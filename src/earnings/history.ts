import { fiscalPeriod, monthLabel, today, type YearMonth } from "../calendar/fiscal";
import type { Account } from "../config/settings";
import { money } from "../money/format";
import type { MonthResult } from "./model";
import { computeMonth, type MonthOptions } from "./month";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s);

export interface AccountHistory {
  name: string;
  /** newest first; null where the month could not be read */
  months: (MonthResult | null)[];
  errors: string[];
}

/**
 * Several months, newest first: a running month with its forecast, closed months from
 * their Financial Report (Trends only where no report exists yet).
 */
export async function computeHistory(account: Account, months: YearMonth[], opts: MonthOptions): Promise<AccountHistory> {
  const out: AccountHistory = { name: account.name, months: [], errors: [] };
  for (const ym of months) {
    const running = fiscalPeriod(ym).end >= today();
    try {
      out.months.push(await computeMonth(account, ym, { ...opts, trends: running ? "always" : "when-needed", settlement: false }));
    } catch (error) {
      out.months.push(null);
      out.errors.push(`${monthLabel(ym)}: ${(error as Error).message.split("\n")[0]}`);
    }
  }
  return out;
}

const estimate = (r: MonthResult | null) => !!r && r.payment.basis !== "reports" && r.payment.amount !== 0;
const cents = (n: number) => Math.round(n * 100) / 100;

function bar(value: number, max: number, width: number): string {
  if (max <= 0 || value <= 0) return "";
  const eighths = Math.round((value / max) * width * 8);
  return "█".repeat(Math.floor(eighths / 8)) + (eighths % 8 ? "▏▎▍▌▋▊▉"[(eighths % 8) - 1] : "");
}

export function renderHistory(histories: AccountHistory[], currency: string, title?: string): string {
  const m = (n: number) => money(n, currency);
  const months = histories[0]?.months.length ?? 0;
  const ymOf = (i: number): YearMonth | undefined => histories.find((h) => h.months[i])?.months[i]?.month;
  const several = histories.length > 1;
  const NAME = 16;
  const COL = several ? 13 : 14;
  const out: string[] = [];

  const totals = Array.from({ length: months }, (_, i) => histories.reduce((s, h) => s + cents(h.months[i]?.payment.amount ?? 0), 0));
  const max = Math.max(0, ...totals);
  const barWidth = Math.max(8, 74 - NAME - COL * (several ? histories.length + 1 : 1) - 9);

  out.push("");
  out.push(bold(`  History  ·  ${several ? "all accounts" : histories[0].name}  ·  ${title ?? `last ${months} months`}`) + dim("  (payments by Apple fiscal month)"));
  out.push("");
  const heads = several ? [...histories.map((h) => h.name.slice(0, COL - 2)), "Total"] : ["Payment"];
  out.push(dim(`  ${"Month".padEnd(NAME)}${heads.map((h) => h.padStart(COL)).join("")}${"vs prev".padStart(9)}`));
  out.push("  " + "─".repeat(NAME + COL * heads.length + 9 + barWidth + 1));

  for (let i = 0; i < months; i++) {
    const ym = ymOf(i);
    const label = ym ? monthLabel(ym) : "?";
    const cells = histories.map((h) => {
      const r = h.months[i];
      return r === null ? "error" : (estimate(r) ? "~" : "") + m(r.payment.amount);
    });
    if (several) cells.push((histories.some((h) => estimate(h.months[i])) ? "~" : "") + m(totals[i]));
    const prev = totals[i + 1];
    const change = prev && prev > 0 ? (totals[i] - prev) / prev : null;
    const changeText = change === null ? "" : `${change >= 0 ? "+" : ""}${Math.round(change * 100)}%`;
    const running = histories.some((h) => h.months[i]?.reports.status === "in-progress");
    out.push(
      `  ${(label + (running ? "*" : "")).padEnd(NAME)}${cells.map((c) => c.padStart(COL)).join("")}${changeText.padStart(9)} ${dim(bar(totals[i], max, barWidth))}`,
    );
  }

  const closed = totals.filter((_, i) => !histories.some((h) => h.months[i]?.reports.status === "in-progress"));
  const sum = totals.reduce((a, b) => a + b, 0);
  const avg = closed.length ? closed.reduce((a, b) => a + b, 0) / closed.length : 0;
  out.push("  " + "─".repeat(NAME + COL * heads.length + 9 + barWidth + 1));
  out.push(bold(`  ${`${months} months`.padEnd(NAME)}${m(sum).padStart(COL * heads.length)}`) + dim(`   average of closed months ${m(avg)}`));
  out.push(dim("  * month still running: forecast.  ~ estimate from Trends (no Financial Report)."));

  // Biggest apps over the period
  const apps = new Map<string, number>();
  for (const h of histories) {
    for (const r of h.months) {
      if (!r) continue;
      const fromReports = r.reports.total !== null;
      for (const a of r.apps) apps.set(a.name, (apps.get(a.name) ?? 0) + (fromReports ? a.reports : a.trends));
    }
  }
  const top = [...apps.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const appSum = [...apps.values()].reduce((a, b) => a + Math.max(0, b), 0);
  if (top.length > 0) {
    out.push("");
    out.push(dim(`  ${"Top apps".padEnd(40)}${"Total".padStart(13)}${"Share".padStart(8)}`));
    for (const [name, v] of top) {
      const share = appSum > 0 ? v / appSum : 0;
      out.push(`  ${(name.length > 39 ? name.slice(0, 38) + "…" : name).padEnd(40)}${m(v).padStart(13)}${`${Math.round(share * 100)}%`.padStart(8)} ${dim(bar(share, top[0][1] / appSum, 12))}`);
    }
  }
  for (const h of histories) for (const e of h.errors) out.push(`  ! ${h.name}, ${e}`);
  out.push("");
  return out.join("\n");
}
