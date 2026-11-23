import { afterEach, describe, expect, test } from "bun:test";
import { convert, getRates } from "../src/money/rates";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function serve(routes: [RegExp, unknown][], seen: string[] = []) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const hit = routes.find(([re]) => re.test(url));
    return hit
      ? new Response(JSON.stringify(hit[1]), { status: 200 })
      : new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return seen;
}

describe("getRates", () => {
  test("ECB first, on the requested day", async () => {
    serve([[/frankfurter\.dev\/v1\/2026-10-30\?base=EUR&symbols=USD/, { date: "2026-10-30", rates: { USD: 1.1172 } }]]);
    const t = await getRates(["EUR", "USD"], "USD", "2026-10-30");
    expect(t.rates.get("EUR")).toEqual({ value: 1.1172, source: "ECB", date: "2026-10-30" });
    expect(t.rates.get("USD")!.value).toBe(1);
    expect(t.missing).toEqual([]);
  });

  test("currencies the ECB lacks come from exchange-api", async () => {
    serve([[/currency-api@2026-10-31\/v1\/currencies\/kzt\.json/, { date: "2026-10-31", kzt: { usd: 0.0022 } }]]);
    const t = await getRates(["KZT"], "USD", "2026-10-31");
    expect(t.rates.get("KZT")?.source).toBe("exchange-api");
  });

  test("then open.er-api", async () => {
    serve([[/open\.er-api\.com\/v6\/latest\/TWD/, { result: "success", rates: { USD: 0.031 }, time_last_update_utc: "Sat, 31 Oct 2026 00:00:01 +0000" }]]);
    const t = await getRates(["TWD"], "USD", "2026-10-31");
    expect(t.rates.get("TWD")).toEqual({ value: 0.031, source: "open.er-api", date: "2026-10-31" });
  });

  test("unknown currency: missing, never 1:1", async () => {
    serve([]);
    const t = await getRates(["XQZ"], "USD", "2026-10-31");
    expect(t.missing).toEqual(["XQZ"]);
    expect(convert({ XQZ: 1000, USD: 5 }, t)).toBe(5);
  });

  test("zero or negative rates are rejected", async () => {
    serve([[/frankfurter/, { date: "x", rates: { USD: 0 } }]]);
    expect((await getRates(["GBP"], "USD", "2026-10-31")).missing).toEqual(["GBP"]);
  });

  test("a future day uses the latest rates", async () => {
    const seen = serve([]);
    await getRates(["EUR"], "USD", "2999-01-01");
    expect(seen.some((u) => u.includes("2999"))).toBe(false);
    expect(seen.some((u) => u.includes("latest"))).toBe(true);
  });
});
