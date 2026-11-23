import { monthLabel, periodLabel, shortDate } from "../calendar/fiscal";
import { lang, t } from "../i18n";
import { money, rawAmount } from "../money/format";
import { APP_SALES, type MonthResult } from "./model";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s);
const yellow = (s: string) => (color ? `\x1b[33m${s}\x1b[39m` : s);
const green = (s: string) => (color ? `\x1b[32m${s}\x1b[39m` : s);

const NAME = 42;
const AMOUNT = 13;
const WIDTH = NAME + AMOUNT * 2;

function fit(text: string, width: number): string {
  return text.length > width ? text.slice(0, width - 1) + "…" : text.padEnd(width);
}

/** A row label in the 10-wide label column ("  Payment   "). */
const label = (text: string) => `  ${t(text).padEnd(9)} `;
const MORE = " ".repeat(12);
const itemName = (name: string) => (name === APP_SALES ? t(APP_SALES) : name);

const signed = (n: number, currency: string) => (n >= 0 ? "+" : "-") + money(Math.abs(n), currency);

const BARS = "▁▂▃▄▅▆▇█";

/** One character per day, a space between weeks; "·" for days without a report yet. */
export function sparkline(values: (number | null)[]): string {
  const max = Math.max(0, ...values.filter((v): v is number => v !== null));
  return values
    .map((v, i) => {
      const bar = v === null ? "·" : max <= 0 ? BARS[0] : BARS[Math.min(7, Math.max(0, Math.round((v / max) * 7)))];
      return (i > 0 && i % 7 === 0 ? " " : "") + bar;
    })
    .join("");
}

let regionNames: { lang: string; names: Intl.DisplayNames } | null = null;
function countryName(code: string): string {
  try {
    if (regionNames?.lang !== lang()) regionNames = { lang: lang(), names: new Intl.DisplayNames([lang()], { type: "region" }) };
    return regionNames.names.of(code) ?? code;
  } catch {
    return code;
  }
}

export interface RenderOptions {
  by?: "app" | "country";
  /** the monthly goal, in the result's currency */
  goal?: number;
}

/** Progress toward a monthly goal, from what is known now (no projection). */
export function goalLine(current: number, goal: number, currency: string): string {
  const m = (n: number) => money(n, currency);
  const share = goal > 0 ? current / goal : 0;
  const cells = 16;
  const filled = Math.max(0, Math.min(cells, Math.round(share * cells)));
  const bar = (share >= 1 ? green : (s: string) => s)("█".repeat(filled)) + dim("░".repeat(cells - filled));
  let tail: string;
  if (share >= 1) tail = green(t("reached")) + dim(current > goal ? `, ${t("{amount} over", { amount: m(current - goal) })}` : "");
  else tail = dim(t("{amount} to go", { amount: m(goal - current) }));
  return `${label("Goal")}${bar} ${String(Math.round(share * 100)).padStart(3)}%  ${t("{current} of {goal}", { current: m(current), goal: m(goal) })}  ·  ${tail}`;
}

/** What counts toward a goal: the Financial Report when it is out, the real sales so far (Trends) until then. */
export function goalProgress(r: MonthResult): number {
  return r.payment.amount;
}

export function renderMonth(r: MonthResult, options: RenderOptions = {}): string {
  const out: string[] = [];
  const m = (n: number) => money(n, r.currency);
  const hasReports = r.reports.total !== null;
  const reportsCell = (n: number, mark?: boolean) => (hasReports ? m(n) + (mark ? "*" : "") : "—");
  const trendsCell = (n: number, mark?: boolean) => m(n) + (mark ? "*" : "");
  const rule = "  " + "─".repeat(WIDTH);

  out.push("");
  out.push(bold(`  ${r.account.name}  ·  ${monthLabel(r.month)}`) + dim(`  ·  ${periodLabel(r.period)}`));
  out.push("");
  out.push(dim(`  ${t(options.by === "country" ? "Country" : "App / product").padEnd(NAME)}${t("Reports").padStart(AMOUNT)}${t("Trends").padStart(AMOUNT)}`));
  out.push(rule);
  if (options.by === "country") {
    for (const c of r.countries) {
      out.push(`  ${fit(`${countryName(c.code)} (${c.code})`, NAME - 1)} ${reportsCell(c.reports).padStart(AMOUNT)}${trendsCell(c.trends).padStart(AMOUNT)}`);
    }
    if (r.countries.length === 0) out.push(dim(`  ${t("No paid sales in this period.")}`));
  } else r.apps.forEach((app, i) => {
    if (i > 0) out.push("");
    out.push(bold(`  ${fit(app.name, NAME - 1)} ${reportsCell(app.reports, app.unconverted?.reports).padStart(AMOUNT)}${trendsCell(app.trends, app.unconverted?.trends).padStart(AMOUNT)}`));
    const showItems = !(app.items.length === 1 && app.items[0].name === "(App sales)");
    if (showItems) {
      for (const item of app.items) {
        out.push(dim(`    ${fit(itemName(item.name), NAME - 3)} ${reportsCell(item.reports, item.unconverted?.reports).padStart(AMOUNT)}${trendsCell(item.trends, item.unconverted?.trends).padStart(AMOUNT)}`));
      }
    }
  });
  if (options.by !== "country" && r.apps.length === 0) out.push(dim(`  ${t("No paid sales in this period.")}`));
  out.push(rule);
  out.push(bold(`  ${t("Total").padEnd(NAME)}${(hasReports ? m(r.reports.total!) : "—").padStart(AMOUNT)}${m(r.trends.total).padStart(AMOUNT)}`));
  out.push("");

  // Payment first: it is what people run this for
  // Only real figures: the Financial Report when it is out, otherwise the sales so far
  const p = r.payment;
  const when = t(p.paid ? "paid around {date}" : "expected around {date}", { date: shortDate(p.date) });
  if (p.basis === "reports") {
    if (Math.abs(p.amount) < 0.005) out.push(bold(`${label("Payment")}${m(0)}`) + dim(`  ·  ${t("nothing to pay for this month")}`));
    else out.push(bold(`${label("Payment")}${m(p.amount)}  ·  ${when}`) + dim(`  (${t("Apple Financial Report")})`));
  } else if (p.basis === "trends-so-far") {
    out.push(bold(`${label("Payment")}${t("not final yet")}`) + `  ·  ${t("sales so far {amount}", { amount: m(p.amount) })}`);
    out.push(dim(MORE + `${t("{n} of {total} days", { n: r.trends.available, total: r.trends.days })}; ${t("the final amount comes with Apple's Financial Report")}`));
  } else {
    out.push(bold(`${label("Payment")}${t("not final yet")}`) + `  ·  ${t("sales of the month {amount}", { amount: m(p.amount) })}`);
    out.push(dim(MORE + `${t("waiting for Apple's Financial Report")}; ${when}`));
  }
  if (options.goal) out.push(goalLine(goalProgress(r), options.goal, r.currency));

  // Reports
  const reportsLine = {
    ok: t("Apple Financial Report, the final figures."),
    "in-progress": t("not available until the month ends."),
    "not-published": t("not published yet; Apple usually publishes it in the first week after the month ends."),
    none: t("no Financial Report for this month: nothing was settled."),
    "no-access": t("this API key can't read Financial Reports. Give it the Finance role."),
    failed: t("could not be downloaded: {message}", { message: String(r.reports.message) }),
  }[r.reports.status];
  out.push(`${label("Reports")}${reportsLine}`);
  if (r.reports.status === "ok") {
    if (r.reports.mismatches.length === 0) out.push(dim(MORE + t("Rows match the report's own country summary.")));
    for (const x of r.reports.mismatches) {
      const vars = { currency: x.currency, rows: x.rows.toFixed(2), summary: x.summary.toFixed(2) };
      out.push(yellow(MORE + t("Warning: {currency} rows add up to {rows}, the report's summary says {summary}.", vars)));
    }
  }

  // Trends
  const tr = r.trends;
  const through = tr.through ? ` (${t("through {date}", { date: shortDate(tr.through, false) })})` : "";
  if (tr.skipped) {
    out.push(dim(label("Trends") + t("not downloaded (the Financial Report is final).")));
  } else {
    out.push(
      `${label("Trends")}${t("{n} of {total} days", { n: tr.available, total: tr.days })}${through}` +
        `${tr.available < tr.days && !tr.problems.length ? `, ${t("month still running")}` : ""}.`,
    );
    const known = r.daily.filter((d): d is { date: string; total: number } => d.total !== null);
    if (known.some((d) => d.total !== 0)) {
      const peak = known.reduce((a, b) => (b.total > a.total ? b : a));
      out.push(`${label("Daily")}${sparkline(r.daily.map((d) => d.total))}` + dim(`  ${t("peak {amount} on {date}", { amount: m(peak.total), date: shortDate(peak.date, false) })}`));
    }
  }
  for (const problem of tr.problems) out.push(yellow(MORE + problem));
  if (hasReports && tr.total !== 0 && !tr.skipped) {
    const diff = r.reports.total! - tr.total;
    const pct = (diff / Math.abs(tr.total)) * 100;
    const head = label("Diff") + t("Reports {diff} ({pct}) vs Trends", { diff: signed(diff, r.currency), pct: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` });
    const s = r.settlement;
    if (s && s.later !== undefined) {
      // exact: diff = earlier - later
      out.push(head + dim(t(", because the Financial Report has:")));
      out.push(`${MORE}${signed(s.earlier, r.currency).padStart(11)}  ${t("sales made before {date}, settled now", { date: shortDate(r.period.start, false) })}`);
      out.push(`${MORE}${signed(-s.later, r.currency).padStart(11)}  ${t("this period's sales Apple settles in the next report")}`);
    } else {
      out.push(head + dim(`  (${t("timing, refunds, adjustments")})`));
    }
  }

  // Rates
  out.push(`${label("Rates")}${t("as of {date}", { date: shortDate(r.rates.date) })}${r.rates.sources ? ` · ${r.rates.sources}` : ""}`);
  for (const u of r.rates.unconverted) {
    const vars = { amount: rawAmount(u.amount, u.currency), in: t(u.in) };
    out.push(yellow(MORE + t("No exchange rate for {amount}; not included in the {in} total (rows marked *).", vars)));
  }
  out.push(dim(MORE + t("Before tax withholding and bank fees; Apple's rates differ slightly.")));
  out.push("");
  return out.join("\n");
}

export interface AccountRow {
  name: string;
  result?: MonthResult;
  error?: string;
}

export function renderSummary(rows: AccountRow[], currency: string, goal?: number): string {
  const out: string[] = [];
  const m = (n: number) => money(n, currency);
  const W = 32;
  const A = 14;
  const rule = "  " + "─".repeat(W + A * 3);
  const first = rows.find((r) => r.result)?.result;
  const cents = (n: number) => Math.round(n * 100) / 100;

  out.push("");
  out.push(bold(`  ${t("All accounts")}${first ? `  ·  ${monthLabel(first.month)}` : ""}`) + (first ? dim(`  ·  ${periodLabel(first.period)}`) : ""));
  out.push("");
  out.push(dim(`  ${t("Account").padEnd(W)}${t("Reports").padStart(A)}${t("Trends").padStart(A)}${t("Payment").padStart(A)}`));
  out.push(rule);

  let reports = 0;
  let trends = 0;
  let reportsCount = 0;
  for (const row of rows) {
    if (!row.result) {
      out.push(`  ${fit(row.name, W - 1)} ${yellow(t("could not be read").padStart(A * 3))}`);
      continue;
    }
    const r = row.result;
    const rep = r.reports.total === null ? null : cents(r.reports.total);
    const tr = cents(r.trends.total);
    if (rep !== null) {
      reports += rep;
      reportsCount++;
    }
    trends += tr;
    // the payment is the Financial Report; until it is out there is no final amount
    out.push(`  ${fit(row.name, W - 1)} ${(rep === null ? "—" : m(rep)).padStart(A)}${m(tr).padStart(A)}${(rep === null ? "—" : m(rep)).padStart(A)}`);
  }
  out.push(rule);
  const reportsTotal = reportsCount === 0 ? "—" : m(reports) + (reportsCount < rows.length ? "*" : "");
  out.push(bold(`  ${t("Total").padEnd(W)}${reportsTotal.padStart(A)}${m(trends).padStart(A)}${reportsTotal.padStart(A)}`));
  out.push("");
  const results = rows.flatMap((r) => (r.result ? [r.result] : []));
  if (goal && results.length > 0) {
    out.push(goalLine(results.reduce((s, r) => s + cents(goalProgress(r)), 0), goal, currency));
    out.push("");
  }
  if (reportsCount > 0 && reportsCount < rows.length) out.push(dim(`  ${t("* not every account has a Financial Report for this month yet")}`));
  if (first) {
    const note =
      reportsCount === rows.length
        ? t("Payment is Apple's Financial Report. Expected around {date}.", { date: shortDate(first.payment.date) })
        : t("Payment: the final amount comes with Apple's Financial Report; Trends are the real sales so far. Expected around {date}.", { date: shortDate(first.payment.date) });
    out.push(dim(`  ${note}`));
  }
  out.push("");
  return out.join("\n");
}

export function renderAppDetail(d: import("./app").AppDetail): string {
  const m = (n: number) => money(n, d.currency);
  const out: string[] = [];
  const rule = "  " + "─".repeat(WIDTH);
  out.push("");
  out.push(bold(`  ${d.app.name}  ·  ${monthLabel(d.month)}`) + dim(`  ·  ${d.account}  ·  ${periodLabel(d.period)}`));
  out.push("");
  out.push(dim(`  ${t("Product").padEnd(NAME)}${t("Reports").padStart(AMOUNT)}${t("Trends").padStart(AMOUNT)}`));
  out.push(rule);
  for (const item of d.app.items) {
    out.push(`  ${fit(itemName(item.name), NAME - 1)} ${(d.hasReports ? m(item.reports) : "—").padStart(AMOUNT)}${m(item.trends).padStart(AMOUNT)}`);
  }
  out.push(rule);
  out.push(bold(`  ${t("Total").padEnd(NAME)}${(d.hasReports ? m(d.app.reports) : "—").padStart(AMOUNT)}${m(d.app.trends).padStart(AMOUNT)}`));
  out.push("");

  const known = d.daily.filter((x): x is { date: string; total: number } => x.total !== null);
  if (known.some((x) => x.total !== 0)) {
    const peak = known.reduce((a, b) => (b.total > a.total ? b : a));
    out.push(`${label("Daily")}${sparkline(d.daily.map((x) => x.total))}` + dim(`  ${t("peak {amount} on {date}", { amount: m(peak.total), date: shortDate(peak.date, false) })}`));
  }
  const rate = d.sold > 0 ? (d.refunded / d.sold) * 100 : 0;
  out.push(
    `${label("Refunds")}${t("{refunded} of {sold} sold", { refunded: d.refunded, sold: d.sold })}` +
      (d.sold > 0 ? ` (${rate.toFixed(1)}%)` : "") +
      (d.refundAmount > 0 ? dim(`  ·  ${t("{amount} refunded", { amount: m(d.refundAmount) })}`) : ""),
  );

  if (d.countries.length > 0) {
    out.push("");
    const total = d.countries.reduce((s, c) => s + Math.max(0, c.amount), 0);
    out.push(dim(`  ${t("Country").padEnd(30)}${t("Trends").padStart(13)}${t("Share").padStart(8)}`));
    for (const c of d.countries.slice(0, 10)) {
      const share = total > 0 ? c.amount / total : 0;
      out.push(`  ${fit(`${countryName(c.code)} (${c.code})`, 29)} ${m(c.amount).padStart(13)}${`${Math.round(share * 100)}%`.padStart(8)} ${dim("█".repeat(Math.round(share * 20)))}`);
    }
    if (d.countries.length > 10) out.push(dim(`  ${t("… and {n} more countries", { n: d.countries.length - 10 })}`));
  }
  out.push("");
  return out.join("\n");
}
