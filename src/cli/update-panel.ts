import { t } from "../i18n";
import { bold, dim, fg, gradient, mb, padVisible, shineText, smoothBar, sparkline, spinnerFrame, visibleLength, type Rgb } from "./look";

/**
 * The update, drawn as a small live panel on stderr:
 *
 *   ╭─ asc-payout ──────────────────────────────────────────────╮
 *   │                                                            │
 *   │   1.7.2  →  1.7.3                                          │
 *   │                                                            │
 *   │   ✔  Release found                                         │
 *   │   ⠹  Downloading                                      48%  │
 *   │      ███████████████████▊──────────────────────────        │
 *   │      53.1 / 110.2 MB  ·  9.4 MB/s ▂▃▅▇▆▇  ·  6s left       │
 *   │   ○  Checking the download (SHA-256)                       │
 *   │   ○  Installing                                            │
 *   │                                                            │
 *   ╰──────────────────────────────────────────────────── 3.2s ─╯
 *
 * then a short finish line with light passing over it. Only on a terminal; the caller
 * prints plain lines otherwise.
 */

export interface UpdatePanel {
  /** start step `index`; the steps before it are done */
  step(index: number): void;
  bytes(done: number, total: number): void;
  /** mark the current step as failed and leave the panel on screen */
  fail(): void;
  /** clear the panel and show the finish line */
  finish(): Promise<void>;
}

const GREEN: Rgb = [52, 211, 153];
const RED: Rgb = [248, 113, 113];

export function startUpdatePanel(from: string, to: string, stream: NodeJS.WriteStream = process.stderr): UpdatePanel | null {
  if (!stream.isTTY || process.env.ASC_PAYOUT_NO_SPINNER) return null;
  const color = !process.env.NO_COLOR;
  // each step as it runs, and once it is done
  const steps = [t("Release found"), t("Downloading"), t("Checking the download (SHA-256)"), t("Installing")];
  const finished = [t("Release found"), t("Downloaded"), t("Checked (SHA-256)"), t("Installed")];
  const started = Date.now();
  let current = 1;
  let failed = false;
  let done = 0;
  let total = 0;
  let downloadStarted = 0;
  let downloadEnded = 0;
  let tick = 0;
  let drawn = 0;
  let stopped = false;
  const speeds: number[] = [];
  let lastSample = { at: Date.now(), bytes: 0 };

  const width = () => Math.max(46, Math.min((stream.columns || 80) - 4, 68));

  function lines(): string[] {
    const W = width(); // inner width
    const row = (text: string, i: number, rows: number) => {
      const side = fg(gradient(i / Math.max(1, rows - 1)), "│", color);
      const fitted = visibleLength(text) > W ? text : padVisible(text, W);
      return `  ${side}${fitted}${side}`;
    };
    const body: string[] = [""];
    body.push(`   ${dim(from, color)}  ${fg(gradient(0.5), "→", color)}  ${bold(fg(gradient(0.15), to, color), color)}`);
    body.push("");
    steps.forEach((name, i) => {
      let mark: string;
      if (i < current) mark = fg(GREEN, "✔", color);
      else if (i === current) mark = failed ? fg(RED, "✗", color) : spinnerFrame(tick, color);
      else mark = dim("○", color);
      const label = i < current ? finished[i] : i === current ? name : dim(name, color);
      if (i === 1 && total > 0) {
        // stays after the download, full, so the panel keeps its height
        const percent = bold(`${Math.floor((done / total) * 100)}%`, color);
        body.push(padVisible(`   ${mark}  ${label}`, W - visibleLength(percent) - 3) + percent);
        body.push(`      ${smoothBar(done / total, W - 9, tick, color)}`);
        if (done >= total && !downloadEnded) downloadEnded = Date.now();
        const secs = ((downloadEnded || Date.now()) - downloadStarted) / 1000;
        const speed = secs > 0.5 ? done / secs : 0;
        const parts = [`${mb(done)} / ${mb(total)} MB`];
        if (speed > 0) parts.push(`${mb(speed)} MB/s${speeds.length >= 3 ? ` ${sparkline(speeds.slice(-14), color)}` : ""}`);
        if (speed > 0 && total > done) parts.push(t("{s}s left", { s: Math.max(1, Math.round((total - done) / speed)) }));
        body.push(`      ${parts.join(dim("  ·  ", color))}`);
      } else {
        body.push(`   ${mark}  ${label}`);
      }
    });
    body.push("");
    const rows = body.length + 2;
    const top = (() => {
      const title = ` ${bold("asc-payout", color)} `;
      const rest = W - 1 - visibleLength(title);
      let s = fg(gradient(0), "╭─", color) + title;
      for (let i = 0; i < rest; i++) s += fg(gradient((i + 12) / (W + 12)), "─", color);
      return `  ${s}${fg(gradient(1), "╮", color)}`;
    })();
    const bottom = (() => {
      const time = ` ${dim(`${((Date.now() - started) / 1000).toFixed(1)}s`, color)} `;
      const rest = W - 1 - visibleLength(time);
      let s = fg(gradient(0), "╰", color);
      for (let i = 0; i < rest; i++) s += fg(gradient(i / W), "─", color);
      return `  ${s}${time}${fg(gradient(1), "─╯", color)}`;
    })();
    return [top, ...body.map((b, i) => row(b, i + 1, rows)), bottom];
  }

  // "\x1b[0A" still moves one line up in many terminals, so a zero move is left out
  const up = (n: number) => (n > 0 ? `\x1b[${n}A` : "");

  function draw(next: string[]) {
    let out = drawn > 0 ? `\r${up(drawn - 1)}` : "";
    out += next.map((l) => `\x1b[2K${l}`).join("\n");
    // a shorter frame clears what is left of the previous one
    const extra = drawn - next.length;
    if (extra > 0) out += "\n\x1b[2K".repeat(extra) + up(extra);
    stream.write(out);
    drawn = next.length;
  }

  function erase() {
    if (drawn === 0) return;
    stream.write(`\r${up(drawn - 1)}` + Array.from({ length: drawn }, () => "\x1b[2K").join("\n") + `\r${up(drawn - 1)}`);
    drawn = 0;
  }

  const render = () => {
    if (stopped) return;
    const now = Date.now();
    if (current === 1 && total > 0 && done < total && now - lastSample.at >= 250) {
      speeds.push(((done - lastSample.bytes) / (now - lastSample.at)) * 1000);
      lastSample = { at: now, bytes: done };
    }
    draw(lines());
    tick++;
  };

  const restore = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stream.write("\x1b[?25h");
  };
  process.once("exit", restore);
  stream.write("\x1b[?25l");
  const timer = setInterval(render, 70);
  render();

  return {
    step(index) {
      current = index;
      render();
    },
    bytes(d, tl) {
      if (!downloadStarted) {
        downloadStarted = Date.now();
        lastSample = { at: downloadStarted, bytes: 0 };
      }
      done = d;
      total = tl;
    },
    fail() {
      failed = true;
      render();
      restore();
      stream.write("\n");
    },
    async finish() {
      current = steps.length;
      render();
      clearInterval(timer);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      await new Promise((r) => setTimeout(r, 250));
      erase();
      const headline = t("asc-payout {version} is ready", { version: to });
      const details = dim(`      ${from} → ${to}  ·  ${t("{size} MB in {seconds}s", { size: mb(total), seconds })}  ·  ${t("checksum verified")}`, color);
      // light passes over the headline once, then it settles
      const frames = color ? headline.length + 8 : 0;
      for (let i = 0; i <= frames; i++) {
        stream.write(`\r\x1b[2K  ${fg(GREEN, "✔", color)}  ${bold(shineText(headline, i - 4, GREEN, color), color)}`);
        await new Promise((r) => setTimeout(r, 28));
      }
      stream.write(`\r\x1b[2K  ${fg(GREEN, "✔", color)}  ${bold(fg(GREEN, headline, color), color)}\n${details}\n\n`);
      await new Promise((r) => setTimeout(r, 900));
      restore();
    },
  };
}
