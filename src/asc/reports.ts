import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, vendorCacheDir } from "../config/paths";
import type { Account } from "../config/settings";
import { AscError, ascReport } from "./client";

const NO_SALES = "#no-sales\n";
const PARALLEL = 6;

// ---------------------------------------------------------------------------
// Financial Report
// ---------------------------------------------------------------------------

export type FinanceDownload =
  | { status: "ok"; text: string; cached: boolean }
  | { status: "not-published" }
  | { status: "no-access"; message: string }
  | { status: "failed"; message: string };

/** `reportDate` is the fiscal YYYY-MM (see financeReportDate). Published reports are final, so they are cached. */
export async function downloadFinancialReport(account: Account, reportDate: string, useCache: boolean): Promise<FinanceDownload> {
  const file = join(vendorCacheDir(account.vendor), "financial", `${reportDate}.tsv`);
  if (useCache && existsSync(file)) return { status: "ok", text: readFileSync(file, "utf-8"), cached: true };

  const query = new URLSearchParams({
    "filter[vendorNumber]": account.vendor,
    "filter[reportType]": "FINANCIAL",
    "filter[regionCode]": "ZZ",
    "filter[reportDate]": reportDate,
  });
  try {
    const text = await ascReport(account.key, `/v1/financeReports?${query}`);
    ensureDir(join(vendorCacheDir(account.vendor), "financial"));
    writeFileSync(file, text, "utf-8");
    return { status: "ok", text, cached: false };
  } catch (error) {
    if (error instanceof AscError && error.status === 404) return { status: "not-published" };
    if (error instanceof AscError && error.status === 403) return { status: "no-access", message: error.message };
    return { status: "failed", message: (error as Error).message };
  }
}

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

async function downloadDay(account: Account, date: string): Promise<SalesDay> {
  const query = new URLSearchParams({
    "filter[frequency]": "DAILY",
    "filter[reportType]": "SALES",
    "filter[reportSubType]": "SUMMARY",
    "filter[vendorNumber]": account.vendor,
    "filter[reportDate]": date,
    "filter[version]": "1_0",
  });
  try {
    return { date, status: "sales", text: await ascReport(account.key, `/v1/salesReports?${query}`) };
  } catch (error) {
    // Apple answers 404 both for "no sales that day" and "not published yet"
    if (error instanceof AscError && error.status === 404) {
      if (/no sales/i.test(error.message)) return { date, status: "no-sales" };
      if (/not available yet/i.test(error.message)) return { date, status: "not-yet" };
    }
    return { date, status: "failed", error: (error as Error).message };
  }
}

/**
 * One SALES/SUMMARY/DAILY report per date, a few in parallel. Published days are final
 * and cached; days not published yet and failures are fetched again next time.
 */
export async function downloadSalesDays(account: Account, dates: string[], useCache: boolean): Promise<SalesDay[]> {
  const dir = join(vendorCacheDir(account.vendor), "sales");
  const result: SalesDay[] = new Array(dates.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < dates.length) {
      const i = cursor++;
      const date = dates[i];
      const file = join(dir, `${date}.tsv`);
      if (useCache && existsSync(file)) {
        const text = readFileSync(file, "utf-8");
        result[i] = text === NO_SALES ? { date, status: "no-sales" } : { date, status: "sales", text };
        continue;
      }
      const day = await downloadDay(account, date);
      if (day.status === "sales" || day.status === "no-sales") {
        ensureDir(dir);
        writeFileSync(file, day.status === "sales" ? day.text! : NO_SALES, "utf-8");
      }
      result[i] = day;
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL, dates.length) }, worker));
  return result;
}

/** Used by setup: proves the key and vendor number are accepted for Sales reports. */
export async function checkSalesAccess(account: Account): Promise<{ ok: boolean; message: string }> {
  const date = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const day = await downloadDay(account, date);
  if (day.status !== "failed") return { ok: true, message: "Sales reports: OK" };
  if (/\(401\)/.test(day.error ?? "")) return { ok: false, message: day.error! };
  if (/\(403\)/.test(day.error ?? "")) return { ok: false, message: "Sales reports: this key can't read them (403). Use a key with the Finance role." };
  return { ok: false, message: `Sales reports: ${day.error}. Check the vendor number.` };
}
