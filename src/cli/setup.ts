import { existsSync } from "node:fs";
import pkg from "../../package.json";
import { loadCatalog } from "../asc/catalog";
import { checkSalesAccess } from "../asc/reports";
import { cacheDir, configDir, resolveKeyFile, settingsFile } from "../config/paths";
import { accountFromEnv, loadSettings, saveSettings, type Account, type ApiKey, type Settings } from "../config/settings";
import { LANGS, systemLang, t, type Lang } from "../i18n";
import { money } from "../money/format";
import { checkKeyFile, cleanPath, findKeyFiles, keyIdFromFileName, storeKeyFile } from "./keys";
import { isDailyCheckOn, setDailyCheck } from "./schedule";
import { startSpinner, withSpinner } from "./spinner";
import { compareVersions, latestVersion, runUpdate } from "./update";
import { runWatch } from "./watch";
import { adsMenu } from "./ads-setup";
import { BACK, QUIT, type Back } from "./prompts";
import { ui } from "./ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Z0-9]{10}$/;
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s);
const say = (text = "") => ui.print(text ? `  ${text}` : "");

// ---------------------------------------------------------------------------
// A wizard is a list of steps; Esc in a step goes back to the previous one.
// A step that does not apply returns "skip" and is passed over in either direction.
// ---------------------------------------------------------------------------

type StepResult = "next" | "skip" | Back;
type Step<D> = (draft: D) => Promise<StepResult>;

/** Runs the steps; null when the person goes back past the first one. `before` runs before each step. */
export async function wizard<D>(draft: D, steps: Step<D>[], before?: (index: number) => void): Promise<D | null> {
  let i = 0;
  let direction = 1;
  while (i < steps.length) {
    if (i < 0) return null;
    before?.(i);
    const result = await steps[i](draft);
    if (result === BACK) direction = -1;
    else if (result === "next") direction = 1;
    i += direction;
  }
  return draft;
}

interface AccountDraft {
  key?: ApiKey;
  keyChoice?: "keep" | "new" | ApiKey;
  keyFile?: string;
  keyId?: string;
  issuerId?: string;
  vendor?: string;
  name?: string;
  cancelled?: boolean;
}

/** Add (no `current`) or change an account. Returns null when cancelled. */
async function accountWizard(others: Account[], current?: Account): Promise<Account | null> {
  const draft: AccountDraft = {};
  const reusable = [...new Map(others.map((a) => [a.key.keyId, a])).values()].filter((a) => a.key.keyId !== current?.key.keyId);

  const steps: Step<AccountDraft>[] = [
    // 1. Which key
    async (d) => {
      if (!current && reusable.length === 0) {
        d.keyChoice = "new";
        return "skip";
      }
      const choice = await ui.pick<"keep" | "new" | ApiKey>({
        message: t("API key"),
        items: [
          ...(current ? [{ label: t("Keep the current key"), value: "keep" as const, hint: current.key.keyId, key: "k" }] : []),
          ...reusable.map((a) => ({ label: t("Same key as {name}", { name: a.name }), value: a.key, hint: `${a.key.keyId} · ${t("same App Store Connect team")}` })),
          { label: t("A new API key"), value: "new" as const, key: "n" },
        ],
      });
      if (choice === BACK || choice === QUIT) return BACK;
      d.keyChoice = choice;
      return "next";
    },
    // 2. The .p8 file
    async (d) => {
      if (d.keyChoice !== "new") return "skip";
      say(dim(t("App Store Connect > Users and Access > Integrations > App Store Connect API.")));
      say(dim(t("Use a key with the Finance role and download its .p8 file.")));
      say();
      for (;;) {
        const found = findKeyFiles();
        let file: string | Back = "";
        if (found.length > 0) {
          const at = found.findIndex((f) => f.path === d.keyFile);
          const chosen = await ui.pick<string>({
            message: t("Key file"),
            items: [
              ...found.slice(0, 8).map((f) => ({ label: f.path, value: f.path, hint: f.keyId })),
              { label: t("Another file…"), value: "", key: "o" },
            ],
            start: Math.max(0, at),
          });
          if (chosen === BACK || chosen === QUIT) return BACK;
          file = chosen;
        }
        if (file === "") {
          file = await ui.ask({ message: t("Path to the .p8 file"), hint: t("drag the file here or paste its path"), prefill: d.keyFile, validate: checkKeyFile });
          if (file === BACK) {
            if (found.length > 0) continue; // back to the list of files
            return BACK;
          }
        }
        d.keyFile = cleanPath(file);
        return "next";
      }
    },
    // 3. Key ID (read from Apple's file name when possible)
    async (d) => {
      if (d.keyChoice !== "new") return "skip";
      const fromName = keyIdFromFileName(d.keyFile ?? "");
      const id = await ui.ask({
        message: t("Key ID"),
        default: d.keyId ?? fromName ?? undefined,
        hint: fromName ? t("read from the file name; enter to confirm") : t("10 letters and digits, next to the key in App Store Connect"),
        validate: (v) => (KEY_ID.test(v.toUpperCase()) ? true : t("10 letters and digits, e.g. ABCDE12345")),
      });
      if (id === BACK) return BACK;
      d.keyId = id.toUpperCase();
      return "next";
    },
    // 4. Issuer ID
    async (d) => {
      if (d.keyChoice !== "new") return "skip";
      const issuer = await ui.ask({
        message: t("Issuer ID"),
        default: d.issuerId ?? others[0]?.key.issuerId ?? current?.key.issuerId,
        hint: t("shown above the list of keys"),
        validate: (v) => (UUID.test(v) ? true : t("Looks like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")),
      });
      if (issuer === BACK) return BACK;
      d.issuerId = issuer;
      return "next";
    },
    // 5. Vendor number
    async (d) => {
      const vendor = await ui.ask({
        message: t("Vendor number"),
        prefill: d.vendor ?? current?.vendor,
        hint: t("Payments and Financial Reports, top left (8-9 digits)"),
        validate: (v) => {
          if (!/^\d{5,12}$/.test(v)) return t("Digits only, e.g. 85012345");
          if (others.some((a) => a.vendor === v)) return t("Another account already uses this vendor number");
          return true;
        },
      });
      if (vendor === BACK) return BACK;
      d.vendor = vendor;
      return "next";
    },
    // 6. Name
    async (d) => {
      const name = await ui.ask({
        message: t("Name"),
        prefill: d.name ?? current?.name ?? t("Account {n}", { n: others.length + 1 }),
        hint: t("shown in menus, e.g. Account 1"),
        validate: (v) => {
          if (!v) return t("Enter a name");
          if (v.toLowerCase() === "all") return t('"all" is reserved');
          if (others.some((a) => a.name.toLowerCase() === v.toLowerCase())) return t("Another account has this name");
          return true;
        },
      });
      if (name === BACK) return BACK;
      d.name = name;
      return "next";
    },
    // 7. Check with Apple, then save, go back or cancel
    async (d) => {
      d.key =
        d.keyChoice === "keep" ? current!.key
        : d.keyChoice === "new" ? { issuerId: d.issuerId!, keyId: d.keyId!, keyFile: d.keyFile! }
        : (d.keyChoice as ApiKey);
      say();
      say(`${bold(d.name!)}  ${dim(t("vendor {vendor} · key {key}", { vendor: d.vendor!, key: d.key.keyId }))}`);
      const ok = await verify(toAccount(d, current));
      const action = await ui.pick<"save" | "fix" | "cancel">({
        message: ok ? t("Everything works. Save?") : t("Something is not right. What now?"),
        back: false,
        items: ok
          ? [
              { label: t("Save"), value: "save", key: "s" },
              { label: t("Go back and change something"), value: "fix", key: "b" },
              { label: t("Cancel"), value: "cancel", key: "c" },
            ]
          : [
              { label: t("Go back and fix it"), value: "fix", key: "b" },
              { label: t("Save anyway"), value: "save", key: "s" },
              { label: t("Cancel"), value: "cancel", key: "c" },
            ],
      });
      if (action === "fix") return BACK;
      if (action !== "save") {
        d.cancelled = true;
        return "next";
      }
      if (d.keyChoice === "new") d.key = { ...d.key, keyFile: storeKeyFile(d.keyFile!) };
      return "next";
    },
  ];

  // A form at the top of the screen: what is filled in, what comes next
  const title = current ? t("Change {name}", { name: current.name }) : t("Add an account");
  const fields: [step: number, label: string, value: (d: AccountDraft) => string | undefined, applies: (d: AccountDraft) => boolean][] = [
    [0, t("API key"), (d) => (d.keyChoice === "keep" ? t("current ({id})", { id: current?.key.keyId ?? "" }) : d.keyChoice === "new" ? t("a new key") : d.keyChoice ? t("same as {name}", { name: others.find((a) => a.key === d.keyChoice)?.name ?? "" }) : undefined), () => !!current || reusable.length > 0],
    [1, t("Key file"), (d) => d.keyFile, (d) => d.keyChoice === "new"],
    [2, t("Key ID"), (d) => d.keyId, (d) => d.keyChoice === "new"],
    [3, t("Issuer ID"), (d) => d.issuerId, (d) => d.keyChoice === "new"],
    [4, t("Vendor number"), (d) => d.vendor, () => true],
    [5, t("Name"), (d) => d.name, () => true],
  ];
  const width = Math.max(15, ...fields.map((f) => f[1].length + 1));
  const draw = (index: number) => {
    const shown = fields.filter((f) => f[3](draft));
    const position = shown.findIndex((f) => f[0] === index);
    ui.clear();
    say();
    say(`${bold(title)}${position >= 0 ? dim(`   ${t("step {n} of {total}", { n: position + 1, total: shown.length })}`) : dim(`   ${t("check")}`)}`);
    say(dim("─".repeat(60)));
    for (const [step, label, value] of shown) {
      const v = value(draft);
      const here = step === index;
      const mark = here ? "›" : step < index && v ? "✓" : "·";
      const text = step < index && v ? (v.length > 44 ? "…" + v.slice(-43) : v) : "";
      say(`${here ? bold(mark) : dim(mark)} ${here ? bold(label.padEnd(width)) : label.padEnd(width)}${dim(text)}`);
    }
    say(dim("─".repeat(60)));
    say(dim(t("Esc goes back a step.")));
    say();
  };

  const result = await wizard(draft, steps, draw);
  if (!result || result.cancelled || !result.name || !result.key) return null;
  return toAccount(result, current);
}

function toAccount(d: AccountDraft, current?: Account): Account {
  return { name: d.name!, vendor: d.vendor!, key: d.key!, ...(current?.catalogKey ? { catalogKey: current.catalogKey } : {}) };
}

async function verify(account: Account): Promise<boolean> {
  const sales = await withSpinner(t("Checking access to Sales reports"), () => checkSalesAccess(account));
  say(`${sales.ok ? "✓" : "✗"} ${sales.message}`);
  if (sales.ok) {
    const catalog = await withSpinner(t("Reading app names"), () => loadCatalog(account, true, (m) => say(`! ${m}`)));
    if (catalog.apps.length > 0) say(`✓ ${t("App names: {n} app(s)", { n: catalog.apps.length })}`);
  }
  say();
  return sales.ok;
}

async function pickCurrency(current: string): Promise<string | null> {
  const common = ["USD", "EUR", "GBP", "TRY", "JPY", "CAD", "AUD", "CHF"];
  for (;;) {
    const code = await ui.pick<string>({
      message: t("Show amounts in"),
      items: [...common.map((c) => ({ label: c, value: c, hint: c === current ? t("current") : undefined })), { label: t("Other…"), value: "", key: "o" }],
      start: Math.max(0, common.indexOf(current)),
    });
    if (code === BACK || code === QUIT) return null;
    if (code) return code;
    const typed = await ui.ask({ message: t("Currency code"), hint: t("3 letters, e.g. SEK"), validate: (v) => (/^[a-z]{3}$/i.test(v) ? true : t("3 letters, e.g. SEK")) });
    if (typed !== BACK) return typed.toUpperCase();
  }
}

async function accountMenu(settings: Settings, target: Account): Promise<void> {
  for (;;) {
    const action = await ui.pick<string>({
      message: target.name,
      items: [
        { label: t("Change name, vendor number or key"), value: "edit", key: "c" },
        { label: t("Check access"), value: "check", key: "a" },
        target.catalogKey
          ? { label: t("Remove the in-app purchase key"), value: "drop-catalog", hint: target.catalogKey.keyId }
          : { label: t("Add a key that lists in-app purchases"), value: "catalog", hint: t("optional, App Manager role") },
        { label: t("Remove this account"), value: "remove", key: "r" },
      ],
    });
    if (action === BACK || action === QUIT) return;
    const others = settings.accounts.filter((a) => a !== target);
    if (action === "edit") {
      const updated = await accountWizard(others, target);
      if (updated) {
        if (settings.lastAccount === target.name) settings.lastAccount = updated.name;
        settings.accounts[settings.accounts.indexOf(target)] = updated;
        saveSettings(settings);
        say(t("Saved."));
        target = updated;
      }
    } else if (action === "check") {
      await verify(target);
    } else if (action === "catalog") {
      say(dim(t("Only needed to name in-app purchases with no sales in the months you look at.")));
      const keyOwner = await accountWizard(others, target);
      if (keyOwner) {
        target.catalogKey = keyOwner.key;
        saveSettings(settings);
        say(t("Saved."));
      }
    } else if (action === "drop-catalog") {
      delete target.catalogKey;
      saveSettings(settings);
      say(t("Removed."));
    } else if (action === "remove") {
      if (await ui.yesNo(t('Remove "{name}"? Its key file stays in the keys folder.', { name: target.name }), false)) {
        settings.accounts = settings.accounts.filter((a) => a !== target);
        if (settings.lastAccount === target.name) delete settings.lastAccount;
        saveSettings(settings);
        say(t("Removed."));
        return;
      }
    }
  }
}

async function notificationsMenu(settings: Settings): Promise<void> {
  for (;;) {
    const on = isDailyCheckOn();
    const choice = await ui.pick<"now" | "on" | "off">({
      message: t("Notifications"),
      items: [
        { label: t("Check now"), value: "now", key: "c", hint: t("is last month's Financial Report out?") },
        on
          ? { label: t("Turn off the daily check"), value: "off", key: "t", hint: t("on now") }
          : { label: t("Turn on a daily check at 10:00"), value: "on", key: "t", hint: t("a desktop notification once the month is final") },
      ],
    });
    if (choice === BACK || choice === QUIT) return;
    if (choice === "now") {
      say();
      await withSpinner(t("Looking for last month's Financial Report"), () => runWatch(settings.accounts, settings.currency));
      say();
    } else {
      const result = setDailyCheck(choice === "on");
      say(`${result.ok ? "✓" : "✗"} ${result.message}`);
    }
  }
}

/** Parses "2500", "2,500", "2.500,50", "2500.50" into a number; null if it is not one. */
export function parseAmount(text: string): number | null {
  let t = text.trim().replace(/[\s$€£₺¥]/g, "");
  if (!t) return null;
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  // the separator that comes last, with 1-2 digits after it, is the decimal one
  const decimal = Math.max(lastComma, lastDot);
  if (decimal >= 0 && t.length - decimal - 1 <= 2 && !(lastComma >= 0 && lastDot >= 0 && t.length - decimal - 1 === 0)) {
    t = t.slice(0, decimal).replace(/[.,]/g, "") + "." + t.slice(decimal + 1);
  } else t = t.replace(/[.,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const goalText = (settings: Settings, key: string) => {
  const g = settings.goals?.[key];
  return g ? money(g.amount, g.currency) : undefined;
};

export function goalsHint(settings: Settings): string {
  const set = Object.keys(settings.goals ?? {}).length;
  if (set === 0) return t("not set");
  if (set === 1) {
    const [key] = Object.keys(settings.goals!);
    const amount = goalText(settings, key) ?? "";
    return key === "all" ? t("{amount} for all a month", { amount }) : t("{amount} a month", { amount });
  }
  return t("{n} goals", { n: set });
}

async function goalsMenu(settings: Settings): Promise<void> {
  for (;;) {
    const targets = [
      ...settings.accounts.map((a) => ({ key: a.vendor, name: a.name })),
      ...(settings.accounts.length > 1 ? [{ key: "all", name: t("All accounts together") }] : []),
    ];
    const key = await ui.pick<string>({
      message: t("Monthly goals"),
      items: targets.map((x) => ({ label: x.name, value: x.key, hint: goalText(settings, x.key) ?? t("not set") })),
    });
    if (key === BACK || key === QUIT) return;
    const target = targets.find((x) => x.key === key)!;
    const current = settings.goals?.[key];
    const currency = current?.currency ?? settings.currency;
    const typed = await ui.ask({
      message: t("Goal for {name}, a month, in {currency}", { name: target.name, currency }),
      hint: current ? t("Leave it empty to remove the goal.") : t("For example 2500. The month screen shows how far along you are."),
      prefill: current ? String(current.amount) : undefined,
      validate: (v) => (v.trim() === "" || parseAmount(v) !== null ? true : t("A number, e.g. 2500")),
    });
    if (typed === BACK) continue;
    const amount = parseAmount(typed);
    const goals = { ...(settings.goals ?? {}) };
    if (amount === null) delete goals[key];
    else goals[key] = { amount, currency };
    settings.goals = goals;
    saveSettings(settings);
    say(amount === null ? t("Goal removed.") : `✓ ${t("{name}: {amount} a month.", { name: target.name, amount: money(amount, currency) })}`);
  }
}

async function checkUpdates(): Promise<void> {
  const latest = await withSpinner(t("Looking for the latest version"), () => latestVersion());
  if (!latest) {
    say(t("Could not check: no internet connection?"));
    return;
  }
  if (compareVersions(latest, pkg.version) <= 0) {
    say(`✓ ${t("asc-payout {version} is the latest version.", { version: pkg.version })}`);
    return;
  }
  if (await ui.yesNo(t("Version {latest} is available (you have {version}). Update now?", { latest: latest.replace(/^v/, ""), version: pkg.version }))) {
    await runUpdate(pkg.version);
    say(dim(t("Start asc-payout again to use the new version.")));
  }
}

async function refreshAppNames(settings: Settings): Promise<void> {
  const spinner = startSpinner();
  const found: string[] = [];
  try {
    for (const a of settings.accounts) {
      spinner.text(`${a.name} · ${t("app names")}`);
      const catalog = await loadCatalog(a, true, () => {});
      found.push(t("{name}: {n} app(s)", { name: a.name, n: catalog.apps.length }));
    }
  } finally {
    spinner.stop();
  }
  for (const f of found) say(`✓ ${f}`);
}

async function waitKey(): Promise<void> {
  say(dim(t("Press any key to go back.")));
  await ui.key();
}

const languageName = (code: Lang) => LANGS.find((l) => l.code === code)?.name ?? code;

/** "Türkçe", or "System (Türkçe)" when the language follows the system. */
export function languageHint(settings: Settings): string {
  return settings.language ? languageName(settings.language) : t("System ({name})", { name: languageName(systemLang()) });
}

async function pickLanguage(settings: Settings): Promise<void> {
  const choice = await ui.pick<Lang | "system">({
    message: t("Language"),
    items: [
      { label: t("Same as the system"), value: "system" as const, hint: languageName(systemLang()) },
      ...LANGS.map((l) => ({ label: l.name, value: l.code })),
    ],
    start: settings.language ? 1 + LANGS.findIndex((l) => l.code === settings.language) : 0,
  });
  if (choice === BACK || choice === QUIT) return;
  if (choice === "system") delete settings.language;
  else settings.language = choice;
  saveSettings(settings);
}

/** Accounts and settings. Returns when the person goes back. */
export async function runSetup(): Promise<void> {
  const settings = loadSettings();

  if (settings.accounts.length === 0) {
    const account = await accountWizard([]);
    if (!account) {
      say(t("Nothing saved. Run asc-payout setup whenever you are ready."));
      return;
    }
    settings.accounts.push(account);
    const currency = await pickCurrency(settings.currency);
    if (currency) settings.currency = currency;
    saveSettings(settings);
    say(`${t("Saved.")} ${dim(t("Run asc-payout to see your earnings."))}`);
    return;
  }

  for (;;) {
    ui.clear();
    say();
    say(`${bold(t("Settings"))}  ${dim(settingsFile())}`);
    say();
    const choice = await ui.pick<Account | "add" | "currency" | "language" | "goals" | "ads" | "notify" | "update" | "files" | "names">({
      message: t("Accounts and settings"),
      items: [
        ...settings.accounts.map((a) => ({ label: a.name, value: a, hint: t("vendor {vendor} · key {key}", { vendor: a.vendor, key: a.key.keyId }) })),
        { label: `+ ${t("Add an account")}`, value: "add" as const, key: "a" },
        { separator: "" },
        { label: t("Currency"), value: "currency" as const, hint: settings.currency, key: "c" },
        { label: t("Language"), value: "language" as const, hint: languageHint(settings), key: "l" },
        { label: t("Monthly goals"), value: "goals" as const, hint: goalsHint(settings), key: "g" },
        { label: "Apple Ads", value: "ads" as const, hint: settings.ads ? t("connected") : t("connect for profit and ROAS"), key: "d" },
        { label: t("Notifications"), value: "notify" as const, key: "n", hint: isDailyCheckOn() ? t("daily check on") : t("when a month is final") },
        { label: t("Check for updates"), value: "update" as const, key: "u", hint: t("you have {version}", { version: pkg.version }) },
        { label: t("Refresh app names"), value: "names" as const, key: "r", hint: t("after adding or renaming apps") },
        { label: t("Where are my files?"), value: "files" as const, key: "f" },
      ],
    });
    if (choice === BACK || choice === QUIT) return;
    if (choice === "add") {
      const account = await accountWizard(settings.accounts);
      if (account) {
        settings.accounts.push(account);
        saveSettings(settings);
      }
    } else if (choice === "currency") {
      const currency = await pickCurrency(settings.currency);
      if (currency) {
        settings.currency = currency;
        saveSettings(settings);
      }
    } else if (choice === "language") {
      await pickLanguage(settings);
    } else if (choice === "goals") {
      await goalsMenu(settings);
    } else if (choice === "ads") {
      await adsMenu(settings);
    } else if (choice === "notify") {
      await notificationsMenu(settings);
    } else if (choice === "update") {
      await checkUpdates();
      await waitKey();
    } else if (choice === "names") {
      await refreshAppNames(settings);
      await waitKey();
    } else if (choice === "files") {
      showStatus();
      await waitKey();
    } else {
      await accountMenu(settings, choice);
    }
  }
}

/** Shows configuration status and location. */
export function showStatus(): void {
  const settings = loadSettings();
  const labels = [t("Settings"), t("Folder"), t("Downloads"), t("Currency")].map((l) => `${l}:`);
  const width = Math.max(11, ...labels.map((l) => l.length + 1));
  const [settingsLabel, folderLabel, downloadsLabel, currencyLabel] = labels.map((l) => l.padEnd(width));
  say();
  say(`${settingsLabel}${settingsFile()}${existsSync(settingsFile()) ? "" : ` ${t("(not created yet; run: asc-payout setup)")}`}`);
  say(`${folderLabel}${configDir()}  ${t("(settings and API keys)")}`);
  say(`${downloadsLabel}${cacheDir()}`);
  say(`${currencyLabel}${process.env.ASC_PAYOUT_CURRENCY || settings.currency}`);
  say();
  if (settings.accounts.length === 0) say(t("No accounts yet."));
  for (const a of settings.accounts) {
    const keyOk = existsSync(resolveKeyFile(a.key.keyFile));
    say(`• ${a.name}`);
    say(`    ${t("vendor {vendor} · key {key}", { vendor: a.vendor, key: a.key.keyId })}${keyOk ? "" : ` ${t("(KEY FILE MISSING)")}`}${a.catalogKey ? ` · ${t("in-app purchase key {id}", { id: a.catalogKey.keyId })}` : ""}`);
  }
  try {
    const env = accountFromEnv();
    if (env) {
      say();
      say(t("ASC_PAYOUT_* variables are set: vendor {vendor} is used instead of the accounts above.", { vendor: env.vendor }));
    }
  } catch (error) {
    say();
    say(`! ${(error as Error).message}`);
  }
  say();
}
