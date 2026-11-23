/**
 * The loading line shown on stderr while reports download:
 *
 *   ⠹  Trends · daily sales reports   ━━━━━━━━━━━━━╸━━━━━━━━━━   21/35   2.4s
 *
 * An animated spinner in a moving color, the current step, a progress bar when the
 * step has a count, and the time so far. It redraws one line in place and erases it
 * when done, so only the results stay on screen. Off when stderr is not a terminal,
 * and with ASC_PAYOUT_NO_SPINNER=1.
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// a slow cycle through cyan, blue and magenta (256-color codes)
const HUES = [51, 45, 39, 33, 63, 99, 135, 171, 135, 99, 63, 33, 39, 45];
const BAR = 24;

export interface Spinner {
  /** what is happening now */
  text(message: string): void;
  /** progress of the current step */
  progress(done: number, total: number, unit?: string): void;
  /** erase the line (results can be printed after this) */
  stop(): void;
}

const NOOP: Spinner = { text: () => {}, progress: () => {}, stop: () => {} };

export function startSpinner(stream: NodeJS.WriteStream = process.stderr): Spinner {
  if (!stream.isTTY || process.env.ASC_PAYOUT_NO_SPINNER) return NOOP;
  const color = !process.env.NO_COLOR;
  const paint = (code: number, s: string) => (color ? `\x1b[38;5;${code}m${s}\x1b[39m` : s);
  const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s);

  const started = Date.now();
  let message = "Starting";
  let done = 0;
  let total = 0;
  let unit = "";
  let tick = 0;
  let stopped = false;

  const render = () => {
    if (stopped) return;
    const frame = paint(HUES[Math.floor(tick / 2) % HUES.length], FRAMES[tick % FRAMES.length]);
    let bar = "";
    if (total > 0) {
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
    if (visibleLength(line) > width - 1) line = `  ${frame}  ${message.slice(0, Math.max(10, width - 30))}${total ? `  ${done}/${total}` : ""}`;
    stream.write(`\r\x1b[2K${line}`);
    tick++;
  };

  stream.write("\x1b[?25l"); // hide the cursor while animating
  const timer = setInterval(render, 80);
  render();

  const restore = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stream.write("\r\x1b[2K\x1b[?25h");
  };
  process.once("exit", restore);

  return {
    text(m) {
      message = m;
      done = total = 0;
      unit = "";
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

function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").length;
}
