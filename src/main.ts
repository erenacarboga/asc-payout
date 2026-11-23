#!/usr/bin/env bun
import { UsageError } from "./cli/args";
import { run } from "./cli/run";
import { t } from "./i18n";

/** Leave the terminal as we found it: normal input mode, cursor visible. */
function restoreTerminal(): void {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
  } catch {
    // not a terminal any more
  }
  if (process.stderr.isTTY) process.stderr.write("\x1b[?25h");
}

const exit = (code: number) => {
  restoreTerminal();
  process.exit(code);
};

run(process.argv.slice(2)).then(exit, (error) => {
  if ((error as Error).name === "ExitPromptError") return exit(130);
  const usage = error instanceof UsageError;
  const message = (error as Error).message;
  process.stderr.write(`\n  ${usage ? message : t("Error: {message}", { message })}\n${usage ? `  ${t("See: asc-payout --help")}\n` : ""}\n`);
  if (process.env.DEBUG && !usage) console.error(error);
  exit(usage ? 2 : 1);
});
