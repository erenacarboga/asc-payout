import { fromUsDate } from "../calendar/fiscal";
import { columns, splitTsv } from "./tsv";

/** One paid row of a daily Sales report, with what the aggregated readers drop. */
export interface SaleRow {
  date: string;
  id: string;
  appleId: string;
  title: string;
  typeId: string;
  parentSku?: string;
  country: string;
  /** negative for refunds */
  units: number;
  /** units x developer proceeds, in `currency` */
  amount: number;
  currency: string;
}

export function readSaleRows(text: string): SaleRow[] {
  const { header, rows } = splitTsv(text);
  if (header.length === 0) return [];
  const c = columns(
    header,
    {
      sku: "SKU",
      title: "Title",
      typeId: "Product Type Identifier",
      units: "Units",
      proceeds: "Developer Proceeds",
      currency: "Currency of Proceeds",
      appleId: "Apple Identifier",
      parent: "Parent Identifier",
      country: "Country Code",
      begin: "Begin Date",
    },
    "Sales report",
  );
  const out: SaleRow[] = [];
  for (const r of rows) {
    const units = Number(r[c.units]) || 0;
    const amount = units * (Number(r[c.proceeds]) || 0);
    const currency = (r[c.currency] ?? "").trim();
    const id = (r[c.sku] ?? "").trim() || (r[c.appleId] ?? "").trim();
    if (amount === 0 || !currency || !id) continue;
    out.push({
      date: fromUsDate(r[c.begin] ?? "") ?? "",
      id,
      appleId: (r[c.appleId] ?? "").trim(),
      title: (r[c.title] ?? "").trim() || id,
      typeId: (r[c.typeId] ?? "").trim(),
      parentSku: (r[c.parent] ?? "").trim() || undefined,
      country: (r[c.country] ?? "").trim() || "??",
      units,
      amount,
      currency,
    });
  }
  return out;
}
