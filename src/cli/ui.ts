import { confirm, input, select } from "@inquirer/prompts";
import { emitKeypressEvents } from "node:readline";

/**
 * Everything that talks to the person at the terminal goes through here, so tests can
 * answer the questions and read the output without a real terminal.
 */
export const ui = {
  select: select as <T>(config: {
    message: string;
    choices: { name: string; value: T }[];
    default?: T;
    pageSize?: number;
  }) => Promise<T>,
  input: input as (config: { message: string; default?: string; validate?: (value: string) => boolean | string }) => Promise<string>,
  confirm: confirm as (config: { message: string; default?: boolean }) => Promise<boolean>,
  /** A person is at the terminal: prompts are possible and output goes to a screen. */
  interactive: (): boolean => !!process.stdin.isTTY && !!process.stdout.isTTY,
  /** Results (stdout) */
  print: (text: string): void => {
    process.stdout.write(text.endsWith("\n") ? text : text + "\n");
  },
  /** Waits for one key press: "left", "right", "up", "down", "q", "c", ... (Ctrl+C and Esc give "q"). */
  key: (): Promise<string> =>
    new Promise((resolve) => {
      const stdin = process.stdin;
      emitKeypressEvents(stdin);
      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.once("keypress", (text: string | undefined, key: { name?: string; ctrl?: boolean } | undefined) => {
        stdin.setRawMode?.(false);
        stdin.pause();
        if (key?.ctrl && key.name === "c") return resolve("q");
        if (key?.name === "escape") return resolve("q");
        resolve(key?.name ?? text ?? "");
      });
    }),
  /** Progress and problems (stderr) */
  note: (text: string): void => {
    process.stderr.write(text.endsWith("\n") ? text : text + "\n");
  },
};
