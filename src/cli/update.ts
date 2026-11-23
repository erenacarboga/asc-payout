import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readJson, writeFileAtomic } from "../config/files";
import { cacheDir } from "../config/paths";
import { t } from "../i18n";
import { startSpinner, withSpinner, type Spinner } from "./spinner";
import { ui } from "./ui";

export const REPO = "erenacarboga/asc-payout";
const green = (s: string) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[32m${s}\x1b[39m` : s);
/** A check younger than this is reused, so a run started again right away doesn't ask GitHub again. */
const CHECK_EVERY_MS = 15 * 60 * 1000;

/** -1, 0 or 1, comparing "1.2.0" style versions (a leading "v" is ignored). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

/** Release asset for this computer, e.g. asc-payout-darwin-arm64. */
export function assetName(platform: string = process.platform, arch: string = process.arch, musl = isMusl()): string | null {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : null;
  const cpu = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
  if (!os || !cpu) return null;
  if (os === "windows") return `asc-payout-windows-${cpu}.exe`; // x64 and arm64 builds exist
  return `asc-payout-${os}-${cpu}${os === "linux" && musl ? "-musl" : ""}`;
}

function isMusl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return existsSync("/etc/alpine-release") || readFileSync("/proc/self/maps", "utf-8").includes("musl");
  } catch {
    return false;
  }
}

/** True when running the compiled program (not `bun run src/main.ts`). */
export const isCompiled = (): boolean => basename(process.execPath).toLowerCase().startsWith("asc-payout");

function gh(args: string[]): { ok: boolean; out: string } {
  try {
    const r = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
    return { ok: r.exitCode === 0, out: r.stdout.toString().trim() };
  } catch {
    return { ok: false, out: "" };
  }
}

/** Latest release tag: GitHub's API first (public repository), then the GitHub CLI. */
export async function latestVersion(timeoutMs = 10_000, allowGh = true): Promise<string | null> {
  if (process.env.ASC_PAYOUT_NO_UPDATE_CHECK) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "asc-payout" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) return ((await r.json()) as { tag_name?: string }).tag_name ?? null;
  } catch {
    // offline or blocked
  }
  if (!allowGh) return null;
  const view = gh(["release", "view", "-R", REPO, "--json", "tagName", "-q", ".tagName"]);
  return view.ok && view.out ? view.out : null;
}

/** Gives up when no data has arrived for this long (a slow connection is fine). */
const STALL_MS = 30_000;

/** Downloads one file, reporting bytes as they arrive. */
async function fetchFile(url: string, path: string, onBytes?: (done: number, total: number) => void): Promise<void> {
  const abort = new AbortController();
  let stall = setTimeout(() => abort.abort(), STALL_MS);
  const alive = () => {
    clearTimeout(stall);
    stall = setTimeout(() => abort.abort(), STALL_MS);
  };
  try {
    const r = await fetch(url, { signal: abort.signal });
    if (!r.ok || !r.body) throw new Error(`${r.status}`);
    const total = Number(r.headers.get("content-length")) || 0;
    const chunks: Uint8Array[] = [];
    let done = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      alive();
      chunks.push(value);
      done += value.length;
      onBytes?.(done, total);
    }
    if (total && done !== total) throw new Error("incomplete download");
    writeFileSync(path, Buffer.concat(chunks));
  } finally {
    clearTimeout(stall);
  }
}

async function download(tag: string, asset: string, dir: string, spinner: Spinner): Promise<void> {
  const base = `https://github.com/${REPO}/releases/download/${tag}`;
  try {
    await fetchFile(`${base}/SHA256SUMS`, join(dir, "SHA256SUMS"));
    await fetchFile(`${base}/${asset}`, join(dir, asset), (done, total) => spinner.progress(done, total, "bytes"));
    return;
  } catch {
    // blocked (a proxy, for example): try the GitHub CLI if it is installed
  }
  spinner.text(t("Downloading with the GitHub CLI"));
  const args = ["release", "download", tag, "-R", REPO, "-D", dir, "--clobber", "-p", asset, "-p", "SHA256SUMS"];
  if (!gh(args).ok) throw new Error(t("Download failed. Check your internet connection and try again."));
}

export async function runUpdate(current: string): Promise<number> {
  if (!isCompiled()) {
    ui.print(`  ${t("Running from source: update with git pull.")}`);
    return 0;
  }
  const latest = await withSpinner(t("Looking for the latest version"), () => latestVersion());
  if (!latest) throw new Error(t("Could not find the latest release. Check your internet connection and try again."));
  if (compareVersions(latest, current) <= 0) {
    ui.print(`  ${t("asc-payout {version} is up to date.", { version: current })}`);
    return 0;
  }
  const asset = assetName();
  if (!asset) throw new Error(t("No release build for {platform} {arch}.", { platform: process.platform, arch: process.arch }));

  const to = latest.replace(/^v/, "");
  const dir = mkdtempSync(join(tmpdir(), "asc-payout-update-"));
  const spinner = startSpinner();
  // without a terminal (scripts, logs) a plain line says what is going on
  if (!process.stderr.isTTY) ui.print(`  ${t("Updating {from} -> {to}...", { from: current, to })}`);
  try {
    spinner.text(t("Downloading asc-payout {version}", { version: to }));
    await download(latest, asset, dir, spinner);
    spinner.text(t("Checking the download"));
    const sums = readFileSync(join(dir, "SHA256SUMS"), "utf-8");
    const want = sums.split("\n").map((l) => l.trim().split(/\s+\*?/)).find((p) => p[1] === asset)?.[0];
    const have = createHash("sha256").update(readFileSync(join(dir, asset))).digest("hex");
    if (!want || want.toLowerCase() !== have) throw new Error(t("Checksum does not match; nothing was changed."));

    spinner.text(t("Installing"));
    const target = process.execPath;
    if (process.platform === "win32") {
      // A running .exe can be renamed but not overwritten. An older copy still running
      // (another window) keeps its file locked: then this one gets a name of its own.
      const old = oldName(target);
      renameSync(target, old);
      try {
        copyFileSync(join(dir, asset), target);
      } catch (error) {
        renameSync(old, target);
        throw error;
      }
    } else {
      copyFileSync(join(dir, asset), `${target}.new`);
      chmodSync(`${target}.new`, 0o755);
      renameSync(`${target}.new`, target);
    }
    spinner.stop();
    ui.print(`  ${green("✔")} ${t("asc-payout updated: {from} → {to}", { from: current, to })}`);
    return 0;
  } finally {
    spinner.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Removes the previous .exe left behind by an update on Windows. */
/** Where the running .exe goes during an update: "<exe>.old", or "<exe>.old-<time>" while that one is locked. */
function oldName(target: string): string {
  try {
    rmSync(`${target}.old`, { force: true });
    return `${target}.old`;
  } catch {
    return `${target}.old-${Date.now()}`;
  }
}

/** Removes the previous .exe files left behind by updates on Windows; locked ones wait for a later start. */
export function cleanUpAfterUpdate(): void {
  if (!isCompiled()) return;
  const name = basename(process.execPath);
  let files: string[] = [];
  try {
    files = readdirSync(dirname(process.execPath)).filter((f) => f === `${name}.old` || f.startsWith(`${name}.old-`));
  } catch {
    return;
  }
  for (const f of files) {
    try {
      rmSync(join(dirname(process.execPath), f), { force: true });
    } catch {
      // still in use (another window, or the version that just updated is closing)
    }
  }
}

interface UpdateCheck {
  checkedAt: number;
  latest: string | null;
  /** a version the person chose to skip */
  skipped?: string;
}

const checkFile = () => join(cacheDir(), "update-check.json");

function saveCheck(check: UpdateCheck): void {
  try {
    writeFileAtomic(checkFile(), JSON.stringify(check));
  } catch {
    // not important
  }
}

/**
 * The newest release when it is newer than `current`, else null. Uses GitHub's public API
 * only and gives up after 2 seconds, so it never slows anything down.
 */
export async function newerRelease(current: string): Promise<{ version: string; skipped: boolean } | null> {
  const last = readJson<UpdateCheck>(checkFile());
  let latest = last?.latest ?? null;
  if (!last || Date.now() - last.checkedAt > CHECK_EVERY_MS) {
    latest = await latestVersion(2000, false);
    saveCheck({ checkedAt: Date.now(), latest, ...(last?.skipped ? { skipped: last.skipped } : {}) });
  }
  if (!latest || compareVersions(latest, current) <= 0) return null;
  return { version: latest.replace(/^v/, ""), skipped: !!last?.skipped && compareVersions(last.skipped, latest) === 0 };
}

/** Remembers not to ask about this version again. */
export function skipVersion(version: string): void {
  const last = readJson<UpdateCheck>(checkFile());
  saveCheck({ checkedAt: last?.checkedAt ?? Date.now(), latest: last?.latest ?? version, skipped: version });
}

/** A quiet note for the home menu when a newer release exists. */
export async function updateHint(current: string): Promise<string | null> {
  const newer = await newerRelease(current);
  return newer ? t("asc-payout {version} is available: run  asc-payout update", { version: newer.version }) : null;
}

/**
 * On an interactive start of the installed program: if a newer release is out, ask whether
 * to update now. After updating, the new version starts in its place with the same
 * arguments; the result is its exit code. null: carry on with this version.
 */
export async function offerUpdate(current: string, argv: string[]): Promise<number | null> {
  if (!isCompiled() || !ui.interactive() || process.env.ASC_PAYOUT_NO_UPDATE_CHECK) return null;
  const newer = await withSpinner(t("Checking for updates"), () => newerRelease(current).catch(() => null), 300);
  if (!newer || newer.skipped) return null;
  ui.print("");
  ui.print(`  ${t("asc-payout {version} is out (you have {current}).", { version: newer.version, current })}`);
  ui.print(`  ${t("What's new: https://github.com/{repo}/releases/tag/v{version}", { repo: REPO, version: newer.version })}`);
  ui.print("");
  const answer = await ui.pick<"yes" | "later" | "skip">({
    message: t("Update now?"),
    back: false,
    items: [
      { label: t("Yes, update"), value: "yes", key: "y" },
      { label: t("Not now"), value: "later", key: "n", hint: t("you will be asked next time") },
      { label: t("Skip this version"), value: "skip", key: "s", hint: t("ask again when a newer one is out") },
    ],
  });
  if (answer === "skip") skipVersion(newer.version);
  if (answer !== "yes") return null;
  try {
    await runUpdate(current);
  } catch (error) {
    ui.print(`  ${(error as Error).message}`);
    ui.print(`  ${t("Carrying on with {current}.", { current })}`);
    return null;
  }
  // start the new version, which now sits where this one was
  const child = Bun.spawn([process.execPath, ...argv], { stdio: ["inherit", "inherit", "inherit"] });
  return await child.exited;
}
