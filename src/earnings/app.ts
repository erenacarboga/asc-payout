import { appOf, loadCatalog } from "../asc/catalog";
import { downloadSalesDays } from "../asc/reports";
import { eachDay, today, type Period, type YearMonth } from "../calendar/fiscal";
import type { Account } from "../config/settings";
import { convert, getRates } from "../money/rates";
import { readSaleRows, type SaleRow } from "../reports/rows";
import type { AppGroup, MonthResult } from "./model";

/**
 * One app in one month: its products (from the month result), and from the daily
 * Sales reports its countries, its day-by-day sales and its refunds. The reports were
 * downloaded for the month view already, so this reads them from the cache.
 */
export interface AppDetail {
  account: string;
  app: AppGroup;
  month: YearMonth;
  period: Period;
  currency: string;
  hasReports: boolean;
  daily: { date: string; total: number | null }[];
  countries: { code: string; amount: number; units: number }[];
  /** paid units sold and refunded in the period, and the money refunded */
  sold: number;
  refunded: number;
  refundAmount: number;
}

export async function computeAppDetail(account: Account, month: MonthResult, app: AppGroup, useCache = true): Promise<AppDetail> {
  const period = month.period;
  const lastDay = period.end < today() ? period.end : today();
  const dates = period.start <= lastDay ? eachDay(period.start, lastDay) : [];
  const days = await downloadSalesDays(account, dates, useCache);
  const catalog = await loadCatalog(account, false, () => {});

  const mine = (row: SaleRow) => {
    const owner = appOf(catalog, row);
    const key = owner ? `app:${owner.key}` : `product:${row.id}`;
    return key === app.key;
  };

  const rowsByDay = new Map<string, SaleRow[]>();
  const currencies = new Set<string>();
  for (const d of days) {
    if (d.status !== "sales" || !d.text) continue;
    const rows = readSaleRows(d.text).filter(mine);
    rowsByDay.set(d.date, rows);
    for (const r of rows) currencies.add(r.currency);
  }
  const table = await getRates(currencies, month.currency, period.end);
  const value = (r: SaleRow) => convert({ [r.currency]: r.amount }, table);

  const available = new Set(days.filter((d) => d.status === "sales" || d.status === "no-sales").map((d) => d.date));
  const daily = eachDay(period.start, period.end).map((date) => ({
    date,
    total: available.has(date) ? (rowsByDay.get(date) ?? []).reduce((s, r) => s + value(r), 0) : null,
  }));

  const byCountry = new Map<string, { amount: number; units: number }>();
  let sold = 0;
  let refunded = 0;
  let refundAmount = 0;
  for (const rows of rowsByDay.values()) {
    for (const r of rows) {
      const c = byCountry.get(r.country) ?? { amount: 0, units: 0 };
      c.amount += value(r);
      c.units += r.units;
      byCountry.set(r.country, c);
      if (r.units > 0) sold += r.units;
      else {
        refunded += -r.units;
        refundAmount += -value(r);
      }
    }
  }

  return {
    account: account.name,
    app,
    month: month.month,
    period,
    currency: month.currency,
    hasReports: month.reports.total !== null,
    daily,
    countries: [...byCountry.entries()].map(([code, v]) => ({ code, ...v })).sort((a, b) => b.amount - a.amount),
    sold,
    refunded,
    refundAmount,
  };
}
