const formatters = new Map<string, Intl.NumberFormat>();

/** 1234.5, "USD" -> "$1,234.50"; works for any ISO currency code. */
export function money(amount: number, currency: string): string {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" });
    formatters.set(currency, f);
  }
  // avoid "-$0.00"
  return f.format(Math.abs(amount) < 0.005 ? 0 : amount);
}

/** Plain number with the currency code, for amounts that could not be converted: "4,389.22 KZT" */
export function rawAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
