import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readJson, writeFileAtomic } from "../config/files";
import { cacheDir } from "../config/paths";
import { t } from "../i18n";
import { ui } from "./ui";

export const REPO = "erenacarboga/asc-payout";
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

async function download(tag: string, files: string[], dir: string): Promise<void> {
  try {
    for (const f of files) {
      const r = await fetch(`https://github.com/${REPO}/releases/download/${tag}/${f}`, { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`${r.status}`);
      writeFileSync(join(dir, f), Buffer.from(await r.arrayBuffer()));
    }
    return;
  } catch {
    // blocked (a proxy, for example): try the GitHub CLI if it is installed
  }
  const args = ["release", "download", tag, "-R", REPO, "-D", dir, "--clobber", ...files.flatMap((f) => ["-p", f])];
  if (!gh(args).ok) throw new Error(t("Download failed. Check your internet connection and try again."));
}

export async function runUpdate(current: string): Promise<number> {
  if (!isCompiled()) {
    ui.print(`  ${t("Running from source: update with git pull.")}`);
    return 0;
  }
  const latest = await latestVersion();
  if (!latest) throw new Error(t("Could not find the latest release. Check your internet connection and try again."));
  if (compareVersions(latest, current) <= 0) {
    ui.print(`  ${t("asc-payout {version} is up to date.", { version: current })}`);
    return 0;
  }
  const asset = assetName();
  if (!asset) throw new Error(t("No release build for {platform} {arch}.", { platform: process.platform, arch: process.arch }));

  ui.print(`  ${t("Updating {from} -> {to}...", { from: current, to: latest.replace(/^v/, "") })}`);
  const dir = mkdtempSync(join(tmpdir(), "asc-payout-update-"));
  try {
    await download(latest, [asset, "SHA256SUMS"], dir);
    const sums = readFileSync(join(dir, "SHA256SUMS"), "utf-8");
    const want = sums.split("\n").map((l) => l.trim().split(/\s+\*?/)).find((p) => p[1] === asset)?.[0];
    const have = createHash("sha256").update(readFileSync(join(dir, asset))).digest("hex");
    if (!want || want.toLowerCase() !== have) throw new Error(t("Checksum does not match; nothing was changed."));

    const target = process.execPath;
    if (process.platform === "win32") {
      // A running .exe can be renamed but not overwritten
      rmSync(`${target}.old`, { force: true });
      renameSync(target, `${target}.old`);
      try {
        copyFileSync(join(dir, asset), target);
      } catch (error) {
        renameSync(`${target}.old`, target);
        throw error;
      }
    } else {
      copyFileSync(join(dir, asset), `${target}.new`);
      chmodSync(`${target}.new`, 0o755);
      renameSync(`${target}.new`, target);
    }
    ui.print(`  ${t("Updated to {version}.", { version: latest.replace(/^v/, "") })}`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Removes the previous .exe left behind by an update on Windows. */
export function cleanUpAfterUpdate(): void {
  if (!isCompiled()) return;
  try {
    rmSync(`${process.execPath}.old`, { force: true });
  } catch {
    // still in use (the version that just updated is closing): removed on a later start
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
  const newer = await newerRelease(current).catch(() => null);
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
