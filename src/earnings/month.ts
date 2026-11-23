import { learnParents, loadCatalog } from "../asc/catalog";
import { downloadDetailReport, downloadFinancialReport, downloadSalesDays } from "../asc/reports";
import { addDays, eachDay, financeReportDate, fiscalPeriod, monthLabel, today, toMs, type YearMonth } from "../calendar/fiscal";
import type { Account } from "../config/settings";
import { t } from "../i18n";
import { convert, getRates } from "../money/rates";
import { readSettlement } from "../reports/detail";
import { readFinancialReport } from "../reports/finance";
import { readSalesReports, salesByCountry } from "../reports/sales";
import { totalsByCurrency } from "../reports/tsv";
import { describeSources, forecastMonth, groupByApp, type MonthResult } from "./model";

export interface MonthOptions {
  currency: string;
  useCache: boolean;
  refreshCatalog: boolean;
  /** what is happening now (the loading line) */
  log: (message: string) => void;
  /** progress of the current step */
  progress?: (done: number, total: number, unit?: string) => void;
  /** problems worth reading after the loading line is gone (default: log) */
  warn?: (message: string) => void;
  /**
   * "always": download every day's Sales report.
   * "when-needed": skip them when the Financial Report is there (history views).
   */
  trends?: "always" | "when-needed";
  /** explain the Reports/Trends difference with the Financial Detail Report (default true) */
  settlement?: boolean;
}

const DAY_MS = 86_400_000;
const DAILY_RETENTION_DAYS = 365;
/** Apple publishes a month's Financial Report within days; this long after, none means no sales. */
const PUBLISHED_WITHIN_DAYS = 40;

const sameTotals = (a: Record<string, number>, b: Record<string, number>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((c) => Math.abs((a[c] ?? 0) - (b[c] ?? 0)) < 0.01);

/** Downloads, checks and converts one fiscal month of one account. */
export async function computeMonth(account: Account, ym: YearMonth, opts: MonthOptions): Promise<MonthResult> {
  const now = today();
  let period = fiscalPeriod(ym);

  // 1) Reports: the Financial Report exists only after the month closes
  opts.log(`${account.name} · ${t("Financial Report, {month}", { month: monthLabel(ym) })}`);
  let reportsStatus: MonthResult["reports"]["status"] = "in-progress";
  let reportsMessage: string | undefined;
  let financial: ReturnType<typeof readFinancialReport> | null = null;
  if (period.end < now) {
    const final = toMs(period.end) < Date.now() - PUBLISHED_WITHIN_DAYS * DAY_MS;
    const download = await downloadFinancialReport(account, financeReportDate(ym), opts.useCache, final);
    if (download.status === "ok") {
      financial = readFinancialReport(download.text);
      reportsStatus = "ok";
      // Apple's own dates win over the calculated period
      if (financial.period) period = financial.period;
    } else {
      reportsStatus = download.status;
      reportsMessage = download.status === "not-published" ? undefined : download.message;
    }
  }
  const longClosed = toMs(period.end) < Date.now() - PUBLISHED_WITHIN_DAYS * DAY_MS;
  if (reportsStatus === "not-published" && longClosed) reportsStatus = "none";
  const skipTrends = opts.trends === "when-needed" && (financial !== null || reportsStatus === "none");

  // 2) Trends: one daily Sales report per day of the period, up to today
  const lastDay = period.end < now ? period.end : now;
  const dates = !skipTrends && period.start <= lastDay ? eachDay(period.start, lastDay) : [];
  const days = eachDay(period.start, period.end).length;
  if (dates.length > 0) opts.log(`${account.name} · ${t("daily Sales reports")}`);
  const salesDays = await downloadSalesDays(account, dates, opts.useCache, (d, n) => opts.progress?.(d, n, t("days")));

  const available = salesDays.filter((d) => d.status === "sales" || d.status === "no-sales");
  const failed = salesDays.filter((d) => d.status === "failed");
  const problems: string[] = [];
  const byError = new Map<string, string[]>();
  for (const d of failed) byError.set(d.error ?? "error", [...(byError.get(d.error ?? "error") ?? []), d.date]);
  for (const [error, list] of byError) {
    const range = list.length > 1 ? t("{from} to {to}", { from: list[0], to: list[list.length - 1] }) : list[0];
    problems.push(t("{n} day(s) could not be read ({days}): {error}", { n: list.length, days: range, error }));
  }
  if (!skipTrends && toMs(period.start) < Date.now() - DAILY_RETENTION_DAYS * DAY_MS) {
    problems.push(t("Apple keeps daily Sales reports for about a year, so days older than that are missing."));
  }

  if (!financial && available.length === 0 && failed.length > 0) {
    const w = Math.max(t("Reports").length, t("Trends").length) + 2;
    throw new Error(
      `${t("Nothing could be read for {account}, {month}.", { account: account.name, month: monthLabel(ym) })}\n` +
        `  ${`${t("Reports")}:`.padEnd(w)}${reportsMessage ?? reportsStatus}\n` +
        `  ${`${t("Trends")}:`.padEnd(w)}${problems[0]}`,
    );
  }

  const salesTexts = available.flatMap((d) => (d.text ? [d.text] : []));
  const trendsProducts = readSalesReports(salesTexts);

  // 3) App names and which app each in-app purchase belongs to
  opts.log(`${account.name} · ${t("app names")}`);
  const catalog = await loadCatalog(account, opts.refreshCatalog, opts.warn ?? opts.log);
  learnParents(account, catalog, trendsProducts.values());

  // 4) One exchange rate per currency, as of the last day of the period
  const trendsCountries = salesByCountry(salesTexts);
  const currencies = new Set([
    ...Object.keys(totalsByCurrency(financial?.products.values() ?? [])),
    ...Object.keys(totalsByCurrency(trendsProducts.values())),
  ]);
  opts.log(`${account.name} · ${t(currencies.size === 1 ? "exchange rates for {n} currency" : "exchange rates for {n} currencies", { n: currencies.size })}`);
  const table = await getRates(currencies, opts.currency, period.end);

  const apps = groupByApp(financial?.products ?? null, trendsProducts, catalog, table);
  const reportsTotal = financial ? sum(financial.products.values(), (p) => convert(p.amounts, table)) : null;
  const trendsTotal = sum(trendsProducts.values(), (p) => convert(p.amounts, table));

  // 5) Day by day, and a forecast while the month is running
  const byDate = new Map(salesDays.map((d) => [d.date, d]));
  const daily = eachDay(period.start, period.end).map((date) => {
    const d = byDate.get(date);
    if (!d || (d.status !== "sales" && d.status !== "no-sales")) return { date, total: null };
    return { date, total: d.text ? sum(readSalesReports([d.text]).values(), (p) => convert(p.amounts, table)) : 0 };
  });
  const complete = !skipTrends && available.length === days && failed.length === 0;
  const forecast =
    !complete && failed.length === 0 && period.end >= now
      ? forecastMonth(daily.filter((d): d is { date: string; total: number } => d.total !== null), days)
      : undefined;

  // 6) Countries
  const countryCodes = new Set([...Object.keys(financial?.countries ?? {}), ...Object.keys(trendsCountries)]);
  const countries = [...countryCodes]
    .map((code) => ({ code, reports: convert(financial?.countries[code] ?? {}, table), trends: convert(trendsCountries[code] ?? {}, table) }))
    .sort((a, b) => Math.max(b.reports, b.trends) - Math.max(a.reports, a.trends));

  // 7) Why Reports and Trends differ: sales settled from earlier, and sales settling later
  let settlement: MonthResult["settlement"];
  if (financial && opts.settlement !== false && !skipTrends) {
    opts.log(`${account.name} · ${t("Financial Detail Report")}`);
    const detail = await downloadDetailReport(account, financeReportDate(ym), opts.useCache);
    const split = detail.status === "ok" ? readSettlement(detail.text, period.start) : null;
    // only when the detail adds up to exactly the Financial Report
    if (split && sameTotals(split.total, totalsByCurrency(financial.products.values()))) {
      const inPeriod = convert(split.inPeriod, table);
      settlement = { earlier: convert(split.earlier, table), inPeriod, later: complete ? trendsTotal - inPeriod : undefined };
    }
  }

  const unconverted: MonthResult["rates"]["unconverted"] = [];
  for (const currency of table.missing) {
    const inReports = totalsByCurrency(financial?.products.values() ?? [])[currency];
    const inTrends = totalsByCurrency(trendsProducts.values())[currency];
    if (inReports) unconverted.push({ in: "Reports", currency, amount: inReports });
    if (inTrends) unconverted.push({ in: "Trends", currency, amount: inTrends });
  }

  const paymentDate = addDays(period.end, 33);
  const payment: MonthResult["payment"] =
    reportsTotal !== null
      ? { date: paymentDate, paid: now > paymentDate, amount: reportsTotal, basis: "reports" }
      : forecast
        ? { date: paymentDate, paid: false, amount: forecast.total, basis: "forecast" }
        : { date: paymentDate, paid: now > paymentDate, amount: trendsTotal, basis: complete || skipTrends ? "trends" : "trends-so-far" };

  const rateDates = [...table.rates.values()].map((r) => r.date).filter((d) => /^\d{4}-/.test(d)).sort();

  return {
    account: { name: account.name, vendor: account.vendor },
    month: ym,
    period,
    currency: opts.currency,
    reports: { status: reportsStatus, message: reportsMessage, mismatches: financial?.mismatches ?? [], total: reportsTotal },
    trends: {
      days,
      available: available.length,
      skipped: skipTrends || undefined,
      through: available.map((d) => d.date).sort().at(-1),
      problems,
      total: trendsTotal,
      forecast,
    },
    apps,
    daily,
    countries,
    settlement,
    rates: { date: rateDates.at(-1) ?? period.end, sources: describeSources(table), unconverted },
    payment,
  };
}

function sum<T>(items: Iterable<T>, value: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += value(item);
  return total;
}
