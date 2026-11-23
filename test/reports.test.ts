import { describe, expect, test } from "bun:test";
import { readFinancialReport } from "../src/reports/finance";
import { readSalesReports } from "../src/reports/sales";
import { financialReport, financialReportBadSummary, salesDayA, salesDayB } from "./samples";

describe("Sales reports", () => {
  const products = readSalesReports([salesDayA, salesDayB]);

  test("units x developer proceeds, per currency, refunds subtract", () => {
    const week = products.get("notes.plus.week")!;
    expect(week.amounts.USD).toBeCloseTo(3 * 4.24, 6);
    expect(week.amounts.EUR).toBeCloseTo(7.2, 6);
    expect(week.parentSku).toBe("app.notes");
  });

  test("free rows are skipped, paid apps are kept", () => {
    expect(products.has("app.notes")).toBe(false);
    expect(products.get("app.paint")!.amounts.USD).toBeCloseTo(1.4, 6);
  });

  test("columns are found by name", () => {
    const swapped = salesDayA
      .split("\n")
      .map((line) => {
        const c = line.split("\t");
        [c[7], c[8]] = [c[8], c[7]];
        return c.join("\t");
      })
      .join("\n");
    expect(readSalesReports([swapped]).get("notes.plus.week")!.amounts.USD).toBeCloseTo(12.72, 6);
  });

  test("a changed format is an error, not a wrong number", () => {
    expect(() => readSalesReports([salesDayA.replace("Developer Proceeds", "Proceeds")])).toThrow(/Developer Proceeds/);
  });
});

describe("Financial Report", () => {
  const report = readFinancialReport(financialReport);

  test("reads rows, not the summary", () => {
    expect(report.rowCount).toBe(4);
    expect(report.products.get("notes.plus.week")!.amounts.USD).toBeCloseTo(12.72, 6);
    expect(report.products.get("notes.plus.life")!.amounts.USD).toBe(20);
  });

  test("period from the rows", () => {
    expect(report.period).toEqual({ start: "2026-09-27", end: "2026-10-31" });
  });

  test("rows checked against the report's own summary", () => {
    expect(report.mismatches).toEqual([]);
    const bad = readFinancialReport(financialReportBadSummary).mismatches;
    expect(bad).toHaveLength(1);
    expect(bad[0].currency).toBe("USD");
    expect(bad[0].summary).toBe(50);
  });
});
