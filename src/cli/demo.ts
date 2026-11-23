import { addDays, eachDay, fiscalPeriod, today, type YearMonth } from "../calendar/fiscal";
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

export function demoResults(ym: YearMonth, currency: string): MonthResult[] {
  const period = fiscalPeriod(ym);
  const now = today();
  const running = period.end >= now;
  const days = eachDay(period.start, period.end).length;
  const available = running ? Math.max(0, eachDay(period.start, now).length - 1) : days;
  const share = available / days;

  return DEMO_ACCOUNTS.map((account) => {
    const apps: AppGroup[] = account.apps.map(([name, items]) => {
      const lines = items.map(([item, reports, trends]) => ({ name: item, reports: running ? 0 : reports, trends: trends * share }));
      return { name, items: lines, reports: lines.reduce((s, l) => s + l.reports, 0), trends: lines.reduce((s, l) => s + l.trends, 0) };
    });
    const trendsTotal = apps.reduce((s, a) => s + a.trends, 0);
    const reportsTotal = running ? null : apps.reduce((s, a) => s + a.reports, 0);
    const forecast = running
      ? forecastMonth(
          eachDay(period.start, period.end)
            .slice(0, available)
            .map((date) => ({ date, total: trendsTotal / Math.max(available, 1) })),
          days,
        )
      : undefined;
    const date = addDays(period.end, 33);
    return {
      account: { name: account.name, vendor: account.vendor },
      month: ym,
      period,
      currency,
      reports: { status: running ? "in-progress" : "ok", mismatches: [], total: reportsTotal },
      trends: {
        days,
        available,
        through: available > 0 ? addDays(period.start, available - 1) : undefined,
        problems: [],
        total: trendsTotal,
        forecast,
      },
      apps,
      rates: { date: running ? now : period.end, sources: "ECB", unconverted: [] },
      payment:
        reportsTotal !== null
          ? { date, paid: now > date, amount: reportsTotal, basis: "reports" }
          : { date, paid: false, amount: forecast?.total ?? trendsTotal, basis: forecast ? "forecast" : "trends-so-far" },
    } satisfies MonthResult;
  });
}
