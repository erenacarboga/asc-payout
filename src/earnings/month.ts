import { learnParents, loadCatalog } from "../asc/catalog";
import { downloadFinancialReport, downloadSalesDays } from "../asc/reports";
import { addDays, eachDay, financeReportDate, fiscalPeriod, monthLabel, today, toMs, type YearMonth } from "../calendar/fiscal";
import type { Account } from "../config/settings";
import { convert, getRates } from "../money/rates";
import { readFinancialReport } from "../reports/finance";
import { readSalesReports } from "../reports/sales";
import { totalsByCurrency } from "../reports/tsv";
import { describeSources, forecastMonth, groupByApp, type MonthResult } from "./model";

export interface MonthOptions {
  currency: string;
  useCache: boolean;
  refreshCatalog: boolean;
  /** progress messages (stderr) */
  log: (message: string) => void;
}

const DAILY_RETENTION_DAYS = 365;

/** Downloads, checks and converts one fiscal month of one account. */
export async function computeMonth(account: Account, ym: YearMonth, opts: MonthOptions): Promise<MonthResult> {
  const now = today();
  let period = fiscalPeriod(ym);

  // 1) Reports: the Financial Report exists only after the month closes
  opts.log(`Reports: Financial Report for ${monthLabel(ym)}...`);
  let reportsStatus: MonthResult["reports"]["status"] = "in-progress";
  let reportsMessage: string | undefined;
  let financial: ReturnType<typeof readFinancialReport> | null = null;
  if (period.end < now) {
    const download = await downloadFinancialReport(account, financeReportDate(ym), opts.useCache);
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

  // 2) Trends: one daily Sales report per day of the period, up to today
  const lastDay = period.end < now ? period.end : now;
  const dates = period.start <= lastDay ? eachDay(period.start, lastDay) : [];
  const days = eachDay(period.start, period.end).length;
  opts.log(`Trends: daily Sales reports (${dates.length} day${dates.length === 1 ? "" : "s"})...`);
  const salesDays = await downloadSalesDays(account, dates, opts.useCache);

  const available = salesDays.filter((d) => d.status === "sales" || d.status === "no-sales");
  const failed = salesDays.filter((d) => d.status === "failed");
  const problems: string[] = [];
  const byError = new Map<string, string[]>();
  for (const d of failed) byError.set(d.error ?? "error", [...(byError.get(d.error ?? "error") ?? []), d.date]);
  for (const [error, list] of byError) {
    problems.push(`${list.length} day(s) could not be read (${list[0]}${list.length > 1 ? ` to ${list[list.length - 1]}` : ""}): ${error}`);
  }
  if (toMs(period.start) < Date.now() - DAILY_RETENTION_DAYS * 86_400_000) {
    problems.push("Apple keeps daily Sales reports for about a year, so days older than that are missing.");
  }

  if (!financial && available.length === 0 && failed.length > 0) {
    throw new Error(
      `Nothing could be read for ${account.name}, ${monthLabel(ym)}.\n` +
        `  Reports: ${reportsMessage ?? reportsStatus}\n` +
        `  Trends:  ${problems[0]}`,
    );
  }

  const trendsProducts = readSalesReports(available.flatMap((d) => (d.text ? [d.text] : [])));

  // 3) App names and which app each in-app purchase belongs to
  const catalog = await loadCatalog(account, opts.refreshCatalog, opts.log);
  learnParents(account, catalog, trendsProducts.values());

  // 4) One exchange rate per currency, as of the last day of the period
  const currencies = new Set([
    ...Object.keys(totalsByCurrency(financial?.products.values() ?? [])),
    ...Object.keys(totalsByCurrency(trendsProducts.values())),
  ]);
  opts.log(`Converting ${currencies.size} currenc${currencies.size === 1 ? "y" : "ies"} to ${opts.currency}...`);
  const table = await getRates(currencies, opts.currency, period.end);

  const apps = groupByApp(financial?.products ?? null, trendsProducts, catalog, table);
  const reportsTotal = financial ? sum(financial.products.values(), (p) => convert(p.amounts, table)) : null;
  const trendsTotal = sum(trendsProducts.values(), (p) => convert(p.amounts, table));

  // 5) Forecast while the month is running
  const complete = available.length === days && failed.length === 0;
  const forecast =
    !complete && failed.length === 0 && period.end >= now
      ? forecastMonth(
          available.map((d) => ({ date: d.date, total: d.text ? sum(readSalesReports([d.text]).values(), (p) => convert(p.amounts, table)) : 0 })),
          days,
        )
      : undefined;

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
        : { date: paymentDate, paid: now > paymentDate, amount: trendsTotal, basis: complete ? "trends" : "trends-so-far" };

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
      through: available.map((d) => d.date).sort().at(-1),
      problems,
      total: trendsTotal,
      forecast,
    },
    apps,
    rates: { date: rateDates.at(-1) ?? period.end, sources: describeSources(table), unconverted },
    payment,
  };
}

function sum<T>(items: Iterable<T>, value: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += value(item);
  return total;
}

