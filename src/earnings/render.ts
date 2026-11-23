import { monthLabel, periodLabel, shortDate } from "../calendar/fiscal";
import { money, rawAmount } from "../money/format";
import type { MonthResult } from "./model";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s);
const yellow = (s: string) => (color ? `\x1b[33m${s}\x1b[39m` : s);

const NAME = 42;
const AMOUNT = 13;
const WIDTH = NAME + AMOUNT * 2;

function fit(text: string, width: number): string {
  return text.length > width ? text.slice(0, width - 1) + "…" : text.padEnd(width);
}

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

let regionNames: Intl.DisplayNames | null = null;
function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export interface RenderOptions {
  by?: "app" | "country";
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
  out.push(dim(`  ${(options.by === "country" ? "Country" : "App / product").padEnd(NAME)}${"Reports".padStart(AMOUNT)}${"Trends".padStart(AMOUNT)}`));
  out.push(rule);
  if (options.by === "country") {
    for (const c of r.countries) {
      out.push(`  ${fit(`${countryName(c.code)} (${c.code})`, NAME - 1)} ${reportsCell(c.reports).padStart(AMOUNT)}${trendsCell(c.trends).padStart(AMOUNT)}`);
    }
    if (r.countries.length === 0) out.push(dim("  No paid sales in this period."));
  } else r.apps.forEach((app, i) => {
    if (i > 0) out.push("");
    out.push(bold(`  ${fit(app.name, NAME - 1)} ${reportsCell(app.reports, app.unconverted?.reports).padStart(AMOUNT)}${trendsCell(app.trends, app.unconverted?.trends).padStart(AMOUNT)}`));
    const showItems = !(app.items.length === 1 && app.items[0].name === "(App sales)");
    if (showItems) {
      for (const item of app.items) {
        out.push(dim(`    ${fit(item.name, NAME - 3)} ${reportsCell(item.reports, item.unconverted?.reports).padStart(AMOUNT)}${trendsCell(item.trends, item.unconverted?.trends).padStart(AMOUNT)}`));
      }
    }
  });
  if (options.by !== "country" && r.apps.length === 0) out.push(dim("  No paid sales in this period."));
  out.push(rule);
  out.push(bold(`  ${"Total".padEnd(NAME)}${(hasReports ? m(r.reports.total!) : "—").padStart(AMOUNT)}${m(r.trends.total).padStart(AMOUNT)}`));
  out.push("");

  // Payment first: it is what people run this for
  const p = r.payment;
  const basis = {
    reports: "from Reports",
    forecast: "forecast from Trends",
    trends: "from Trends",
    "trends-so-far": "Trends so far, month not complete",
  }[p.basis];
  const when = p.paid ? `paid around ${shortDate(p.date)}` : `expected around ${shortDate(p.date)}`;
  out.push(bold(`  Payment   ~${m(p.amount)}  ·  ${when}`) + dim(`  (${basis})`));

  // Reports
  const reportsLine = {
    ok: "Apple Financial Report, the final figures.",
    "in-progress": "not available until the month ends.",
    "not-published": "not published yet; Apple usually publishes it in the first week after the month ends.",
    "no-access": `this API key can't read Financial Reports. Give it the Finance role.`,
    failed: `could not be downloaded: ${r.reports.message}`,
  }[r.reports.status];
  out.push(`  Reports   ${reportsLine}`);
  if (r.reports.status === "ok") {
    if (r.reports.mismatches.length === 0) out.push(dim("            Rows match the report's own country summary."));
    for (const x of r.reports.mismatches) {
      out.push(yellow(`            Warning: ${x.currency} rows add up to ${x.rows.toFixed(2)}, the report's summary says ${x.summary.toFixed(2)}.`));
    }
  }

  // Trends
  const t = r.trends;
  const through = t.through ? ` (through ${shortDate(t.through, false)})` : "";
  if (t.skipped) {
    out.push(dim("  Trends    not downloaded (the Financial Report is final)."));
  } else {
    out.push(`  Trends    ${t.available} of ${t.days} days${through}${t.available < t.days && !t.problems.length ? ", month still running" : ""}.`);
    const known = r.daily.filter((d): d is { date: string; total: number } => d.total !== null);
    if (known.some((d) => d.total !== 0)) {
      const peak = known.reduce((a, b) => (b.total > a.total ? b : a));
      out.push(`  Daily     ${sparkline(r.daily.map((d) => d.total))}` + dim(`  peak ${m(peak.total)} on ${shortDate(peak.date, false)}`));
    }
  }
  for (const problem of t.problems) out.push(yellow(`            ${problem}`));
  if (t.forecast) {
    out.push(
      `  Forecast  ~${m(t.forecast.total)} for the whole month` +
        dim(`  (${t.forecast.remainingDays} more day(s) at ${m(t.forecast.perDay)}/day, the last ${t.forecast.basisDays} days' average)`),
    );
  }
  if (hasReports && t.total !== 0 && !t.skipped) {
    const diff = r.reports.total! - t.total;
    const pct = (diff / Math.abs(t.total)) * 100;
    const head = `  Diff      Reports ${signed(diff, r.currency)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%) vs Trends`;
    const s = r.settlement;
    if (s && s.later !== undefined) {
      // exact: diff = earlier - later
      out.push(head + dim(", because the Financial Report has:"));
      out.push(`            ${signed(s.earlier, r.currency).padStart(11)}  sales made before ${shortDate(r.period.start, false)}, settled now`);
      out.push(`            ${signed(-s.later, r.currency).padStart(11)}  this period's sales Apple settles in the next report`);
    } else {
      out.push(head + dim("  (timing, refunds, adjustments)"));
    }
  }

  // Rates
  out.push(`  Rates     as of ${shortDate(r.rates.date)}${r.rates.sources ? ` · ${r.rates.sources}` : ""}`);
  for (const u of r.rates.unconverted) {
    out.push(yellow(`            No exchange rate for ${rawAmount(u.amount, u.currency)}; not included in the ${u.in} total (rows marked *).`));
  }
  out.push(dim("            Before tax withholding and bank fees; Apple's rates differ slightly."));
  out.push("");
  return out.join("\n");
}

export interface AccountRow {
  name: string;
  result?: MonthResult;
  error?: string;
}

export function renderSummary(rows: AccountRow[], currency: string): string {
  const out: string[] = [];
  const m = (n: number) => money(n, currency);
  const W = 32;
  const A = 14;
  const rule = "  " + "─".repeat(W + A * 3);
  const first = rows.find((r) => r.result)?.result;
  const cents = (n: number) => Math.round(n * 100) / 100;

  out.push("");
  out.push(bold(`  All accounts${first ? `  ·  ${monthLabel(first.month)}` : ""}`) + (first ? dim(`  ·  ${periodLabel(first.period)}`) : ""));
  out.push("");
  out.push(dim(`  ${"Account".padEnd(W)}${"Reports".padStart(A)}${"Trends".padStart(A)}${"Payment".padStart(A)}`));
  out.push(rule);

  let reports = 0;
  let trends = 0;
  let payment = 0;
  let reportsCount = 0;
  let estimated = false;
  for (const row of rows) {
    if (!row.result) {
      out.push(`  ${fit(row.name, W - 1)} ${yellow("could not be read".padStart(A * 3))}`);
      continue;
    }
    const r = row.result;
    const rep = r.reports.total === null ? null : cents(r.reports.total);
    const tr = cents(r.trends.total);
    const pay = cents(r.payment.amount);
    if (rep !== null) {
      reports += rep;
      reportsCount++;
    }
    if (r.payment.basis !== "reports") estimated = true;
    trends += tr;
    payment += pay;
    out.push(
      `  ${fit(row.name, W - 1)} ${(rep === null ? "—" : m(rep)).padStart(A)}${m(tr).padStart(A)}${((r.payment.basis === "reports" ? "" : "~") + m(pay)).padStart(A)}`,
    );
  }
  out.push(rule);
  const reportsTotal = reportsCount === 0 ? "—" : m(reports) + (reportsCount < rows.length ? "*" : "");
  out.push(bold(`  ${"Total".padEnd(W)}${reportsTotal.padStart(A)}${m(trends).padStart(A)}${((estimated ? "~" : "") + m(payment)).padStart(A)}`));
  out.push("");
  if (reportsCount > 0 && reportsCount < rows.length) out.push(dim("  * not every account has a Financial Report for this month yet"));
  if (first) {
    out.push(
      dim(`  Payment uses Reports when available, otherwise Trends (~). Expected around ${shortDate(first.payment.date)}.`),
    );
  }
  out.push("");
  return out.join("\n");
}
