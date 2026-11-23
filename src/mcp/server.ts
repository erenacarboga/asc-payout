import { createInterface } from "node:readline";
import pkg from "../../package.json";
import { UsageError } from "../cli/args";
import { ui } from "../cli/ui";
import { accountFromEnv, loadSettings } from "../config/settings";

/**
 * A Model Context Protocol server over stdio (`asc-payout mcp`), so assistants such as
 * Claude Desktop, Claude Code, VS Code or Cursor can ask asc-payout directly. Each tool
 * runs the matching command with --json, so the numbers are exactly the ones the
 * terminal shows. Everything runs on this computer with the accounts set up here; API
 * keys never leave it, only the results do.
 *
 * Messages are JSON-RPC 2.0, one per line on stdin/stdout. stdout carries nothing else:
 * output of the commands is captured, and notes go to stderr.
 */

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `asc-payout answers App Store earnings questions from the user's own App Store Connect data.
- Months are Apple fiscal months named after the calendar month they mostly cover: "2026-10" is October 2026 = Sep 27 - Oct 31, 2026. Always state the period.
- reports.total is Apple's Financial Report: final, the basis of the payment; null until Apple publishes it (a few days after the month ends).
- trends.total adds up daily Sales reports: available during the month, with a forecast; differs from Reports by a few percent. Never add Reports and Trends.
- payment.amount is what Apple pays for the month: final when payment.basis is "reports", otherwise an estimate (say "about"). payment.date is the expected payment day.
- Amounts are proceeds after Apple's commission, before tax withholding and bank fees, converted at month-end rates into "currency".
- With several accounts, each has its own entry; the combined payment is the sum of payment.amount.
- Mention anything in "errors", trends.problems or rates.unconverted.
- Account setup is interactive: if no account is set up, ask the user to run "asc-payout setup" in a terminal.`;

const account = {
  type: "string",
  description: 'Account name (or a unique part of it), vendor number, or "all" (default: all accounts)',
};
const month = { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "Fiscal month as YYYY-MM, e.g. 2026-10 (default: the month that just closed)" };
const currency = { type: "string", pattern: "^[A-Za-z]{3}$", description: "Show amounts in this currency, e.g. USD, EUR, TRY (default: the user's setting)" };
const days = { type: "integer", minimum: 1, maximum: 365, description: "Days of events to look at (default 30)" };

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; additionalProperties: false };
  /** the asc-payout command line for the given arguments */
  argv?: (a: Record<string, unknown>) => string[];
}

const common = (a: Record<string, unknown>) => [
  "-a", String(a.account || "all"),
  ...(a.currency ? ["-c", String(a.currency)] : []),
  "--json",
];

export const TOOLS: Tool[] = [
  {
    name: "list_accounts",
    title: "Accounts",
    description: "The App Store Connect accounts set up in asc-payout (names and vendor numbers), the display currency, and whether Apple Ads is connected. Call this first when unsure which account the user means.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_month",
    title: "Earnings of a month",
    description:
      "What Apple pays for one fiscal month, per account: the payment (amount, expected date, final or estimate), the Financial Report total, Sales Trends with a forecast while the month runs, every app and product, countries, day-by-day sales, and why Reports and Trends differ. Use for 'how much will Apple pay me', 'what did I earn in October', 'which app earned most', 'this month so far'.",
    inputSchema: { type: "object", properties: { account, month, currency }, additionalProperties: false },
    argv: (a) => [...(a.month ? ["-m", String(a.month)] : []), ...common(a)],
  },
  {
    name: "get_history",
    title: "Months side by side",
    description: "Payments month by month (the last N months, or the twelve months of a calendar year), per account, each with the same fields as get_month. Use for trends over time, best and worst months, year totals.",
    inputSchema: {
      type: "object",
      properties: {
        account,
        months: { type: "integer", minimum: 1, maximum: 36, description: "How many months back (default 12)" },
        year: { type: "integer", minimum: 2008, maximum: 2100, description: "A calendar year instead of the last N months" },
        currency,
      },
      additionalProperties: false,
    },
    argv: (a) => ["history", ...(a.year ? ["--year", String(a.year)] : a.months ? ["--months", String(a.months)] : []), ...common(a)],
  },
  {
    name: "get_subscriptions",
    title: "Subscriptions",
    description: "Active subscriptions per app on the latest published day (paying, free trials, billing problems) with monthly recurring proceeds (MRR), and the last N days of events: trials started, trial-to-paid conversions, new subscriptions, renewals, cancellations, refunds.",
    inputSchema: { type: "object", properties: { account, days, currency }, additionalProperties: false },
    argv: (a) => ["subs", ...(a.days ? ["--days", String(a.days)] : []), ...common(a)],
  },
  {
    name: "get_refunds_and_cancellations",
    title: "Refunds and cancellations",
    description: "Over the last N days, per app: trials and how many became paid, cancellations (turned off renewal) and Apple's reasons, refunds and the refund rate, payment problems recovered or lost, and trial conversion week by week.",
    inputSchema: { type: "object", properties: { account, days, currency }, additionalProperties: false },
    argv: (a) => ["churn", ...(a.days ? ["--days", String(a.days)] : []), ...common(a)],
  },
  {
    name: "get_profit",
    title: "Profit after Apple Ads",
    description: "For one fiscal month, each app's revenue next to its Apple Ads spend over the same days: profit, ROAS (revenue / ad spend; revenue includes sales without an ad), installs and cost per install. Needs Apple Ads connected in asc-payout setup.",
    inputSchema: { type: "object", properties: { account, month, currency }, additionalProperties: false },
    argv: (a) => ["profit", ...(a.month ? ["-m", String(a.month)] : []), ...common(a)],
  },
];

type Json = Record<string, unknown>;
type Runner = (argv: string[]) => Promise<number>;

const textResult = (text: string, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

function listAccounts(): Json {
  const settings = loadSettings();
  const env = accountFromEnv();
  const accounts = env ? [env] : settings.accounts;
  return {
    accounts: accounts.map((a) => ({ name: a.name, vendor: a.vendor })),
    currency: process.env.ASC_PAYOUT_CURRENCY?.toUpperCase() || settings.currency,
    appleAdsConnected: !!settings.ads,
    ...(accounts.length === 0 ? { hint: "No account is set up. Ask the user to run `asc-payout setup` in a terminal." } : {}),
  };
}

/** Runs one tool. Commands run one at a time: output capture is process-wide. */
export async function callTool(name: string, args: Json, run: Runner): Promise<Json> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return textResult(`Unknown tool: ${name}`, true);
  if (!tool.argv) return textResult(JSON.stringify(listAccounts(), null, 1));

  const out: string[] = [];
  const notes: string[] = [];
  const { print, note, interactive } = ui;
  ui.print = (t) => void out.push(t);
  ui.note = (t) => void notes.push(t);
  ui.interactive = () => false;
  try {
    const code = await run(tool.argv(args));
    const body = out.join("\n").trim();
    if (!body) return textResult(notes.join("\n").trim() || `asc-payout exited with code ${code}`, true);
    return textResult(body);
  } catch (error) {
    const message = (error as Error).message;
    return textResult(error instanceof UsageError ? message : `asc-payout failed: ${message}`, true);
  } finally {
    Object.assign(ui, { print, note, interactive });
  }
}

/** Answers one JSON-RPC message; null for notifications. */
export async function handle(message: Json, run: Runner): Promise<Json | null> {
  const id = message.id;
  const method = String(message.method ?? "");
  const params = (message.params ?? {}) as Json;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  if (id === undefined || id === null) return null; // a notification

  switch (method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "asc-payout", title: "asc-payout", version: pkg.version },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: true } })),
      });
    case "tools/call":
      return reply(await callTool(String(params.name ?? ""), (params.arguments ?? {}) as Json, run));
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

/** `asc-payout mcp`: serves until stdin closes. */
export async function serveMcp(run: Runner): Promise<number> {
  // nothing on screen: no clearing, no loading animation, results in English
  process.env.ASC_PAYOUT_NO_CLEAR = "1";
  process.env.ASC_PAYOUT_NO_SPINNER = "1";
  process.env.ASC_PAYOUT_NO_UPDATE_CHECK = "1";
  process.env.ASC_PAYOUT_LANG = "en";
  const send = (m: Json) => process.stdout.write(JSON.stringify(m) + "\n");

  let queue = Promise.resolve();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message: Json;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    queue = queue.then(async () => {
      try {
        const answer = await handle(message, run);
        if (answer) send(answer);
      } catch (error) {
        send({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32603, message: (error as Error).message } });
      }
    });
  });
  await new Promise<void>((resolve) => lines.on("close", () => resolve()));
  await queue;
  return 0;
}
