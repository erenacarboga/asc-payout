import pkg from "../../package.json";
import { fiscalPeriod, monthLabel, parseYearMonth, periodLabel, recentMonths, today, type YearMonth } from "../calendar/fiscal";
import { accountFromEnv, findAccount, loadSettings, saveSettings, type Account, type Settings } from "../config/settings";
import type { MonthResult } from "../earnings/model";
import { computeMonth } from "../earnings/month";
import { renderMonth, renderSummary, type AccountRow } from "../earnings/render";
import { HELP, parseArgs, UsageError, type Args } from "./args";
import { demoResults } from "./demo";
import { runDoctor } from "./doctor";
import { runSetup, showStatus } from "./setup";
import { ui } from "./ui";
import { cleanUpAfterUpdate, runUpdate, updateHint } from "./update";

export const VERSION: string = pkg.version;

const dim = (s: string) => (process.stderr.isTTY && !process.env.NO_COLOR ? `\x1b[2m${s}\x1b[22m` : s);
const log = (message: string) => ui.note(dim(`  ${message}`));

export async function pickAccounts(args: Args, settings: Settings): Promise<Account[]> {
  const fromEnv = accountFromEnv();
  if (fromEnv) return [fromEnv];

  if (settings.accounts.length === 0) {
    if (!ui.interactive()) throw new UsageError("No account set up yet. Run: asc-payout setup");
    ui.print("\n  No App Store Connect account is set up yet.\n");
    if (await ui.confirm({ message: "Set one up now?", default: true })) await runSetup();
    const reloaded = loadSettings();
    if (reloaded.accounts.length === 0) return [];
    Object.assign(settings, reloaded);
  }

  if (args.account !== undefined) {
    if (args.account.toLowerCase() === "all") return settings.accounts;
    const account = findAccount(settings, args.account);
    if (!account) {
      throw new UsageError(
        `No account "${args.account}". Accounts: ${settings.accounts.map((a) => `${a.name} (${a.vendor})`).join(", ")}, or "all".`,
      );
    }
    return [account];
  }
  if (settings.accounts.length === 1) return settings.accounts;
  if (!ui.interactive()) throw new UsageError("Several accounts are set up: choose one with --account <name> or --account all");

  const ALL = "\u0000all";
  const picked = await ui.select<string>({
    message: "Account:",
    default: settings.lastAccount === "all" ? ALL : settings.lastAccount,
    choices: [
      ...settings.accounts.map((a) => ({ name: `${a.name}  (vendor ${a.vendor})`, value: a.name })),
      { name: "All accounts", value: ALL },
    ],
  });
  settings.lastAccount = picked === ALL ? "all" : picked;
  saveSettings(settings);
  return picked === ALL ? settings.accounts : settings.accounts.filter((a) => a.name === picked);
}

export async function pickMonth(args: Args): Promise<YearMonth> {
  if (args.month !== undefined) {
    const ym = parseYearMonth(args.month);
    if (!ym) throw new UsageError(`--month expects YYYY-MM, e.g. 2026-10 (got "${args.month}")`);
    return ym;
  }
  const months = recentMonths(24);
  // The month that just closed is what people look up most
  if (!ui.interactive()) return months[1];
  const now = today();
  return ui.select<YearMonth>({
    message: "Month:",
    default: months[1],
    pageSize: 12,
    choices: months.map((ym) => {
      const p = fiscalPeriod(ym);
      return { name: `${monthLabel(ym).padEnd(15)} ${periodLabel(p)}${p.end >= now ? "  (in progress)" : ""}`, value: ym };
    }),
  });
}

function printResults(rows: AccountRow[], currency: string, json: boolean): void {
  if (json) {
    const results = rows.filter((r) => r.result).map((r) => r.result as MonthResult);
    const errors = rows.filter((r) => r.error).map((r) => ({ account: r.name, error: r.error }));
    ui.print(JSON.stringify({ version: VERSION, results, errors }, null, 2));
    return;
  }
  for (const r of rows) if (r.result) ui.print(renderMonth(r.result));
  if (rows.length > 1) ui.print(renderSummary(rows, currency));
}

export async function report(args: Args): Promise<number> {
  const settings = loadSettings();
  const accounts = await pickAccounts(args, settings);
  if (accounts.length === 0) return 0;
  const ym = await pickMonth(args);
  const currency = args.currency ?? process.env.ASC_PAYOUT_CURRENCY?.toUpperCase() ?? settings.currency;
  const hint = !args.json && ui.interactive() ? updateHint(VERSION).catch(() => null) : Promise.resolve(null);

  const rows: AccountRow[] = [];
  for (const account of accounts) {
    if (accounts.length > 1) log(`── ${account.name} ──`);
    try {
      const result = await computeMonth(account, ym, { currency, useCache: !args.noCache, refreshCatalog: args.refresh, log });
      rows.push({ name: account.name, result });
    } catch (error) {
      rows.push({ name: account.name, error: (error as Error).message });
      ui.note(`\n  ${account.name}: ${(error as Error).message}\n`);
    }
  }
  printResults(rows, currency, args.json);
  const note = await hint;
  if (note) ui.note(dim(`  ${note}`));
  return rows.some((r) => r.error) ? 1 : 0;
}

function demo(args: Args): number {
  const ym = (args.month && parseYearMonth(args.month)) || recentMonths(2)[1];
  const currency = args.currency ?? "USD";
  const all = demoResults(ym, currency);
  const chosen = args.account?.toLowerCase() === "all" ? all : [all[0]];
  printResults(chosen.map((r) => ({ name: r.account.name, result: r })), currency, args.json);
  return 0;
}

/**
 * Starts from a clean screen, like `clear` / `cls`, when a person is looking at it.
 * Not for --json, piped output, help or version, and not with --no-clear or ASC_PAYOUT_NO_CLEAR=1.
 */
function clearScreen(args: Args): void {
  const screens = ["report", "setup", "status", "demo", "doctor"];
  if (!screens.includes(args.command) || args.json || args.noClear || process.env.ASC_PAYOUT_NO_CLEAR || !process.stdout.isTTY) return;
  // clear the screen and the scrollback, cursor to the top
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  cleanUpAfterUpdate();
  clearScreen(args);
  switch (args.command) {
    case "help":
      ui.print(HELP);
      return 0;
    case "version":
      ui.print(VERSION);
      return 0;
    case "setup":
      if (!ui.interactive()) throw new UsageError("setup needs an interactive terminal");
      await runSetup();
      return 0;
    case "status":
      showStatus();
      return 0;
    case "doctor":
      return runDoctor(VERSION);
    case "update":
      return runUpdate(VERSION);
    case "demo":
      return demo(args);
    case "report":
      return report(args);
  }
}
