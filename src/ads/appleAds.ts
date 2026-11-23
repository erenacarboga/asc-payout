import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolveKeyFile } from "../config/paths";
import { t } from "../i18n";

/**
 * Apple Ads (formerly Search Ads) Campaign Management API, read only: which
 * organizations the key can see, and what each campaign spent in a date range.
 * https://developer.apple.com/documentation/apple_ads
 *
 * Sign-in is OAuth 2 client credentials: a client secret (an ES256 JWT signed with
 * the private key whose public half was uploaded in Apple Ads) is traded for an
 * access token that lasts an hour.
 */

export interface AdsKey {
  clientId: string;
  teamId: string;
  keyId: string;
  /** PEM private key, absolute or relative to the config folder */
  keyFile: string;
}

export interface AdsOrg {
  id: number;
  name: string;
  currency: string;
  timeZone: string;
}

export interface CampaignSpend {
  orgId: number;
  campaignId: number;
  campaign: string;
  /** the App Store ID of the advertised app */
  appId: string;
  appName: string;
  spend: number;
  currency: string;
  installs: number;
  taps: number;
  impressions: number;
}

const TOKEN_URL = "https://appleid.apple.com/auth/oauth2/token";
const API = "https://api.searchads.apple.com/api/v5";
const TIMEOUT_MS = 60_000;
let RETRY_DELAYS_MS = [2000, 4000, 8000];

export function setAdsRetryDelays(delays: number[]): void {
  RETRY_DELAYS_MS = delays;
}

export class AdsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdsError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** A new P-256 key pair: the public half goes into Apple Ads, the private half stays here. */
export function newKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKey: privateKey.export({ type: "sec1", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** true, or why the file cannot be used as the Apple Ads private key. */
export function checkAdsKeyFile(path: string): true | string {
  if (!path) return t("Enter the path of the private key file");
  if (!existsSync(path)) return t("File not found: {path}", { path });
  try {
    const key = createPrivateKey(readFileSync(path, "utf-8"));
    if (key.asymmetricKeyType !== "ec") return t("This is not an EC (P-256) private key");
  } catch {
    return t("This doesn't look like a private key (.pem)");
  }
  return true;
}

export function clientSecret(key: AdsKey, pem: string, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  const header = { alg: "ES256", kid: key.keyId };
  const payload = { sub: key.clientId, iss: key.teamId, aud: "https://appleid.apple.com", iat: now - 30, exp: now + 3600 };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign("sha256", Buffer.from(input), { key: createPrivateKey(pem), dsaEncoding: "ieee-p1363" });
  return `${input}.${base64url(signature)}`;
}

const tokens = new Map<string, { token: string; until: number }>();

async function withRetries(request: () => Promise<Response>): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      const response = await request();
      if (response.status === 429 || response.status >= 500) {
        lastError = new AdsError(response.status, t("Apple Ads answered {status}", { status: response.status }));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof AdsError) throw lastError;
  throw new AdsError(0, t("Cannot reach Apple Ads: {error}", { error: (lastError as Error)?.message ?? t("network error") }));
}

export async function accessToken(key: AdsKey): Promise<string> {
  const id = `${key.clientId}/${key.keyId}`;
  const hit = tokens.get(id);
  if (hit && hit.until > Date.now()) return hit.token;

  const file = resolveKeyFile(key.keyFile);
  if (!existsSync(file)) throw new AdsError(0, t("Apple Ads key file not found: {path}. Set it up again in Settings > Apple Ads.", { path: file }));
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: key.clientId,
    client_secret: clientSecret(key, readFileSync(file, "utf-8")),
    scope: "searchadsorg",
  });
  const response = await withRetries(() =>
    fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !json.access_token) {
    if (json.error === "invalid_client") {
      throw new AdsError(
        response.status,
        t("Apple Ads did not accept the key (invalid_client). Check the client ID, team ID and key ID, and that the public key in Apple Ads belongs to this private key."),
      );
    }
    throw new AdsError(response.status, t("Apple Ads sign-in failed ({details}).", { details: `${response.status}${json.error ? `, ${json.error}` : ""}` }));
  }
  tokens.set(id, { token: json.access_token, until: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 120) * 1000 });
  return json.access_token;
}

async function adsRequest<T>(key: AdsKey, path: string, init: { method?: "GET" | "POST"; body?: unknown; orgId?: number } = {}): Promise<T> {
  const token = await accessToken(key);
  const response = await withRetries(() =>
    fetch(API + path, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.orgId !== undefined ? { "X-AP-Context": `orgId=${init.orgId}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const j = (await response.json()) as { error?: { errors?: { message?: string }[] } };
      detail = j.error?.errors?.[0]?.message || detail;
    } catch {
      // not JSON
    }
    if (response.status === 401) tokens.clear();
    if (response.status === 403) throw new AdsError(403, `${t("This Apple Ads user may not read this (403). Give it a role such as API Account Read Only.")} ${detail}`.trim());
    throw new AdsError(response.status, t("Apple Ads answered {status}: {detail}", { status: response.status, detail }));
  }
  return (await response.json()) as T;
}

/** The organizations (campaign groups) the key can read. */
export async function listOrgs(key: AdsKey): Promise<AdsOrg[]> {
  const body = await adsRequest<{ data?: { orgId: number; orgName: string; currency: string; timeZone: string }[] }>(key, "/acls");
  return (body.data ?? []).map((o) => ({ id: o.orgId, name: o.orgName, currency: o.currency, timeZone: o.timeZone }));
}

interface ReportRow {
  total?: Record<string, unknown> & { localSpend?: { amount?: string | number; currency?: string } };
  metadata?: { campaignId?: number; campaignName?: string; adamId?: number | string; app?: { appName?: string; adamId?: number | string } };
}

const count = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** Spend, installs and taps of every campaign of an organization from `from` to `to` (inclusive). */
export async function campaignSpend(key: AdsKey, org: AdsOrg, from: string, to: string): Promise<CampaignSpend[]> {
  const out: CampaignSpend[] = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const body = await adsRequest<{ data?: { reportingDataResponse?: { row?: ReportRow[] } }; pagination?: { totalResults?: number } }>(
      key,
      "/reports/campaigns",
      {
        method: "POST",
        orgId: org.id,
        body: {
          startTime: from,
          endTime: to,
          selector: { orderBy: [{ field: "localSpend", sortOrder: "DESCENDING" }], pagination: { offset, limit } },
          timeZone: "ORTZ",
          returnRecordsWithNoMetrics: false,
          returnRowTotals: true,
          returnGrandTotals: false,
        },
      },
    );
    const rows = body.data?.reportingDataResponse?.row ?? [];
    for (const r of rows) {
      const t = r.total ?? {};
      const m = r.metadata ?? {};
      out.push({
        orgId: org.id,
        campaignId: count(m.campaignId),
        campaign: m.campaignName ?? "",
        appId: String(m.app?.adamId ?? m.adamId ?? ""),
        appName: m.app?.appName ?? "",
        spend: count(t.localSpend?.amount),
        currency: t.localSpend?.currency || org.currency,
        // v5 reports split installs into tap and view installs; older ones had one number
        installs: count(t.totalInstalls ?? t.installs ?? t.tapInstalls),
        taps: count(t.taps),
        impressions: count(t.impressions),
      });
    }
    const total = body.pagination?.totalResults ?? rows.length;
    if (rows.length < limit || offset + limit >= total) break;
  }
  return out;
}
