import { fromUsDate, type Period } from "../calendar/fiscal";
import { addAmount, columns, splitTsv, type Product } from "./tsv";

/**
 * Financial Report (FINANCIAL, region ZZ = all regions in one file).
 *
 * The file is a table of sales rows followed by a summary: a "Total_Rows" line and a
 * per-country table (Country Of Sale, Partner Share Currency, Quantity, Extended
 * Partner Share). The summary is used to check the rows were read completely.
 */
const FINANCE_COLUMNS = {
  start: "Start Date",
  end: "End Date",
  id: "Vendor Identifier",
  extended: "Extended Partner Share",
  currency: "Partner Share Currency",
  appleId: "Apple Identifier",
  title: "Title",
  typeId: "Product Type Identifier",
  country: "Country Of Sale",
} as const;

export interface FinancialReport {
  products: Map<string, Product>;
  /** per country of sale, per currency */
  countries: Record<string, Record<string, number>>;
  /** The period Apple states in the rows (most common start/end pair) */
  period: Period | null;
  /** Currencies where the rows don't add up to the report's own summary */
  mismatches: { currency: string; rows: number; summary: number }[];
  rowCount: number;
}

export function readFinancialReport(text: string): FinancialReport {
  const { header, rows } = splitTsv(text);
  const products = new Map<string, Product>();
  const countries: Record<string, Record<string, number>> = {};
  if (header.length === 0) return { products, countries, period: null, mismatches: [], rowCount: 0 };

  const c = columns(header, FINANCE_COLUMNS, "Financial Report");
  const rowTotals: Record<string, number> = {};
  const summaryTotals: Record<string, number> = {};
  const periods = new Map<string, number>();
  let inSummary = false;
  let hasSummary = false;
  let rowCount = 0;

  for (const r of rows) {
    const start = fromUsDate(r[c.start] ?? "");
    const end = fromUsDate(r[c.end] ?? "");

    if (!inSummary && start && end) {
      rowCount++;
      const currency = (r[c.currency] ?? "").trim();
      const amount = Number(r[c.extended]) || 0;
      periods.set(`${start}|${end}`, (periods.get(`${start}|${end}`) ?? 0) + 1);
      rowTotals[currency] = (rowTotals[currency] ?? 0) + amount;
      if (amount !== 0 && currency) {
        const bucket = (countries[(r[c.country] ?? "").trim() || "??"] ??= {});
        bucket[currency] = (bucket[currency] ?? 0) + amount;
      }
      const id = (r[c.id] ?? "").trim() || (r[c.appleId] ?? "").trim();
      if (amount !== 0 && currency && id) {
        addAmount(
          products,
          { id, appleId: (r[c.appleId] ?? "").trim(), title: (r[c.title] ?? "").trim() || id, typeId: (r[c.typeId] ?? "").trim() },
          currency,
          amount,
        );
      }
      continue;
    }

    if (r[0]?.trim() === "Country Of Sale") {
      inSummary = true;
      hasSummary = true;
      continue;
    }
    // Summary row: country, currency, quantity, extended partner share
    if (inSummary && r.length === 4) {
      summaryTotals[r[1].trim()] = (summaryTotals[r[1].trim()] ?? 0) + (Number(r[3]) || 0);
    }
  }

  const mismatches = hasSummary
    ? [...new Set([...Object.keys(rowTotals), ...Object.keys(summaryTotals)])]
        .map((currency) => ({ currency, rows: rowTotals[currency] ?? 0, summary: summaryTotals[currency] ?? 0 }))
        .filter((m) => Math.abs(m.rows - m.summary) > 0.005)
    : [];

  const top = [...periods.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const period = top ? { start: top.split("|")[0], end: top.split("|")[1] } : null;

  return { products, countries, period, mismatches, rowCount };
}
