import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const APP_NAME = "asc-payout";

/** Settings and API keys. Override with ASC_PAYOUT_CONFIG_DIR. */
export function configDir(): string {
  if (process.env.ASC_PAYOUT_CONFIG_DIR) return process.env.ASC_PAYOUT_CONFIG_DIR;
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), APP_NAME);
}

/** Downloaded reports. Override with ASC_PAYOUT_CACHE_DIR. */
export function cacheDir(): string {
  if (process.env.ASC_PAYOUT_CACHE_DIR) return process.env.ASC_PAYOUT_CACHE_DIR;
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), APP_NAME);
}

/** Cache folder of one vendor, so two accounts never share cached reports. */
export function vendorCacheDir(vendor: string): string {
  return join(cacheDir(), vendor);
}

export function settingsFile(): string {
  return join(configDir(), "config.json");
}

export function keysDir(): string {
  return join(configDir(), "keys");
}

/** Key files are stored relative to the config folder so the folder can be copied as a whole. */
export function resolveKeyFile(path: string): string {
  return isAbsolute(path) ? path : join(configDir(), path);
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
