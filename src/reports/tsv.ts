/** Proceeds of one product, per currency of proceeds. */
export interface Product {
  /** Product ID for in-app purchases, SKU for apps */
  id: string;
  appleId: string;
  title: string;
  typeId: string;
  /** SKU of the app an in-app purchase belongs to (Sales reports only) */
  parentSku?: string;
  amounts: Record<string, number>;
}

export const isInAppType = (typeId: string): boolean => /^(IA|FI)/.test(typeId);

/** Splits a report into header and rows; tolerates \r\n and trailing blank lines. */
export function splitTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return { header: [], rows: [] };
  return { header: lines[0].split("\t").map((h) => h.trim()), rows: lines.slice(1).map((line) => line.split("\t")) };
}

/** Index of each named column; throws when Apple changes the format. */
export function columns<K extends string>(header: string[], wanted: Record<K, string>, report: string): Record<K, number> {
  const out = {} as Record<K, number>;
  const missing: string[] = [];
  for (const [key, name] of Object.entries(wanted) as [K, string][]) {
    out[key] = header.indexOf(name);
    if (out[key] < 0) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(`Unexpected ${report} format: column(s) ${missing.join(", ")} not found.`);
  }
  return out;
}

export function addAmount(products: Map<string, Product>, base: Omit<Product, "amounts">, currency: string, amount: number): void {
  let p = products.get(base.id);
  if (!p) {
    p = { ...base, amounts: {} };
    products.set(base.id, p);
  }
  if (!p.parentSku && base.parentSku) p.parentSku = base.parentSku;
  p.amounts[currency] = (p.amounts[currency] ?? 0) + amount;
}

/** Total per currency over many products. */
export function totalsByCurrency(products: Iterable<Product>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const p of products) for (const [cur, v] of Object.entries(p.amounts)) totals[cur] = (totals[cur] ?? 0) + v;
  return totals;
}
