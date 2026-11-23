#!/usr/bin/env bun
import { confirm, select } from "@inquirer/prompts";
import pkg from "../package.json";
import { fiscalPeriod, monthLabel, parseYearMonth, periodLabel, recentMonths, today, type YearMonth } from "./calendar/fiscal";
import { HELP, parseArgs, UsageError, type Args } from "./cli/args";
import { demoResults } from "./cli/demo";
import { runSetup, showStatus } from "./cli/setup";
import { accountFromEnv, findAccount, loadSettings, saveSettings, type Account, type Settings } from "./config/settings";
import type { MonthResult } from "./earnings/model";
import { computeMonth } from "./earnings/month";
import { renderMonth, renderSummary, type AccountRow } from "./earnings/render";

const interactive = process.stdin.isTTY && process.stdout.isTTY;
const dim = (s: string) => (process.stderr.isTTY && !process.env.NO_COLOR ? `\x1b[2m${s}\x1b[22m` : s);
const log = (message: string) => process.stderr.write(dim(`  ${message}`) + "\n");

async function pickAccounts(args: Args, settings: Settings): Promise<Account[]> {
  const fromEnv = accountFromEnv();
  if (fromEnv) return [fromEnv];

  if (settings.accounts.length === 0) {
    if (!interactive) throw new UsageError("No account set up yet. Run: asc-payout setup");
    console.log("\n  No App Store Connect account is set up yet.\n");
    if (await confirm({ message: "Set one up now?", default: true })) await runSetup();
    const reloaded = loadSettings();
    if (reloaded.accounts.length === 0) process.exit(0);
    settings.accounts = reloaded.accounts;
    settings.currency = reloaded.currency;
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
  if (settings.accounts.length === 1 || !interactive) {
    if (settings.accounts.length > 1) throw new UsageError('Several accounts are set up: choose one with --account <name> or --account all');
    return settings.accounts;
  }

  const ALL = "\u0000all";
  const picked = await select<string>({
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

async function pickMonth(args: Args): Promise<YearMonth> {
  if (args.month !== undefined) {
    const ym = parseYearMonth(args.month);
    if (!ym) throw new UsageError(`--month expects YYYY-MM, e.g. 2026-10 (got "${args.month}")`);
    return ym;
  }
  const months = recentMonths(24);
  // The month just closed is what people look up most; default to it
  if (!interactive) return months[1];
  const now = today();
  return select<YearMonth>({
    message: "Month:",
    default: months[1],
    pageSize: 12,
    choices: months.map((ym) => {
      const p = fiscalPeriod(ym);
      return { name: `${monthLabel(ym).padEnd(15)} ${periodLabel(p)}${p.end >= now ? "  (in progress)" : ""}`, value: ym };
    }),
  });
}

function print(results: AccountRow[], currency: string, json: boolean): void {
  if (json) {
    const ok = results.filter((r) => r.result).map((r) => r.result as MonthResult);
    const failed = results.filter((r) => r.error).map((r) => ({ account: r.name, error: r.error }));
    console.log(JSON.stringify({ version: pkg.version, results: ok, errors: failed }, null, 2));
    return;
  }
  if (results.length > 1) console.log(renderSummary(results, currency));
}

async function report(args: Args): Promise<number> {
  const settings = loadSettings();
  const accounts = await pickAccounts(args, settings);
  const ym = await pickMonth(args);
  const currency = args.currency ?? process.env.ASC_PAYOUT_CURRENCY?.toUpperCase() ?? settings.currency;

  const rows: AccountRow[] = [];
  for (const account of accounts) {
    if (accounts.length > 1) log(`── ${account.name} ──`);
    try {
      const result = await computeMonth(account, ym, { currency, useCache: !args.noCache, refreshCatalog: args.refresh, log });
      rows.push({ name: account.name, result });
      if (!args.json) console.log(renderMonth(result));
    } catch (error) {
      rows.push({ name: account.name, error: (error as Error).message });
      process.stderr.write(`\n  ${account.name}: ${(error as Error).message}\n\n`);
    }
  }
  print(rows, currency, args.json);
  return rows.some((r) => r.error) ? 1 : 0;
}

function demo(args: Args): number {
  const ym = (args.month && parseYearMonth(args.month)) || recentMonths(2)[1];
  const currency = args.currency ?? "USD";
  const all = demoResults(ym, currency);
  const chosen = args.account?.toLowerCase() === "all" ? all : [all[0]];
  const rows = chosen.map((r) => ({ name: r.account.name, result: r }));
  if (!args.json) for (const r of chosen) console.log(renderMonth(r));
  print(rows, currency, args.json);
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "help":
      console.log(HELP);
      return 0;
    case "version":
      console.log(pkg.version);
      return 0;
    case "setup":
      if (!interactive) throw new UsageError("setup needs an interactive terminal");
      await runSetup();
      return 0;
    case "status":
      showStatus();
      return 0;
    case "demo":
      return demo(args);
    case "report":
      return report(args);
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    if ((error as Error).name === "ExitPromptError") process.exit(130);
    const usage = error instanceof UsageError;
    process.stderr.write(`\n  ${usage ? "" : "Error: "}${(error as Error).message}\n${usage ? "  See: asc-payout --help\n" : ""}\n`);
    if (process.env.DEBUG && !usage) console.error(error);
    process.exit(usage ? 2 : 1);
  },
);
