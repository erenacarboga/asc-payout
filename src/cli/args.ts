import { t } from "../i18n";

export type Command = "report" | "history" | "subs" | "churn" | "profit" | "watch" | "setup" | "status" | "demo" | "doctor" | "update" | "help" | "version";

export interface Args {
  command: Command;
  account?: string;
  month?: string;
  currency?: string;
  /** history: how many months */
  months?: number;
  /** history: the twelve months of this calendar year */
  year?: number;
  /** subs: days of events to count */
  days?: number;
  csv: boolean;
  /** group the month view by app (default) or country */
  by?: "app" | "country";
  json: boolean;
  noCache: boolean;
  /** keep what is on the screen instead of clearing it first */
  noClear: boolean;
  refresh: boolean;
}

export class UsageError extends Error {}

const COMMANDS: Record<string, Command> = {
  setup: "setup",
  status: "status",
  demo: "demo",
  history: "history",
  subs: "subs",
  churn: "churn",
  profit: "profit",
  watch: "watch",
  doctor: "doctor",
  update: "update",
  help: "help",
  version: "version",
};

const VALUE_FLAGS: Record<string, "account" | "month" | "currency" | "months" | "by" | "year" | "days"> = {
  "--year": "year",
  "--days": "days",
  "--months": "months",
  "--by": "by",
  "--account": "account",
  "-a": "account",
  "--month": "month",
  "-m": "month",
  "--currency": "currency",
  "-c": "currency",
};

const SWITCHES: Record<string, (a: Args) => void> = {
  "--json": (a) => (a.json = true),
  "--csv": (a) => (a.csv = true),
  "--no-cache": (a) => (a.noCache = true),
  "--no-clear": (a) => (a.noClear = true),
  "--refresh": (a) => (a.refresh = true),
  "--help": (a) => (a.command = "help"),
  "-h": (a) => (a.command = "help"),
  "--version": (a) => (a.command = "version"),
  "-v": (a) => (a.command = "version"),
  // the same commands as flags
  "--setup": (a) => (a.command = "setup"),
  "--status": (a) => (a.command = "status"),
  "--demo": (a) => (a.command = "demo"),
};

export function parseArgs(argv: string[]): Args {
  const args: Args = { command: "report", json: false, csv: false, noCache: false, noClear: false, refresh: false };
  let commandSet = false;

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const [flag, inline] = raw.startsWith("--") && raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, undefined];

    if (flag in VALUE_FLAGS) {
      const value = inline ?? argv[++i];
      if (value === undefined || (inline === undefined && value.startsWith("-"))) throw new UsageError(t("{flag} needs a value", { flag }));
      const key = VALUE_FLAGS[flag];
      if (key === "year") {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 2008 || n > 2100) throw new UsageError(t("--year expects a year like 2026"));
        args.year = n;
      } else if (key === "days") {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 365) throw new UsageError(t("--days expects a number from 1 to 365"));
        args.days = n;
      } else if (key === "months") {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 36) throw new UsageError(t("--months expects a number from 1 to 36"));
        args.months = n;
      } else if (key === "by") {
        if (value !== "app" && value !== "country") throw new UsageError(t('--by expects "app" or "country"'));
        args.by = value;
      } else {
        args[key] = value;
      }
    } else if (flag in SWITCHES) {
      if (inline !== undefined) throw new UsageError(t("{flag} does not take a value", { flag }));
      const before = args.command;
      SWITCHES[flag](args);
      // help and version win over other commands
      if (before === "help" || before === "version") args.command = before;
    } else if (!flag.startsWith("-") && !commandSet && flag in COMMANDS) {
      if (args.command !== "help" && args.command !== "version") args.command = COMMANDS[flag];
      commandSet = true;
    } else {
      throw new UsageError(flag.startsWith("-") ? t("Unknown option: {name}", { name: raw }) : t("Unknown command: {name}", { name: raw }));
    }
  }

  if (args.json && args.csv) throw new UsageError(t("choose --json or --csv, not both"));
  if (args.currency !== undefined) {
    args.currency = args.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(args.currency)) throw new UsageError(t("--currency expects a 3-letter code like USD, EUR or TRY"));
  }
  return args;
}

export const HELP = `
asc-payout - what Apple will pay you, per Apple fiscal month

Usage
  asc-payout                       pick an account and a month
  asc-payout -a <account> -m <YYYY-MM>
  asc-payout history               the last 12 months, with the biggest apps
  asc-payout history --year 2026    January to December of a year
  asc-payout subs                  subscribers, trials and MRR, and the last 30 days
  asc-payout churn                 refunds, cancellations and why, trial conversion by week
  asc-payout profit                revenue next to Apple Ads spend: profit and ROAS by app
  asc-payout watch                 tell me when last month's report is published
  asc-payout setup                 add, edit or remove accounts
  asc-payout status                show accounts and where files are kept
  asc-payout demo                  try it with made-up data
  asc-payout doctor                check keys, access, clock and network
  asc-payout update                install the latest version

Options
  -a, --account <name>   account name or vendor number, or "all"
  -m, --month <YYYY-MM>  fiscal month, named after the calendar month (2026-10 = October 2026)
  -c, --currency <CODE>  show amounts in this currency for this run (USD, EUR, TRY, ...)
      --by country       one row per country instead of per app
      --months <N>       history: number of months (default 12)
      --year <YYYY>      history: the months of that year
      --days <N>         subs, churn: days of events (default 30)
      --json             print the result as JSON (progress goes to stderr)
      --csv              print the result as CSV, for spreadsheets
      --no-cache         download the reports again
      --no-clear         don't clear the screen first (or ASC_PAYOUT_NO_CLEAR=1)
      --refresh          reload app names from App Store Connect
  -h, --help             this help
  -v, --version          version

Environment
  ASC_PAYOUT_VENDOR, ASC_PAYOUT_ISSUER_ID, ASC_PAYOUT_KEY_ID, ASC_PAYOUT_KEY_FILE
                         use this account instead of the configured ones
  ASC_PAYOUT_CURRENCY    default display currency
  ASC_PAYOUT_LANG=en|tr  language of the screens (default: the system's)
  ASC_PAYOUT_CONFIG_DIR, ASC_PAYOUT_CACHE_DIR
                         where settings and downloaded reports are kept
  ASC_PAYOUT_NOTIFY=off   watch: print only, no desktop notification
  ASC_PAYOUT_NO_SPINNER=1 no loading animation
  ASC_PAYOUT_NO_UPDATE_CHECK=1
                         never look for new releases
  NO_COLOR=1             no colors     DEBUG=1  more detail

https://github.com/erenacarboga/asc-payout
`;
