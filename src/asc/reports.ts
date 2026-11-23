import { join } from "node:path";
import { readCached, writeFileAtomic } from "../config/files";
import { vendorCacheDir } from "../config/paths";
import type { Account } from "../config/settings";
import { AscError, ascReport } from "./client";

const NO_SALES = "#no-sales\n";
const PARALLEL = 6;

// ---------------------------------------------------------------------------
// Completeness checks: a report is cached and used only when it is whole
// ---------------------------------------------------------------------------

const lines = (text: string) => text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
const isUsDate = (v: string | undefined) => !!v && /^\d{2}\/\d{2}\/\d{4}$/.test(v);

/** Daily Sales report: header first, every row has the header's number of columns. */
export function isCompleteSalesReport(text: string): boolean {
  const l = lines(text);
  if (l.length === 0 || !l[0].startsWith("Provider\t")) return false;
  const width = l[0].split("\t").length;
  return l.slice(1).every((row) => row.split("\t").length === width);
}

/** Financial Report: as many sales rows as its own "Total_Rows" line says. */
export function isCompleteFinancialReport(text: string): boolean {
  const l = lines(text);
  if (l.length === 0 || !l[0].startsWith("Start Date\t")) return false;
  const stated = l.find((row) => row.startsWith("Total_Rows\t"));
  if (!stated) return false;
  const rows = l.filter((row) => isUsDate(row.split("\t")[0])).length;
  return rows === Number(stated.split("\t")[1]);
}

/**
 * Financial Detail Report: no row count, so the per-currency row totals must equal the
 * country summary at its end.
 */
export function isCompleteDetailReport(text: string): boolean {
  const l = lines(text);
  const headerAt = l.findIndex((row) => row.startsWith("Transaction Date\t"));
  if (headerAt < 0) return false;
  const header = l[headerAt].split("\t");
  const settled = header.indexOf("Settlement Date");
  const amount = header.indexOf("Extended Partner Share");
  const currency = header.indexOf("Partner Share Currency");
  const rows: Record<string, number> = {};
  const summary: Record<string, number> = {};
  let inSummary = false;
  let sawSummary = false;
  for (const row of l.slice(headerAt + 1)) {
    const c = row.split("\t");
    // A transaction row has a transaction or a settlement date (Apple sometimes leaves the first empty)
    if (!inSummary && (isUsDate(c[0]) || isUsDate(c[settled]))) {
      if (c.length < header.length) return false;
      rows[c[currency]] = (rows[c[currency]] ?? 0) + (Number(c[amount]) || 0);
    } else if (c[0] === "Country Of Sale") {
      inSummary = sawSummary = true;
    } else if (inSummary && c.length === 4) {
      summary[c[1]] = (summary[c[1]] ?? 0) + (Number(c[3]) || 0);
    }
  }
  if (!sawSummary) return false;
  const all = new Set([...Object.keys(rows), ...Object.keys(summary)]);
  return [...all].every((cur) => Math.abs((rows[cur] ?? 0) - (summary[cur] ?? 0)) < 0.005);
}

// ---------------------------------------------------------------------------
// Financial reports (published after the month ends; final, so cached)
// ---------------------------------------------------------------------------

export type FinanceDownload =
  | { status: "ok"; text: string; cached: boolean }
  | { status: "not-published" }
  | { status: "no-access"; message: string }
  | { status: "failed"; message: string };

type FinanceKind = { type: "FINANCIAL"; region: "ZZ"; folder: "financial"; complete: (t: string) => boolean } | {
  type: "FINANCE_DETAIL";
  region: "Z1";
  folder: "financial-detail";
  complete: (t: string) => boolean;
};

const FINANCIAL: FinanceKind = { type: "FINANCIAL", region: "ZZ", folder: "financial", complete: isCompleteFinancialReport };
const DETAIL: FinanceKind = { type: "FINANCE_DETAIL", region: "Z1", folder: "financial-detail", complete: isCompleteDetailReport };

const NOT_PUBLISHED = "#not-published\n";

/**
 * `final`: the month ended long ago, so "not published" will not change (an account
 * without sales that month) and is remembered instead of asked again every time.
 */
async function downloadFinance(kind: FinanceKind, account: Account, reportDate: string, useCache: boolean, final = false): Promise<FinanceDownload> {
  const file = join(vendorCacheDir(account.vendor), kind.folder, `${reportDate}.tsv`);
  if (useCache) {
    const cached = readCached(file, (t) => t === NOT_PUBLISHED || kind.complete(t));
    if (cached === NOT_PUBLISHED) return { status: "not-published" };
    if (cached !== null) return { status: "ok", text: cached, cached: true };
  }
  const query = new URLSearchParams({
    "filter[vendorNumber]": account.vendor,
    "filter[reportType]": kind.type,
    "filter[regionCode]": kind.region,
    "filter[reportDate]": reportDate,
  });
  try {
    const text = await ascReport(account.key, `/v1/financeReports?${query}`);
    if (!kind.complete(text)) return { status: "failed", message: "the downloaded report is incomplete; try again" };
    writeFileAtomic(file, text);
    return { status: "ok", text, cached: false };
  } catch (error) {
    if (error instanceof AscError && error.status === 404) {
      if (final) writeFileAtomic(file, NOT_PUBLISHED);
      return { status: "not-published" };
    }
    if (error instanceof AscError && error.status === 403) return { status: "no-access", message: error.message };
    return { status: "failed", message: (error as Error).message };
  }
}

/** `reportDate` is the fiscal YYYY-MM (see financeReportDate). */
export const downloadFinancialReport = (account: Account, reportDate: string, useCache: boolean, final = false) =>
  downloadFinance(FINANCIAL, account, reportDate, useCache, final);

/** Same money as the Financial Report, one row per transaction with its transaction and settlement date. */
export const downloadDetailReport = (account: Account, reportDate: string, useCache: boolean) =>
  downloadFinance(DETAIL, account, reportDate, useCache);

// ---------------------------------------------------------------------------
// Daily Sales and Trends reports
// ---------------------------------------------------------------------------

export type DayStatus = "sales" | "no-sales" | "not-yet" | "failed";

export interface SalesDay {
  date: string;
  status: DayStatus;
  text?: string;
  error?: string;
}

/** Daily report types this tool reads. */
export type DailyKind = "SALES" | "SUBSCRIPTION" | "SUBSCRIPTION_EVENT";

const DAILY: Record<DailyKind, { version: string; folder: string; header: string }> = {
  SALES: { version: "1_0", folder: "sales", header: "Provider\t" },
  SUBSCRIPTION: { version: "1_4", folder: "subscriptions", header: "App Name\t" },
  SUBSCRIPTION_EVENT: { version: "1_4", folder: "subscription-events", header: "Event Date\t" },
};

function isCompleteDaily(kind: DailyKind, text: string): boolean {
  if (kind === "SALES") return isCompleteSalesReport(text);
  const l = lines(text);
  if (l.length === 0 || !l[0].startsWith(DAILY[kind].header)) return false;
  const width = l[0].split("\t").length;
  return l.slice(1).every((row) => row.split("\t").length === width);
}

async function downloadDay(account: Account, date: string, kind: DailyKind): Promise<SalesDay> {
  const query = new URLSearchParams({
    "filter[frequency]": "DAILY",
    "filter[reportType]": kind,
    "filter[reportSubType]": "SUMMARY",
    "filter[vendorNumber]": account.vendor,
    "filter[reportDate]": date,
    "filter[version]": DAILY[kind].version,
  });
  try {
    const text = await ascReport(account.key, `/v1/salesReports?${query}`);
    if (!isCompleteDaily(kind, text)) return { date, status: "failed", error: "incomplete download" };
    return { date, status: "sales", text };
  } catch (error) {
    // Apple answers 404 both for "nothing that day" and "not published yet"
    if (error instanceof AscError && error.status === 404) {
      if (/no sales|no (subscription|subscriber)|were no/i.test(error.message)) return { date, status: "no-sales" };
      if (/not available yet/i.test(error.message)) return { date, status: "not-yet" };
    }
    return { date, status: "failed", error: (error as Error).message };
  }
}

/**
 * One daily report per date, a few in parallel. Published days are final and cached;
 * days not published yet and failures are fetched again next time.
 */
export async function downloadDays(
  account: Account,
  dates: string[],
  useCache: boolean,
  kind: DailyKind = "SALES",
  onProgress?: (done: number, total: number) => void,
): Promise<SalesDay[]> {
  const dir = join(vendorCacheDir(account.vendor), DAILY[kind].folder);
  const result: SalesDay[] = new Array(dates.length);
  let cursor = 0;
  let finished = 0;
  const tick = () => onProgress?.(++finished, dates.length);

  async function worker(): Promise<void> {
    while (cursor < dates.length) {
      const i = cursor++;
      const date = dates[i];
      const file = join(dir, `${date}.tsv`);
      if (useCache) {
        const text = readCached(file, (t) => t === NO_SALES || isCompleteDaily(kind, t));
        if (text !== null) {
          result[i] = text === NO_SALES ? { date, status: "no-sales" } : { date, status: "sales", text };
          tick();
          continue;
        }
      }
      const day = await downloadDay(account, date, kind);
      // "No sales" is remembered only once it can be trusted: Apple sometimes says it for a
      // day whose report is just late (seen for subscription snapshots), so recent days and
      // subscription snapshots are asked again next time.
      const recent = date > new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
      if (day.status === "sales") writeFileAtomic(file, day.text!);
      else if (day.status === "no-sales" && !recent && kind !== "SUBSCRIPTION") writeFileAtomic(file, NO_SALES);
      result[i] = day;
      tick();
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL, dates.length) }, worker));
  return result;
}

/** Kept for callers that only read Sales reports. */
export const downloadSalesDays = (account: Account, dates: string[], useCache: boolean, onProgress?: (done: number, total: number) => void) =>
  downloadDays(account, dates, useCache, "SALES", onProgress);

/** Used by setup and doctor: proves the key and vendor number are accepted for Sales reports. */
export async function checkSalesAccess(account: Account): Promise<{ ok: boolean; message: string }> {
  const date = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const day = await downloadDay(account, date, "SALES");
  // any answer about the report itself (even "not found") means key and vendor were accepted
  if (day.status !== "failed" || /^The request expected results|^NOT_FOUND|none were found/i.test(day.error ?? "")) {
    return { ok: true, message: "Sales reports: OK" };
  }
  if (/\(401\)/.test(day.error ?? "")) return { ok: false, message: day.error! };
  if (/\(403\)/.test(day.error ?? "")) return { ok: false, message: "Sales reports: this key can't read them (403). Use a key with the Finance role." };
  return { ok: false, message: `Sales reports: ${day.error}. Check the vendor number.` };
}
