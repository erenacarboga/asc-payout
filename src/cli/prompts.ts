import {
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isTabKey,
  isUpKey,
  useEffect,
  useKeypress,
  useState,
  type KeypressEvent,
} from "@inquirer/core";
import { t } from "../i18n";

/**
 * The tool's own prompts, so every screen behaves the same:
 *   ↑ ↓ (or k j) move, Enter picks, Esc goes back, a shortcut letter picks directly,
 *   q quits from menus that allow it.
 */

/** Returned when the person goes back (Esc or "← Back"). */
export const BACK: unique symbol = Symbol("back");
/** Returned when the person quits (q on a menu that allows it). */
export const QUIT: unique symbol = Symbol("quit");
export type Back = typeof BACK;
export type Quit = typeof QUIT;

const color = !process.env.NO_COLOR;
const paint = (open: string, close: string) => (s: string) => (color ? `\x1b[${open}m${s}\x1b[${close}m` : s);
const bold = paint("1", "22");
const dim = paint("2", "22");
const cyan = paint("36", "39");
const red = paint("31", "39");
const green = paint("32", "39");

export interface MenuItem<T> {
  label: string;
  value: T;
  /** grey text after the label */
  hint?: string;
  /** a letter that picks this item directly */
  key?: string;
  /** shown but not selectable, with the reason */
  disabled?: string;
}
export type MenuEntry<T> = MenuItem<T> | { separator: string };

export interface MenuConfig<T> {
  message: string;
  items: MenuEntry<T>[];
  /** index (among all entries) of the item to start on */
  start?: number;
  /** Esc and a "← Back" entry go back (default true) */
  back?: boolean;
  /** q quits (default false) */
  quit?: boolean;
  pageSize?: number;
}

const isItem = <T,>(e: MenuEntry<T>): e is MenuItem<T> => !("separator" in e);
const selectable = <T,>(e: MenuEntry<T> | undefined): boolean => !!e && isItem(e) && !e.disabled;
const isEscape = (key: KeypressEvent) => key.name === "escape";

export const menu = createPrompt(<T,>(config: MenuConfig<T>, done: (value: T | Back | Quit) => void): string => {
  const back = config.back !== false;
  const entries: MenuEntry<T | Back>[] = back
    ? [...config.items, { separator: "" }, { label: t("← Back"), value: BACK, key: "b" }]
    : config.items;
  const first = entries.findIndex((e) => selectable(e));
  const start = config.start !== undefined && selectable(entries[config.start]) ? config.start : first;
  const [active, setActive] = useState(start);
  const [status, setStatus] = useState<"idle" | "done">("idle");
  const [quitting, setQuitting] = useState(false);

  const move = (step: number) => {
    let i = active;
    for (let n = 0; n < entries.length; n++) {
      i = (i + step + entries.length) % entries.length;
      if (selectable(entries[i])) return setActive(i);
    }
  };
  const finish = (value: T | Back | Quit, index = active) => {
    setActive(index);
    setStatus("done");
    done(value);
  };

  useKeypress((key) => {
    if (status === "done") return;
    if (isEnterKey(key)) {
      const e = entries[active];
      if (e && isItem(e) && !e.disabled) finish(e.value);
    } else if (isUpKey(key)) move(-1);
    else if (isDownKey(key)) move(1);
    else if (back && isEscape(key)) finish(BACK, entries.length - 1);
    else if (config.quit && key.name === "q") {
      setQuitting(true);
      setStatus("done");
      done(QUIT);
    }
    else if (key.name && key.name.length === 1) {
      const i = entries.findIndex((e) => isItem(e) && !e.disabled && e.key === key.name);
      if (i >= 0) finish((entries[i] as MenuItem<T | Back>).value, i);
    } else if (key.name === "home") setActive(first);
    else if (key.name === "end") {
      for (let i = entries.length - 1; i >= 0; i--) if (selectable(entries[i])) return setActive(i);
    }
  });

  const chosen = entries[active];
  if (status === "done") {
    if (!chosen || !isItem(chosen) || chosen.value === BACK || quitting) return "";
    return `${green("✔")} ${bold(config.message)} ${cyan(chosen.label)}`;
  }

  const labelWidth = Math.min(40, Math.max(...entries.filter(isItem).map((e) => e.label.length)) + 2);
  const lines = entries.map((e, i) => {
    if (!isItem(e)) return e.separator ? `  ${dim(`── ${e.separator} ──`)}` : "";
    const pointer = i === active ? cyan("❯") : " ";
    const shortcut = e.key && e.value !== BACK ? dim(`${e.key} `) : "  ";
    const label = e.disabled ? dim(e.label) : i === active ? bold(cyan(e.label)) : e.label;
    const hint = e.disabled ? dim(e.disabled) : e.hint ? dim(e.hint) : "";
    return `${pointer} ${shortcut}${label}${hint ? " ".repeat(Math.max(2, labelWidth - e.label.length)) + hint : ""}`;
  });

  // Keep long lists to a window around the cursor
  const size = config.pageSize ?? 14;
  let view = lines;
  if (lines.length > size) {
    const top = Math.min(Math.max(0, active - Math.floor(size / 2)), lines.length - size);
    view = lines.slice(top, top + size);
    if (top > 0) view[0] = dim(`  ${t("↑ more")}`);
    if (top + size < lines.length) view[view.length - 1] = dim(`  ${t("↓ more")}`);
  }

  const help = [t("↑↓ move"), t("enter select"), back ? t("esc back") : "", config.quit ? t("q quit") : ""].filter(Boolean).join(" · ");
  return `${cyan("?")} ${bold(config.message)}\n${view.join("\n")}\n${dim(`  ${help}`)}`;
});

export interface AskConfig {
  message: string;
  /** shown in grey; Enter on an empty line takes it, Tab puts it in the line */
  default?: string;
  /** put this text in the line, ready to edit */
  prefill?: string;
  validate?: (value: string) => boolean | string;
  /** grey line under the prompt */
  hint?: string;
  /** Esc goes back (default true) */
  back?: boolean;
}

export const ask = createPrompt((config: AskConfig, done: (value: string | Back) => void): string | [string, string] => {
  const back = config.back !== false;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<"idle" | "done" | "back">("idle");
  const [fallback, setFallback] = useState(config.default ?? "");

  useEffect((rl) => {
    if (config.prefill) {
      rl.write(config.prefill);
      setValue(config.prefill);
    }
  }, []);

  useKeypress((key, rl) => {
    if (status !== "idle") return;
    if (back && isEscape(key)) {
      setStatus("back");
      done(BACK);
    } else if (isEnterKey(key)) {
      const answer = (value || fallback).trim();
      const ok = config.validate ? config.validate(answer) : true;
      if (ok === true) {
        setValue(answer);
        setStatus("done");
        done(answer);
      } else {
        rl.write(value); // keep what was typed
        setError(ok || t("Not valid"));
      }
    } else if (isTabKey(key) && !value && fallback) {
      rl.clearLine(0);
      rl.write(fallback);
      setValue(fallback);
    } else if (isBackspaceKey(key) && !value) {
      setFallback("");
    } else {
      setValue(rl.line);
      setError(undefined);
    }
  });

  if (status === "back") return "";
  if (status === "done") return `${green("✔")} ${bold(config.message)} ${cyan(value)}`;
  const shown = value || (fallback ? dim(fallback) : "");
  const below = [error ? red(`  ${error}`) : config.hint ? dim(`  ${config.hint}`) : "", dim(`  ${[t("enter confirm"), fallback ? t("tab fill") : "", back ? t("esc back") : ""].filter(Boolean).join(" · ")}`)];
  return [`${cyan("?")} ${bold(config.message)} ${shown}`, below.filter(Boolean).join("\n")] as [string, string];
});

/** Yes/No as a two-line menu (y / n pick directly). */
export async function yesNo(message: string, yes = true): Promise<boolean> {
  const answer = await menu({
    message,
    back: false,
    items: [
      { label: t("Yes"), value: true, key: "y" },
      { label: t("No"), value: false, key: "n" },
    ],
    start: yes ? 0 : 1,
  });
  return answer === true;
}

/** Typed wrapper around `menu`. */
export function pick<T>(config: MenuConfig<T>): Promise<T | Back | Quit> {
  return menu(config as MenuConfig<unknown>) as Promise<T | Back | Quit>;
}
