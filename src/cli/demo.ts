import { addDays, eachDay, fiscalPeriod, toMs, today, type YearMonth } from "../calendar/fiscal";
import { forecastMonth, type AppGroup, type MonthResult } from "../earnings/model";

/**
 * Made-up results in the real layout: for screenshots and for trying the tool
 * without an App Store Connect account. No network, no settings.
 */
const DEMO_ACCOUNTS: { name: string; vendor: string; apps: [string, [string, number, number][]][] }[] = [
  {
    name: "Demo Studio",
    vendor: "80000001",
    apps: [
      ["Photo Editor Pro", [["Pro Yearly", 599.99, 580.1], ["Pro Monthly", 247.23, 232.3]]],
      ["Task Planner", [["Premium Upgrade", 234.5, 241.75]]],
      ["Weather Glance", [["(App sales)", 89.97, 89.97]]],
    ],
  },
  {
    name: "Demo Personal",
    vendor: "80000002",
    apps: [["Habit Streaks", [["Plus Weekly", 152.4, 148.85], ["Plus Lifetime", 39.99, 0]]]],
  },
];

const COUNTRY_SHARE: [string, number][] = [
  ["US", 0.44], ["DE", 0.11], ["GB", 0.09], ["JP", 0.08], ["TR", 0.06], ["FR", 0.06], ["CA", 0.05], ["BR", 0.04], ["AU", 0.04], ["IN", 0.03],
];

/** A believable daily shape: busier weekends, a slow rise over the month. */
function dailyShape(dates: string[]): number[] {
  const raw = dates.map((d, i) => {
    const weekday = new Date(toMs(d)).getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 1.45 : 1;
    const wave = 1 + 0.18 * Math.sin(i * 1.7) + 0.1 * Math.cos(i * 0.6);
    return weekend * wave * (1 + i / dates.length / 3);
  });
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / total);
}

export function demoResults(ym: YearMonth, currency: string): MonthResult[] {
  const period = fiscalPeriod(ym);
  const now = today();
  const running = period.end >= now;
  const all = eachDay(period.start, period.end);
  const available = running ? Math.max(0, eachDay(period.start, now).length - 1) : all.length;
  const shape = dailyShape(all);
  const share = shape.slice(0, available).reduce((a, b) => a + b, 0);

  return DEMO_ACCOUNTS.map((account) => {
    const apps: AppGroup[] = account.apps.map(([name, items]) => {
      const lines = items.map(([item, reports, trends]) => ({ name: item, reports: running ? 0 : reports, trends: trends * share }));
      return { name, items: lines, reports: lines.reduce((s, l) => s + l.reports, 0), trends: lines.reduce((s, l) => s + l.trends, 0) };
    });
    const fullTrends = account.apps.flatMap(([, items]) => items).reduce((s, [, , t]) => s + t, 0);
    const trendsTotal = fullTrends * share;
    const reportsTotal = running ? null : apps.reduce((s, a) => s + a.reports, 0);
    const daily = all.map((date, i) => ({ date, total: i < available ? fullTrends * shape[i] : null }));
    const forecast = running
      ? forecastMonth(daily.filter((d): d is { date: string; total: number } => d.total !== null), all.length)
      : undefined;
    const date = addDays(period.end, 33);
    const countries = COUNTRY_SHARE.map(([code, part]) => ({ code, reports: (reportsTotal ?? 0) * part, trends: trendsTotal * part }));
    const earlier = reportsTotal === null ? 0 : reportsTotal * 0.09;
    return {
      account: { name: account.name, vendor: account.vendor },
      month: ym,
      period,
      currency,
      reports: { status: running ? "in-progress" : "ok", mismatches: [], total: reportsTotal },
      trends: { days: all.length, available, through: available > 0 ? all[available - 1] : undefined, problems: [], total: trendsTotal, forecast },
      apps,
      daily,
      countries,
      settlement: reportsTotal === null ? undefined : { earlier, inPeriod: reportsTotal - earlier, later: trendsTotal - (reportsTotal - earlier) },
      rates: { date: running ? now : period.end, sources: "ECB", unconverted: [] },
      payment:
        reportsTotal !== null
          ? { date, paid: now > date, amount: reportsTotal, basis: "reports" }
          : { date, paid: false, amount: forecast?.total ?? trendsTotal, basis: forecast ? "forecast" : "trends-so-far" },
    } satisfies MonthResult;
  });
}
