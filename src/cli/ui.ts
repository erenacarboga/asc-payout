import { emitKeypressEvents } from "node:readline";
import { ask, pick, yesNo, type AskConfig, type Back, type MenuConfig, type Quit } from "./prompts";
import { clearLoadingLine, redrawLoadingLine } from "./spinner";

/**
 * Everything that talks to the person at the terminal goes through here, so tests can
 * answer the questions and read the output without a real terminal.
 */
export const ui = {
  /** a menu; resolves to the chosen value, BACK (Esc / "← Back") or QUIT (q, where allowed) */
  pick: pick as <T>(config: MenuConfig<T>) => Promise<T | Back | Quit>,
  /** a line of text; resolves to the text or BACK (Esc) */
  ask: ask as (config: AskConfig) => Promise<string | Back>,
  yesNo: yesNo as (message: string, yes?: boolean) => Promise<boolean>,
  /** A person is at the terminal: prompts are possible and output goes to a screen. */
  interactive: (): boolean => !!process.stdin.isTTY && !!process.stdout.isTTY,
  /** Results (stdout) */
  print: (text: string): void => {
    clearLoadingLine();
    process.stdout.write(text.endsWith("\n") ? text : text + "\n");
    redrawLoadingLine();
  },
  /** Progress and problems (stderr) */
  note: (text: string): void => {
    clearLoadingLine();
    process.stderr.write(text.endsWith("\n") ? text : text + "\n");
    redrawLoadingLine();
  },
  /** Clean screen (screen and scrollback), like clear / cls. Only on a terminal. */
  clear: (): void => {
    if (process.stdout.isTTY && !process.env.ASC_PAYOUT_NO_CLEAR) process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  },
  /** Waits for one key press: "left", "right", "up", "down", "q", "c", "escape", "return", ... (Ctrl+C gives "q"). */
  // stdin stays flowing in raw mode between keys: pausing and resuming it loses the
  // next key press on Windows. main.ts puts the terminal back on exit.
  key: (): Promise<string> =>
    new Promise((resolve) => {
      const stdin = process.stdin;
      emitKeypressEvents(stdin);
      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.once("keypress", (text: string | undefined, key: { name?: string; ctrl?: boolean } | undefined) => {
        if (key?.ctrl && key.name === "c") return resolve("q");
        resolve(key?.name ?? text ?? "");
      });
    }),
};
