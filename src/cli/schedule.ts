import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isCompiled } from "./update";

/**
 * A daily `asc-payout watch` run, set up from the menu:
 *   Windows: a Task Scheduler task
 *   macOS:   a launchd agent in ~/Library/LaunchAgents
 *   Linux:   a line in the user's crontab
 * Only for the installed program (a path that stays valid), not `bun run`.
 */

const TASK = "asc-payout watch";
const LABEL = "io.github.erenacarboga.asc-payout.watch";
const CRON_MARK = "# asc-payout watch";

export type Runner = (cmd: string[], input?: string) => { ok: boolean; out: string };

const defaultRunner: Runner = (cmd, input) => {
  try {
    const r = Bun.spawnSync(cmd, { stdin: input === undefined ? "ignore" : Buffer.from(input), stdout: "pipe", stderr: "pipe" });
    return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() };
  } catch (error) {
    return { ok: false, out: (error as Error).message };
  }
};

export function launchAgentPath(home = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
}

export function launchAgentPlist(exe: string, hour: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${exe}</string><string>watch</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
`;
}

export function cronLine(exe: string, hour: number): string {
  return `0 ${hour} * * * "${exe}" watch ${CRON_MARK}`;
}

/** The crontab without our line, and with it when `line` is given. */
export function editCrontab(current: string, line?: string): string {
  const kept = current.split("\n").filter((l) => l.trim() !== "" && !l.includes(CRON_MARK));
  if (line) kept.push(line);
  return kept.length ? kept.join("\n") + "\n" : "";
}

export function isDailyCheckOn(run: Runner = defaultRunner, platform = process.platform): boolean {
  if (platform === "win32") return run(["schtasks", "/Query", "/TN", TASK]).ok;
  if (platform === "darwin") return existsSync(launchAgentPath());
  return run(["crontab", "-l"]).out.includes(CRON_MARK);
}

/** Turns the daily check on (at `hour` o'clock) or off. Returns a sentence for the person. */
export function setDailyCheck(on: boolean, hour = 10, run: Runner = defaultRunner, platform = process.platform, exe = process.execPath): { ok: boolean; message: string } {
  if (on && !isCompiled()) return { ok: false, message: "Only the installed program can be scheduled (not bun run)." };
  const time = `${String(hour).padStart(2, "0")}:00`;

  if (platform === "win32") {
    const r = on
      ? run(["schtasks", "/Create", "/F", "/SC", "DAILY", "/ST", time, "/TN", TASK, "/TR", `"${exe}" watch`])
      : run(["schtasks", "/Delete", "/F", "/TN", TASK]);
    return r.ok
      ? { ok: true, message: on ? `Every day at ${time} (Task Scheduler: "${TASK}").` : "Daily check turned off." }
      : { ok: false, message: `Task Scheduler said: ${r.out.trim()}` };
  }

  if (platform === "darwin") {
    const path = launchAgentPath();
    const uid = String(process.getuid?.() ?? "");
    run(["launchctl", "bootout", `gui/${uid}`, path]); // unload an older one; fine if none
    if (!on) {
      rmSync(path, { force: true });
      return { ok: true, message: "Daily check turned off." };
    }
    mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(path, launchAgentPlist(exe, hour));
    const r = run(["launchctl", "bootstrap", `gui/${uid}`, path]);
    return r.ok ? { ok: true, message: `Every day at ${time} (launchd).` } : { ok: false, message: `launchctl said: ${r.out.trim()}` };
  }

  const current = run(["crontab", "-l"]);
  const next = editCrontab(current.ok ? current.out : "", on ? cronLine(exe, hour) : undefined);
  const r = run(["crontab", "-"], next);
  return r.ok ? { ok: true, message: on ? `Every day at ${time} (crontab).` : "Daily check turned off." } : { ok: false, message: `crontab said: ${r.out.trim()}` };
}
