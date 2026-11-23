import { gunzipSync } from "node:zlib";
import { readKeyFile, type ApiKey } from "../config/settings";
import { t } from "../i18n";
import { tokenFor } from "./token";

const API = "https://api.appstoreconnect.apple.com";
const TIMEOUT_MS = 60_000;
let RETRY_DELAYS_MS = [2000, 4000, 8000];

/** For tests: wait this long between retries. */
export function setRetryDelays(delays: number[]): void {
  RETRY_DELAYS_MS = delays;
}

/** An error answer from App Store Connect. */
export class AscError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AscError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function explain(status: number, detail: string, response: Response): string {
  if (status === 401) {
    const serverTime = Date.parse(response.headers.get("date") || "");
    const skew = Number.isNaN(serverTime) ? 0 : Math.round((Date.now() - serverTime) / 1000);
    const off = skew > 0 ? t("This computer's clock is {n} s ahead; sync it and try again.", { n: Math.abs(skew) }) : t("This computer's clock is {n} s behind; sync it and try again.", { n: Math.abs(skew) });
    const clock = Math.abs(skew) > 60 ? ` ${off}` : "";
    return `${t("The API key was rejected (401): check the Issuer ID, Key ID and .p8 file, and that the key was not revoked.")}${clock}`;
  }
  if (status === 403) return `${t("This API key is not allowed to do this (403).")} ${detail}`.trim();
  return t("App Store Connect answered {status}: {detail}", { status, detail });
}

/**
 * GET with retries for rate limits (429), server errors (5xx) and network failures.
 * Returns the raw body; throws AscError for any other non-2xx answer.
 */
export async function ascRequest(key: ApiKey, path: string, accept: "json" | "gzip"): Promise<Buffer> {
  const pem = readKeyFile(key);
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    let response: Response;
    try {
      response = await fetch(API + path, {
        headers: {
          Authorization: `Bearer ${tokenFor(key.issuerId, key.keyId, pem)}`,
          Accept: accept === "gzip" ? "application/a-gzip, application/json" : "application/json",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
      continue; // network error: retry
    }

    if (response.ok) {
      const body = Buffer.from(await response.arrayBuffer());
      const gzipped = body.length > 2 && body[0] === 0x1f && body[1] === 0x8b;
      return gzipped ? gunzipSync(body) : body;
    }

    let code = "";
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { errors?: { code?: string; detail?: string; title?: string }[] };
      const err = body?.errors?.[0];
      code = err?.code || "";
      detail = err?.detail || err?.title || detail;
    } catch {
      // not JSON
    }
    const error = new AscError(response.status, code, explain(response.status, detail, response));
    if (response.status === 429 || response.status >= 500) {
      lastError = error;
      continue;
    }
    // Keep Apple's own wording for 404s: callers tell "no sales" from "not available yet" by it
    if (response.status === 404) throw new AscError(404, code, detail);
    throw error;
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(String(lastError));
}

export async function ascJson<T>(key: ApiKey, path: string): Promise<T> {
  return JSON.parse((await ascRequest(key, path, "json")).toString("utf-8")) as T;
}

/** Follows `links.next` and returns every `data` item. */
export async function ascAll<T>(key: ApiKey, path: string, maxPages = 50): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;
  for (let page = 0; next && page < maxPages; page++) {
    const body: { data: T[]; links?: { next?: string } } = await ascJson(key, next);
    items.push(...body.data);
    next = body.links?.next ? body.links.next.replace(API, "") : undefined;
  }
  return items;
}

export async function ascReport(key: ApiKey, path: string): Promise<string> {
  return (await ascRequest(key, path, "gzip")).toString("utf-8");
}
