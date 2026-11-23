import { spawnSync } from "node:child_process";
import { copyFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accessToken, checkAdsKeyFile, listOrgs, newKeyPair, type AdsKey } from "../ads/appleAds";
import { ensureDir, keysDir, resolveKeyFile } from "../config/paths";
import { saveSettings, type Settings } from "../config/settings";
import { t } from "../i18n";
import { cleanPath } from "./keys";
import { BACK, QUIT, type Back } from "./prompts";
import { wizard } from "./setup";
import { startSpinner } from "./spinner";
import { ui } from "./ui";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s);
const cyan = (s: string) => (color ? `\x1b[36m${s}\x1b[39m` : s);
const say = (text = "") => ui.print(text ? `  ${text}` : "");

const SEARCHADS = /^SEARCHADS\.[0-9a-f-]{8,}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE = "apple-ads-private-key.pem";
const PUBLIC = "apple-ads-public-key.pem";

interface AdsDraft {
  source?: "keep" | "new" | "file";
  publicKey?: string;
  keyFile?: string;
  clientId?: string;
  teamId?: string;
  keyId?: string;
  done?: boolean;
}

/** Puts text on the clipboard when the system has a way to; false otherwise. */
export function copyToClipboard(text: string): boolean {
  const tools: [string, string[]][] =
    process.platform === "win32" ? [["clip", []]]
    : process.platform === "darwin" ? [["pbcopy", []]]
    : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
  for (const [cmd, args] of tools) {
    try {
      const r = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 3000 });
      if (r.status === 0) return true;
    } catch {
      // not installed
    }
  }
  return false;
}

/** Checks the key with Apple; the organizations it reads, or null after showing why not. */
export async function checkAds(key: AdsKey): Promise<{ name: string; currency: string }[] | null> {
  const spinner = startSpinner();
  spinner.text(`Apple Ads · ${t("signing in")}`);
  try {
    await accessToken(key);
    spinner.text(`Apple Ads · ${t("organizations")}`);
    const orgs = await listOrgs(key);
    spinner.stop();
    if (orgs.length === 0) {
      say(`✗ ${t("Signed in, but this user can see no organization. Give it a role in Apple Ads > Account Settings > User Management.")}`);
      return null;
    }
    for (const o of orgs) say(`✓ ${o.name}  ${dim(`${o.currency} · ${o.timeZone}`)}`);
    return orgs;
  } catch (error) {
    spinner.stop();
    say(`✗ ${(error as Error).message}`);
    return null;
  } finally {
    spinner.stop();
  }
}

/** Connect (or change) Apple Ads. Returns true when something was saved. */
export async function adsWizard(settings: Settings): Promise<boolean> {
  const current = settings.ads;
  const draft: AdsDraft = {};
  const steps: ((d: AdsDraft) => Promise<"next" | "skip" | Back>)[] = [
    // 1. Which private key
    async (d) => {
      const choice = await ui.pick<"keep" | "new" | "file">({
        message: t("Apple Ads API key"),
        items: [
          ...(current ? [{ label: t("Keep the current key"), value: "keep" as const, key: "k", hint: current.keyId }] : []),
          { label: t("Make a new key for me"), value: "new" as const, key: "n", hint: t("easiest: you paste one line into Apple Ads") },
          { label: t("I already have a private key file"), value: "file" as const, key: "f", hint: t(".pem made with openssl") },
        ],
      });
      if (choice === BACK || choice === QUIT) return BACK;
      d.source = choice;
      if (choice === "new" && !d.publicKey) {
        const pair = newKeyPair();
        const dir = ensureDir(keysDir());
        // a fresh pair is kept under a temporary name until it is saved
        writeFileSync(join(dir, `new-${PRIVATE}`), pair.privateKey, { mode: 0o600 });
        d.publicKey = pair.publicKey;
        d.keyFile = join(dir, `new-${PRIVATE}`);
      }
      return "next";
    },
    // 2. The private key file
    async (d) => {
      if (d.source !== "file") return "skip";
      const path = await ui.ask({
        message: t("Path to the private key"),
        hint: t("drag the file here or paste its path"),
        prefill: d.keyFile,
        validate: (v) => checkAdsKeyFile(cleanPath(v)),
      });
      if (path === BACK) return BACK;
      d.keyFile = cleanPath(path);
      return "next";
    },
    // 3-5. The IDs Apple Ads shows after the public key is saved
    async (d) => {
      if (d.source === "keep") return "skip";
      const v = await ui.ask({
        message: t("Client ID"),
        prefill: d.clientId ?? current?.clientId,
        hint: t("starts with SEARCHADS."),
        validate: (s) => (SEARCHADS.test(s.trim()) ? true : t("Looks like SEARCHADS.xxxxxxxx-xxxx-…")),
      });
      if (v === BACK) return BACK;
      d.clientId = v.trim();
      return "next";
    },
    async (d) => {
      if (d.source === "keep") return "skip";
      const v = await ui.ask({
        message: t("Team ID"),
        prefill: d.teamId ?? current?.teamId,
        hint: t("starts with SEARCHADS. too"),
        validate: (s) => (SEARCHADS.test(s.trim()) ? true : t("Looks like SEARCHADS.xxxxxxxx-xxxx-…")),
      });
      if (v === BACK) return BACK;
      d.teamId = v.trim();
      return "next";
    },
    async (d) => {
      if (d.source === "keep") return "skip";
      const v = await ui.ask({
        message: t("Key ID"),
        prefill: d.keyId ?? current?.keyId,
        validate: (s) => (UUID.test(s.trim()) ? true : t("Looks like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")),
      });
      if (v === BACK) return BACK;
      d.keyId = v.trim();
      return "next";
    },
    // 6. Check, then save
    async (d) => {
      const key: AdsKey =
        d.source === "keep" ? current! : { clientId: d.clientId!, teamId: d.teamId!, keyId: d.keyId!, keyFile: d.keyFile! };
      const ok = (await checkAds(key)) !== null;
      say();
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
      if (action === "save") {
        let keyFile = key.keyFile;
        if (d.source !== "keep") {
          const target = join(ensureDir(keysDir()), PRIVATE);
          if (resolveKeyFile(keyFile).toLowerCase() !== target.toLowerCase()) copyFileSync(resolveKeyFile(keyFile), target);
          keyFile = join("keys", PRIVATE);
          if (d.publicKey) writeFileSync(join(keysDir(), PUBLIC), d.publicKey);
        }
        settings.ads = { ...key, keyFile };
        saveSettings(settings);
        d.done = true;
      }
      return "next";
    },
  ];

  const fields: [number, string, (d: AdsDraft) => string | undefined][] = [
    [0, t("Key"), (d) => ({ keep: t("current key"), new: t("a new key"), file: t("my own key file") })[d.source ?? "keep"]],
    [1, t("Key file"), (d) => (d.source === "file" ? d.keyFile : undefined)],
    [2, t("Client ID"), (d) => d.clientId],
    [3, t("Team ID"), (d) => d.teamId],
    [4, t("Key ID"), (d) => d.keyId],
  ];
  const width = Math.max(12, ...fields.map((f) => f[1].length + 1));
  const draw = (index: number) => {
    ui.clear();
    say();
    say(`${bold(current ? "Apple Ads" : t("Connect Apple Ads"))}${dim(`   ${t("to see profit and ROAS by app")}`)}`);
    say(dim("─".repeat(60)));
    for (const [step, label, value] of fields) {
      if (step === 1 && draft.source !== "file") continue;
      if (step > 1 && draft.source === "keep") continue;
      const v = value(draft);
      const here = step === index;
      const mark = here ? "›" : step < index && v ? "✓" : "·";
      const text = step < index && v ? (v.length > 44 ? "…" + v.slice(-43) : v) : "";
      say(`${here ? bold(mark) : dim(mark)} ${here ? bold(label.padEnd(width)) : label.padEnd(width)}${dim(text)}`);
    }
    say(dim("─".repeat(60)));
    if (index === 0) {
      say(dim(t("Apple Ads > Account Settings > User Management: the user needs an API role,")));
      say(dim(t("such as API Account Read Only. Sign in as that user for the next steps.")));
    } else if (draft.source === "new" && draft.publicKey && index >= 2 && index <= 4) {
      const copied = index === 2 && copyToClipboard(draft.publicKey);
      say(t("In Apple Ads > Account Settings > {api}, paste this public key and save:", { api: bold("API") }));
      say();
      for (const line of draft.publicKey.trim().split("\n")) say(cyan(line));
      say();
      if (copied) say(dim(t("It is on your clipboard already.")));
      say(dim(t("Apple Ads then shows the client ID, team ID and key ID to type below.")));
    } else if (index >= 2 && index <= 4) {
      say(dim(t("Apple Ads > Account Settings > API shows these next to the public key.")));
    }
    say(dim(t("Esc goes back a step.")));
    say();
  };

  const result = await wizard(draft, steps, draw);
  // the new key pair was copied to its place when saved; the temporary one goes
  rmSync(join(keysDir(), `new-${PRIVATE}`), { force: true });
  return !!result?.done;
}

/** Settings > Apple Ads: connect, check, or disconnect. */
export async function adsMenu(settings: Settings): Promise<void> {
  if (!settings.ads) {
    await adsWizard(settings);
    return;
  }
  for (;;) {
    const choice = await ui.pick<"check" | "change" | "remove">({
      message: "Apple Ads",
      items: [
        { label: t("Check access"), value: "check", key: "a" },
        { label: t("Change the key"), value: "change", key: "c" },
        { label: t("Disconnect Apple Ads"), value: "remove", key: "r", hint: t("the key file stays in the keys folder") },
      ],
    });
    if (choice === BACK || choice === QUIT) return;
    if (choice === "check") {
      await checkAds(settings.ads);
      say(dim(t("Press any key to go back.")));
      await ui.key();
    } else if (choice === "change") {
      await adsWizard(settings);
    } else if (await ui.yesNo(t("Disconnect Apple Ads?"), false)) {
      delete settings.ads;
      saveSettings(settings);
      return;
    }
  }
}
