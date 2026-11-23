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
import { financialReport, salesDayB } from "./samples";

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

  test("pay-up-front offers pay, but not every period: they stay out of MRR", () => {
    const text = [
      SNAP_HEADER.join("\t"),
      snapRow("Notes", "Plus Monthly", "1 Month", "6.00", "USD", { "Active Pay Up Front Introductory Offer Subscriptions": 2 }),
      snapRow("Notes", "Plus Monthly", "1 Month", "2.00", "USD", { "Active Pay As You Go Introductory Offer Subscriptions": 3 }),
    ].join("\n");
    const [line] = readSubscriptionSnapshot(text);
    expect(line.paying).toBe(5);
    expect(line.monthly.USD).toBeCloseTo(3 * 2, 6);
  });

  test("events are added up per app", () => {
    const e = readSubscriptionEvents([
      events([["Start Introductory Offer", "Notes", 5], ["Paid Subscription from Introductory Offer", "Notes", 2], ["Cancel", "Paint", 1]]),
      events([["Start Introductory Offer", "Notes", 3], ["Renewal from Billing Retry", "Notes", 1], ["Renewals from Grace Period", "Notes", 1]]),
    ]);
    expect(e.get("Notes")).toMatchObject({ trialStarts: 8, trialConversions: 2, billingRecovered: 2 });
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

describe("refunds and cancellations", () => {
  test("trials, conversions, cancellations with reasons, billing and refunds", async () => {
    freshAccounts([["Notes Inc", "80000001"]]);
    const yesterday = addDays(today(), -1);
    const w = world({
      apps: [{ id: "900001", sku: "app.notes", name: "Notes" }, { id: "900002", sku: "app.paint", name: "Paint" }],
      sales: { [yesterday]: salesDayB },
    });
    serve(w);
    const header = ["Event Date", "Event", "App Name", "App Apple ID", "Subscription Name", "Cancellation Reason", "Quantity"].join("\t");
    const day = [
      header,
      ["", "Start Introductory Offer", "Notes", "900001", "Plus Weekly", "", "6"].join("\t"),
      ["", "Paid Subscription from Introductory Offer", "Notes", "900001", "Plus Weekly", "", "2"].join("\t"),
      ["", "Subscribe", "Notes", "900001", "Plus Yearly", "", "1"].join("\t"),
      ["", "Cancel", "Notes", "900001", "Plus Weekly", "Price", "3"].join("\t"),
      ["", "Cancel", "Notes", "900001", "Plus Weekly", "", "1"].join("\t"),
      ["", "Billing Retry from Paid Subscription", "Notes", "900001", "Plus Weekly", "", "2"].join("\t"),
      ["", "Renewal from Billing Retry", "Notes", "900001", "Plus Weekly", "", "1"].join("\t"),
      ["", "Canceled from Billing Retry", "Notes", "900001", "Plus Weekly", "", "1"].join("\t"),
      // grace period: entering it is a payment problem, moving on to billing retry is not a second one
      ["", "Grace Period from Paid Subscription", "Notes", "900001", "Plus Weekly", "", "1"].join("\t"),
      ["", "Billing Retry from Grace Period", "Notes", "900001", "Plus Weekly", "", "1"].join("\t"),
      ["", "Renewals from Grace Period", "Notes", "900001", "Plus Weekly", "", "1"].join("\t"),
    ].join("\n");
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get("filter[reportType]") === "SUBSCRIPTION_EVENT") {
        if (url.searchParams.get("filter[reportDate]") === yesterday) return new Response(Bun.gzipSync(Buffer.from(day)), { status: 200 });
        return new Response(JSON.stringify({ errors: [{ status: "404", detail: "There were no sales for the date specified." }] }), { status: 404 });
      }
      return inner(input, init);
    }) as unknown as typeof fetch;

    expect(await run(["churn", "--days", "7", "--json"])).toBe(0);
    const r = JSON.parse(output.join("\n")).churn[0];
    expect(r.window).toMatchObject({ days: 7, to: yesterday, available: 7 });
    const notes = r.apps.find((a: { app: string }) => a.app === "Notes");
    expect(notes).toMatchObject({ trialStarts: 6, conversions: 2, newPaid: 1, cancellations: 4, sold: 1, refunded: 1 });
    expect(notes.refundAmount).toBeCloseTo(4.24, 6);
    expect(r.reasons).toEqual({ Price: 3, "Not given": 1 });
    expect(r.billing).toEqual({ entered: 3, recovered: 2, lost: 1 });
    expect(r.weeks.at(-1)).toMatchObject({ trialStarts: 6, conversions: 2, cancellations: 4 });

    output = [];
    expect(await run(["churn", "--days", "7", "--csv"])).toBe(0);
    const csv = output.join("\n").split("\r\n");
    expect(csv[0]).toStartWith("account,from,to,app,trial_starts");
    expect(csv.some((l) => l.includes(",Notes,6,2,1,4,1,1,4.24,USD"))).toBe(true);

    output = [];
    expect(await run(["churn", "--days", "7"])).toBe(0);
    const text = output.join("\n");
    expect(text).toContain("Refunds and cancellations");
    expect(text).toContain("Why       Price 3");
    expect(text).toContain("2 recovered");
  });
});

describe("monthly goals", () => {
  test("amounts typed in any common way", async () => {
    const { parseAmount } = await import("../src/cli/setup");
    expect(parseAmount("2500")).toBe(2500);
    expect(parseAmount("2,500")).toBe(2500);
    expect(parseAmount("2.500")).toBe(2500);
    expect(parseAmount("2.500,50")).toBe(2500.5);
    expect(parseAmount("2,500.50")).toBe(2500.5);
    expect(parseAmount("$ 1 200")).toBe(1200);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  test("progress line: reached, on track, short, to go", async () => {
    const { goalLine } = await import("../src/earnings/render");
    expect(goalLine(1200, 1000, "USD")).toContain("120%  $1,200.00 of $1,000.00  ·  reached, $200.00 over");
    expect(goalLine(500, 1000, "USD", 1100)).toContain("50%  $500.00 of $1,000.00  ·  on track (forecast ~$1,100.00)");
    expect(goalLine(500, 1000, "USD", 900)).toContain("forecast ~$900.00, $100.00 short");
    expect(goalLine(250, 1000, "USD")).toContain("25%  $250.00 of $1,000.00  ·  $750.00 to go");
    expect(goalLine(250, 1000, "USD")).toContain("████░░░░░░░░░░░░");
  });

  test("goals are kept in settings, bad ones dropped, and converted to the display currency", async () => {
    freshAccounts([["Notes Inc", "80000001"]]);
    const { loadSettings, saveSettings } = await import("../src/config/settings");
    const s = loadSettings();
    saveSettings({ ...s, goals: { "80000001": { amount: 100, currency: "EUR" }, all: { amount: -5, currency: "USD" } } as never });
    const loaded = loadSettings();
    expect(loaded.goals).toEqual({ "80000001": { amount: 100, currency: "EUR" } });
    serve(world({ rates: { EUR: 1.1 } }));
    const { goalsIn } = await import("../src/cli/run");
    const goals = await goalsIn(loaded.goals, "USD");
    expect(goals.get("80000001")).toBeCloseTo(110, 6);
  });

  test("the demo shows a goal", async () => {
    expect(await run(["demo"])).toBe(0);
    expect(output.join("\n")).toMatch(/Goal {6}█+░* +\d+%/);
  });
});

describe("update check", () => {
  test("a newer release is found, and a skipped version is remembered", async () => {
    const { newerRelease, skipVersion } = await import("../src/cli/update");
    const { rmSync } = await import("node:fs");
    rmSync(join(process.env.ASC_PAYOUT_CACHE_DIR!, "update-check.json"), { force: true });
    const saved = process.env.ASC_PAYOUT_NO_UPDATE_CHECK;
    delete process.env.ASC_PAYOUT_NO_UPDATE_CHECK;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ tag_name: "v9.1.0" }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      expect(await newerRelease("9.0.0")).toEqual({ version: "9.1.0", skipped: false });
      expect(await newerRelease("9.1.0")).toBeNull();
      expect(calls).toBe(1); // a fresh answer is reused
      skipVersion("9.1.0");
      expect(await newerRelease("9.0.0")).toEqual({ version: "9.1.0", skipped: true });
    } finally {
      if (saved !== undefined) process.env.ASC_PAYOUT_NO_UPDATE_CHECK = saved;
      rmSync(join(process.env.ASC_PAYOUT_CACHE_DIR!, "update-check.json"), { force: true });
    }
  });
});
