import { describe, expect, test } from "bun:test";
import { appOf, type Catalog } from "../src/asc/catalog";
import { groupByApp } from "../src/earnings/model";
import type { RateTable } from "../src/money/rates";
import { readFinancialReport } from "../src/reports/finance";
import { readSalesReports } from "../src/reports/sales";
import { financialReport, salesDayA, salesDayB } from "./samples";

const catalog = (): Catalog => ({
  apps: [
    { id: "900001", sku: "app.notes", name: "Notes" },
    { id: "900002", sku: "app.paint", name: "Paint" },
  ],
  parents: {},
  names: {},
});

const usd: RateTable = {
  currency: "USD",
  rates: new Map([
    ["USD", { value: 1, source: "ECB", date: "2026-10-30" }],
    ["EUR", { value: 1.1, source: "ECB", date: "2026-10-30" }],
  ]),
  missing: ["KZT"],
};

describe("appOf", () => {
  test("parent from the Sales report", () => {
    expect(appOf(catalog(), { id: "notes.plus.week", appleId: "910001", parentSku: "app.notes" })?.name).toBe("Notes");
  });
  test("the app itself, by SKU or Apple ID", () => {
    expect(appOf(catalog(), { id: "app.paint", appleId: "" })?.name).toBe("Paint");
    expect(appOf(catalog(), { id: "x", appleId: "900002" })?.name).toBe("Paint");
  });
  test("a product never sold in Trends is placed by its siblings", () => {
    const c = catalog();
    c.parents["notes.plus.week"] = "app.notes";
    expect(appOf(c, { id: "notes.plus.life", appleId: "910003" })?.name).toBe("Notes");
  });
  test("ambiguous siblings are not guessed", () => {
    const c = catalog();
    c.parents["shared.week"] = "app.notes";
    c.parents["shared.month"] = "app.paint";
    expect(appOf(c, { id: "shared.life", appleId: "" })).toBeNull();
  });
});

describe("groupByApp", () => {
  const sales = readSalesReports([salesDayA, salesDayB]);
  const reports = readFinancialReport(financialReport).products;
  const c = catalog();
  c.parents["notes.plus.week"] = "app.notes";
  const apps = groupByApp(reports, sales, c, usd);

  test("joins both sources per product under the app", () => {
    const notes = apps.find((a) => a.name === "Notes")!;
    const week = notes.items.find((i) => i.name === "Plus Weekly")!;
    expect(week.reports).toBeCloseTo(12.72 + 7.2 * 1.1, 6);
    expect(week.trends).toBeCloseTo(12.72 + 7.2 * 1.1, 6); // the KZT tip has no rate and is left out
    expect(notes.items.find((i) => i.name === "Plus Lifetime")!.reports).toBe(20);
  });

  test("paid app sales are one line", () => {
    const paint = apps.find((a) => a.name === "Paint")!;
    expect(paint.items).toEqual([{ name: "(App sales)", reports: 0, trends: expect.closeTo(1.4, 6) }]);
  });

  test("largest app first", () => {
    expect(apps[0].name).toBe("Notes");
  });
});

