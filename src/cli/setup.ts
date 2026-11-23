import { confirm, input, select } from "@inquirer/prompts";
import { existsSync } from "node:fs";
import { loadCatalog } from "../asc/catalog";
import { checkSalesAccess } from "../asc/reports";
import { cacheDir, configDir, resolveKeyFile, settingsFile } from "../config/paths";
import { accountFromEnv, loadSettings, saveSettings, type Account, type ApiKey, type Settings } from "../config/settings";
import { checkKeyFile, cleanPath, findKeyFiles, keyIdFromFileName, storeKeyFile } from "./keys";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Z0-9]{10}$/;

const say = (text = "") => console.log(text ? `  ${text}` : "");

async function askNewKey(defaultIssuer?: string): Promise<ApiKey> {
  say();
  say("API key: App Store Connect > Users and Access > Integrations > App Store Connect API.");
  say("Create a key with the Finance role (or use one you have) and download its .p8 file.");
  say();

  const found = findKeyFiles();
  let file: string;
  if (found.length > 0) {
    const picked = await select({
      message: ".p8 key file:",
      choices: [
        ...found.slice(0, 8).map((f) => ({ name: f.path, value: f.path })),
        { name: "Another file...", value: "" },
      ],
    });
    file = picked || (await input({ message: "Path to the .p8 file:", validate: checkKeyFile }));
  } else {
    file = await input({ message: "Path to the .p8 file (you can drag it here):", validate: checkKeyFile });
  }
  file = cleanPath(file);

  const fromName = keyIdFromFileName(file);
  const keyId = (
    await input({
      message: "Key ID:",
      default: fromName ?? undefined,
      validate: (v) => (KEY_ID.test(v.trim()) ? true : "10 letters and digits, shown next to the key in App Store Connect"),
    })
  ).trim();

  const issuerId = (
    await input({
      message: "Issuer ID (above the keys list):",
      default: defaultIssuer,
      validate: (v) => (UUID.test(v.trim()) ? true : "Looks like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"),
    })
  ).trim();

  return { issuerId, keyId, keyFile: storeKeyFile(file) };
}

async function askKey(others: Account[], current?: ApiKey): Promise<ApiKey> {
  type Choice = { kind: "keep" } | { kind: "new" } | { kind: "reuse"; key: ApiKey };
  const choices: { name: string; value: Choice }[] = [];
  if (current) choices.push({ name: `Keep the current key (${current.keyId})`, value: { kind: "keep" } });
  const seen = new Set<string>(current ? [current.keyId] : []);
  for (const a of others) {
    if (seen.has(a.key.keyId)) continue;
    seen.add(a.key.keyId);
    choices.push({ name: `Same key as "${a.name}" (${a.key.keyId}, same App Store Connect team)`, value: { kind: "reuse", key: a.key } });
  }
  choices.push({ name: "A new API key", value: { kind: "new" } });

  const choice = choices.length === 1 ? choices[0].value : await select({ message: "API key:", choices });
  if (choice.kind === "keep" && current) return current;
  if (choice.kind === "reuse") return choice.key;
  return askNewKey(current?.issuerId ?? others[0]?.key.issuerId);
}

async function verify(account: Account): Promise<boolean> {
  say();
  say("Checking with App Store Connect...");
  const sales = await checkSalesAccess(account);
  say(`${sales.ok ? "✓" : "✗"} ${sales.message}`);
  if (sales.ok) {
    const catalog = await loadCatalog(account, true, (m) => say(`! ${m}`));
    if (catalog.apps.length > 0) say(`✓ App names: ${catalog.apps.length} app(s)`);
  }
  say();
  return sales.ok;
}

async function askAccount(others: Account[], current?: Account): Promise<Account | null> {
  const key = await askKey(others, current?.key);

  say();
  say("Vendor number: App Store Connect > Payments and Financial Reports, top left (8-9 digits).");
  const vendor = (
    await input({
      message: "Vendor number:",
      default: current?.vendor,
      validate: (v) => {
        if (!/^\d{5,12}$/.test(v.trim())) return "Digits only, e.g. 85012345";
        if (others.some((a) => a.vendor === v.trim())) return "Another account already uses this vendor number";
        return true;
      },
    })
  ).trim();

  const name = (
    await input({
      message: "Name for this account (e.g. Company, Personal):",
      default: current?.name ?? (others.length === 0 ? "My apps" : `Account ${others.length + 1}`),
      validate: (v) => {
        if (!v.trim()) return "Enter a name";
        if (v.trim().toLowerCase() === "all") return '"all" is reserved';
        if (others.some((a) => a.name.toLowerCase() === v.trim().toLowerCase())) return "Another account has this name";
        return true;
      },
    })
  ).trim();

  const account: Account = { name, vendor, key, ...(current?.catalogKey ? { catalogKey: current.catalogKey } : {}) };
  if (await verify(account)) return account;
  return (await confirm({ message: "Save it anyway?", default: false })) ? account : null;
}

async function editAccount(settings: Settings, target: Account): Promise<void> {
  const others = settings.accounts.filter((a) => a !== target);
  const action = await select({
    message: `${target.name}:`,
    choices: [
      { name: "Change name, vendor number or key", value: "details" },
      target.catalogKey
        ? { name: `Remove the in-app purchase key (${target.catalogKey.keyId})`, value: "drop-catalog" }
        : { name: "Add a key that lists in-app purchases (optional, App Manager role)", value: "catalog" },
      { name: "Check access again", value: "check" },
      { name: "Back", value: "back" },
    ],
  });
  if (action === "details") {
    const updated = await askAccount(others, target);
    if (updated) settings.accounts[settings.accounts.indexOf(target)] = updated;
  } else if (action === "catalog") {
    say();
    say("Only needed to name in-app purchases that had no sales in a month you look at;");
    say("everything else is grouped from Sales reports already.");
    target.catalogKey = await askKey(others.concat(target));
  } else if (action === "drop-catalog") {
    delete target.catalogKey;
  } else if (action === "check") {
    await verify(target);
  }
}

async function askCurrency(current: string): Promise<string> {
  const code = await select({
    message: "Show amounts in:",
    default: current,
    choices: [
      ...["USD", "EUR", "GBP", "TRY", "JPY", "CAD", "AUD", "CHF"].map((c) => ({ name: c, value: c })),
      { name: "Other...", value: "" },
    ],
  });
  if (code) return code;
  return (await input({ message: "Currency code:", validate: (v) => (/^[a-z]{3}$/i.test(v.trim()) ? true : "3 letters, e.g. SEK") })).trim().toUpperCase();
}

export async function runSetup(): Promise<void> {
  const settings = loadSettings();
  say();
  say("asc-payout setup");
  say(`Settings: ${settingsFile()}`);

  try {
    if (settings.accounts.length === 0) {
      say();
      say("Let's add your App Store Connect account.");
      const account = await askAccount([]);
      if (!account) return;
      settings.accounts.push(account);
      settings.currency = await askCurrency(settings.currency);
      saveSettings(settings);
      say("Saved. Run asc-payout to see your earnings, or asc-payout setup to add another account.");
      say();
      return;
    }

    for (;;) {
      say();
      for (const a of settings.accounts) say(`• ${a.name}  vendor ${a.vendor}, key ${a.key.keyId}`);
      say(`Currency: ${settings.currency}`);
      say();
      const action = await select({
        message: "Setup:",
        choices: [
          { name: "Add an account", value: "add" },
          { name: "Edit an account", value: "edit" },
          { name: "Remove an account", value: "remove" },
          { name: "Change currency", value: "currency" },
          { name: "Done", value: "done" },
        ],
      });
      if (action === "done") return;

      if (action === "add") {
        const account = await askAccount(settings.accounts);
        if (account) settings.accounts.push(account);
      } else if (action === "currency") {
        settings.currency = await askCurrency(settings.currency);
      } else {
        const target = await select({
          message: action === "edit" ? "Which account?" : "Remove which account?",
          choices: settings.accounts.map((a) => ({ name: `${a.name} (vendor ${a.vendor})`, value: a })),
        });
        if (action === "edit") await editAccount(settings, target);
        else if (await confirm({ message: `Remove "${target.name}"? (its key file stays in the keys folder)`, default: false })) {
          settings.accounts = settings.accounts.filter((a) => a !== target);
        }
      }
      saveSettings(settings);
      say("Saved.");
    }
  } catch (error) {
    if ((error as Error).name === "ExitPromptError") {
      say();
      say("Setup closed.");
      return;
    }
    throw error;
  }
}

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
