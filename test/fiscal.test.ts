import { describe, expect, test } from "bun:test";
import {
  addDays, eachDay, financeReportDate, fiscalPeriod, fromUsDate, monthContaining, parseYearMonth, periodLabel, recentMonths, toMs,
} from "../src/calendar/fiscal";

describe("fiscalPeriod", () => {
  const known: [string, string, string][] = [
    ["2026-09", "2026-08-30", "2026-09-26"], // from an Apple Financial Report
    ["2026-10", "2026-09-27", "2026-10-31"], // from an Apple Financial Report
    ["2026-11", "2026-11-01", "2026-11-28"],
    ["2026-12", "2026-11-29", "2026-12-26"],
    ["2022-12", "2022-11-27", "2022-12-31"], // 53-week year: December has 5 weeks
    ["2023-01", "2023-01-01", "2023-02-04"],
    ["2023-09", "2023-09-03", "2023-09-30"],
    ["2025-01", "2024-12-29", "2025-02-01"],
  ];
  for (const [ym, start, end] of known) {
    test(ym, () => expect(fiscalPeriod(parseYearMonth(ym)!)).toEqual({ start, end }));
  }

  test("months follow each other without gaps, Sunday to Saturday", () => {
    for (let fy = 2020; fy <= 2032; fy++) {
      let previousEnd: string | null = null;
      for (const m of [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const p = fiscalPeriod({ year: m >= 10 ? fy - 1 : fy, month: m });
        if (previousEnd) expect(p.start).toBe(addDays(previousEnd, 1));
        expect(new Date(toMs(p.start)).getUTCDay()).toBe(0);
        expect(new Date(toMs(p.end)).getUTCDay()).toBe(6);
        previousEnd = p.end;
      }
    }
  });
});

describe("helpers", () => {
  test("finance report date is fiscal year and fiscal month", () => {
    expect(financeReportDate({ year: 2026, month: 10 })).toBe("2027-01");
    expect(financeReportDate({ year: 2027, month: 9 })).toBe("2027-12");
    expect(financeReportDate({ year: 2027, month: 1 })).toBe("2027-04");
  });
  test("monthContaining handles dates that belong to the next or previous named month", () => {
    expect(monthContaining("2026-09-28")).toEqual({ year: 2026, month: 10 });
    expect(monthContaining("2026-11-30")).toEqual({ year: 2026, month: 12 });
    expect(monthContaining("2024-12-30")).toEqual({ year: 2025, month: 1 });
  });
  test("recentMonths starts with the current month", () => {
    expect(recentMonths(3, "2026-11-23")).toEqual([
      { year: 2026, month: 11 }, { year: 2026, month: 10 }, { year: 2026, month: 9 },
    ]);
  });
  test("parsing", () => {
    expect(parseYearMonth("2026-13")).toBeNull();
    expect(parseYearMonth("2026-1")).toEqual({ year: 2026, month: 1 });
    expect(fromUsDate("1/2/2026")).toBe("2026-01-02");
    expect(eachDay("2026-10-30", "2026-11-01")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(periodLabel({ start: "2024-12-29", end: "2025-02-01" })).toBe("Dec 29, 2024 - Feb 1, 2025");
  });
});
