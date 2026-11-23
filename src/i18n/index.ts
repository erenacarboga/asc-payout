import { TR } from "./tr";

/**
 * The language of the screens and menus. Machine output (--json, --csv) and the
 * command-line help stay in English.
 *
 * Texts are written in English in the code and looked up by that text, so a
 * missing translation shows the English one rather than nothing:
 *
 *   t("Payment")                          -> "Ödeme"
 *   t("{n} of {total} days", { n, total }) -> "35 / 35 gün"
 */

export type Lang = "en" | "tr";
export const LANGS: { code: Lang; name: string }[] = [
  { code: "en", name: "English" },
  { code: "tr", name: "Türkçe" },
];

let chosen: Lang | null = null;
let fromSettings: Lang | undefined;

const isLang = (v: unknown): v is Lang => v === "en" || v === "tr";

/** The system language, when it is one asc-payout speaks. */
export function systemLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const candidates = [env.LC_ALL, env.LC_MESSAGES, env.LANG, safeLocale()];
  for (const c of candidates) {
    if (!c || c === "C" || c === "POSIX") continue;
    return c.toLowerCase().startsWith("tr") ? "tr" : "en";
  }
  return "en";
}

function safeLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

/** ASC_PAYOUT_LANG, then the language picked in Settings, then the system's. */
export function lang(): Lang {
  if (chosen) return chosen;
  const env = process.env.ASC_PAYOUT_LANG?.toLowerCase().slice(0, 2);
  chosen = isLang(env) ? env : (fromSettings ?? systemLang());
  return chosen;
}

/** Called with the saved setting (undefined: follow the system). */
export function useLanguageSetting(value: unknown): void {
  fromSettings = isLang(value) ? value : undefined;
  chosen = null;
}

/** For tests. */
export function setLang(value: Lang | null): void {
  chosen = value;
}

export function t(text: string, vars?: Record<string, string | number>): string {
  const s = lang() === "tr" ? (TR[text] ?? text) : text;
  return vars ? s.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : s;
}
