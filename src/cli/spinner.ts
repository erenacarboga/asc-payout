/**
 * The loading line shown on stderr while reports download:
 *
 *   ⠹  Trends · daily sales reports   ━━━━━━━━━━━━━╸━━━━━━━━━━   21/35   2.4s
 *   ⠼  Downloading asc-payout 1.7.2   ━━━━━━━━╸━━━━━━━━━━━━━━━   38.2 / 110.4 MB · 9.1 MB/s · 8s left   4.2s
 *
 * An animated spinner in a moving color, the current step, a progress bar when the
 * step has a count, and the time so far. It redraws one line in place and erases it
 * when done, so only the results stay on screen. Off when stderr is not a terminal,
 * and with ASC_PAYOUT_NO_SPINNER=1.
 */

import { t } from "../i18n";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// a slow cycle through cyan, blue and magenta (256-color codes)
const HUES = [51, 45, 39, 33, 63, 99, 135, 171, 135, 99, 63, 33, 39, 45];
const BAR = 24;

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
  const paint = (code: number, s: string) => (color ? `\x1b[38;5;${code}m${s}\x1b[39m` : s);
  const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s);

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
    const frame = paint(HUES[Math.floor(tick / 2) % HUES.length], FRAMES[tick % FRAMES.length]);
    let bar = "";
    if (unit === "bytes") {
      const mb = (n: number) => (n / 1048576).toFixed(1);
      const secs = (Date.now() - stepStarted) / 1000;
      const speed = secs > 0.5 ? done / secs : 0;
      const parts = [total > 0 ? `${mb(done)} / ${mb(total)} MB` : `${mb(done)} MB`];
      if (speed > 0) parts.push(`${mb(speed)} MB/s`);
      if (speed > 0 && total > done) parts.push(t("{s}s left", { s: Math.max(1, Math.round((total - done) / speed)) }));
      const filled = total > 0 ? Math.min(BAR, (done / total) * BAR) : 0;
      const whole = Math.floor(filled);
      const head = total > 0 && whole < BAR ? (filled - whole >= 0.5 ? "╸" : "") : "";
      const rest = BAR - whole - (head ? 1 : 0);
      bar = `${total > 0 ? `   ${paint(HUES[(Math.floor(tick / 2) + 4) % HUES.length], "━".repeat(whole) + head)}${dim("━".repeat(Math.max(0, rest)))}` : ""}   ${parts.join(dim(" · "))}`;
    } else if (total > 0) {
      const filled = Math.min(BAR, (done / total) * BAR);
      const whole = Math.floor(filled);
      const head = whole < BAR ? (filled - whole >= 0.5 ? "╸" : "") : "";
      const rest = BAR - whole - (head ? 1 : 0);
      bar = `   ${paint(HUES[(Math.floor(tick / 2) + 4) % HUES.length], "━".repeat(whole) + head)}${dim("━".repeat(Math.max(0, rest)))}   ${done}/${total}${unit ? ` ${unit}` : ""}`;
    }
    const seconds = dim(`${((Date.now() - started) / 1000).toFixed(1)}s`);
    const width = stream.columns || 80;
    // keep it on one line even in a narrow window
    let line = `  ${frame}  ${message}${bar}   ${seconds}`;
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

function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").length;
}
