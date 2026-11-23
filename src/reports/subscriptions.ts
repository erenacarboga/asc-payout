import { columns, splitTsv } from "./tsv";

/**
 * Subscription reports (version 1_4).
 *
 * SUBSCRIPTION, daily: a snapshot of active subscriptions, one row per subscription,
 * offer, price and country, with counts per state.
 * SUBSCRIPTION_EVENT, daily: what happened that day (trial started, converted,
 * renewed, cancelled, ...) with a quantity.
 */

const DAYS_PER_MONTH = 365.25 / 12;

/** "7 Days" -> 7, "1 Month" -> 30.44, "1 Year" -> 365.25; null when unknown */
export function durationInDays(text: string): number | null {
  const m = /(\d+)\s*(day|week|month|year)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit === "day" ? n : unit === "week" ? n * 7 : unit === "month" ? n * DAYS_PER_MONTH : n * 365.25;
}

export interface SubscriptionLine {
  app: string;
  subscription: string;
  /** subscriptions paying the standard or a discounted price */
  paying: number;
  trials: number;
  /** payment problems: billing retry and grace period */
  billingIssues: number;
  /** per currency: monthly proceeds of the paying subscriptions */
  monthly: Record<string, number>;
}

const SNAPSHOT_COLUMNS = {
  app: "App Name",
  subscription: "Subscription Name",
  duration: "Standard Subscription Duration",
  proceeds: "Developer Proceeds",
  currency: "Proceeds Currency",
  standard: "Active Standard Price Subscriptions",
  trial: "Active Free Trial Introductory Offer Subscriptions",
} as const;

/** Paid offer states: they bring money in, at the row's (discounted) price */
const PAID_OFFER_COLUMNS = [
  "Active Pay Up Front Introductory Offer Subscriptions",
  "Active Pay As You Go Introductory Offer Subscriptions",
  "Pay Up Front Promotional Offer Subscriptions",
  "Pay As You Go Promotional Offer Subscriptions",
  "Pay Up Front Offer Code Subscriptions",
  "Pay As You Go Offer Code Subscriptions",
  "Pay Up Front Win-back Offers",
  "Pay As You Go Win-back Offers",
];
const FREE_OFFER_COLUMNS = ["Free Trial Promotional Offer Subscriptions", "Free Trial Offer Code Subscriptions", "Free Trial Win-back Offers"];
const ISSUE_COLUMNS = ["Billing Retry", "Grace Period"];

export function readSubscriptionSnapshot(text: string): SubscriptionLine[] {
  const { header, rows } = splitTsv(text);
  if (header.length === 0) return [];
  const c = columns(header, SNAPSHOT_COLUMNS, "Subscription report");
  const idx = (names: string[]) => names.map((n) => header.indexOf(n)).filter((i) => i >= 0);
  const paid = idx(PAID_OFFER_COLUMNS);
  const free = idx(FREE_OFFER_COLUMNS);
  const issues = idx(ISSUE_COLUMNS);
  const count = (r: string[], list: number[]) => list.reduce((s, i) => s + (Number(r[i]) || 0), 0);

  const lines = new Map<string, SubscriptionLine>();
  for (const r of rows) {
    const app = (r[c.app] ?? "").trim();
    const subscription = (r[c.subscription] ?? "").trim();
    const key = `${app}\u0000${subscription}`;
    let line = lines.get(key);
    if (!line) {
      line = { app, subscription, paying: 0, trials: 0, billingIssues: 0, monthly: {} };
      lines.set(key, line);
    }
    const paying = (Number(r[c.standard]) || 0) + count(r, paid);
    line.paying += paying;
    line.trials += (Number(r[c.trial]) || 0) + count(r, free);
    line.billingIssues += count(r, issues);

    const days = durationInDays(r[c.duration] ?? "");
    const proceeds = Number(r[c.proceeds]) || 0;
    const currency = (r[c.currency] ?? "").trim();
    if (days && paying && proceeds && currency) {
      line.monthly[currency] = (line.monthly[currency] ?? 0) + paying * proceeds * (DAYS_PER_MONTH / days);
    }
  }
  return [...lines.values()];
}

export interface EventCounts {
  trialStarts: number;
  trialConversions: number;
  newPaid: number;
  renewals: number;
  cancellations: number;
  refunds: number;
  billingRecovered: number;
  /** every event name and its total quantity, as Apple names them */
  all: Record<string, number>;
}

const EVENT_GROUPS: [keyof Omit<EventCounts, "all">, RegExp][] = [
  ["trialStarts", /^Start Introductory Offer$/i],
  ["trialConversions", /^Paid Subscription from Introductory Offer$/i],
  ["newPaid", /^Subscribe$/i],
  ["renewals", /^Renew$/i],
  ["cancellations", /^Cancel$/i],
  ["refunds", /^Refund$/i],
  ["billingRecovered", /^Renewal from Billing Retry$/i],
];

/** Event totals over one or more daily SUBSCRIPTION_EVENT reports, per app. */
export function readSubscriptionEvents(reports: string[]): Map<string, EventCounts> {
  const byApp = new Map<string, EventCounts>();
  for (const text of reports) {
    const { header, rows } = splitTsv(text);
    if (header.length === 0) continue;
    const c = columns(header, { event: "Event", app: "App Name", quantity: "Quantity" }, "Subscription event report");
    for (const r of rows) {
      const app = (r[c.app] ?? "").trim();
      const event = (r[c.event] ?? "").trim();
      const qty = Number(r[c.quantity]) || 0;
      let counts = byApp.get(app);
      if (!counts) {
        counts = { trialStarts: 0, trialConversions: 0, newPaid: 0, renewals: 0, cancellations: 0, refunds: 0, billingRecovered: 0, all: {} };
        byApp.set(app, counts);
      }
      counts.all[event] = (counts.all[event] ?? 0) + qty;
      for (const [field, pattern] of EVENT_GROUPS) if (pattern.test(event)) counts[field] += qty;
    }
  }
  return byApp;
}
