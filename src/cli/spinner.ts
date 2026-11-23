/**
 * The loading line shown on stderr while reports download:
 *
 *   ⠹  Trends · daily sales reports   ████████████████▌───────────   21/35   2.4s
 *
 * A spinner turning through a color gradient, the current step, a smooth gradient bar
 * with a moving shine when the step has a count (or megabytes, speed and time left for
 * a download), and the time so far. It redraws one line in place and erases it
 * when done, so only the results stay on screen. Off when stderr is not a terminal,
 * and with ASC_PAYOUT_NO_SPINNER=1.
 */

import { t } from "../i18n";
import { bold, dim, mb, smoothBar, spinnerFrame, visibleLength } from "./look";

const BAR = 28;

export interface Spinner {
  /** what is happening now */
  text(message: string): void;
  /** progress of the current step; unit "bytes" shows megabytes, speed and time left */
  progress(done: number, total: number, unit?: string): void;
  /** erase the line (results can be printed after this) */
  stop(): void;
}

const NOOP: Spinner = { text: () => {}, progress: () => {}, stop: () => {} };

/** The line on screen now, if any: cleared before other output so text never mixes with it. */
let active: { stream: NodeJS.WriteStream; render: () => void } | null = null;

/** Called before anything is printed: clears the loading line; it is drawn again below. */
export function clearLoadingLine(): void {
  if (active) active.stream.write("\r\x1b[2K");
}

/** Called after something was printed: draws the loading line again right away. */
export function redrawLoadingLine(): void {
  active?.render();
}

export function startSpinner(stream: NodeJS.WriteStream = process.stderr): Spinner {
  if (!stream.isTTY || process.env.ASC_PAYOUT_NO_SPINNER) return NOOP;
  const color = !process.env.NO_COLOR;

  const started = Date.now();
  let stepStarted = started;
  let message = t("Starting");
  let done = 0;
  let total = 0;
  let unit = "";
  let tick = 0;
  let stopped = false;

  const render = () => {
    if (stopped) return;
    const frame = spinnerFrame(tick, color);
    let tail = "";
    if (unit === "bytes") {
      const secs = (Date.now() - stepStarted) / 1000;
      const speed = secs > 0.5 ? done / secs : 0;
      const parts = [total > 0 ? `${mb(done)} / ${mb(total)} MB` : `${mb(done)} MB`];
      if (speed > 0) parts.push(`${mb(speed)} MB/s`);
      if (speed > 0 && total > done) parts.push(t("{s}s left", { s: Math.max(1, Math.round((total - done) / speed)) }));
      const percent = total > 0 ? `  ${bold(`${Math.floor((done / total) * 100)}%`.padStart(4), color)}` : "";
      tail = `${total > 0 ? `   ${smoothBar(done / total, BAR, tick, color)}${percent}` : ""}   ${parts.join(dim(" · ", color))}`;
    } else if (total > 0) {
      tail = `   ${smoothBar(done / total, BAR, tick, color)}   ${done}/${total}${unit ? ` ${unit}` : ""}`;
    }
    const seconds = dim(`${((Date.now() - started) / 1000).toFixed(1)}s`, color);
    const width = stream.columns || 80;
    // keep it on one line even in a narrow window
    let line = `  ${frame}  ${message}${tail}   ${seconds}`;
    if (visibleLength(line) > width - 1) {
      const count = !total ? "" : unit === "bytes" ? `  ${Math.floor((done / total) * 100)}%` : `  ${done}/${total}`;
      line = `  ${frame}  ${message.slice(0, Math.max(10, width - 30))}${count}`;
    }
    stream.write(`\r\x1b[2K${line}`);
    tick++;
  };

  stream.write("\x1b[?25l"); // hide the cursor while animating
  const timer = setInterval(render, 80);
  const self = { stream, render };
  active = self;
  render();

  const restore = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (active === self) active = null;
    stream.write("\r\x1b[2K\x1b[?25h");
  };
  process.once("exit", restore);

  return {
    text(m) {
      message = m;
      done = total = 0;
      unit = "";
      stepStarted = Date.now();
      render();
    },
    progress(d, t, u = "") {
      done = d;
      total = t;
      unit = u;
    },
    stop: restore,
  };
}

/**
 * Runs `work` with a loading line that appears only when it takes longer than `delayMs`,
 * so quick steps don't flash on screen. The line is gone when `work` ends.
 */
export async function withSpinner<T>(message: string, work: (spinner: Spinner) => Promise<T>, delayMs = 0): Promise<T> {
  let real: Spinner | null = null;
  let current = { message, done: 0, total: 0, unit: "" };
  const start = () => {
    real = startSpinner();
    real.text(current.message);
    if (current.total || current.unit) real.progress(current.done, current.total, current.unit);
  };
  const timer = delayMs > 0 ? setTimeout(start, delayMs) : null;
  if (!timer) start();
  const proxy: Spinner = {
    text(m) {
      current = { message: m, done: 0, total: 0, unit: "" };
      real?.text(m);
    },
    progress(d, total, u = "") {
      current = { ...current, done: d, total, unit: u };
      real?.progress(d, total, u);
    },
    stop() {
      if (timer) clearTimeout(timer);
      real?.stop();
    },
  };
  try {
    return await work(proxy);
  } finally {
    proxy.stop();
  }
}

