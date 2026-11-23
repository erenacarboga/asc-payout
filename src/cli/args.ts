export type Command = "report" | "setup" | "status" | "demo" | "help" | "version";

export interface Args {
  command: Command;
  account?: string;
  month?: string;
  currency?: string;
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
  help: "help",
  version: "version",
};

const VALUE_FLAGS: Record<string, "account" | "month" | "currency"> = {
  "--account": "account",
  "-a": "account",
  "--month": "month",
  "-m": "month",
  "--currency": "currency",
  "-c": "currency",
};

const SWITCHES: Record<string, (a: Args) => void> = {
  "--json": (a) => (a.json = true),
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
  const args: Args = { command: "report", json: false, noCache: false, noClear: false, refresh: false };
  let commandSet = false;

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const [flag, inline] = raw.startsWith("--") && raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, undefined];

    if (flag in VALUE_FLAGS) {
      const value = inline ?? argv[++i];
      if (value === undefined || (inline === undefined && value.startsWith("-"))) throw new UsageError(`${flag} needs a value`);
      args[VALUE_FLAGS[flag]] = value;
    } else if (flag in SWITCHES) {
      if (inline !== undefined) throw new UsageError(`${flag} does not take a value`);
      const before = args.command;
      SWITCHES[flag](args);
      // help and version win over other commands
      if (before === "help" || before === "version") args.command = before;
    } else if (!flag.startsWith("-") && !commandSet && flag in COMMANDS) {
      if (args.command !== "help" && args.command !== "version") args.command = COMMANDS[flag];
      commandSet = true;
    } else {
      throw new UsageError(`Unknown ${flag.startsWith("-") ? "option" : "command"}: ${raw}`);
    }
  }

  if (args.currency !== undefined) {
    args.currency = args.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(args.currency)) throw new UsageError(`--currency expects a 3-letter code like USD, EUR or TRY`);
  }
  return args;
}

export const HELP = `
asc-payout - what Apple will pay you, per Apple fiscal month

Usage
  asc-payout                       pick an account and a month
  asc-payout -a <account> -m <YYYY-MM>
  asc-payout setup                 add, edit or remove accounts
  asc-payout status                show accounts and where files are kept
  asc-payout demo                  try it with made-up data

Options
  -a, --account <name>   account name or vendor number, or "all"
  -m, --month <YYYY-MM>  fiscal month, named after the calendar month (2026-10 = October 2026)
  -c, --currency <CODE>  show amounts in this currency for this run (USD, EUR, TRY, ...)
      --json             print the result as JSON (progress goes to stderr)
      --no-cache         download the reports again
      --no-clear         don't clear the screen first (or ASC_PAYOUT_NO_CLEAR=1)
      --refresh          reload app names from App Store Connect
  -h, --help             this help
  -v, --version          version

Environment
  ASC_PAYOUT_VENDOR, ASC_PAYOUT_ISSUER_ID, ASC_PAYOUT_KEY_ID, ASC_PAYOUT_KEY_FILE
                         use this account instead of the configured ones
  ASC_PAYOUT_CURRENCY    default display currency
  ASC_PAYOUT_CONFIG_DIR, ASC_PAYOUT_CACHE_DIR
                         where settings and downloaded reports are kept
  NO_COLOR=1             no colors     DEBUG=1  more detail

https://github.com/erenacarboga/asc-payout
`;
