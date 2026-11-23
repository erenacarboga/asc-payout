import type { AccountHistory } from "../earnings/history";
import type { MonthResult } from "../earnings/model";
import type { SubscriptionsResult } from "../earnings/subscriptions";
import type { ChurnResult } from "../earnings/churn";
import type { ProfitResult } from "../earnings/profit";

/** RFC 4180 CSV: quotes when needed, numbers with 2 decimals, "\r\n" line ends (Excel friendly). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const ym = (r: MonthResult) => `${r.month.year}-${String(r.month.month).padStart(2, "0")}`;

export function monthCsv(results: MonthResult[]): string {
  const rows: (string | number | null)[][] = [["account", "vendor", "month", "period_start", "period_end", "app", "product", "reports", "trends", "currency"]];
  for (const r of results) {
    for (const app of r.apps) {
      for (const item of app.items) {
        rows.push([r.account.name, r.account.vendor, ym(r), r.period.start, r.period.end, app.name, item.name, r.reports.total === null ? null : item.reports, item.trends, r.currency]);
      }
    }
  }
  return toCsv(rows);
}

export function historyCsv(histories: AccountHistory[]): string {
  const rows: (string | number | null)[][] = [["account", "month", "period_start", "period_end", "payment", "basis", "reports", "trends", "currency"]];
  for (const h of histories) {
    for (const r of h.months) {
      if (!r) continue;
      rows.push([h.name, ym(r), r.period.start, r.period.end, r.payment.amount, r.payment.basis, r.reports.total, r.trends.skipped ? null : r.trends.total, r.currency]);
    }
  }
  return toCsv(rows);
}

export function subscriptionsCsv(results: SubscriptionsResult[]): string {
  const rows: (string | number | null)[][] = [[
    "account", "as_of", "app", "paying", "trials", "billing_issues", "mrr", "currency",
    "trial_starts", "trial_conversions", "new_paid", "renewals", "cancellations", "refunds", "window_from", "window_to",
  ]];
  for (const r of results) {
    for (const a of r.apps) {
      const e = a.events;
      rows.push([r.account.name, r.asOf, a.app, a.paying, a.trials, a.billingIssues, a.mrr, r.currency, e.trialStarts, e.trialConversions, e.newPaid, e.renewals, e.cancellations, e.refunds, r.window.from, r.window.to]);
    }
  }
  return toCsv(rows);
}

export function churnCsv(results: ChurnResult[]): string {
  const rows: (string | number | null)[][] = [[
    "account", "from", "to", "app", "trial_starts", "trial_conversions", "new_paid", "cancellations", "units_sold", "units_refunded", "refund_amount", "currency",
  ]];
  for (const r of results) {
    for (const a of r.apps) {
      rows.push([r.account.name, r.window.from, r.window.to, a.app, a.trialStarts, a.conversions, a.newPaid, a.cancellations, a.sold, a.refunded, a.refundAmount, r.currency]);
    }
  }
  return toCsv(rows);
}

export function profitCsv(r: ProfitResult): string {
  const month = `${r.month.year}-${String(r.month.month).padStart(2, "0")}`;
  const rows: (string | number | null)[][] = [["month", "app", "app_id", "account", "revenue", "ad_spend", "profit", "roas", "installs", "cost_per_install", "currency"]];
  for (const a of r.apps) {
    rows.push([
      month, a.name, a.appId ?? null, a.account ?? null, a.revenue, a.spend, a.revenue === null ? null : a.revenue - a.spend,
      a.revenue !== null && a.spend > 0 ? a.revenue / a.spend : null, a.installs, a.installs ? a.spend / a.installs : null, r.currency,
    ]);
  }
  return toCsv(rows);
}
