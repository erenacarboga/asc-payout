import { closeSync, existsSync, linkSync, lstatSync, openSync, readSync, realpathSync, renameSync, statSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * `ascp`, the short name: the same program as `asc-payout`.
 *
 * On Windows it is a hard link (ascp.exe and asc-payout.exe are one file on disk, so it
 * takes no space and starts like any program); on macOS and Linux a symbolic link. It is
 * only ever created next to asc-payout, and an `ascp` that belongs to another program
 * (IBM Aspera has one) is never touched.
 */

export const SHORT = "ascp";

const exe = (platform: string) => (platform === "win32" ? ".exe" : "");

/** The installed asc-payout, also when started as ascp. */
export function mainExecutable(execPath = process.execPath, platform = process.platform): string {
  if (platform === "win32") {
    return basename(execPath).toLowerCase() === `${SHORT}.exe` ? join(dirname(execPath), "asc-payout.exe") : execPath;
  }
  try {
    return realpathSync(execPath);
  } catch {
    return execPath;
  }
}

/** Installed by Homebrew or Scoop: they make the short name themselves. */
const managed = (path: string) => /[\\/]Cellar[\\/]|[\\/]scoop[\\/]apps[\\/]/i.test(path);

/** An asc-payout build: its bundled code names this repository. */
function isAscPayout(path: string): boolean {
  try {
    const size = statSync(path).size;
    if (size < 5_000_000) return false;
    const length = Math.min(size, 16 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    return buffer.includes("erenacarboga/asc-payout");
  } catch {
    return false;
  }
}

function sameFile(a: string, b: string): boolean {
  try {
    const x = statSync(a, { bigint: true });
    const y = statSync(b, { bigint: true });
    return x.ino !== 0n && x.ino === y.ino && x.dev === y.dev;
  } catch {
    return false;
  }
}

/**
 * Makes sure `ascp` sits next to asc-payout and runs the current version. Quiet: any
 * problem (a read-only folder, another program's ascp) just leaves things as they are.
 */
export function ensureShortName(main: string, platform: string = process.platform): "created" | "renewed" | "present" | "skipped" {
  // only next to an installed asc-payout, not a downloaded build such as asc-payout-darwin-arm64
  if (managed(main) || !existsSync(main) || basename(main).toLowerCase() !== `asc-payout${exe(platform)}`) return "skipped";
  const link = join(dirname(main), SHORT + exe(platform));
  try {
    if (platform === "win32") {
      if (!existsSync(link)) {
        linkSync(main, link);
        return "created";
      }
      if (sameFile(link, main)) return "present";
      // an older asc-payout left behind by an update: a running file can be renamed, not replaced
      if (!isAscPayout(link)) return "skipped";
      renameSync(link, `${link}.old-${Date.now()}`);
      linkSync(main, link);
      return "renewed";
    }
    let stat;
    try {
      stat = lstatSync(link);
    } catch {
      symlinkSync(basename(main), link);
      return "created";
    }
    return stat.isSymbolicLink() ? "present" : "skipped";
  } catch {
    return "skipped";
  }
}
