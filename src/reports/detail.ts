import { fromUsDate } from "../calendar/fiscal";
import { splitTsv } from "./tsv";

/**
 * Financial Detail Report (FINANCE_DETAIL, region Z1): the Financial Report's money,
 * one row per transaction with the day it was made and the day Apple settled it.
 * Used to explain why Reports and Trends differ.
 */
export interface SettlementSplit {
  /** per currency: transactions made before the period started, settled in this report */
  earlier: Record<string, number>;
  /** per currency: transactions made inside the period */
  inPeriod: Record<string, number>;
  /** per currency: everything in the report */
  total: Record<string, number>;
}

export function readSettlement(text: string, periodStart: string): SettlementSplit | null {
  const lines = text.replace(/\r/g, "").split("\n");
  const at = lines.findIndex((l) => l.startsWith("Transaction Date\t"));
  if (at < 0) return null;
  const { header, rows } = splitTsv(lines.slice(at).join("\n"));
  const iDate = header.indexOf("Transaction Date");
  const iSettled = header.indexOf("Settlement Date");
  const iAmount = header.indexOf("Extended Partner Share");
  const iCurrency = header.indexOf("Partner Share Currency");
  if (iDate < 0 || iAmount < 0 || iCurrency < 0) return null;

  const split: SettlementSplit = { earlier: {}, inPeriod: {}, total: {} };
  for (const r of rows) {
    // Apple sometimes leaves the transaction date empty; the settlement date is the next best
    const date = fromUsDate(r[iDate] ?? "") ?? fromUsDate(r[iSettled] ?? "");
    if (!date) continue; // summary lines
    const currency = (r[iCurrency] ?? "").trim();
    const amount = Number(r[iAmount]) || 0;
    const bucket = date < periodStart ? split.earlier : split.inPeriod;
    bucket[currency] = (bucket[currency] ?? 0) + amount;
    split.total[currency] = (split.total[currency] ?? 0) + amount;
  }
  return split;
}
