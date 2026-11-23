/**
 * Exchange rates into the display currency, as of a given day.
 *
 * Sources, most authoritative first:
 *   1. ECB reference rates via Frankfurter (about 30 currencies, dated)
 *   2. fawazahmed0/exchange-api snapshots (about 200 currencies, dated), two mirrors
 *   3. the same, latest snapshot
 *   4. open.er-api.com (latest)
 * Only currency codes and dates are sent. A currency that no source knows is reported
 * as missing; it is never converted 1:1.
 */

export interface Rate {
  /** amount in `from` x value = amount in the display currency */
  value: number;
  source: "ECB" | "exchange-api" | "open.er-api";
  date: string;
}

export interface RateTable {
  currency: string;
  rates: Map<string, Rate>;
  missing: string[];
}

const TIMEOUT_MS = 15_000;

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

type Lookup = (from: string, to: string, date: string | null) => Promise<Rate | null>;

const ecb: Lookup = async (from, to, date) => {
  const data = await getJson(`https://api.frankfurter.dev/v1/${date ?? "latest"}?base=${from}&symbols=${to}`);
  const value = data?.rates?.[to];
  return valid(value) ? { value, source: "ECB", date: data.date ?? date ?? "latest" } : null;
};

const exchangeApi: Lookup = async (from, to, date) => {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  const tag = date ?? "latest";
  for (const url of [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/${f}.json`,
    `https://${tag}.currency-api.pages.dev/v1/currencies/${f}.json`,
  ]) {
    try {
      const data = await getJson(url);
      const value = data?.[f]?.[t];
      if (valid(value)) return { value, source: "exchange-api", date: data.date ?? tag };
    } catch {
      // next mirror
    }
  }
  return null;
};

const openErApi: Lookup = async (from, to) => {
  const data = await getJson(`https://open.er-api.com/v6/latest/${from}`);
  const value = data?.rates?.[to];
  if (data?.result !== "success" || !valid(value)) return null;
  const updated = Date.parse(data.time_last_update_utc ?? "");
  return { value, source: "open.er-api", date: Number.isNaN(updated) ? "latest" : new Date(updated).toISOString().slice(0, 10) };
};

async function findRate(from: string, to: string, date: string | null): Promise<Rate | null> {
  const attempts: [Lookup, string | null][] = date
    ? [[ecb, date], [exchangeApi, date], [exchangeApi, null], [openErApi, null]]
    : [[ecb, null], [exchangeApi, null], [openErApi, null]];
  for (const [lookup, d] of attempts) {
    try {
      const rate = await lookup(from, to, d);
      if (rate) return rate;
    } catch (error) {
      if (process.env.DEBUG) console.error(`  rate ${from}->${to} (${d ?? "latest"}): ${(error as Error).message}`);
    }
  }
  return null;
}

/**
 * Rates for `currencies` into `to`, as of `date` (YYYY-MM-DD). Dates after today use
 * the latest rates, since future rates don't exist.
 */
export async function getRates(currencies: Iterable<string>, to: string, date: string): Promise<RateTable> {
  const asOf = date > new Date().toISOString().slice(0, 10) ? null : date;
  const rates = new Map<string, Rate>([[to, { value: 1, source: "ECB", date: asOf ?? "latest" }]]);
  const wanted = [...new Set(currencies)].filter((c) => c && c !== to);
  const found = await Promise.all(wanted.map(async (c) => [c, await findRate(c, to, asOf)] as const));
  const missing: string[] = [];
  for (const [c, rate] of found) {
    if (rate) rates.set(c, rate);
    else missing.push(c);
  }
  return { currency: to, rates, missing };
}

/** Converts per-currency amounts; currencies without a rate are skipped (see RateTable.missing). */
export function convert(amounts: Record<string, number>, table: RateTable): number {
  let total = 0;
  for (const [currency, amount] of Object.entries(amounts)) {
    const rate = table.rates.get(currency);
    if (rate) total += amount * rate.value;
  }
  return total;
}
