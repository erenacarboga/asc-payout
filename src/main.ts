#!/usr/bin/env bun
import { UsageError } from "./cli/args";
import { run } from "./cli/run";

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    if ((error as Error).name === "ExitPromptError") process.exit(130);
    const usage = error instanceof UsageError;
    process.stderr.write(`\n  ${usage ? "" : "Error: "}${(error as Error).message}\n${usage ? "  See: asc-payout --help\n" : ""}\n`);
    if (process.env.DEBUG && !usage) console.error(error);
    process.exit(usage ? 2 : 1);
  },
);
