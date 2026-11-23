import { downloadDays } from "../asc/reports";
import { addDays, eachDay, shortDate, today } from "../calendar/fiscal";
import type { Account } from "../config/settings";
import { money } from "../money/format";
import { convert, getRates } from "../money/rates";
import { readSubscriptionEvents, readSubscriptionSnapshot, type EventCounts } from "../reports/subscriptions";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s);

export interface SubscriptionApp {
  app: string;
  paying: number;
  trials: number;
  billingIssues: number;
  /** monthly recurring proceeds in the display currency */
  mrr: number;
  events: EventCounts;
}

export interface SubscriptionsResult {
  account: { name: string; vendor: string };
  currency: string;
  /** day of the snapshot (the latest published) */
  asOf: string | null;
  apps: SubscriptionApp[];
  window: { from: string; to: string; days: number; available: number };
  unconverted: string[];
}

const emptyEvents = (): EventCounts => ({
  trialStarts: 0, trialConversions: 0, newPaid: 0, renewals: 0, cancellations: 0, refunds: 0, billingRecovered: 0, all: {},
});

export interface SubscriptionOptions {
  currency: string;
  useCache: boolean;
  days: number;
  log: (m: string) => void;
  progress?: (done: number, total: number, unit?: string) => void;
}

/** Active subscriptions on the latest published day, and what happened over the last `days` days. */
export async function computeSubscriptions(account: Account, opts: SubscriptionOptions): Promise<SubscriptionsResult> {
  // The snapshot of a day is published the next morning; take the newest available
  opts.log(`${account.name} · subscription snapshot`);
  // Apple answers "no sales" for a snapshot that is merely late, so such a day is skipped:
  // the newest day with data wins. Only when every recent day says so is it really zero.
  let asOf: string | null = null;
  let snapshotText = "";
  let noneDays = 0;
  for (let back = 1; back <= 6 && !asOf; back++) {
    const date = addDays(today(), -back);
    const [day] = await downloadDays(account, [date], opts.useCache, "SUBSCRIPTION");
    if (day.status === "sales" && day.text) {
      asOf = date;
      snapshotText = day.text;
    } else if (day.status === "no-sales") {
      noneDays++;
    } else if (day.status === "failed" && /\(40[13]\)/.test(day.error ?? "")) {
      throw new Error(day.error);
    }
  }
  if (!asOf && noneDays >= 5) asOf = addDays(today(), -1); // no active subscriptions at all

  const to = asOf ?? addDays(today(), -1);
  const from = addDays(to, -(opts.days - 1));
  opts.log(`${account.name} · subscription events`);
  const eventDays = await downloadDays(account, eachDay(from, to), opts.useCache, "SUBSCRIPTION_EVENT", (d, t) => opts.progress?.(d, t, "days"));
  const events = readSubscriptionEvents(eventDays.flatMap((d) => (d.text ? [d.text] : [])));
  const available = eventDays.filter((d) => d.status === "sales" || d.status === "no-sales").length;

  const lines = readSubscriptionSnapshot(snapshotText);
  const currencies = new Set(lines.flatMap((l) => Object.keys(l.monthly)));
  opts.log(`${account.name} · exchange rates`);
  const table = await getRates(currencies, opts.currency, to);

  const byApp = new Map<string, SubscriptionApp>();
  const appOf = (name: string) => {
    let a = byApp.get(name);
    if (!a) {
      a = { app: name, paying: 0, trials: 0, billingIssues: 0, mrr: 0, events: emptyEvents() };
      byApp.set(name, a);
    }
    return a;
  };
  for (const l of lines) {
    const a = appOf(l.app);
    a.paying += l.paying;
    a.trials += l.trials;
    a.billingIssues += l.billingIssues;
    a.mrr += convert(l.monthly, table);
  }
  for (const [app, e] of events) {
    const a = appOf(app);
    for (const k of Object.keys(e) as (keyof EventCounts)[]) {
      if (k === "all") for (const [name, n] of Object.entries(e.all)) a.events.all[name] = (a.events.all[name] ?? 0) + n;
      else a.events[k] += e[k];
    }
  }

  return {
    account: { name: account.name, vendor: account.vendor },
    currency: opts.currency,
    asOf,
    apps: [...byApp.values()].sort((x, y) => y.mrr - x.mrr || y.paying - x.paying),
    window: { from, to, days: opts.days, available },
    unconverted: table.missing,
  };
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export function renderSubscriptions(r: SubscriptionsResult): string {
  const m = (n: number) => money(n, r.currency);
  const out: string[] = [];
  const W = 34;
  const rule = "  " + "─".repeat(W + 8 * 3 + 13);
  out.push("");
  out.push(bold(`  ${r.account.name}  ·  Subscriptions`) + dim(r.asOf ? `  ·  active on ${shortDate(r.asOf)}` : "  ·  no snapshot published in the last 5 days"));
  out.push("");
  out.push(dim(`  ${"App".padEnd(W)}${"Paying".padStart(8)}${"Trials".padStart(8)}${"Issues".padStart(8)}${"MRR".padStart(13)}`));
  out.push(rule);
  const total = { paying: 0, trials: 0, issues: 0, mrr: 0 };
  for (const a of r.apps) {
    if (!a.paying && !a.trials && !a.billingIssues && !a.mrr) continue;
    total.paying += a.paying;
    total.trials += a.trials;
    total.issues += a.billingIssues;
    total.mrr += a.mrr;
    const name = a.app.length > W - 1 ? a.app.slice(0, W - 2) + "…" : a.app;
    out.push(`  ${name.padEnd(W)}${String(a.paying).padStart(8)}${String(a.trials).padStart(8)}${String(a.billingIssues || "").padStart(8)}${m(a.mrr).padStart(13)}`);
  }
  out.push(rule);
  out.push(bold(`  ${"Total".padEnd(W)}${String(total.paying).padStart(8)}${String(total.trials).padStart(8)}${String(total.issues || "").padStart(8)}${m(total.mrr).padStart(13)}`));
  out.push(dim("  MRR: monthly proceeds of paying subscriptions at their current price (weekly x 4.35, yearly / 12),"));
  out.push(dim("  before tax. Issues: billing retry or grace period."));

  const e = r.apps.reduce((acc, a) => {
    for (const k of ["trialStarts", "trialConversions", "newPaid", "renewals", "cancellations", "refunds", "billingRecovered"] as const) acc[k] += a.events[k];
    return acc;
  }, emptyEvents());
  out.push("");
  out.push(bold(`  Last ${r.window.days} days`) + dim(`  ·  ${shortDate(r.window.from, false)} - ${shortDate(r.window.to)}${r.window.available < r.window.days ? `  (${r.window.available} of ${r.window.days} days available)` : ""}`));
  out.push(`  ${"New trials".padEnd(26)}${String(e.trialStarts).padStart(8)}`);
  out.push(`  ${"Trial → paid".padEnd(26)}${String(e.trialConversions).padStart(8)}` + dim(`   ${pct(e.trialConversions, e.trialStarts)} of new trials (same period)`));
  out.push(`  ${"New paid (no trial)".padEnd(26)}${String(e.newPaid).padStart(8)}`);
  out.push(`  ${"Renewals".padEnd(26)}${String(e.renewals).padStart(8)}` + (e.billingRecovered ? dim(`   ${e.billingRecovered} after a billing retry`) : ""));
  out.push(`  ${"Cancellations".padEnd(26)}${String(e.cancellations).padStart(8)}`);
  out.push(`  ${"Refunds".padEnd(26)}${String(e.refunds).padStart(8)}`);
  if (r.unconverted.length) out.push(dim(`  No exchange rate for ${r.unconverted.join(", ")}; left out of MRR.`));
  out.push("");
  return out.join("\n");
}
