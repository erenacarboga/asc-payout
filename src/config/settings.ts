import { existsSync, readFileSync } from "node:fs";
import type { AdsKey } from "../ads/appleAds";
import { t, useLanguageSetting, type Lang } from "../i18n";
import { writeFileAtomic } from "./files";
import { resolveKeyFile, settingsFile } from "./paths";

/** An App Store Connect API key. */
export interface ApiKey {
  issuerId: string;
  keyId: string;
  /** Path to the .p8 file, absolute or relative to the config folder. */
  keyFile: string;
}

/** One vendor number and the key that reads its reports. */
export interface Account {
  name: string;
  vendor: string;
  key: ApiKey;
  /**
   * Optional second key (App Manager or Developer role). Only needed to name
   * in-app purchases that never appear in Sales reports.
   */
  catalogKey?: ApiKey;
}

/** A monthly earnings goal, in the currency it was set in. */
export interface Goal {
  amount: number;
  currency: string;
}

export interface Settings {
  accounts: Account[];
  /** Display currency, e.g. USD. */
  currency: string;
  /** Name of the account picked last time ("all" for all accounts). */
  lastAccount?: string;
  /** Monthly goals by vendor number, and "all" for all accounts together. */
  goals?: Record<string, Goal>;
  /** Apple Ads API key, for ad spend next to revenue */
  ads?: AdsKey;
  /** Language of the screens; follows the system when not set */
  language?: Lang;
}

function isAdsKey(value: unknown): value is AdsKey {
  const k = value as AdsKey;
  return !!k && ["clientId", "teamId", "keyId", "keyFile"].every((f) => typeof (k as unknown as Record<string, unknown>)[f] === "string");
}

function isGoal(value: unknown): value is Goal {
  const g = value as Goal;
  return !!g && typeof g.amount === "number" && Number.isFinite(g.amount) && g.amount > 0 && typeof g.currency === "string" && /^[A-Z]{3}$/.test(g.currency);
}

const DEFAULTS: Settings = { accounts: [], currency: "USD" };

function isKey(value: unknown): value is ApiKey {
  const k = value as ApiKey;
  return !!k && typeof k.issuerId === "string" && typeof k.keyId === "string" && typeof k.keyFile === "string";
}

function isAccount(value: unknown): value is Account {
  const a = value as Account;
  return !!a && typeof a.name === "string" && typeof a.vendor === "string" && isKey(a.key) && (a.catalogKey === undefined || isKey(a.catalogKey));
}

export function loadSettings(): Settings {
  const settings = readSettings();
  useLanguageSetting(settings.language);
  return settings;
}

function readSettings(): Settings {
  const file = settingsFile();
  if (!existsSync(file)) return { ...DEFAULTS, accounts: [] };
  let raw: Partial<Settings>;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    throw new Error(t("Cannot read {file}: {error}. Fix or delete it and run: asc-payout setup", { file, error: (error as Error).message }));
  }
  const accounts = Array.isArray(raw.accounts) ? raw.accounts.filter(isAccount) : [];
  return {
    accounts,
    currency: typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : DEFAULTS.currency,
    lastAccount: typeof raw.lastAccount === "string" ? raw.lastAccount : undefined,
    ...(raw.goals && typeof raw.goals === "object"
      ? { goals: Object.fromEntries(Object.entries(raw.goals).filter(([, g]) => isGoal(g))) }
      : {}),
    ...(isAdsKey(raw.ads) ? { ads: raw.ads } : {}),
    ...(raw.language === "en" || raw.language === "tr" ? { language: raw.language } : {}),
  };
}

export function saveSettings(settings: Settings): void {
  useLanguageSetting(settings.language);
  writeFileAtomic(settingsFile(), JSON.stringify(settings, null, 2) + "\n");
}

export function readKeyFile(key: ApiKey): string {
  const path = resolveKeyFile(key.keyFile);
  if (!existsSync(path)) {
    throw new Error(t("API key file not found: {path}. Run: asc-payout setup", { path }));
  }
  return readFileSync(path, "utf-8");
}

/**
 * Matches an account by vendor number or name (any case). A part of a name works
 * too ("2" for "Account 2") when it fits exactly one account.
 */
export function findAccount(settings: Settings, query: string): Account | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const exact = settings.accounts.find((a) => a.vendor === q || a.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = settings.accounts.filter((a) => a.name.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0] : undefined;
}

/**
 * An account defined entirely by environment variables (handy for CI and scripts).
 * Takes precedence over config.json when ASC_PAYOUT_VENDOR is set.
 */
export function accountFromEnv(env: NodeJS.ProcessEnv = process.env): Account | null {
  const vendor = env.ASC_PAYOUT_VENDOR;
  if (!vendor) return null;
  const missing = ["ASC_PAYOUT_ISSUER_ID", "ASC_PAYOUT_KEY_ID", "ASC_PAYOUT_KEY_FILE"].filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(t(missing.length === 1 ? "ASC_PAYOUT_VENDOR is set but {names} is missing." : "ASC_PAYOUT_VENDOR is set but {names} are missing.", { names: missing.join(", ") }));
  }
  return {
    name: env.ASC_PAYOUT_ACCOUNT_NAME || t("Vendor {vendor}", { vendor }),
    vendor,
    key: { issuerId: env.ASC_PAYOUT_ISSUER_ID!, keyId: env.ASC_PAYOUT_KEY_ID!, keyFile: env.ASC_PAYOUT_KEY_FILE! },
  };
}
