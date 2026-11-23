import type { Period, YearMonth } from "../calendar/fiscal";
import { appOf, type Catalog } from "../asc/catalog";
import { t } from "../i18n";
import { convert, type RateTable } from "../money/rates";
import { isInAppType, type Product } from "../reports/tsv";

export interface Line {
  name: string;
  reports: number;
  trends: number;
  /** some of the amounts behind this line had no exchange rate (not in the numbers) */
  unconverted?: { reports?: boolean; trends?: boolean };
}

export interface AppGroup extends Line {
  /** "app:<sku>" or "product:<id>" when the app is unknown */
  key: string;
  /** App Store ID of the app, when known */
  appId?: string;
  items: Line[];
}

export type ReportsStatus = "ok" | "in-progress" | "not-published" | "none" | "no-access" | "failed";

export interface MonthResult {
  account: { name: string; vendor: string };
  month: YearMonth;
  period: Period;
  currency: string;
  reports: {
    status: ReportsStatus;
    message?: string;
    /** Currencies where the report's rows don't match its own summary */
    mismatches: { currency: string; rows: number; summary: number }[];
    total: number | null;
  };
  trends: {
    days: number;
    available: number;
    /** daily reports were not downloaded (history view with a Financial Report) */
    skipped?: boolean;
    through?: string;
    problems: string[];
    total: number;
    forecast?: { total: number; perDay: number; remainingDays: number; basisDays: number };
  };
  apps: AppGroup[];
  /** Trends per day of the period; null = not available (yet) */
  daily: { date: string; total: number | null }[];
  countries: { code: string; reports: number; trends: number }[];
  /**
   * Why Reports differ from Trends, from the Financial Detail Report:
   * `earlier` = sales made before the period, settled in this report;
   * `inPeriod` = this period's sales settled in this report;
   * `later` = this period's sales Apple settles in the next report (Trends - inPeriod).
   */
  settlement?: { earlier: number; inPeriod: number; later?: number };
  rates: {
    date: string;
    sources: string;
    unconverted: { in: "Reports" | "Trends"; currency: string; amount: number }[];
  };
  payment: {
    date: string;
    paid: boolean;
    amount: number;
    basis: "reports" | "forecast" | "trends" | "trends-so-far";
  };
}

export const APP_SALES = "(App sales)";

/**
 * Joins Reports and Trends by product and groups the products under their apps.
 * Sorted by size, largest first.
 */
export function groupByApp(
  reports: Map<string, Product> | null,
  trends: Map<string, Product>,
  catalog: Catalog,
  table: RateTable,
): AppGroup[] {
  const groups = new Map<string, AppGroup>();
  const lineIndex = new Map<string, Line>();

  const add = (p: Product, field: "reports" | "trends") => {
    const app = appOf(catalog, p);
    const groupKey = app ? `app:${app.key}` : `product:${p.id}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { key: groupKey, appId: app?.id, name: app ? app.name : catalog.names[p.id] || p.title, reports: 0, trends: 0, items: [] };
      groups.set(groupKey, group);
    }
    const isApp = !isInAppType(p.typeId);
    const lineKey = `${groupKey}|${p.id}`;
    let line = lineIndex.get(lineKey);
    if (!line) {
      line = { name: isApp ? APP_SALES : catalog.names[p.id] || p.title, reports: 0, trends: 0 };
      lineIndex.set(lineKey, line);
      group.items.push(line);
    }
    const value = convert(p.amounts, table);
    line[field] += value;
    group[field] += value;
    if (table.missing.some((c) => p.amounts[c])) {
      line.unconverted = { ...line.unconverted, [field]: true };
      group.unconverted = { ...group.unconverted, [field]: true };
    }
  };

  for (const p of reports?.values() ?? []) add(p, "reports");
  for (const p of trends.values()) add(p, "trends");

  const size = (l: Line) => Math.max(Math.abs(l.reports), Math.abs(l.trends));
  const result = [...groups.values()];
  for (const g of result) g.items.sort((a, b) => size(b) - size(a));
  return result.sort((a, b) => size(b) - size(a));
}

/**
 * Full-month estimate for a month in progress: total so far plus the remaining days at
 * the average of the last `window` days with data. Needs at least 3 days.
 */
export function forecastMonth(dailyTotals: { date: string; total: number }[], days: number, window = 7) {
  if (dailyTotals.length < 3 || dailyTotals.length >= days) return undefined;
  const sorted = [...dailyTotals].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-window);
  const perDay = recent.reduce((s, d) => s + d.total, 0) / recent.length;
  const soFar = sorted.reduce((s, d) => s + d.total, 0);
  const remainingDays = days - sorted.length;
  return { total: soFar + perDay * remainingDays, perDay, remainingDays, basisDays: recent.length };
}

/** "ECB; exchange-api for KZT, TWD" */
export function describeSources(table: RateTable): string {
  const by = new Map<string, string[]>();
  for (const [cur, rate] of table.rates) {
    if (cur === table.currency) continue;
    by.set(rate.source, [...(by.get(rate.source) ?? []), cur]);
  }
  return [...by.entries()].map(([src, curs]) => (src === "ECB" ? "ECB" : t("{source} for {currencies}", { source: src, currencies: curs.sort().join(", ") }))).join("; ");
}
