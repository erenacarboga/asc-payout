import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { setRetryDelays } from "../src/asc/client";
import { saveSettings, type Account } from "../src/config/settings";

/**
 * A stand-in for App Store Connect and the exchange-rate services, answering the same
 * requests asc-payout makes. Each answer can be a report, an Apple-style 404, an error
 * status, or a list of those used one after another (for retries).
 */
export type Answer = string | { status: number; detail?: string } | "no-sales" | "not-yet";

export interface FakeWorld {
  finance: Record<string, Answer | Answer[]>; // fiscal reportDate -> FINANCIAL ZZ
  detail: Record<string, Answer | Answer[]>; // fiscal reportDate -> FINANCE_DETAIL Z1
  sales: Record<string, Answer | Answer[]>; // YYYY-MM-DD -> SALES daily
  apps: { id: string; sku: string; name: string }[];
  appsStatus?: number;
  /** rates into USD */
  rates: Record<string, number>;
  /** every URL requested, in order */
  requests: string[];
}

export function world(partial: Partial<FakeWorld> = {}): FakeWorld {
  return { finance: {}, detail: {}, sales: {}, apps: [], rates: {}, requests: [], ...partial };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", date: new Date().toUTCString() } });
const appleError = (status: number, detail: string) => json({ errors: [{ status: String(status), code: status === 404 ? "NOT_FOUND" : "ERROR", title: detail, detail }] }, status);

function take(store: Record<string, Answer | Answer[]>, key: string): Answer | undefined {
  const a = store[key];
  if (Array.isArray(a)) return a.length > 1 ? a.shift() : a[0];
  return a;
}

function answer(a: Answer | undefined): Response {
  if (a === undefined) return appleError(404, "The request expected results but none were found.");
  if (a === "no-sales") return appleError(404, "There were no sales for the date specified.");
  if (a === "not-yet") return appleError(404, "Report is not available yet. Daily reports for the Americas are available by 5 am Pacific Time.");
  if (typeof a === "string") return new Response(gzipSync(Buffer.from(a)), { status: 200, headers: { "content-type": "application/a-gzip" } });
  return appleError(a.status, a.detail ?? `status ${a.status}`);
}

export function serve(w: FakeWorld): void {
  setRetryDelays([0, 0, 0]);
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    w.requests.push(url.toString());
    const q = (k: string) => url.searchParams.get(`filter[${k}]`) ?? "";

    if (url.host === "api.appstoreconnect.apple.com") {
      if (init?.method === "HEAD") return new Response(null, { status: 401, headers: { date: new Date().toUTCString() } });
      if (url.pathname === "/v1/financeReports") {
        return answer(take(q("reportType") === "FINANCE_DETAIL" ? w.detail : w.finance, q("reportDate")));
      }
      if (url.pathname === "/v1/salesReports") return answer(take(w.sales, q("reportDate")) ?? "no-sales");
      if (url.pathname === "/v1/apps") {
        if (w.appsStatus) return appleError(w.appsStatus, "not allowed");
        return json({ data: w.apps.map((a) => ({ id: a.id, type: "apps", attributes: { name: a.name, sku: a.sku } })), links: {} });
      }
      return appleError(404, "unknown path");
    }

    // exchange rates into USD
    const ecb = /frankfurter\.dev\/v1\/([^?]+)\?base=([A-Z]{3})&symbols=([A-Z]{3})/.exec(url.toString());
    if (ecb && w.rates[ecb[2]] !== undefined) {
      return json({ date: ecb[1] === "latest" ? new Date().toISOString().slice(0, 10) : ecb[1], rates: { [ecb[3]]: w.rates[ecb[2]] } });
    }
    return json({ message: "not found" }, 404);
  }) as unknown as typeof fetch;
}

/** Fresh config and cache folders, and an account with a real (throwaway) EC key. */
export function freshAccounts(names: [string, string][] = [["Notes Inc", "80000001"]]): Account[] {
  const root = mkdtempSync(join(tmpdir(), "asc-payout-e2e-"));
  process.env.ASC_PAYOUT_CONFIG_DIR = join(root, "config");
  process.env.ASC_PAYOUT_CACHE_DIR = join(root, "cache");
  mkdirSync(join(root, "config", "keys"), { recursive: true });
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  writeFileSync(join(root, "config", "keys", "AuthKey_TESTKEY001.p8"), privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const accounts = names.map(([name, vendor]) => ({
    name,
    vendor,
    key: { issuerId: "00000000-0000-4000-8000-000000000000", keyId: "TESTKEY001", keyFile: "keys/AuthKey_TESTKEY001.p8" },
  }));
  saveSettings({ accounts, currency: "USD" });
  return accounts;
}

export const ascRequests = (w: FakeWorld) => w.requests.filter((u) => u.includes("appstoreconnect"));
