import { appOf, loadCatalog } from "../asc/catalog";
import { downloadDays } from "../asc/reports";
import { addDays, eachDay, shortDate, today } from "../calendar/fiscal";
import type { Account } from "../config/settings";
import { money } from "../money/format";
import { convert, getRates } from "../money/rates";
import { readSaleRows } from "../reports/rows";
import { t } from "../i18n";
import { columns, splitTsv } from "../reports/tsv";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s);

/**
 * Who leaves and who pays back, over the last N days:
 * trials and conversions, cancellations and why, billing problems, refunds.
 * Events come from the daily SUBSCRIPTION_EVENT reports, refunds from the Sales reports
 * (negative units).
 */

export interface ChurnApp {
  app: string;
  trialStarts: number;
  conversions: number;
  newPaid: number;
  cancellations: number;
  sold: number;
  refunded: number;
  refundAmount: number;
}

export interface ChurnResult {
  account: { name: string; vendor: string };
  currency: string;
  window: { from: string; to: string; days: number; available: number };
  apps: ChurnApp[];
  weeks: { from: string; to: string; trialStarts: number; conversions: number; cancellations: number }[];
  reasons: Record<string, number>;
  billing: { entered: number; recovered: number; lost: number };
}

const TRIAL = /^Start Introductory Offer$/i;
const CONVERTED = /^Paid Subscription from Introductory Offer$/i;
const SUBSCRIBED = /^Subscribe$/i;
const CANCELLED = /^Cancel(ed from Billing Retry)?$/i;
const ENTERED_BILLING = /^Billing Retry from /i;
const RECOVERED = /^Renewals? from (Billing Retry|Grace Period)$/i;
const LOST = /^Canceled from Billing Retry$/i;
/** key of cancellations without a reason (Apple's reasons are kept as Apple writes them) */
const NOT_GIVEN = "Not given";

export interface ChurnOptions {
  currency: string;
  useCache: boolean;
  days: number;
  log: (m: string) => void;
  progress?: (done: number, total: number, unit?: string) => void;
}

export async function computeChurn(account: Account, opts: ChurnOptions): Promise<ChurnResult> {
  const to = addDays(today(), -1);
  const from = addDays(to, -(opts.days - 1));
  const dates = eachDay(from, to);

  opts.log(`${account.name} · ${t("subscription events")}`);
  const eventDays = await downloadDays(account, dates, opts.useCache, "SUBSCRIPTION_EVENT", (d, n) => opts.progress?.(d, n, t("days")));
  opts.log(`${account.name} · ${t("daily Sales reports")}`);
  const salesDays = await downloadDays(account, dates, opts.useCache, "SALES", (d, n) => opts.progress?.(d, n, t("days")));
  const catalog = await loadCatalog(account, false, () => {});

  const apps = new Map<string, ChurnApp>();
  const appRow = (name: string) => {
    let a = apps.get(name);
    if (!a) {
      a = { app: name, trialStarts: 0, conversions: 0, newPaid: 0, cancellations: 0, sold: 0, refunded: 0, refundAmount: 0 };
      apps.set(name, a);
    }
    return a;
  };

  // Weeks ending on the last day, newest last
  const weeks: ChurnResult["weeks"] = [];
  for (let end = to; end >= from; end = addDays(end, -7)) {
    const start = addDays(end, -6) < from ? from : addDays(end, -6);
    weeks.unshift({ from: start, to: end, trialStarts: 0, conversions: 0, cancellations: 0 });
  }
  const weekOf = (date: string) => weeks.find((w) => w.from <= date && date <= w.to);

  const reasons: Record<string, number> = {};
  const billing = { entered: 0, recovered: 0, lost: 0 };
  for (const day of eventDays) {
    if (day.status !== "sales" || !day.text) continue;
    const { header, rows } = splitTsv(day.text);
    const c = columns(header, { event: "Event", app: "App Name", quantity: "Quantity" }, "Subscription event report");
    const reasonAt = header.indexOf("Cancellation Reason");
    for (const r of rows) {
      const event = (r[c.event] ?? "").trim();
      const qty = Number(r[c.quantity]) || 0;
      const a = appRow((r[c.app] ?? "").trim() || "?");
      const w = weekOf(day.date);
      if (TRIAL.test(event)) {
        a.trialStarts += qty;
        if (w) w.trialStarts += qty;
      } else if (CONVERTED.test(event)) {
        a.conversions += qty;
        if (w) w.conversions += qty;
      } else if (SUBSCRIBED.test(event)) {
        a.newPaid += qty;
      }
      if (CANCELLED.test(event)) {
        a.cancellations += qty;
        if (w) w.cancellations += qty;
        const reason = reasonAt >= 0 ? (r[reasonAt] ?? "").trim() : "";
        if (/^Cancel$/i.test(event)) reasons[reason || NOT_GIVEN] = (reasons[reason || NOT_GIVEN] ?? 0) + qty;
      }
      if (ENTERED_BILLING.test(event)) billing.entered += qty;
      if (RECOVERED.test(event)) billing.recovered += qty;
      if (LOST.test(event)) billing.lost += qty;
    }
  }

  // Refunds from the Sales reports, by app
  const saleRows = salesDays.flatMap((d) => (d.status === "sales" && d.text ? readSaleRows(d.text) : []));
  const table = await getRates(new Set(saleRows.map((r) => r.currency)), opts.currency, to);
  for (const row of saleRows) {
    const owner = appOf(catalog, row);
    const a = appRow(owner?.name ?? row.title);
    if (row.units > 0) a.sold += row.units;
    else {
      a.refunded += -row.units;
      a.refundAmount += -convert({ [row.currency]: row.amount }, table);
    }
  }

  const available = eventDays.filter((d) => d.status === "sales" || d.status === "no-sales").length;
  return {
    account: { name: account.name, vendor: account.vendor },
    currency: opts.currency,
    window: { from, to, days: opts.days, available },
    apps: [...apps.values()]
      .filter((a) => a.trialStarts || a.conversions || a.newPaid || a.cancellations || a.refunded)
      .sort((x, y) => y.trialStarts + y.cancellations - (x.trialStarts + x.cancellations)),
    weeks,
    reasons,
    billing,
  };
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export function renderChurn(r: ChurnResult): string {
  const m = (n: number) => money(n, r.currency);
  const out: string[] = [];
  const W = 31;
  // columns grow when a translated heading is wider than the English one
  const col = (text: string, min: number) => Math.max(min, t(text).length + 1);
  const TRIALS = col("Trials", 7);
  const PAID = col("→ paid", 8);
  const CANCELS = col("Cancels", 9);
  const REFUNDS = col("Refunds", 9);
  const RATE = col("Rate", 7);
  const head =
    `  ${t("App").padEnd(W)}${t("Trials").padStart(TRIALS)}${t("→ paid").padStart(PAID)}${"".padStart(5)}` +
    `${t("Cancels").padStart(CANCELS)}${t("Refunds").padStart(REFUNDS)}${t("Rate").padStart(RATE)}`;
  const rule = "  " + "─".repeat(head.length - 2);
  out.push("");
  out.push(
    bold(`  ${r.account.name}  ·  ${t("Refunds and cancellations")}`) +
      dim(`  ·  ${t("last {days} days", { days: r.window.days })}, ${shortDate(r.window.from, false)} - ${shortDate(r.window.to)}`),
  );
  out.push("");
  out.push(dim(head));
  out.push(rule);
  const sum = { trialStarts: 0, conversions: 0, cancellations: 0, sold: 0, refunded: 0, refundAmount: 0 };
  for (const a of r.apps) {
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += a[k];
    const name = a.app.length > W - 1 ? a.app.slice(0, W - 2) + "…" : a.app;
    out.push(
      `  ${name.padEnd(W)}${String(a.trialStarts).padStart(TRIALS)}${String(a.conversions).padStart(PAID)}${dim(pct(a.conversions, a.trialStarts).padStart(5))}` +
        `${String(a.cancellations).padStart(CANCELS)}${String(a.refunded).padStart(REFUNDS)}${pct(a.refunded, a.sold).padStart(RATE)}`,
    );
  }
  if (r.apps.length === 0) out.push(dim(`  ${t("Nothing happened in this period.")}`));
  out.push(rule);
  out.push(
    bold(
      `  ${t("Total").padEnd(W)}${String(sum.trialStarts).padStart(TRIALS)}${String(sum.conversions).padStart(PAID)}${pct(sum.conversions, sum.trialStarts).padStart(5)}` +
        `${String(sum.cancellations).padStart(CANCELS)}${String(sum.refunded).padStart(REFUNDS)}${pct(sum.refunded, sum.sold).padStart(RATE)}`,
    ),
  );
  out.push(dim(`  ${t("→ paid: trials that became paid in the same period.  Rate: refunded units of all sold ({sold}).", { sold: sum.sold })}`));
  if (sum.refundAmount > 0) out.push(`  ${t("Refunded").padEnd(9)} ${m(sum.refundAmount)}`);

  if (r.weeks.length > 1) {
    const WEEK_RATE = col("Rate", 6);
    out.push("");
    out.push(dim(`  ${t("Week").padEnd(18)}${t("Trials").padStart(TRIALS)}${t("→ paid").padStart(PAID)}${t("Rate").padStart(WEEK_RATE)}${t("Cancels").padStart(CANCELS)}`));
    const max = Math.max(0.0001, ...r.weeks.map((w) => (w.trialStarts ? w.conversions / w.trialStarts : 0)));
    for (const w of r.weeks) {
      const rate = w.trialStarts ? w.conversions / w.trialStarts : 0;
      out.push(
        `  ${`${shortDate(w.from, false)} - ${shortDate(w.to, false)}`.padEnd(18)}${String(w.trialStarts).padStart(TRIALS)}${String(w.conversions).padStart(PAID)}` +
          `${pct(w.conversions, w.trialStarts).padStart(WEEK_RATE)}${String(w.cancellations).padStart(CANCELS)}  ${dim("█".repeat(Math.round((rate / max) * 12)))}`,
      );
    }
  }

  out.push("");
  const reasonText = Object.entries(r.reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${t(k)} ${v}`) // Apple's reasons are in English; known ones are translated
    .join("  ·  ");
  if (reasonText) out.push(`  ${t("Why").padEnd(9)} ${reasonText}`);
  const b = r.billing;
  if (b.entered || b.recovered || b.lost) {
    out.push(
      `  ${t("Billing").padEnd(9)} ${t("{n} had a payment problem", { n: b.entered })}  ·  ${t("{n} recovered", { n: b.recovered })}  ·  ${t("{n} lost", { n: b.lost })}` +
        dim(b.recovered + b.lost ? `  (${t("{pct} saved", { pct: pct(b.recovered, b.recovered + b.lost) })})` : ""),
    );
  }
  if (r.window.available < r.window.days) out.push(dim(`  ${t("{available} of {days} days of reports available.", { available: r.window.available, days: r.window.days })}`));
  out.push("");
  return out.join("\n");
}
