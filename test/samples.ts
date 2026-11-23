/** Made-up reports in Apple's file layouts. */

const tsv = (rows: (string | number)[][]) => rows.map((r) => r.join("\t")).join("\n");

const SALES_HEADER = [
  "Provider", "Provider Country", "SKU", "Developer", "Title", "Version", "Product Type Identifier", "Units",
  "Developer Proceeds", "Begin Date", "End Date", "Customer Currency", "Country Code", "Currency of Proceeds",
  "Apple Identifier", "Customer Price", "Promo Code", "Parent Identifier", "Subscription", "Period", "Category",
  "CMB", "Device", "Supported Platforms", "Proceeds Reason", "Preserved Pricing", "Client", "Order Type",
];

function sale(sku: string, title: string, type: string, units: number, proceeds: string, currency: string, appleId: string, parent = "") {
  const row = new Array(SALES_HEADER.length).fill(" ");
  Object.assign(row, {
    0: "APPLE", 2: sku, 4: title, 6: type, 7: units, 8: proceeds, 9: "10/05/2026", 10: "10/05/2026",
    11: currency, 13: currency, 14: appleId, 17: parent || " ",
  });
  return row;
}

export const salesDayA = tsv([
  SALES_HEADER,
  sale("app.notes", "Notes", "1F", 40, "0", "USD", "900001"), // free download
  sale("notes.plus.week", "Plus Weekly", "IAY", 3, "4.24", "USD", "910001", "app.notes"),
  sale("notes.plus.week", "Plus Weekly", "IAY", 2, "3.60", "EUR", "910001", "app.notes"),
  sale("notes.tips.big", "Big Tip", "IA1", 1, "4389.22", "KZT", "910002", "app.notes"),
]);

export const salesDayB = tsv([
  SALES_HEADER,
  sale("notes.plus.week", "Plus Weekly", "IAY", 1, "4.24", "USD", "910001", "app.notes"),
  sale("notes.plus.week", "Plus Weekly", "IAY", -1, "4.24", "USD", "910001", "app.notes"), // refund
  sale("app.paint", "Paint", "1", 2, "0.70", "USD", "900002"),
]).replace(/\n/g, "\r\n");

const FIN_HEADER = [
  "Start Date", "End Date", "UPC", "ISRC/ISBN", "Vendor Identifier", "Quantity", "Partner Share", "Extended Partner Share",
  "Partner Share Currency", "Sales or Return", "Apple Identifier", "Artist/Show/Developer/Author", "Title",
  "Label/Studio/Network/Developer/Publisher", "Grid", "Product Type Identifier", "ISAN/Other Identifier", "Country Of Sale",
  "Pre-order Flag", "Promo Code", "Customer Price", "Customer Currency",
];

function finance(id: string, qty: number, share: number, currency: string, appleId: string, title: string, type: string, country: string) {
  return ["09/27/2026", "10/31/2026", "", "", id, qty, share.toFixed(2), (qty * share).toFixed(2), currency, qty < 0 ? "R" : "S",
    appleId, "Example", title, "", "", type, "", country, "", "", "0", currency];
}

export const financialReport = [
  tsv([
    FIN_HEADER,
    finance("notes.plus.week", 4, 4.24, "USD", "910001", "Plus Weekly", "IAY", "US"),
    finance("notes.plus.week", -1, 4.24, "USD", "910001", "Plus Weekly", "IAY", "US"),
    finance("notes.plus.week", 2, 3.6, "EUR", "910001", "Plus Weekly", "IAY", "FR"),
    finance("notes.plus.life", 1, 20, "USD", "910003", "Plus Lifetime", "IA1", "US"),
  ]),
  "Total_Rows\t4",
  "",
  "Country Of Sale\tPartner Share Currency\tQuantity\tExtended Partner Share",
  "FR\tEUR\t2\t7.20",
  "US\tUSD\t4\t32.72",
].join("\n");

export const financialReportBadSummary = financialReport.replace("US\tUSD\t4\t32.72", "US\tUSD\t4\t50.00");

/** Financial Detail Report for the same money as `financialReport`; one sale was made before the period. */
export const detailReport = [
  "Vendor Name\tExample",
  "Start Date\t09/27/2026",
  "End Date\t10/31/2026",
  [
    "Transaction Date", "Settlement Date", "Apple Identifier", "SKU", "Title", "Developer Name", "Product Type Identifier",
    "Country of Sale", "Quantity", "Partner Share", "Extended Partner Share", "Partner Share Currency", "Customer Price",
    "Customer Currency", "Sale or Return", "Promo Code", "Order Type", "Region",
  ].join("\t"),
  ...[
    ["09/24/2026", "notes.plus.week", 1, 4.24, "USD", "US"], // made before Sep 27, settled in October
    ["10/03/2026", "notes.plus.week", 3, 4.24, "USD", "US"],
    ["10/06/2026", "notes.plus.week", -1, 4.24, "USD", "US"],
    ["10/05/2026", "notes.plus.week", 2, 3.6, "EUR", "FR"],
    ["10/10/2026", "notes.plus.life", 1, 20, "USD", "US"],
  ].map(([date, sku, qty, share, cur, country]) =>
    [date, "10/31/2026", "910001", sku, "x", "Example", "IAY", country, qty, Number(share).toFixed(2), (Number(qty) * Number(share)).toFixed(2), cur, "0", cur, Number(qty) < 0 ? "R" : "S", "", "", "", ""].join("\t"),
  ),
  "",
  "Country Of Sale\tPartner Share Currency\tQuantity\tExtended Partner Share",
  "FR\tEUR\t2\t7.20",
  "US\tUSD\t4\t32.72",
].join("\n");
