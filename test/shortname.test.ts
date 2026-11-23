import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { ensureShortName, mainExecutable } from "../src/cli/shortname";

// a stand-in for a compiled asc-payout: big enough, with the repository named in it
const fakeBuild = (path: string, tag: string) => {
  const body = Buffer.alloc(6 * 1024 * 1024, 0);
  Buffer.from(`erenacarboga/asc-payout ${tag}`).copy(body, body.length - 64);
  writeFileSync(path, body);
};

describe("short name ascp", () => {
  test("started as ascp, asc-payout is still the program that updates", () => {
    const bin = win32.join("C:", "bin");
    if (process.platform === "win32") {
      expect(mainExecutable(win32.join(bin, "ascp.exe"), "win32")).toBe(join(bin, "asc-payout.exe"));
    }
    expect(mainExecutable(win32.join(bin, "asc-payout.exe"), "win32")).toBe(win32.join(bin, "asc-payout.exe"));
  });

  test.if(process.platform === "win32")("Windows: a hard link, renewed after an update, never another program's ascp", () => {
    const dir = mkdtempSync(join(tmpdir(), "ascp-"));
    const main = join(dir, "asc-payout.exe");
    const short = join(dir, "ascp.exe");
    fakeBuild(main, "1");

    expect(ensureShortName(main, "win32")).toBe("created");
    expect(statSync(short).ino).toBe(statSync(main).ino); // the same file, no extra space
    expect(ensureShortName(main, "win32")).toBe("present");

    // an update puts a new file in place: ascp still points at the old one until renewed
    renameSync(main, `${main}.old`);
    fakeBuild(main, "2");
    expect(ensureShortName(main, "win32")).toBe("renewed");
    expect(statSync(short).ino).toBe(statSync(main).ino);
    expect(readdirSync(dir).some((f) => f.startsWith("ascp.exe.old-"))).toBe(true);

    // someone else's ascp.exe in the same folder stays as it is
    const other = mkdtempSync(join(tmpdir(), "ascp-other-"));
    const otherMain = join(other, "asc-payout.exe");
    fakeBuild(otherMain, "1");
    writeFileSync(join(other, "ascp.exe"), "a different program");
    expect(ensureShortName(otherMain, "win32")).toBe("skipped");
    expect(statSync(join(other, "ascp.exe")).size).toBe("a different program".length);
  });

  test("Homebrew and Scoop installs are left to the package manager", () => {
    expect(ensureShortName("/opt/homebrew/Cellar/asc-payout/1.8.1/bin/asc-payout", "darwin")).toBe("skipped");
    expect(ensureShortName(win32.join("C:", "Users", "x", "scoop", "apps", "asc-payout", "current", "asc-payout.exe"), "win32")).toBe("skipped");
    expect(existsSync("/opt/homebrew/Cellar/asc-payout/1.8.1/bin/ascp")).toBe(false);
  });
});
