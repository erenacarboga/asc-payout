import pkg from "../../package.json";
import { fiscalPeriod, monthLabel, next, parseYearMonth, periodLabel, previous, recentMonths, today, type YearMonth } from "../calendar/fiscal";
import { accountFromEnv, findAccount, loadSettings, saveSettings, type Account, type Settings } from "../config/settings";
import { computeHistory, renderHistory } from "../earnings/history";
import type { MonthResult } from "../earnings/model";
import { computeMonth } from "../earnings/month";
import { renderMonth, renderSummary, type AccountRow } from "../earnings/render";
import { computeSubscriptions, renderSubscriptions } from "../earnings/subscriptions";
import { HELP, parseArgs, UsageError, type Args } from "./args";
import { historyCsv, monthCsv, subscriptionsCsv } from "./csv";
import { saveExport } from "./export";
import { demoResults } from "./demo";
import { runDoctor } from "./doctor";
import { BACK, QUIT } from "./prompts";
import { runSetup, showStatus } from "./setup";
import { startSpinner } from "./spinner";
import { ui } from "./ui";
import { cleanUpAfterUpdate, runUpdate, updateHint } from "./update";
import { runWatch } from "./watch";

export const VERSION: string = pkg.version;

const color = () => !!process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string) => (color() ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (color() ? `\x1b[1m${s}\x1b[22m` : s);
const cyan = (s: string) => (color() ? `\x1b[36m${s}\x1b[39m` : s);

const currencyFor = (args: Args, settings: Settings) => args.currency ?? process.env.ASC_PAYOUT_CURRENCY?.toUpperCase() ?? settings.currency;
const sameMonth = (a: YearMonth, b: YearMonth) => a.year === b.year && a.month === b.month;

// ---------------------------------------------------------------------------
// Which accounts
// ---------------------------------------------------------------------------

/** The accounts a command works on: --account, the env account, or the remembered choice. */
export async function pickAccounts(args: Args, settings: Settings): Promise<Account[]> {
  const fromEnv = accountFromEnv();
  if (fromEnv) return [fromEnv];

  if (settings.accounts.length === 0) {
    if (!ui.interactive()) throw new UsageError("No account set up yet. Run: asc-payout setup");
    ui.print("\n  No App Store Connect account is set up yet.\n");
    if (await ui.yesNo("Set one up now?")) await runSetup();
    Object.assign(settings, loadSettings());
    if (settings.accounts.length === 0) return [];
  }

  if (args.account !== undefined) {
    if (args.account.toLowerCase() === "all") return settings.accounts;
    const account = findAccount(settings, args.account);
    if (!account) {
      throw new UsageError(`No account "${args.account}". Accounts: ${settings.accounts.map((a) => `${a.name} (${a.vendor})`).join(", ")}, or "all".`);
    }
    return [account];
  }
  if (settings.accounts.length === 1) return settings.accounts;
  if (!ui.interactive()) throw new UsageError("Several accounts are set up: choose one with --account <name> or --account all");
  return scopeAccounts(settings);
}

/** The account choice remembered from the menus ("all" or a name); the first account otherwise. */
function scopeAccounts(settings: Settings): Account[] {
  if (settings.lastAccount === "all") return settings.accounts;
  const named = settings.accounts.find((a) => a.name === settings.lastAccount);
  return named ? [named] : settings.accounts.slice(0, 1);
}

const scopeLabel = (accounts: Account[], settings: Settings) =>
  accounts.length > 1 && accounts.length === settings.accounts.length ? "All accounts" : accounts.map((a) => a.name).join(", ");

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

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

async function collectMonth(accounts: Account[], ym: YearMonth, currency: string, args: Args): Promise<AccountRow[]> {
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
  return rows;
}

async function showMonth(accounts: Account[], ym: YearMonth, currency: string, args: Args): Promise<AccountRow[]> {
  const rows = await collectMonth(accounts, ym, currency, args);
  printResults(rows, currency, args);
  return rows;
}

function historyMonths(args: Args): YearMonth[] {
  const now = recentMonths(1)[0];
  if (!args.year) return recentMonths(args.months ?? 12);
  const months = Array.from({ length: 12 }, (_, i) => ({ year: args.year!, month: 12 - i })).filter(
    (m) => m.year < now.year || (m.year === now.year && m.month <= now.month),
  );
  if (months.length === 0) throw new UsageError(`${args.year} has not started yet`);
  return months;
}

async function collectHistory(accounts: Account[], currency: string, args: Args) {
  const months = historyMonths(args);
  const histories = [];
  const spinner = startSpinner();
  try {
    for (const account of accounts) {
      histories.push(
        await computeHistory(account, months, { currency, useCache: !args.noCache, refreshCatalog: args.refresh, log: spinner.text, progress: spinner.progress, warn: () => {} }),
      );
    }
  } finally {
    spinner.stop();
  }
  return histories;
}

async function showHistory(accounts: Account[], currency: string, args: Args): Promise<boolean> {
  const histories = await collectHistory(accounts, currency, args);
  if (args.csv) ui.print(historyCsv(histories).trimEnd());
  else if (args.json) ui.print(JSON.stringify({ version: VERSION, history: histories }, null, 2));
  else ui.print(renderHistory(histories, currency, args.year ? `${args.year}` : undefined));
  return histories.every((h) => h.errors.length === 0);
}

async function collectSubscriptions(accounts: Account[], currency: string, args: Args) {
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
  return { results, errors };
}

async function showSubscriptions(accounts: Account[], currency: string, args: Args): Promise<boolean> {
  const { results, errors } = await collectSubscriptions(accounts, currency, args);
  if (args.csv) ui.print(subscriptionsCsv(results).trimEnd());
  else if (args.json) ui.print(JSON.stringify({ version: VERSION, subscriptions: results, errors }, null, 2));
  else for (const r of results) ui.print(renderSubscriptions(r));
  return errors.length === 0;
}

const ymText = (ym: YearMonth) => `${ym.year}-${String(ym.month).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Keys on a screen
// ---------------------------------------------------------------------------

export interface NavState {
  /** index into the account choices; the last one is "all accounts" when there are several */
  choice: number;
  ym: YearMonth;
  by: "app" | "country";
  /** bumped by "r": download the reports again */
  reload?: number;
}

/** What a key does on the month screen; null = ignore it. */
export function navigate(state: NavState, key: string, choices: number, newest: YearMonth): NavState | "back" | "quit" | "export" | null {
  switch (key) {
    case "left":
    case "h":
      return { ...state, ym: previous(state.ym) };
    case "right":
    case "l":
      return sameMonth(state.ym, newest) ? null : { ...state, ym: next(state.ym) };
    case "up":
    case "k":
      return choices > 1 ? { ...state, choice: (state.choice - 1 + choices) % choices } : null;
    case "down":
    case "j":
      return choices > 1 ? { ...state, choice: (state.choice + 1) % choices } : null;
    case "c":
      return { ...state, by: state.by === "country" ? "app" : "country" };
    case "r":
      return { ...state, reload: (state.reload ?? 0) + 1 };
    case "b":
    case "escape":
    case "backspace":
    case "return":
    case "enter":
      return "back";
    case "q":
      return "quit";
    case "e":
      return "export";
    default:
      return null;
  }
}

/** A month on screen; arrows move, b / Esc goes back. */
async function monthScreen(accounts: Account[], ym: YearMonth, settings: Settings, args: Args): Promise<"back" | "quit"> {
  const currency = currencyFor(args, settings);
  const fromEnv = accountFromEnv() !== null;
  const options: Account[][] = fromEnv ? [accounts] : settings.accounts.map((a) => [a]);
  if (!fromEnv && settings.accounts.length > 1) options.push(settings.accounts);
  let state: NavState = {
    ym,
    by: args.by ?? "app",
    choice: Math.max(0, options.findIndex((o) => o.length === accounts.length && o.every((a, i) => a === accounts[i]))),
  };
  const newest = recentMonths(1)[0];
  ui.clear();
  let rows = await showMonth(options[state.choice], state.ym, currency, { ...args, by: state.by });
  for (;;) {
    const keys = [
      `${cyan("← →")} month`,
      options.length > 1 ? `${cyan("↑ ↓")} account` : "",
      `${cyan("c")} ${state.by === "country" ? "apps" : "countries"}`,
      `${cyan("r")} reload`,
      `${cyan("e")} export`,
      `${cyan("b")} back`,
      `${cyan("q")} quit`,
    ].filter(Boolean);
    ui.note(`  ${keys.join(dim("   "))}`);
    const step = navigate(state, await ui.key(), options.length, newest);
    if (step === "back" || step === "quit") return step;
    if (step === null) continue;
    if (step === "export") {
      const results = rows.filter((r) => r.result).map((r) => r.result as MonthResult);
      const path = saveExport(`asc-payout-${ymText(state.ym)}`, monthCsv(results));
      ui.note(`  ${cyan("✔")} Saved ${path}`);
      continue;
    }
    const reload = (step.reload ?? 0) !== (state.reload ?? 0);
    state = step;
    ui.clear();
    rows = await showMonth(options[state.choice], state.ym, currency, { ...args, by: state.by, noCache: reload || args.noCache, refresh: reload || args.refresh });
  }
}

/** Waits on a finished screen: b / Esc / Enter go back, q quits. */
async function waitBack(): Promise<"back" | "quit"> {
  ui.note(`  ${cyan("b")} back   ${cyan("q")} quit`);
  for (;;) {
    const key = await ui.key();
    if (key === "q") return "quit";
    if (["b", "escape", "return", "enter", "backspace"].includes(key)) return "back";
  }
}

// ---------------------------------------------------------------------------
// Home menu
// ---------------------------------------------------------------------------

async function pickMonthFromList(): Promise<YearMonth | null> {
  const months = recentMonths(24);
  const now = today();
  const chosen = await ui.pick<YearMonth>({
    message: "Which month?",
    start: 1,
    pageSize: 15,
    items: months.map((ym) => {
      const p = fiscalPeriod(ym);
      return { label: monthLabel(ym), value: ym, hint: `${periodLabel(p)}${p.end >= now ? "  ·  running" : ""}` };
    }),
  });
  return chosen === BACK || chosen === QUIT ? null : chosen;
}

async function pickScope(settings: Settings, current: Account[]): Promise<Account[] | null> {
  const ALL = "\u0000all";
  const currentKey = current.length > 1 ? ALL : current[0]?.name;
  const items = [
    ...settings.accounts.map((a) => ({ label: a.name, value: a.name, hint: `vendor ${a.vendor}` })),
    ...(settings.accounts.length > 1 ? [{ label: "All accounts", value: ALL, hint: "each account and a combined table", key: "a" }] : []),
  ];
  const chosen = await ui.pick<string>({ message: "Show which account?", items, start: Math.max(0, items.findIndex((i) => i.value === currentKey)) });
  if (chosen === BACK || chosen === QUIT) return null;
  settings.lastAccount = chosen === ALL ? "all" : chosen;
  saveSettings(settings);
  return chosen === ALL ? settings.accounts : settings.accounts.filter((a) => a.name === chosen);
}

type HomeChoice = "update" | "now" | "last" | "month" | "history" | "subs" | "export" | "account" | "settings" | "doctor" | "quit";

/** History: how far back. */
async function pickHistory(): Promise<Partial<Args> | null> {
  const thisYear = recentMonths(1)[0].year;
  const choice = await ui.pick<Partial<Args> | "year">({
    message: "History of",
    items: [
      { label: "The last 12 months", value: { months: 12 }, key: "1" },
      { label: "The last 24 months", value: { months: 24 }, key: "2" },
      { label: `This year (${thisYear})`, value: { year: thisYear }, key: "y" },
      { label: "Another year…", value: "year", key: "o" },
    ],
  });
  if (choice === BACK || choice === QUIT) return null;
  if (choice !== "year") return choice;
  const year = await ui.pick<number>({
    message: "Which year?",
    items: Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => ({ label: String(y), value: y })),
  });
  return year === BACK || year === QUIT ? null : { year };
}

/** Subscriptions: how many days of events. */
async function pickDays(): Promise<number | null> {
  const days = await ui.pick<number>({
    message: "Subscriptions, with events of",
    start: 1,
    items: [
      { label: "The last 7 days", value: 7, key: "7" },
      { label: "The last 30 days", value: 30, key: "3" },
      { label: "The last 90 days", value: 90, key: "9" },
    ],
  });
  return days === BACK || days === QUIT ? null : days;
}

/** Export: what to save as a CSV file. */
async function exportMenu(accounts: Account[], currency: string, args: Args): Promise<void> {
  const months = recentMonths(2);
  const thisYear = months[0].year;
  const choice = await ui.pick<string>({
    message: "Save as a spreadsheet (CSV) in your Downloads folder",
    items: [
      { label: "Last month", value: "last", key: "l", hint: monthLabel(months[1]) },
      { label: "Another month…", value: "month", key: "m" },
      { label: "The last 12 months", value: "history", key: "h" },
      { label: `This year (${thisYear})`, value: "year", key: "y" },
      { label: "Subscriptions", value: "subs", key: "s" },
    ],
  });
  if (choice === BACK || choice === QUIT) return;
  let path: string;
  if (choice === "last" || choice === "month") {
    const ym = choice === "last" ? months[1] : await pickMonthFromList();
    if (!ym) return;
    const rows = await collectMonth(accounts, ym, currency, args);
    path = saveExport(`asc-payout-${ymText(ym)}`, monthCsv(rows.filter((r) => r.result).map((r) => r.result as MonthResult)));
  } else if (choice === "history" || choice === "year") {
    const histories = await collectHistory(accounts, currency, { ...args, ...(choice === "year" ? { year: thisYear } : { months: 12 }) });
    path = saveExport(choice === "year" ? `asc-payout-${thisYear}` : "asc-payout-last-12-months", historyCsv(histories));
  } else {
    const { results } = await collectSubscriptions(accounts, currency, args);
    path = saveExport(`asc-payout-subscriptions-${today()}`, subscriptionsCsv(results));
  }
  ui.print(`\n  ${cyan("✔")} Saved ${bold(path)}\n`);
}

/** No account yet: set one up, or look around with made-up data first. */
async function firstRun(): Promise<boolean> {
  for (;;) {
    ui.clear();
    ui.print("");
    ui.print(`  ${bold("Welcome to asc-payout")}`);
    ui.print(`  ${dim("See what Apple will pay you, per fiscal month, from your App Store Connect data.")}`);
    ui.print("");
    const choice = await ui.pick<"setup" | "demo" | "quit">({
      message: "How do you want to start?",
      back: false,
      quit: true,
      items: [
        { label: "Set up my account", value: "setup", key: "s", hint: "an API key with the Finance role and your vendor number" },
        { label: "Look around with demo data", value: "demo", key: "d", hint: "made-up numbers, nothing to set up" },
        { label: "Quit", value: "quit", key: "q" },
      ],
    });
    if (choice === "demo") {
      ui.clear();
      demo({ command: "demo", json: false, csv: false, noCache: false, noClear: false, refresh: false, account: "all" });
      if ((await waitBack()) === "quit") return false;
      continue;
    }
    if (choice !== "setup") return false;
    await runSetup();
    if (loadSettings().accounts.length > 0) return true;
  }
}

/** The menu shown by `asc-payout` on a terminal. */
export async function home(args: Args): Promise<number> {
  let settings = loadSettings();
  if (settings.accounts.length === 0 && !accountFromEnv()) {
    if (!(await firstRun())) return 0;
    settings = loadSettings();
  }
  let accounts = await pickAccounts(args, settings);
  if (accounts.length === 0) return 0;
  const hint = updateHint(VERSION).catch(() => null);
  let last: HomeChoice = "last";

  for (;;) {
    settings = loadSettings();
    // keep the scope if the accounts still exist (they may have been edited in Settings)
    const fromEnv = accountFromEnv();
    accounts = fromEnv ? [fromEnv] : accounts.map((a) => settings.accounts.find((s) => s.vendor === a.vendor)).filter((a): a is Account => !!a);
    if (accounts.length === 0) accounts = scopeAccounts(settings);
    if (accounts.length === 0) return 0;

    const months = recentMonths(2);
    const [thisPeriod, lastPeriod] = months.map(fiscalPeriod);
    const currency = currencyFor(args, settings);
    const note = await Promise.race([hint, new Promise<null>((r) => setTimeout(() => r(null), 300))]);

    ui.clear();
    ui.print("");
    ui.print(`  ${bold("asc-payout")} ${dim(VERSION)}   ${scopeLabel(accounts, settings)}  ${dim(`·  ${currency}`)}`);
    if (note) ui.print(`  ${dim(note)}`);
    ui.print("");

    const items = [
      ...(note ? [{ label: `Update asc-payout`, value: "update" as const, key: "u", hint: note.replace(/: run.*$/, "") }, { separator: "" }] : []),
      { label: "This month so far", value: "now" as const, key: "t", hint: `${monthLabel(months[0])}  ·  ${periodLabel(thisPeriod)}  ·  running` },
      { label: "Last month", value: "last" as const, key: "l", hint: `${monthLabel(months[1])}  ·  ${periodLabel(lastPeriod)}` },
      { label: "Another month…", value: "month" as const, key: "m" },
      { label: "History…", value: "history" as const, key: "h", hint: "months side by side, top apps" },
      { label: "Subscriptions…", value: "subs" as const, key: "s", hint: "paying, trials, MRR, cancellations" },
      { label: "Export to a file…", value: "export" as const, key: "e", hint: "CSV for Excel, Numbers, Google Sheets" },
      { separator: "" },
      ...(fromEnv || settings.accounts.length < 2 ? [] : [{ label: "Account", value: "account" as const, key: "a", hint: scopeLabel(accounts, settings) }]),
      { label: "Settings", value: "settings" as const, key: "o", hint: "accounts, currency, notifications, updates" },
      { label: "Check my setup", value: "doctor" as const, key: "d", hint: "keys, access, clock, network" },
      { label: "Quit", value: "quit" as const, key: "q" },
    ];
    const choice: HomeChoice | typeof BACK | typeof QUIT = await ui.pick<HomeChoice>({
      message: "What would you like to see?",
      back: false,
      quit: true,
      start: Math.max(0, items.findIndex((i) => "value" in i && i.value === last)),
      items,
    });
    if (choice === QUIT || choice === BACK || choice === "quit") return 0;
    last = choice;

    let outcome: "back" | "quit" = "back";
    if (choice === "now") outcome = await monthScreen(accounts, months[0], settings, args);
    else if (choice === "last") outcome = await monthScreen(accounts, months[1], settings, args);
    else if (choice === "month") {
      const ym = await pickMonthFromList();
      if (ym) outcome = await monthScreen(accounts, ym, settings, args);
    } else if (choice === "history") {
      const range = await pickHistory();
      if (range) {
        ui.clear();
        await showHistory(accounts, currency, { ...args, ...range });
        outcome = await waitBack();
      }
    } else if (choice === "subs") {
      const days = await pickDays();
      if (days) {
        ui.clear();
        await showSubscriptions(accounts, currency, { ...args, days });
        outcome = await waitBack();
      }
    } else if (choice === "export") {
      await exportMenu(accounts, currency, args);
      outcome = await waitBack();
    } else if (choice === "update") {
      ui.clear();
      await runUpdate(VERSION);
      ui.print(dim("  Start asc-payout again to use the new version."));
      return 0;
    } else if (choice === "account") {
      accounts = (await pickScope(settings, accounts)) ?? accounts;
    } else if (choice === "settings") {
      await runSetup();
    } else if (choice === "doctor") {
      ui.clear();
      await runDoctor(VERSION);
      outcome = await waitBack();
    }
    if (outcome === "quit") return 0;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function report(args: Args): Promise<number> {
  // On a terminal with no month given: the home menu
  if (ui.interactive() && args.month === undefined && !args.json && !args.csv) return home(args);

  const settings = loadSettings();
  const accounts = await pickAccounts(args, settings);
  if (accounts.length === 0) return 0;
  let ym = recentMonths(2)[1]; // the month that just closed
  if (args.month !== undefined) {
    const parsed = parseYearMonth(args.month);
    if (!parsed) throw new UsageError(`--month expects YYYY-MM, e.g. 2026-10 (got "${args.month}")`);
    ym = parsed;
  }
  const hint = !args.json && !args.csv && ui.interactive() ? updateHint(VERSION).catch(() => null) : Promise.resolve(null);
  const rows = await showMonth(accounts, ym, currencyFor(args, settings), args);
  const note = await hint;
  if (note) ui.note(dim(`  ${note}`));
  return rows.some((r) => r.error) ? 1 : 0;
}

async function history(args: Args): Promise<number> {
  const settings = loadSettings();
  const accounts = await pickAccounts(args, settings);
  if (accounts.length === 0) return 0;
  return (await showHistory(accounts, currencyFor(args, settings), args)) ? 0 : 1;
}

async function subscriptions(args: Args): Promise<number> {
  const settings = loadSettings();
  const accounts = await pickAccounts(args, settings);
  if (accounts.length === 0) return 0;
  return (await showSubscriptions(accounts, currencyFor(args, settings), args)) ? 0 : 1;
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
 * Not for --json / --csv, piped output, help or version, and not with --no-clear or ASC_PAYOUT_NO_CLEAR=1.
 */
function clearScreen(args: Args): void {
  const screens = ["report", "history", "subs", "setup", "status", "demo", "doctor"];
  if (!screens.includes(args.command) || args.json || args.csv || args.noClear) return;
  ui.clear();
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.noClear) process.env.ASC_PAYOUT_NO_CLEAR = "1";
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
