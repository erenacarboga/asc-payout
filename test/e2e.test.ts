import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, eachDay, fiscalPeriod, recentMonths, today } from "../src/calendar/fiscal";
import { run } from "../src/cli/run";
import { ui } from "../src/cli/ui";
import type { Account } from "../src/config/settings";
import { computeMonth } from "../src/earnings/month";
import { ascRequests, freshAccounts, serve, world, type FakeWorld } from "./fake-asc";
import { detailReport, financialReport, salesDayA, salesDayB } from "./samples";

const OCT = { year: 2026, month: 10 };
const opts = { currency: "USD", useCache: true, refreshCatalog: false, log: () => {} };
const realFetch = globalThis.fetch;
const realUi = { ...ui };

/** October 2026 (Sep 27 - Oct 31): sales on Oct 5 and 6, nothing on the other days. */
function october(extra: Partial<FakeWorld> = {}): FakeWorld {
  const sales: FakeWorld["sales"] = {};
  for (const d of eachDay("2026-09-27", "2026-10-31")) sales[d] = "no-sales";
  sales["2026-10-05"] = salesDayA;
  sales["2026-10-06"] = salesDayB;
  return world({
    finance: { "2027-01": financialReport },
    detail: { "2027-01": detailReport },
    sales,
    apps: [
      { id: "900001", sku: "app.notes", name: "Notes" },
      { id: "900002", sku: "app.paint", name: "Paint" },
    ],
    rates: { EUR: 1.1 }, // no rate anywhere for KZT
    ...extra,
  });
}

let account: Account;
let output: string[];
beforeEach(() => {
  [account] = freshAccounts();
  output = [];
  ui.print = (t) => void output.push(t);
  ui.note = () => {};
  ui.interactive = () => false;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(ui, realUi);
});

describe("a closed month", () => {
  test("Reports, Trends, grouping and currencies", async () => {
    const w = october();
    serve(w);
    const r = await computeMonth(account, OCT, opts);

    expect(r.period).toEqual({ start: "2026-09-27", end: "2026-10-31" });
    expect(r.reports.status).toBe("ok");
    expect(r.reports.mismatches).toEqual([]);
    expect(r.reports.total).toBeCloseTo(12.72 + 7.2 * 1.1 + 20, 6);
    expect(r.trends.available).toBe(35);
    expect(r.trends.total).toBeCloseTo(12.72 + 7.2 * 1.1 + 1.4, 6);
    // the KZT tip has no rate: listed, never counted 1:1
    expect(r.rates.unconverted).toEqual([{ in: "Trends", currency: "KZT", amount: 4389.22 }]);

    const notes = r.apps.find((a) => a.name === "Notes")!;
    expect(notes.items.map((i) => i.name).sort()).toEqual(["Big Tip", "Plus Lifetime", "Plus Weekly"]);
    expect(r.apps.find((a) => a.name === "Paint")!.trends).toBeCloseTo(1.4, 6);
    expect(r.payment).toMatchObject({ basis: "reports", date: "2026-12-03" });
  });

  test("explains the difference: earlier sales settled now, this month's sales settled later", async () => {
    serve(october());
    const r = await computeMonth(account, OCT, opts);
    const s = r.settlement!;
    expect(s.earlier).toBeCloseTo(4.24, 6);
    expect(s.inPeriod).toBeCloseTo(r.reports.total! - 4.24, 6);
    expect(s.later).toBeCloseTo(r.trends.total - s.inPeriod, 6);
    // the pieces add up exactly
    expect(s.earlier + s.inPeriod).toBeCloseTo(r.reports.total!, 9);
  });

  test("a detail row without a transaction date (seen in real reports) still counts", async () => {
    // move $4.24 of October sales into a row whose transaction date Apple left empty
    const blank = detailReport.replace("10/03/2026\t10/31/2026\t910001\tnotes.plus.week\tx\tExample\tIAY\tUS\t3\t4.24\t12.72", "10/03/2026\t10/31/2026\t910001\tnotes.plus.week\tx\tExample\tIAY\tUS\t2\t4.24\t8.48\tUSD\t0\tUSD\tS\t\t\t\t\n\t10/08/2026\t910001\tnotes.plus.week\tx\tExample\tIAY\tUS\t1\t4.24\t4.24");
    expect(blank).not.toBe(detailReport);
    serve(october({ detail: { "2027-01": blank } }));
    const r = await computeMonth(account, OCT, opts);
    expect(r.settlement).toBeDefined();
    expect(r.settlement!.earlier).toBeCloseTo(4.24, 6);
    expect(r.settlement!.earlier + r.settlement!.inPeriod).toBeCloseTo(r.reports.total!, 9);
  });

  test("a detail report that does not add up to the Financial Report is not used", async () => {
    // consistent in itself (rows match its own summary) but $1 more than the Financial Report
    const off = detailReport.replace("1\t4.24\t4.24\tUSD", "1\t5.24\t5.24\tUSD").replace("US\tUSD\t4\t32.72", "US\tUSD\t4\t33.72");
    expect(off).not.toBe(detailReport);
    serve(october({ detail: { "2027-01": off } }));
    const r = await computeMonth(account, OCT, opts);
    expect(r.settlement).toBeUndefined();
  });

  test("daily totals and countries", async () => {
    serve(october());
    const r = await computeMonth(account, OCT, opts);
    expect(r.daily).toHaveLength(35);
    expect(r.daily.find((d) => d.date === "2026-10-05")!.total).toBeCloseTo(12.72 + 7.92, 6);
    expect(r.daily.find((d) => d.date === "2026-10-07")!.total).toBe(0);
    expect(r.countries[0].code).toBe("US");
  });

  test("a second run uses only stored data (no network at all)", async () => {
    const w = october();
    serve(w);
    await computeMonth(account, OCT, opts);
    w.requests.length = 0;
    const again = await computeMonth(account, OCT, opts);
    expect(ascRequests(w)).toEqual([]);
    // only the currency that has no rate anywhere is looked up again
    expect(w.requests.every((u) => /kzt|KZT/.test(u))).toBe(true);
    expect(again.reports.total).toBeCloseTo(12.72 + 7.92 + 20, 6);
  });

  test("a damaged cached day is thrown away and downloaded again", async () => {
    const w = october();
    serve(w);
    const first = await computeMonth(account, OCT, opts);
    const file = join(process.env.ASC_PAYOUT_CACHE_DIR!, account.vendor, "sales", "2026-10-05.tsv");
    const text = readFileSync(file, "utf-8").split("\n");
    writeFileSync(file, text.slice(0, -1).join("\n") + "\n" + text[text.length - 1].split("\t").slice(0, 5).join("\t"));
    w.requests.length = 0;
    const second = await computeMonth(account, OCT, opts);
    expect(ascRequests(w).filter((u) => u.includes("2026-10-05"))).toHaveLength(1);
    expect(second.trends.total).toBeCloseTo(first.trends.total, 9);
  });

  test("an incomplete Financial Report is not used or stored", async () => {
    const cut = financialReport.replace("Total_Rows\t4", "Total_Rows\t5");
    const w = october({ finance: { "2027-01": cut } });
    serve(w);
    const r = await computeMonth(account, OCT, opts);
    expect(r.reports.status).toBe("failed");
    expect(r.reports.total).toBeNull();
    expect(r.payment.basis).toBe("trends");
    expect(readdirSync(join(process.env.ASC_PAYOUT_CACHE_DIR!, account.vendor)).includes("financial")).toBe(false);
  });

  test("rate limits and server errors are retried", async () => {
    const w = october();
    w.sales["2026-10-05"] = [{ status: 429 }, { status: 503 }, salesDayA];
    serve(w);
    const r = await computeMonth(account, OCT, opts);
    expect(r.trends.problems).toEqual([]);
    expect(r.trends.total).toBeCloseTo(12.72 + 7.92 + 1.4, 6);
    expect(ascRequests(w).filter((u) => u.includes("reportDate%5D=2026-10-05") || u.includes("reportDate]=2026-10-05"))).toHaveLength(3);
  });

  test("a day that keeps failing is reported, not counted as zero sales", async () => {
    const w = october();
    w.sales["2026-10-05"] = { status: 500 };
    serve(w);
    const r = await computeMonth(account, OCT, opts);
    expect(r.trends.available).toBe(34);
    expect(r.trends.problems[0]).toMatch(/1 day\(s\) could not be read \(2026-10-05\)/);
  });
});

describe("Reports not available", () => {
  test("not published yet: payment comes from Trends", async () => {
    const w = october({ finance: {} });
    serve(w);
    const r = await computeMonth(account, OCT, opts);
    expect(r.reports.status).toBe("not-published");
    expect(r.payment).toMatchObject({ basis: "trends" });
    expect(r.payment.amount).toBeCloseTo(r.trends.total, 9);
  });

  test("a key without access to anything is an error, not an empty month", async () => {
    const w = october({ finance: { "2027-01": { status: 403 } } });
    for (const d of Object.keys(w.sales)) w.sales[d] = { status: 403 };
    serve(w);
    expect(computeMonth(account, OCT, opts)).rejects.toThrow(/Nothing could be read/);
  });

  test("a month in progress gets a forecast", async () => {
    const ym = recentMonths(1)[0];
    const p = fiscalPeriod(ym);
    const yesterday = addDays(today(), -1);
    if (yesterday < addDays(p.start, 2)) return; // too early in the month for a forecast
    const sales: FakeWorld["sales"] = {};
    for (const d of eachDay(p.start, yesterday)) sales[d] = salesDayB.replaceAll("10/05/2026", "x"); // 1.40 USD a day
    sales[today()] = "not-yet";
    serve(world({ sales, apps: [{ id: "900002", sku: "app.paint", name: "Paint" }] }));
    const r = await computeMonth(account, ym, opts);
    expect(r.reports.status).toBe("in-progress");
    expect(r.trends.forecast!.perDay).toBeCloseTo(1.4, 6);
    expect(r.payment.basis).toBe("forecast");
    expect(r.payment.amount).toBeCloseTo(1.4 * eachDay(p.start, p.end).length, 6);
  });
});

describe("command line", () => {
  test("one account by a part of its name", async () => {
    serve(october());
    expect(await run(["-a", "notes", "-m", "2026-10"])).toBe(0);
    const text = output.join("\n");
    expect(text).toContain("Notes Inc  ·  October 2026");
    expect(text).toContain("Payment   ~$40.64");
    expect(text).toMatch(/Big Tip\s+\$0\.00\s+\$0\.00\*/);
    expect(text).toContain("No exchange rate for 4,389.22 KZT; not included in the Trends total (rows marked *).");
  });

  test("all accounts as JSON", async () => {
    freshAccounts([["Notes Inc", "80000001"], ["Personal", "80000002"]]);
    const w = october();
    serve(w);
    expect(await run(["-a", "all", "-m", "2026-10", "--json"])).toBe(0);
    const out = JSON.parse(output.join("\n"));
    expect(out.results.map((r: { account: { name: string } }) => r.account.name)).toEqual(["Notes Inc", "Personal"]);
    expect(out.errors).toEqual([]);
  });

  test("several accounts and no terminal: asks for --account instead of guessing", async () => {
    freshAccounts([["A", "1"], ["B", "2"]]);
    serve(october());
    expect(run(["-m", "2026-10"])).rejects.toThrow(/--account/);
  });

  test("demo works without any account or network", async () => {
    globalThis.fetch = (() => {
      throw new Error("no network in demo");
    }) as unknown as typeof fetch;
    expect(await run(["demo", "-a", "all", "-m", "2026-10"])).toBe(0);
    expect(output.join("\n")).toContain("All accounts");
  });
});
