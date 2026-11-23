import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { addDays, eachDay, today } from "../src/calendar/fiscal";
import { toCsv } from "../src/cli/csv";
import { run } from "../src/cli/run";
import { sparkline } from "../src/earnings/render";
import { ui } from "../src/cli/ui";
import { downloadSalesDays } from "../src/asc/reports";
import { durationInDays, readSubscriptionEvents, readSubscriptionSnapshot } from "../src/reports/subscriptions";
import { freshAccounts, serve, world } from "./fake-asc";
import { financialReport } from "./samples";

const realFetch = globalThis.fetch;
const realUi = { ...ui };
let output: string[];
beforeEach(() => {
  output = [];
  ui.print = (t) => void output.push(t);
  ui.note = () => {};
  ui.interactive = () => false;
  process.env.ASC_PAYOUT_NOTIFY = "off";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(ui, realUi);
});

const SNAP_HEADER = [
  "App Name", "App Apple ID", "Subscription Name", "Subscription Apple ID", "Subscription Group ID", "Standard Subscription Duration",
  "Subscription Offer Name", "Promotional Offer ID", "Customer Price", "Customer Currency", "Developer Proceeds", "Proceeds Currency",
  "Preserved Pricing", "Proceeds Reason", "Client", "Device", "State", "Country", "Active Standard Price Subscriptions",
  "Active Free Trial Introductory Offer Subscriptions", "Active Pay Up Front Introductory Offer Subscriptions",
  "Active Pay As You Go Introductory Offer Subscriptions", "Free Trial Promotional Offer Subscriptions",
  "Pay Up Front Promotional Offer Subscriptions", "Pay As You Go Promotional Offer Subscriptions", "Free Trial Offer Code Subscriptions",
  "Pay Up Front Offer Code Subscriptions", "Pay As You Go Offer Code Subscriptions", "Free Trial Win-back Offers",
  "Pay Up Front Win-back Offers", "Pay As You Go Win-back Offers", "Billing Retry", "Grace Period", "Subscribers", "Contingent App Name",
];
function snapRow(app: string, sub: string, duration: string, proceeds: string, currency: string, counts: Record<string, number>) {
  const row = new Array(SNAP_HEADER.length).fill("");
  Object.assign(row, { 0: app, 2: sub, 5: duration, 10: proceeds, 11: currency });
  for (const [name, n] of Object.entries(counts)) row[SNAP_HEADER.indexOf(name)] = String(n);
  return row.join("\t");
}
const snapshot = [
  SNAP_HEADER.join("\t"),
  snapRow("Notes", "Plus Weekly", "7 Days", "3.50", "USD", { "Active Standard Price Subscriptions": 10, "Active Free Trial Introductory Offer Subscriptions": 4, "Billing Retry": 1 }),
  snapRow("Notes", "Plus Yearly", "1 Year", "24.00", "USD", { "Active Standard Price Subscriptions": 2 }),
  snapRow("Paint", "Pro Monthly", "1 Month", "5.00", "EUR", { "Active Standard Price Subscriptions": 3, "Pay Up Front Promotional Offer Subscriptions": 1 }),
].join("\n");

const EVENT_HEADER = ["Event Date", "Event", "App Name", "App Apple ID", "Subscription Name", "Quantity"];
const events = (rows: [string, string, number][]) =>
  [EVENT_HEADER.join("\t"), ...rows.map(([event, app, q]) => ["2026-11-20", event, app, "1", "x", String(q)].join("\t"))].join("\n");

describe("subscriptions", () => {
  test("durations", () => {
    expect(durationInDays("7 Days")).toBe(7);
    expect(durationInDays("1 Year")).toBe(365.25);
    expect(durationInDays("2 Months")).toBeCloseTo(60.875, 6);
    expect(durationInDays("?")).toBeNull();
  });

  test("snapshot: paying, trials, issues and monthly proceeds", () => {
    const lines = readSubscriptionSnapshot(snapshot);
    const weekly = lines.find((l) => l.subscription === "Plus Weekly")!;
    expect(weekly).toMatchObject({ paying: 10, trials: 4, billingIssues: 1 });
    expect(weekly.monthly.USD).toBeCloseTo((10 * 3.5 * 365.25) / 12 / 7, 6);
    expect(lines.find((l) => l.subscription === "Plus Yearly")!.monthly.USD).toBeCloseTo(4, 6);
    // a discounted offer still pays, at the row's price
    expect(lines.find((l) => l.subscription === "Pro Monthly")!.paying).toBe(4);
  });

  test("events are added up per app", () => {
    const e = readSubscriptionEvents([
      events([["Start Introductory Offer", "Notes", 5], ["Paid Subscription from Introductory Offer", "Notes", 2], ["Cancel", "Paint", 1]]),
      events([["Start Introductory Offer", "Notes", 3], ["Renewal from Billing Retry", "Notes", 1]]),
    ]);
    expect(e.get("Notes")).toMatchObject({ trialStarts: 8, trialConversions: 2, billingRecovered: 1 });
    expect(e.get("Paint")!.cancellations).toBe(1);
  });

  test("a late snapshot that Apple calls 'no sales' is skipped for the day before", async () => {
    freshAccounts([["Notes Inc", "80000001"]]);
    const w = world({ rates: { EUR: 1.1 } });
    const yesterday = addDays(today(), -1);
    const before = addDays(today(), -2);
    serve(w);
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const type = url.searchParams.get("filter[reportType]");
      const date = url.searchParams.get("filter[reportDate]");
      if (type === "SUBSCRIPTION") {
        if (date === yesterday) return new Response(JSON.stringify({ errors: [{ status: "404", detail: "There were no sales for the date specified." }] }), { status: 404 });
        if (date === before) return new Response(Bun.gzipSync(Buffer.from(snapshot)), { status: 200 });
      }
      if (type === "SUBSCRIPTION_EVENT") return new Response(Bun.gzipSync(Buffer.from(events([["Start Introductory Offer", "Notes", 1]]))), { status: 200 });
      return inner(input, init);
    }) as unknown as typeof fetch;

    expect(await run(["subs", "--json"])).toBe(0);
    const out = JSON.parse(output.join("\n")).subscriptions[0];
    expect(out.asOf).toBe(before);
    expect(out.apps.find((a: { app: string }) => a.app === "Notes").paying).toBe(12);
    // the "no sales" answer for the late day was not stored
    expect(existsSync(join(process.env.ASC_PAYOUT_CACHE_DIR!, "80000001", "subscriptions", `${yesterday}.tsv`))).toBe(false);
  });
});

describe("cache policy", () => {
  test("'no sales' is stored for old days, not for the last three", async () => {
    const [account] = freshAccounts([["Notes Inc", "80000001"]]);
    serve(world());
    const old = addDays(today(), -10);
    const recent = addDays(today(), -1);
    await downloadSalesDays(account, [old, recent], true);
    const dir = join(process.env.ASC_PAYOUT_CACHE_DIR!, "80000001", "sales");
    expect(existsSync(join(dir, `${old}.tsv`))).toBe(true);
    expect(existsSync(join(dir, `${recent}.tsv`))).toBe(false);
  });
});

describe("output", () => {
  test("CSV quoting", () => {
    expect(toCsv([["a,b", 'say "hi"', 1.5, 2, null], ["x\ny", "", 0.005, -3, undefined]])).toBe('"a,b","say ""hi""",1.50,2,\r\n"x\ny",,0.01,-3,\r\n');
  });

  test("sparkline: a bar per day, weeks apart, dots for missing days", () => {
    expect(sparkline([0, 1, 2, 4, 8, 4, 2, 1, null])).toBe("▁▂▃▅█▅▃ ▂·");
    expect(sparkline([0, 0])).toBe("▁▁");
  });

  test("history of a calendar year, as CSV", async () => {
    freshAccounts([["Notes Inc", "80000001"]]);
    serve(world({ finance: { "2027-01": financialReport }, rates: { EUR: 1.1 } }));
    expect(await run(["history", "--year", "2026", "--csv"])).toBe(0);
    const lines = output.join("\n").split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("account,month,period_start,period_end,payment,basis,reports,trends,currency");
    const october = lines.find((l) => l.includes(",2026-10,"))!;
    expect(october).toContain(",40.64,reports,40.64,");
    // only months that have started
    expect(lines.some((l) => l.includes(",2026-12,"))).toBe(eachDay("2026-11-29", "2026-11-29")[0] <= today());
  });
});

describe("watch", () => {
  test("announces a published month once", async () => {
    freshAccounts([["Notes Inc", "80000001"]]);
    const w = world({ rates: { EUR: 1.1 } });
    serve(w);
    // whatever the last closed month is, publish the sample report for it
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/financeReports" && url.searchParams.get("filter[reportType]") === "FINANCIAL") {
        return new Response(Bun.gzipSync(Buffer.from(financialReport)), { status: 200 });
      }
      return inner(input, init);
    }) as unknown as typeof fetch;

    await run(["watch"]);
    expect(output.join("\n")).toMatch(/is final: \$40\.64/);
    output.length = 0;
    await run(["watch"]);
    expect(output.join("\n")).toContain("already announced");
  });
});
