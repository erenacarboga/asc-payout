import { addAmount, columns, splitTsv, type Product } from "./tsv";

/**
 * Sales and Trends report (SALES / SUMMARY), one file per day.
 * Proceeds of a row = Units x Developer Proceeds (per unit, in Currency of Proceeds).
 * Refunds are rows with negative Units.
 */
const SALES_COLUMNS = {
  sku: "SKU",
  title: "Title",
  typeId: "Product Type Identifier",
  units: "Units",
  proceeds: "Developer Proceeds",
  currency: "Currency of Proceeds",
  appleId: "Apple Identifier",
  parent: "Parent Identifier",
} as const;

/** Adds the paid rows of one or more daily reports into `into` (by product). */
export function readSalesReports(reports: string[], into = new Map<string, Product>()): Map<string, Product> {
  for (const text of reports) {
    const { header, rows } = splitTsv(text);
    if (header.length === 0) continue;
    const c = columns(header, SALES_COLUMNS, "Sales report");
    for (const r of rows) {
      const amount = (Number(r[c.units]) || 0) * (Number(r[c.proceeds]) || 0);
      const currency = (r[c.currency] ?? "").trim();
      const sku = (r[c.sku] ?? "").trim();
      const appleId = (r[c.appleId] ?? "").trim();
      if (amount === 0 || !currency || !(sku || appleId)) continue;
      addAmount(
        into,
        {
          id: sku || appleId,
          appleId,
          title: (r[c.title] ?? "").trim() || sku,
          typeId: (r[c.typeId] ?? "").trim(),
          parentSku: (r[c.parent] ?? "").trim() || undefined,
        },
        currency,
        amount,
      );
    }
  }
  return into;
}
