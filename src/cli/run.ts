import pkg from "../../package.json";
import { fiscalPeriod, monthLabel, next, parseYearMonth, periodLabel, previous, recentMonths, today, type YearMonth } from "../calendar/fiscal";
import { accountFromEnv, findAccount, loadSettings, saveSettings, type Account, type Settings } from "../config/settings";
import type { MonthResult } from "../earnings/model";
import { computeHistory, renderHistory } from "../earnings/history";
import { computeSubscriptions, renderSubscriptions } from "../earnings/subscriptions";
import { computeMonth } from "../earnings/month";
import { renderMonth, renderSummary, type AccountRow } from "../earnings/render";
import { HELP, parseArgs, UsageError, type Args } from "./args";
import { demoResults } from "./demo";
import { runDoctor } from "./doctor";
import { runSetup, showStatus } from "./setup";
import { historyCsv, monthCsv, subscriptionsCsv } from "./csv";
import { startSpinner } from "./spinner";
import { runWatch } from "./watch";
import { ui } from "./ui";
import { cleanUpAfterUpdate, runUpdate, updateHint } from "./update";

export const VERSION: string = pkg.version;

const dim = (s: string) => (process.stderr.isTTY && !process.env.NO_COLOR ? `\x1b[2m${s}\x1b[22m` : s);

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

function printResults(rows: AccountRow[], currency: string, args: Args): void {
  if (args.csv) {
    ui.print(monthCsv(rows.filter((r) => r.result).map((r) => r.result as MonthResult)).trimEnd());
    return;
  }
  if (args.json) {
    const results = rows.filter((r) => r.result).map((r) => r.result as MonthResult);
    const errors = rows.filter((r) => r.error).map((r) => ({ account: r.name, error: r.error }));
    ui.print(JSON.stringify({ version: VERSION, results, errors }, null, 2));
    return;
  }
  for (const r of rows) if (r.result) ui.print(renderMonth(r.result, { by: args.by }));
  if (rows.length > 1) ui.print(renderSummary(rows, currency));
}

const currencyFor = (args: Args, settings: Settings) => args.currency ?? process.env.ASC_PAYOUT_CURRENCY?.toUpperCase() ?? settings.currency;

async function showMonth(accounts: Account[], ym: YearMonth, currency: string, args: Args): Promise<AccountRow[]> {
  const rows: AccountRow[] = [];
  const warnings: string[] = [];
  const spinner = startSpinner();
  try {
    for (const account of accounts) {
      try {
        const result = await computeMonth(account, ym, {
          currency,
          useCache: !args.noCache,
          refreshCatalog: args.refresh,
          log: spinner.text,
          progress: spinner.progress,
          warn: (w) => warnings.push(`${account.name}: ${w}`),
        });
        rows.push({ name: account.name, result });
      } catch (error) {
        rows.push({ name: account.name, error: (error as Error).message });
      }
    }
  } finally {
    spinner.stop();
  }
  for (const w of warnings) ui.note(dim(`  ${w}`));
  for (const r of rows) if (r.error) ui.note(`\n  ${r.name}: ${r.error}\n`);
  printResults(rows, currency, args);
  return rows;
}

export interface NavState {
  /** index into the account choices; the last one is "all accounts" when there are several */
  choice: number;
  ym: YearMonth;
  by: "app" | "country";
}

/** What a key does on the month screen; null = ignore the key, "quit" = leave. */
export function navigate(state: NavState, key: string, choices: number, newest: YearMonth): NavState | "quit" | null {
  const same = (a: YearMonth, b: YearMonth) => a.year === b.year && a.month === b.month;
  switch (key) {
    case "left":
    case "h":
      return { ...state, ym: previous(state.ym) };
    case "right":
    case "l":
      return same(state.ym, newest) ? null : { ...state, ym: next(state.ym) };
    case "up":
    case "k":
      return choices > 1 ? { ...state, choice: (state.choice - 1 + choices) % choices } : null;
    case "down":
    case "j":
      return choices > 1 ? { ...state, choice: (state.choice + 1) % choices } : null;
    case "c":
      return { ...state, by: state.by === "country" ? "app" : "country" };
    case "q":
    case "return":
      return "quit";
    default:
      return null;
  }
}

export async function report(args: Args): Promise<number> {
  const settings = loadSettings();
  const accounts = await pickAccounts(args, settings);
  if (accounts.length === 0) return 0;
  const ym = await pickMonth(args);
  const currency = currencyFor(args, settings);
  const hint = !args.json && !args.csv && ui.interactive() ? updateHint(VERSION).catch(() => null) : Promise.resolve(null);

  let rows = await showMonth(accounts, ym, currency, args);

  // Chosen from the menus: stay on screen, arrows move between months and accounts
  const fromEnv = accountFromEnv() !== null;
  if (ui.interactive() && args.month === undefined && !args.json && !args.csv) {
    const options: Account[][] = fromEnv ? [accounts] : settings.accounts.map((a) => [a]);
    if (!fromEnv && settings.accounts.length > 1) options.push(settings.accounts);
    let state: NavState = {
      ym,
      by: args.by ?? "app",
      choice: Math.max(0, options.findIndex((o) => o.length === accounts.length && o.every((a, i) => a === accounts[i]))),
    };
    const newest = recentMonths(1)[0];
    for (;;) {
      ui.note(dim(`  ← → month${options.length > 1 ? "   ↑ ↓ account" : ""}   c ${state.by === "country" ? "apps" : "countries"}   q quit`));
      const nextState = navigate(state, await ui.key(), options.length, newest);
      if (nextState === "quit") break;
      if (nextState === null) continue;
      state = nextState;
      clearScreen({ ...args, command: "report" });
      rows = await showMonth(options[state.choice], state.ym, currency, { ...args, by: state.by });
    }
  }

  const note = await hint;
  if (note) ui.note(dim(`  ${note}`));
  return rows.some((r) => r.error) ? 1 : 0;
}

async function history(args: Args): Promise<number> {
  const settings = loadSettings();
  const accounts = await pickAccounts(args, settings);
  if (accounts.length === 0) return 0;
  const currency = currencyFor(args, settings);
  const now = recentMonths(1)[0];
  const months = args.year
    ? Array.from({ length: 12 }, (_, i) => ({ year: args.year!, month: 12 - i })).filter(
        (m) => m.year < now.year || (m.year === now.year && m.month <= now.month),
      )
    : recentMonths(args.months ?? 12);
  if (months.length === 0) throw new UsageError(`${args.year} has not started yet`);
  const histories = [];
  const spinner = startSpinner();
  try {
    for (const account of accounts) {
      histories.push(
        await computeHistory(account, months, {
          currency,
          useCache: !args.noCache,
          refreshCatalog: args.refresh,
          log: spinner.text,
          progress: spinner.progress,
          warn: () => {},
        }),
      );
    }
  } finally {
    spinner.stop();
  }
  if (args.csv) ui.print(historyCsv(histories).trimEnd());
  else if (args.json) ui.print(JSON.stringify({ version: VERSION, history: histories }, null, 2));
  else ui.print(renderHistory(histories, currency, args.year ? `${args.year}` : undefined));
  return histories.some((h) => h.errors.length > 0) ? 1 : 0;
}

async function subscriptions(args: Args): Promise<number> {
  const settings = loadSettings();
  const accounts = await pickAccounts(args, settings);
  if (accounts.length === 0) return 0;
  const currency = currencyFor(args, settings);
  const results = [];
  const errors: string[] = [];
  const spinner = startSpinner();
  try {
    for (const account of accounts) {
      try {
        results.push(await computeSubscriptions(account, { currency, useCache: !args.noCache, days: args.days ?? 30, log: spinner.text, progress: spinner.progress }));
      } catch (error) {
        errors.push(`${account.name}: ${(error as Error).message}`);
      }
    }
  } finally {
    spinner.stop();
  }
  for (const e of errors) ui.note(`\n  ${e}\n`);
  if (args.csv) ui.print(subscriptionsCsv(results).trimEnd());
  else if (args.json) ui.print(JSON.stringify({ version: VERSION, subscriptions: results, errors }, null, 2));
  else for (const r of results) ui.print(renderSubscriptions(r));
  return errors.length ? 1 : 0;
}

async function watch(args: Args): Promise<number> {
  const settings = loadSettings();
  const fromEnv = accountFromEnv();
  const accounts = fromEnv ? [fromEnv] : args.account ? await pickAccounts(args, settings) : settings.accounts;
  if (accounts.length === 0) throw new UsageError("No account set up yet. Run: asc-payout setup");
  return runWatch(accounts, currencyFor(args, settings));
}

function demo(args: Args): number {
  const ym = (args.month && parseYearMonth(args.month)) || recentMonths(2)[1];
  const currency = args.currency ?? "USD";
  const all = demoResults(ym, currency);
  const chosen = args.account?.toLowerCase() === "all" ? all : [all[0]];
  printResults(chosen.map((r) => ({ name: r.account.name, result: r })), currency, args);
  return 0;
}

/**
 * Starts from a clean screen, like `clear` / `cls`, when a person is looking at it.
 * Not for --json, piped output, help or version, and not with --no-clear or ASC_PAYOUT_NO_CLEAR=1.
 */
function clearScreen(args: Args): void {
  const screens = ["report", "history", "subs", "setup", "status", "demo", "doctor"];
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
    case "history":
      return history(args);
    case "subs":
      return subscriptions(args);
    case "watch":
      return watch(args);
  }
}
