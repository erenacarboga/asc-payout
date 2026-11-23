/**
 * Terminal drawing for the loading lines: a color gradient, a smooth progress bar with
 * a moving shine, and a small speed graph. Truecolor where the terminal has it, 256
 * colors otherwise, plain characters with NO_COLOR.
 */

export type Rgb = [number, number, number];

/** cyan -> blue -> violet -> pink */
const STOPS: Rgb[] = [
  [34, 211, 238],
  [59, 130, 246],
  [139, 92, 246],
  [236, 72, 153],
];

export function colorOn(stream: NodeJS.WriteStream = process.stderr): boolean {
  return !!stream.isTTY && !process.env.NO_COLOR;
}

/** Terminals that show 24-bit color (most do now; Windows 10+ consoles too). */
export function truecolor(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): boolean {
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? "")) return true;
  if (env.WT_SESSION || env.TERM_PROGRAM === "vscode" || env.TERM_PROGRAM === "iTerm.app" || env.TERM_PROGRAM === "WezTerm") return true;
  if (platform === "win32") return true;
  return false;
}

/** The gradient at x in 0..1. */
export function gradient(x: number): Rgb {
  const p = Math.min(1, Math.max(0, x)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(p));
  const f = p - i;
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as Rgb;
}

/** Mixes a color toward white by `amount` (0..1). */
export function lighten([r, g, b]: Rgb, amount: number): Rgb {
  return [r, g, b].map((v) => Math.round(v + (255 - v) * amount)) as Rgb;
}

function to256([r, g, b]: Rgb): number {
  const c = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * c(r) + 6 * c(g) + c(b);
}

/** Paints text in a color (truecolor, or the nearest of 256). */
export function fg(rgb: Rgb, text: string, color = true): string {
  if (!color) return text;
  return truecolor() ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[39m` : `\x1b[38;5;${to256(rgb)}m${text}\x1b[39m`;
}

export const dim = (s: string, color = true) => (color ? `\x1b[2m${s}\x1b[22m` : s);
export const bold = (s: string, color = true) => (color ? `\x1b[1m${s}\x1b[22m` : s);

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/**
 * A progress bar `width` cells wide, filled to `fraction` in eighths of a cell, colored
 * along the gradient, with a bright shine that sweeps across the filled part as `tick`
 * advances.
 */
export function smoothBar(fraction: number, width: number, tick: number, color = true): string {
  const f = Math.min(1, Math.max(0, fraction));
  const eighths = Math.round(f * width * 8);
  const full = Math.floor(eighths / 8);
  const part = EIGHTHS[eighths % 8];
  if (!color) return "█".repeat(full) + part + "░".repeat(width - full - (part ? 1 : 0));
  const shine = (tick % (width + 12)) - 6; // travels across, then pauses off the edge
  let out = "";
  for (let i = 0; i < full + (part ? 1 : 0); i++) {
    const glow = Math.max(0, 1 - Math.abs(i - shine) / 3.5) * 0.65;
    out += fg(lighten(gradient(i / Math.max(1, width - 1)), glow), i < full ? "█" : part);
  }
  const empty = width - full - (part ? 1 : 0);
  return out + dim("─".repeat(Math.max(0, empty)));
}

/** The spinner frame at `tick`, painted along the gradient as it turns. */
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function spinnerFrame(tick: number, color = true): string {
  const wave = (Math.sin(tick / 6) + 1) / 2;
  return fg(gradient(wave), FRAMES[tick % FRAMES.length], color);
}

const SPARKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** A small graph of recent values, scaled to the largest. */
export function sparkline(values: number[], color = true): string {
  const max = Math.max(...values, 0);
  if (max <= 0) return "";
  return values.map((v, i) => fg(gradient(i / Math.max(1, values.length - 1)), SPARKS[Math.min(7, Math.round((v / max) * 7))], color)).join("");
}

/** Text with a band of light passing over it at position `at` (in characters). */
export function shineText(text: string, at: number, base: Rgb, color = true): string {
  if (!color) return text;
  return [...text].map((ch, i) => fg(lighten(base, Math.max(0, 1 - Math.abs(i - at) / 3) * 0.85), ch)).join("");
}

/** Length on screen, without color codes. */
export function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return [...s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")].length;
}

/** Pads to a visible width (color codes don't count). */
export function padVisible(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visibleLength(s)));
}

export const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
