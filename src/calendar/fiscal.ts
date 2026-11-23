/**
 * Apple's fiscal calendar, which App Store payments follow.
 *
 * The fiscal year is the 52- or 53-week period ending on the last Saturday of
 * September. Every quarter is 5 + 4 + 4 weeks (October, January, April and July are
 * the 5-week months). A 53-week year gives its extra week to December.
 *
 * Months are named after the calendar month they mostly cover: "October 2026" is
 * Sep 27 - Oct 31, 2026. All dates are YYYY-MM-DD strings computed in UTC.
 */

const DAY = 86_400_000;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface YearMonth {
  year: number;
  month: number; // 1-12, the calendar month the fiscal month is named after
}

export interface Period {
  start: string; // Sunday
  end: string; // Saturday
}

export const toDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const toMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
export const addDays = (date: string, days: number): string => toDate(toMs(date) + days * DAY);
export const today = (): string => toDate(Date.now());

export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let t = toMs(start); t <= toMs(end); t += DAY) days.push(toDate(t));
  return days;
}

function fiscalYearEnd(fiscalYear: number): number {
  // last Saturday of September
  let t = Date.UTC(fiscalYear, 8, 30);
  while (new Date(t).getUTCDay() !== 6) t -= DAY;
  return t;
}

/** Fiscal year that a named month belongs to (October-December belong to the next one). */
export const fiscalYearOf = (ym: YearMonth): number => (ym.month >= 10 ? ym.year + 1 : ym.year);

/** 1 = October ... 12 = September */
export const fiscalMonthIndex = (ym: YearMonth): number => ((ym.month + 2) % 12) + 1;

export function fiscalPeriod(ym: YearMonth): Period {
  const fy = fiscalYearOf(ym);
  const first = fiscalYearEnd(fy - 1) + DAY;
  const weeksInYear = Math.round((fiscalYearEnd(fy) - first + DAY) / (7 * DAY));

  const weeks = [5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4];
  if (weeksInYear === 53) weeks[2] += 1;

  const i = fiscalMonthIndex(ym) - 1;
  const startMs = first + weeks.slice(0, i).reduce((a, b) => a + b, 0) * 7 * DAY;
  return { start: toDate(startMs), end: toDate(startMs + weeks[i] * 7 * DAY - DAY) };
}

/** The reportDate App Store Connect expects for Financial Reports: fiscal year and fiscal month. */
export function financeReportDate(ym: YearMonth): string {
  return `${fiscalYearOf(ym)}-${String(fiscalMonthIndex(ym)).padStart(2, "0")}`;
}

export const monthLabel = (ym: YearMonth): string => `${MONTH_NAMES[ym.month - 1]} ${ym.year}`;

/** "2026-10-31" -> "Oct 31, 2026" (or "Oct 31") */
export function shortDate(date: string, withYear = true): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${SHORT_MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

export function periodLabel(p: Period): string {
  return `${shortDate(p.start, p.start.slice(0, 4) !== p.end.slice(0, 4))} - ${shortDate(p.end)}`;
}

/** Parses "2026-10" into a YearMonth. */
export function parseYearMonth(value: string): YearMonth | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(value.trim());
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null;
}

/** The fiscal month containing `date`. */
export function monthContaining(date: string): YearMonth {
  const [y, m] = date.split("-").map(Number);
  for (const candidate of [{ year: y, month: m }, next({ year: y, month: m }), previous({ year: y, month: m })]) {
    const p = fiscalPeriod(candidate);
    if (p.start <= date && date <= p.end) return candidate;
  }
  return { year: y, month: m };
}

export function previous(ym: YearMonth): YearMonth {
  return ym.month === 1 ? { year: ym.year - 1, month: 12 } : { year: ym.year, month: ym.month - 1 };
}

export function next(ym: YearMonth): YearMonth {
  return ym.month === 12 ? { year: ym.year + 1, month: 1 } : { year: ym.year, month: ym.month + 1 };
}

/** The current fiscal month first, then `count - 1` earlier months. */
export function recentMonths(count: number, at: string = today()): YearMonth[] {
  const list: YearMonth[] = [monthContaining(at)];
  while (list.length < count) list.push(previous(list[list.length - 1]));
  return list;
}

/** "MM/DD/YYYY" (Apple report format) -> "YYYY-MM-DD" */
export function fromUsDate(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}
