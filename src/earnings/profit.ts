import { campaignSpend, listOrgs, type AdsKey, type AdsOrg, type CampaignSpend } from "../ads/appleAds";
import { monthLabel, periodLabel, shortDate, today, type Period, type YearMonth } from "../calendar/fiscal";
import { t } from "../i18n";
import { money, rawAmount } from "../money/format";
import { convert, getRates } from "../money/rates";
import type { MonthResult } from "./model";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s);
const green = (s: string) => (color ? `\x1b[32m${s}\x1b[39m` : s);
const red = (s: string) => (color ? `\x1b[31m${s}\x1b[39m` : s);
const yellow = (s: string) => (color ? `\x1b[33m${s}\x1b[39m` : s);

/**
 * What an app earned in a month next to what its Apple Ads campaigns cost in the
 * same days. Revenue is what Apple pays for the month (Reports, else Trends), so it
 * includes people who found the app without an ad: ROAS here is revenue / ad spend.
 */
/** name of an advertised app Apple Ads gives no name for */
const UNKNOWN_APP = "(unknown app)";

export interface ProfitApp {
  name: string;
  appId?: string;
  account?: string;
  /** null for an advertised app that none of the accounts shown sells */
  revenue: number | null;
  spend: number;
  installs: number;
  taps: number;
  campaigns: number;
}

export interface ProfitResult {
  month: YearMonth;
  period: Period;
  /** the days the spend covers (the month so far while it is running) */
  spendFrom: string;
  spendTo: string;
  currency: string;
  revenueBasis: "reports" | "trends" | "mixed";
  apps: ProfitApp[];
  orgs: { name: string; currency: string }[];
  unconverted: { amount: number; currency: string }[];
}

export interface ProfitOptions {
  currency: string;
  log: (m: string) => void;
  /** for tests */
  orgs?: AdsOrg[];
}

export async function computeProfit(results: MonthResult[], key: AdsKey, opts: ProfitOptions): Promise<ProfitResult> {
  if (results.length === 0) throw new Error(t("No month to compare with"));
  const { month, period } = results[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const spendTo = period.end < today() ? period.end : yesterday;

  opts.log(`Apple Ads · ${t("organizations")}`);
  const orgs = opts.orgs ?? (await listOrgs(key));
  const spend: CampaignSpend[] = [];
  if (spendTo >= period.start) {
    for (const org of orgs) {
      opts.log(`Apple Ads · ${org.name}`);
      spend.push(...(await campaignSpend(key, org, period.start, spendTo)));
    }
  }

  const table = await getRates(new Set(spend.map((s) => s.currency)), opts.currency, spendTo);
  const unconverted = new Map<string, number>();
  const value = (s: CampaignSpend) => {
    if (s.currency !== opts.currency && !table.rates.has(s.currency)) {
      unconverted.set(s.currency, (unconverted.get(s.currency) ?? 0) + s.spend);
      return 0;
    }
    return convert({ [s.currency]: s.spend }, table);
  };

  // Revenue by app, from every account shown
  const apps = new Map<string, ProfitApp>();
  const bases = new Set<string>();
  for (const r of results) {
    const hasReports = r.reports.total !== null;
    bases.add(hasReports ? "reports" : "trends");
    for (const app of r.apps) {
      const revenue = hasReports ? app.reports : app.trends;
      const id = app.appId ?? `${r.account.vendor}:${app.key}`;
      const known = apps.get(id);
      if (known) known.revenue = (known.revenue ?? 0) + revenue;
      else apps.set(id, { name: app.name, appId: app.appId, account: r.account.name, revenue, spend: 0, installs: 0, taps: 0, campaigns: 0 });
    }
  }
  for (const s of spend) {
    const id = s.appId || `ads:${s.appName}`;
    let a = apps.get(id);
    if (!a) {
      a = { name: s.appName || UNKNOWN_APP, appId: s.appId || undefined, revenue: null, spend: 0, installs: 0, taps: 0, campaigns: 0 };
      apps.set(id, a);
    }
    a.spend += value(s);
    a.installs += s.installs;
    a.taps += s.taps;
    a.campaigns += 1;
  }

  return {
    month,
    period,
    spendFrom: period.start,
    spendTo,
    currency: opts.currency,
    revenueBasis: bases.size > 1 ? "mixed" : bases.has("reports") ? "reports" : "trends",
    apps: [...apps.values()]
      .filter((a) => a.spend > 0 || a.campaigns > 0 || (a.revenue ?? 0) !== 0)
      .sort((x, y) => y.spend - x.spend || (y.revenue ?? 0) - (x.revenue ?? 0)),
    orgs: orgs.map((o) => ({ name: o.name, currency: o.currency })),
    unconverted: [...unconverted].map(([currency, amount]) => ({ currency, amount })),
  };
}

const roas = (revenue: number | null, spend: number) => (revenue !== null && spend > 0 ? `${(revenue / spend).toFixed(1)}x` : "—");

export function renderProfit(r: ProfitResult): string {
  const m = (n: number) => money(n, r.currency);
  const W = 26;
  // columns grow when a translated heading is wider than the English one
  const col = (text: string, min: number) => Math.max(min, t(text).length + 1);
  const REVENUE = col("Revenue", 12);
  const SPEND = col("Ad spend", 12);
  const PROFIT = col("Profit", 12);
  const ROAS = col("ROAS", 7);
  const INSTALLS = col("Installs", 10);
  const PER = col("Per install", 13);
  const out: string[] = [];
  const head =
    `  ${t("App").padEnd(W)}${t("Revenue").padStart(REVENUE)}${t("Ad spend").padStart(SPEND)}${t("Profit").padStart(PROFIT)}` +
    `${t("ROAS").padStart(ROAS)}${t("Installs").padStart(INSTALLS)}${t("Per install").padStart(PER)}`;
  const rule = "  " + "─".repeat(head.length - 2);
  const fit = (s: string) => (s.length > W - 1 ? s.slice(0, W - 2) + "…" : s);
  const appName = (a: ProfitApp) => (a.revenue === null && a.name === UNKNOWN_APP ? t(UNKNOWN_APP) : a.name);
  const profitCell = (p: number | null) => {
    if (p === null) return "—".padStart(PROFIT);
    const text = m(p).padStart(PROFIT);
    return p < 0 ? red(text) : p > 0 ? green(text) : text;
  };

  out.push("");
  out.push(bold(`  ${t("Profit after Apple Ads")}  ·  ${monthLabel(r.month)}`) + dim(`  ·  ${periodLabel(r.period)}`));
  out.push("");
  out.push(dim(head));
  out.push(rule);
  const sum = { revenue: 0, spend: 0, installs: 0, other: 0 };
  for (const a of r.apps) {
    sum.revenue += a.revenue ?? 0;
    sum.spend += a.spend;
    sum.installs += a.installs;
    if (a.revenue === null) sum.other += a.spend;
    const profit = a.revenue === null ? null : a.revenue - a.spend;
    out.push(
      `  ${fit(appName(a)).padEnd(W)}${(a.revenue === null ? "—" : m(a.revenue)).padStart(REVENUE)}${(a.spend ? m(a.spend) : "—").padStart(SPEND)}${profitCell(profit)}` +
        `${roas(a.revenue, a.spend).padStart(ROAS)}${(a.campaigns ? String(a.installs) : "—").padStart(INSTALLS)}${(a.installs ? m(a.spend / a.installs) : "—").padStart(PER)}`,
    );
  }
  if (r.apps.length === 0) out.push(dim(`  ${t("No sales and no ad spend in this period.")}`));
  out.push(rule);
  out.push(
    bold(
      `  ${t("Total").padEnd(W)}${m(sum.revenue).padStart(REVENUE)}${m(sum.spend).padStart(SPEND)}${profitCell(sum.revenue - sum.spend)}` +
        `${roas(sum.revenue, sum.spend).padStart(ROAS)}${String(sum.installs).padStart(INSTALLS)}${(sum.installs ? m(sum.spend / sum.installs) : "—").padStart(PER)}`,
    ),
  );
  out.push("");
  const basis = { reports: t("Financial Reports"), trends: t("Trends"), mixed: t("Reports where final, Trends otherwise") }[r.revenueBasis];
  out.push(dim(`  ${t("Revenue is what Apple pays for the month ({basis}), including sales without an ad.", { basis })}`));
  const days = r.spendTo < r.spendFrom ? t("no days yet") : `${shortDate(r.spendFrom, false)} - ${shortDate(r.spendTo)}`;
  const orgs = r.orgs.map((o) => o.name).join(", ") || t("no Apple Ads organization");
  out.push(dim(`  ${t("Ad spend {days}, from {orgs}.", { days, orgs })}`));
  if (sum.other > 0) out.push(dim(`  ${t("— revenue: an advertised app none of the accounts shown sells ({amount} of the spend).", { amount: m(sum.other) })}`));
  for (const u of r.unconverted) out.push(yellow(`  ${t("No exchange rate for {amount}; it is not in the spend.", { amount: rawAmount(u.amount, u.currency) })}`));
  out.push("");
  return out.join("\n");
}
