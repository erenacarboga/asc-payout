import { existsSync } from "node:fs";
import pkg from "../../package.json";
import { loadCatalog } from "../asc/catalog";
import { checkSalesAccess } from "../asc/reports";
import { cacheDir, configDir, resolveKeyFile, settingsFile } from "../config/paths";
import { accountFromEnv, loadSettings, saveSettings, type Account, type ApiKey, type Settings } from "../config/settings";
import { checkKeyFile, cleanPath, findKeyFiles, keyIdFromFileName, storeKeyFile } from "./keys";
import { isDailyCheckOn, setDailyCheck } from "./schedule";
import { startSpinner } from "./spinner";
import { compareVersions, latestVersion, runUpdate } from "./update";
import { runWatch } from "./watch";
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
        message: "API key",
        items: [
          ...(current ? [{ label: "Keep the current key", value: "keep" as const, hint: current.key.keyId, key: "k" }] : []),
          ...reusable.map((a) => ({ label: `Same key as ${a.name}`, value: a.key, hint: `${a.key.keyId} · same App Store Connect team` })),
          { label: "A new API key", value: "new" as const, key: "n" },
        ],
      });
      if (choice === BACK || choice === QUIT) return BACK;
      d.keyChoice = choice;
      return "next";
    },
    // 2. The .p8 file
    async (d) => {
      if (d.keyChoice !== "new") return "skip";
      say(dim("App Store Connect > Users and Access > Integrations > App Store Connect API."));
      say(dim("Use a key with the Finance role and download its .p8 file."));
      say();
      for (;;) {
        const found = findKeyFiles();
        let file: string | Back = "";
        if (found.length > 0) {
          const at = found.findIndex((f) => f.path === d.keyFile);
          const chosen = await ui.pick<string>({
            message: "Key file",
            items: [
              ...found.slice(0, 8).map((f) => ({ label: f.path, value: f.path, hint: f.keyId })),
              { label: "Another file…", value: "", key: "o" },
            ],
            start: Math.max(0, at),
          });
          if (chosen === BACK || chosen === QUIT) return BACK;
          file = chosen;
        }
        if (file === "") {
          file = await ui.ask({ message: "Path to the .p8 file", hint: "drag the file here or paste its path", prefill: d.keyFile, validate: checkKeyFile });
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
        message: "Key ID",
        default: d.keyId ?? fromName ?? undefined,
        hint: fromName ? "read from the file name; enter to confirm" : "10 letters and digits, next to the key in App Store Connect",
        validate: (v) => (KEY_ID.test(v.toUpperCase()) ? true : "10 letters and digits, e.g. ABCDE12345"),
      });
      if (id === BACK) return BACK;
      d.keyId = id.toUpperCase();
      return "next";
    },
    // 4. Issuer ID
    async (d) => {
      if (d.keyChoice !== "new") return "skip";
      const issuer = await ui.ask({
        message: "Issuer ID",
        default: d.issuerId ?? others[0]?.key.issuerId ?? current?.key.issuerId,
        hint: "shown above the list of keys",
        validate: (v) => (UUID.test(v) ? true : "Looks like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"),
      });
      if (issuer === BACK) return BACK;
      d.issuerId = issuer;
      return "next";
    },
    // 5. Vendor number
    async (d) => {
      const vendor = await ui.ask({
        message: "Vendor number",
        prefill: d.vendor ?? current?.vendor,
        hint: "Payments and Financial Reports, top left (8-9 digits)",
        validate: (v) => {
          if (!/^\d{5,12}$/.test(v)) return "Digits only, e.g. 85012345";
          if (others.some((a) => a.vendor === v)) return "Another account already uses this vendor number";
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
        message: "Name",
        prefill: d.name ?? current?.name ?? (others.length === 0 ? "My apps" : `Account ${others.length + 1}`),
        hint: "shown in menus, e.g. Company or Personal",
        validate: (v) => {
          if (!v) return "Enter a name";
          if (v.toLowerCase() === "all") return '"all" is reserved';
          if (others.some((a) => a.name.toLowerCase() === v.toLowerCase())) return "Another account has this name";
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
      say(`${bold(d.name!)}  ${dim(`vendor ${d.vendor} · key ${d.key.keyId}`)}`);
      say("Checking with App Store Connect…");
      const ok = await verify(toAccount(d, current));
      const action = await ui.pick<"save" | "fix" | "cancel">({
        message: ok ? "Everything works. Save?" : "Something is not right. What now?",
        back: false,
        items: ok
          ? [
              { label: "Save", value: "save", key: "s" },
              { label: "Go back and change something", value: "fix", key: "b" },
              { label: "Cancel", value: "cancel", key: "c" },
            ]
          : [
              { label: "Go back and fix it", value: "fix", key: "b" },
              { label: "Save anyway", value: "save", key: "s" },
              { label: "Cancel", value: "cancel", key: "c" },
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
  const title = current ? `Change ${current.name}` : "Add an account";
  const fields: [step: number, label: string, value: (d: AccountDraft) => string | undefined, applies: (d: AccountDraft) => boolean][] = [
    [0, "API key", (d) => (d.keyChoice === "keep" ? `current (${current?.key.keyId})` : d.keyChoice === "new" ? "a new key" : d.keyChoice ? `same as ${others.find((a) => a.key === d.keyChoice)?.name}` : undefined), () => !!current || reusable.length > 0],
    [1, "Key file", (d) => d.keyFile, (d) => d.keyChoice === "new"],
    [2, "Key ID", (d) => d.keyId, (d) => d.keyChoice === "new"],
    [3, "Issuer ID", (d) => d.issuerId, (d) => d.keyChoice === "new"],
    [4, "Vendor number", (d) => d.vendor, () => true],
    [5, "Name", (d) => d.name, () => true],
  ];
  const draw = (index: number) => {
    const shown = fields.filter((f) => f[3](draft));
    const position = shown.findIndex((f) => f[0] === index);
    ui.clear();
    say();
    say(`${bold(title)}${position >= 0 ? dim(`   step ${position + 1} of ${shown.length}`) : dim("   check")}`);
    say(dim("─".repeat(60)));
    for (const [step, label, value] of shown) {
      const v = value(draft);
      const here = step === index;
      const mark = here ? "›" : step < index && v ? "✓" : "·";
      const text = step < index && v ? (v.length > 44 ? "…" + v.slice(-43) : v) : "";
      say(`${here ? bold(mark) : dim(mark)} ${here ? bold(label.padEnd(15)) : label.padEnd(15)}${dim(text)}`);
    }
    say(dim("─".repeat(60)));
    say(dim("Esc goes back a step."));
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
  const sales = await checkSalesAccess(account);
  say(`${sales.ok ? "✓" : "✗"} ${sales.message}`);
  if (sales.ok) {
    const catalog = await loadCatalog(account, true, (m) => say(`! ${m}`));
    if (catalog.apps.length > 0) say(`✓ App names: ${catalog.apps.length} app(s)`);
  }
  say();
  return sales.ok;
}

async function pickCurrency(current: string): Promise<string | null> {
  const common = ["USD", "EUR", "GBP", "TRY", "JPY", "CAD", "AUD", "CHF"];
  for (;;) {
    const code = await ui.pick<string>({
      message: "Show amounts in",
      items: [...common.map((c) => ({ label: c, value: c, hint: c === current ? "current" : undefined })), { label: "Other…", value: "", key: "o" }],
      start: Math.max(0, common.indexOf(current)),
    });
    if (code === BACK || code === QUIT) return null;
    if (code) return code;
    const typed = await ui.ask({ message: "Currency code", hint: "3 letters, e.g. SEK", validate: (v) => (/^[a-z]{3}$/i.test(v) ? true : "3 letters, e.g. SEK") });
    if (typed !== BACK) return typed.toUpperCase();
  }
}

async function accountMenu(settings: Settings, target: Account): Promise<void> {
  for (;;) {
    const action = await ui.pick<string>({
      message: target.name,
      items: [
        { label: "Change name, vendor number or key", value: "edit", key: "c" },
        { label: "Check access", value: "check", key: "a" },
        target.catalogKey
          ? { label: "Remove the in-app purchase key", value: "drop-catalog", hint: target.catalogKey.keyId }
          : { label: "Add a key that lists in-app purchases", value: "catalog", hint: "optional, App Manager role" },
        { label: "Remove this account", value: "remove", key: "r" },
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
        say("Saved.");
        target = updated;
      }
    } else if (action === "check") {
      say("Checking with App Store Connect…");
      await verify(target);
    } else if (action === "catalog") {
      say(dim("Only needed to name in-app purchases with no sales in the months you look at."));
      const keyOwner = await accountWizard(others, target);
      if (keyOwner) {
        target.catalogKey = keyOwner.key;
        saveSettings(settings);
        say("Saved.");
      }
    } else if (action === "drop-catalog") {
      delete target.catalogKey;
      saveSettings(settings);
      say("Removed.");
    } else if (action === "remove") {
      if (await ui.yesNo(`Remove "${target.name}"? Its key file stays in the keys folder.`, false)) {
        settings.accounts = settings.accounts.filter((a) => a !== target);
        if (settings.lastAccount === target.name) delete settings.lastAccount;
        saveSettings(settings);
        say("Removed.");
        return;
      }
    }
  }
}

async function notificationsMenu(settings: Settings): Promise<void> {
  for (;;) {
    const on = isDailyCheckOn();
    const choice = await ui.pick<"now" | "on" | "off">({
      message: "Notifications",
      items: [
        { label: "Check now", value: "now", key: "c", hint: "is last month's Financial Report out?" },
        on
          ? { label: "Turn off the daily check", value: "off", key: "t", hint: "on now" }
          : { label: "Turn on a daily check at 10:00", value: "on", key: "t", hint: "a desktop notification once the month is final" },
      ],
    });
    if (choice === BACK || choice === QUIT) return;
    if (choice === "now") {
      say();
      await runWatch(settings.accounts, settings.currency);
      say();
    } else {
      const result = setDailyCheck(choice === "on");
      say(`${result.ok ? "✓" : "✗"} ${result.message}`);
    }
  }
}

async function checkUpdates(): Promise<void> {
  say("Looking for a new version…");
  const latest = await latestVersion();
  if (!latest) {
    say("Could not check (offline, or a private repository without the GitHub CLI).");
    return;
  }
  if (compareVersions(latest, pkg.version) <= 0) {
    say(`✓ asc-payout ${pkg.version} is the latest version.`);
    return;
  }
  if (await ui.yesNo(`Version ${latest.replace(/^v/, "")} is available (you have ${pkg.version}). Update now?`)) {
    await runUpdate(pkg.version);
    say(dim("Start asc-payout again to use the new version."));
  }
}

async function refreshAppNames(settings: Settings): Promise<void> {
  const spinner = startSpinner();
  const found: string[] = [];
  try {
    for (const a of settings.accounts) {
      spinner.text(`${a.name} · app names`);
      const catalog = await loadCatalog(a, true, () => {});
      found.push(`${a.name}: ${catalog.apps.length} app(s)`);
    }
  } finally {
    spinner.stop();
  }
  for (const f of found) say(`✓ ${f}`);
}

async function waitKey(): Promise<void> {
  say(dim("Press any key to go back."));
  await ui.key();
}

/** Accounts and settings. Returns when the person goes back. */
export async function runSetup(): Promise<void> {
  const settings = loadSettings();

  if (settings.accounts.length === 0) {
    const account = await accountWizard([]);
    if (!account) {
      say("Nothing saved. Run asc-payout setup whenever you are ready.");
      return;
    }
    settings.accounts.push(account);
    const currency = await pickCurrency(settings.currency);
    if (currency) settings.currency = currency;
    saveSettings(settings);
    say(`Saved. ${dim("Run asc-payout to see your earnings.")}`);
    return;
  }

  for (;;) {
    ui.clear();
    say();
    say(`${bold("Settings")}  ${dim(settingsFile())}`);
    say();
    const choice = await ui.pick<Account | "add" | "currency" | "notify" | "update" | "files" | "names">({
      message: "Accounts and settings",
      items: [
        ...settings.accounts.map((a) => ({ label: a.name, value: a, hint: `vendor ${a.vendor} · key ${a.key.keyId}` })),
        { label: "+ Add an account", value: "add" as const, key: "a" },
        { separator: "" },
        { label: "Currency", value: "currency" as const, hint: settings.currency, key: "c" },
        { label: "Notifications", value: "notify" as const, key: "n", hint: isDailyCheckOn() ? "daily check on" : "when a month is final" },
        { label: "Check for updates", value: "update" as const, key: "u", hint: `you have ${pkg.version}` },
        { label: "Refresh app names", value: "names" as const, key: "r", hint: "after adding or renaming apps" },
        { label: "Where are my files?", value: "files" as const, key: "f" },
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
  say();
  say(`Settings:  ${settingsFile()}${existsSync(settingsFile()) ? "" : " (not created yet; run: asc-payout setup)"}`);
  say(`Folder:    ${configDir()}  (settings and API keys)`);
  say(`Downloads: ${cacheDir()}`);
  say(`Currency:  ${process.env.ASC_PAYOUT_CURRENCY || settings.currency}`);
  say();
  if (settings.accounts.length === 0) say("No accounts yet.");
  for (const a of settings.accounts) {
    const keyOk = existsSync(resolveKeyFile(a.key.keyFile));
    say(`• ${a.name}`);
    say(`    vendor ${a.vendor} · key ${a.key.keyId}${keyOk ? "" : " (KEY FILE MISSING)"}${a.catalogKey ? ` · in-app purchase key ${a.catalogKey.keyId}` : ""}`);
  }
  try {
    const env = accountFromEnv();
    if (env) {
      say();
      say(`ASC_PAYOUT_* variables are set: vendor ${env.vendor} is used instead of the accounts above.`);
    }
  } catch (error) {
    say();
    say(`! ${(error as Error).message}`);
  }
  say();
}
