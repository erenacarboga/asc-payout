import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../src/cli/doctor";
import { BACK, QUIT } from "../src/cli/prompts";
import { navigate, run } from "../src/cli/run";
import { cronLine, editCrontab, launchAgentPlist, setDailyCheck } from "../src/cli/schedule";
import { runSetup } from "../src/cli/setup";
import { ui } from "../src/cli/ui";
import { assetName, compareVersions } from "../src/cli/update";
import { loadSettings } from "../src/config/settings";
import { freshAccounts, serve, world } from "./fake-asc";
import { financialReport } from "./samples";

const realFetch = globalThis.fetch;
const realUi = { ...ui };
let output: string[];

type Step = [string, (config: any) => unknown];

/**
 * Answers prompts in order. Each step names the prompt it expects (a part of its
 * message), so a changed flow fails the test instead of answering the wrong question.
 */
function script(steps: Step[], keys: string[] = []) {
  const asked: string[] = [];
  const answer = async (config: { message: string }) => {
    asked.push(config.message);
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected prompt: ${config.message}`);
    if (!config.message.includes(step[0])) throw new Error(`Expected a prompt about "${step[0]}", got "${config.message}"`);
    return step[1](config);
  };
  ui.pick = answer as typeof ui.pick;
  ui.ask = answer as typeof ui.ask;
  ui.yesNo = (async (message: string) => answer({ message })) as typeof ui.yesNo;
  ui.key = async () => {
    const k = keys.shift();
    if (k === undefined) throw new Error("Unexpected key press wait");
    return k;
  };
  return { asked, left: () => steps.length + keys.length };
}

const value = (label: string) => (c: { items: { label?: string; value?: unknown }[] }) => {
  const item = c.items.find((i) => i.label?.includes(label));
  if (!item) throw new Error(`No menu entry "${label}" in ${c.items.map((i) => i.label).join(", ")}`);
  return item.value;
};

function downloadsWithKey(name = "AuthKey_ABCDE12345.p8"): string {
  const dir = mkdtempSync(join(tmpdir(), "downloads-"));
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  writeFileSync(join(dir, name), privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  process.env.ASC_PAYOUT_KEY_SEARCH = dir;
  return dir;
}

beforeEach(() => {
  output = [];
  ui.print = (t) => void output.push(t);
  ui.note = (t) => void output.push(t);
  ui.clear = () => {};
  ui.interactive = () => true;
  process.env.ASC_PAYOUT_EXPORT_DIR = mkdtempSync(join(tmpdir(), "exports-"));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(ui, realUi);
  delete process.env.ASC_PAYOUT_KEY_SEARCH;
});

describe("setup wizard", () => {
  const ISSUER = "11111111-2222-4333-8444-555555555555";

  test("first account: finds the key, reads its Key ID, checks access, saves", async () => {
    freshAccounts([]);
    downloadsWithKey();
    serve(world({ apps: [{ id: "1", sku: "app.one", name: "One" }] }));
    const s = script([
      ["Key file", (c) => c.items[0].value],
      ["Key ID", (c) => c.default],
      ["Issuer ID", () => ISSUER],
      ["Vendor number", () => "85012345"],
      ["Name", () => "Studio"],
      ["Everything works. Save?", value("Save")],
      ["Show amounts in", value("EUR")],
    ]);
    await runSetup();
    expect(s.left()).toBe(0);
    const settings = loadSettings();
    expect(settings.currency).toBe("EUR");
    expect(settings.accounts).toEqual([
      { name: "Studio", vendor: "85012345", key: { issuerId: ISSUER, keyId: "ABCDE12345", keyFile: join("keys", "AuthKey_ABCDE12345.p8") } },
    ]);
    expect(existsSync(join(process.env.ASC_PAYOUT_CONFIG_DIR!, "keys", "AuthKey_ABCDE12345.p8"))).toBe(true);
    expect(output.join("\n")).toContain("✓ Sales reports: OK");
  });

  test("Esc goes back one step and keeps what was entered", async () => {
    freshAccounts([]);
    downloadsWithKey();
    serve(world());
    let vendorPrefill: string | undefined;
    const s = script([
      ["Key file", (c) => c.items[0].value],
      ["Key ID", (c) => c.default],
      ["Issuer ID", () => ISSUER],
      ["Vendor number", () => "85012345"],
      ["Name", () => BACK], // back to the vendor number…
      ["Vendor number", (c) => {
        vendorPrefill = c.prefill; // …which still holds what was typed
        return "85099999";
      }],
      ["Name", () => "Studio"],
      ["Everything works. Save?", value("Save")],
      ["Show amounts in", () => BACK], // keeps the default currency
    ]);
    await runSetup();
    expect(s.left()).toBe(0);
    expect(vendorPrefill).toBe("85012345");
    expect(loadSettings().accounts[0].vendor).toBe("85099999");
    expect(loadSettings().currency).toBe("USD");
  });

  test("going back from the first step cancels without saving", async () => {
    freshAccounts([]);
    downloadsWithKey();
    script([["Key file", () => BACK]]);
    await runSetup();
    expect(loadSettings().accounts).toEqual([]);
    expect(output.join("\n")).toContain("Nothing saved");
  });

  test("a rejected key: go back and fix it", async () => {
    freshAccounts([]);
    downloadsWithKey();
    let calls = 0;
    serve(world());
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      // the first check is rejected, the second accepted
      if (String(input).includes("salesReports") && calls++ === 0) {
        return new Response(JSON.stringify({ errors: [{ status: "401", detail: "bad" }] }), { status: 401 });
      }
      return inner(input, init);
    }) as unknown as typeof fetch;
    const s = script([
      ["Key file", (c) => c.items[0].value],
      ["Key ID", (c) => c.default],
      ["Issuer ID", () => ISSUER],
      ["Vendor number", () => "85012345"],
      ["Name", () => "Studio"],
      ["Something is not right", value("Go back and fix it")],
      ["Name", () => BACK],
      ["Vendor number", () => "85012346"],
      ["Name", () => "Studio"],
      ["Everything works. Save?", value("Save")],
      ["Show amounts in", value("USD")],
    ]);
    await runSetup();
    expect(s.left()).toBe(0);
    expect(output.join("\n")).toMatch(/✗ .*rejected \(401\)/);
    expect(loadSettings().accounts[0].vendor).toBe("85012346");
  });

  test("a second account on the same team reuses the key", async () => {
    freshAccounts([["Account 1", "80000001"]]);
    serve(world());
    script([
      ["Accounts and settings", value("Add an account")],
      ["API key", value("Same key as Account 1")],
      ["Vendor number", () => "80000002"],
      ["Name", () => "Account 2"],
      ["Everything works. Save?", value("Save")],
      ["Accounts and settings", () => BACK],
    ]);
    await runSetup();
    const accounts = loadSettings().accounts;
    expect(accounts.map((a) => a.name)).toEqual(["Account 1", "Account 2"]);
    expect(accounts[1].key).toEqual(accounts[0].key);
  });

  test("removing an account asks first", async () => {
    freshAccounts([["Account 1", "80000001"], ["Account 2", "80000002"]]);
    script([
      ["Accounts and settings", value("Account 2")],
      ["Account 2", value("Remove this account")],
      ["Remove", () => true],
      ["Accounts and settings", () => BACK],
    ]);
    await runSetup();
    expect(loadSettings().accounts.map((a) => a.name)).toEqual(["Account 1"]);
  });
});

describe("home menu", () => {
  const octoberWorld = () => world({ finance: { "2027-01": financialReport }, rates: { EUR: 1.1 } });

  test("a month: arrows, countries, export, back to the menu, quit", async () => {
    freshAccounts([["Account 1", "80000001"], ["Account 2", "80000002"]]);
    serve(octoberWorld());
    const s = script(
      [
        ["What would you like to see?", value("Another month")],
        ["Which month?", (c) => c.items.find((i: { label: string }) => i.label === "October 2026").value],
        ["What would you like to see?", value("Quit")],
      ],
      ["left", "right", "down", "c", "e", "x", "b"],
    );
    expect(await run([])).toBe(0);
    expect(s.left()).toBe(0);
    const text = output.join("\n");
    expect(text).toContain("Account 1  ·  September 2026");
    expect(text).toContain("Account 2  ·  October 2026");
    expect(text).toContain("Country");
    const saved = readdirSync(process.env.ASC_PAYOUT_EXPORT_DIR!);
    expect(saved).toEqual(["asc-payout-2026-10.csv"]);
    expect(readFileSync(join(process.env.ASC_PAYOUT_EXPORT_DIR!, saved[0]), "utf-8")).toContain("account,vendor,month");
  });

  test("q on a screen quits the program", async () => {
    freshAccounts([["Account 1", "80000001"]]);
    serve(octoberWorld());
    const s = script([["What would you like to see?", value("Last month")]], ["q"]);
    expect(await run([])).toBe(0);
    expect(s.left()).toBe(0);
  });

  test("history of a year from the submenu, then back", async () => {
    freshAccounts([["Account 1", "80000001"]]);
    serve(octoberWorld());
    const s = script(
      [
        ["What would you like to see?", value("History")],
        ["History of", value("Another year")],
        ["Which year?", value("2026")],
        ["What would you like to see?", () => QUIT],
      ],
      ["escape"],
    );
    await run([]);
    expect(s.left()).toBe(0);
    expect(output.join("\n")).toContain("History  ·  Account 1  ·  2026");
  });

  test("switching account is remembered", async () => {
    freshAccounts([["Account 1", "80000001"], ["Account 2", "80000002"]]);
    serve(octoberWorld());
    script([
      ["What would you like to see?", value("Account")],
      ["Show which account?", value("All accounts")],
      ["What would you like to see?", (c) => {
        expect(c.items.find((i: { label: string }) => i.label === "Account").hint).toBe("All accounts");
        return QUIT;
      }],
    ]);
    await run([]);
    expect(loadSettings().lastAccount).toBe("all");
  });

  test("export from the menu", async () => {
    freshAccounts([["Account 1", "80000001"]]);
    serve(octoberWorld());
    script(
      [
        ["What would you like to see?", value("Export")],
        ["Save as a spreadsheet", value(`This year`)],
        ["What would you like to see?", () => QUIT],
      ],
      ["b"],
    );
    await run([]);
    expect(readdirSync(process.env.ASC_PAYOUT_EXPORT_DIR!)[0]).toMatch(/^asc-payout-\d{4}\.csv$/);
  });

  test("no account yet: demo first, then quit", async () => {
    freshAccounts([]);
    globalThis.fetch = (() => {
      throw new Error("no network in demo");
    }) as unknown as typeof fetch;
    const s = script(
      [
        ["How do you want to start?", value("demo")],
        ["How do you want to start?", value("Quit")],
      ],
      ["b"],
    );
    expect(await run([])).toBe(0);
    expect(s.left()).toBe(0);
    expect(output.join("\n")).toContain("Account 1");
  });
});

describe("navigate", () => {
  const nov = { year: 2026, month: 11 };
  const s = { choice: 0, ym: { year: 2026, month: 10 }, by: "app" as const };
  test("months", () => {
    expect(navigate(s, "left", 3, nov)).toEqual({ ...s, ym: { year: 2026, month: 9 } });
    expect(navigate(s, "right", 3, nov)).toEqual({ ...s, ym: nov });
    expect(navigate({ ...s, ym: nov }, "right", 3, nov)).toBeNull();
  });
  test("accounts wrap around", () => {
    expect(navigate(s, "up", 3, nov)).toMatchObject({ choice: 2 });
    expect(navigate({ ...s, choice: 2 }, "down", 3, nov)).toMatchObject({ choice: 0 });
    expect(navigate(s, "down", 1, nov)).toBeNull();
  });
  test("back, quit, export, reload, countries", () => {
    for (const k of ["b", "escape", "return", "backspace"]) expect(navigate(s, k, 1, nov)).toBe("back");
    expect(navigate(s, "q", 1, nov)).toBe("quit");
    expect(navigate(s, "e", 1, nov)).toBe("export");
    expect(navigate(s, "r", 1, nov)).toMatchObject({ reload: 1 });
    expect(navigate(s, "c", 1, nov)).toMatchObject({ by: "country" });
    expect(navigate(s, "z", 1, nov)).toBeNull();
  });
});

describe("daily check (schedule)", () => {
  test("crontab line added once and removed cleanly", () => {
    const line = cronLine("/home/me/.local/bin/asc-payout", 10);
    expect(line).toBe('0 10 * * * "/home/me/.local/bin/asc-payout" watch # asc-payout watch');
    const added = editCrontab("MAILTO=me\n5 * * * * backup\n", line);
    expect(editCrontab(added, line)).toBe(added); // not twice
    expect(editCrontab(added)).toBe("MAILTO=me\n5 * * * * backup\n");
  });
  test("launchd agent runs watch at the hour", () => {
    const plist = launchAgentPlist("/usr/local/bin/asc-payout", 9);
    expect(plist).toContain("<string>/usr/local/bin/asc-payout</string><string>watch</string>");
    expect(plist).toContain("<key>Hour</key><integer>9</integer>");
  });
  test("Windows task and Linux crontab commands", () => {
    const calls: { cmd: string[]; input?: string }[] = [];
    const runner = (cmd: string[], input?: string) => {
      calls.push({ cmd, input });
      return { ok: true, out: cmd[0] === "crontab" && cmd[1] === "-l" ? "1 * * * * other\n" : "" };
    };
    // isCompiled() is false under bun test, so turning on refuses; turning off works everywhere
    expect(setDailyCheck(true, 10, runner, "win32", "C:\\asc-payout.exe").ok).toBe(false);
    expect(setDailyCheck(false, 10, runner, "win32").ok).toBe(true);
    expect(calls[0].cmd).toEqual(["schtasks", "/Delete", "/F", "/TN", "asc-payout watch"]);
    expect(setDailyCheck(false, 10, runner, "linux").ok).toBe(true);
    expect(calls.at(-1)).toEqual({ cmd: ["crontab", "-"], input: "1 * * * * other\n" });
  });
});

describe("doctor", () => {
  test("reports a missing key file with the fix", async () => {
    freshAccounts([["Account 1", "80000001"]]);
    const cfg = join(process.env.ASC_PAYOUT_CONFIG_DIR!, "config.json");
    writeFileSync(cfg, readFileSync(cfg, "utf-8").replace("AuthKey_TESTKEY001", "AuthKey_MISSING999"));
    serve(world());
    const code = await runDoctor("1.0.0");
    expect(code).toBe(1);
    expect(output.join("\n")).toContain("✗ Key file missing");
  });

  test("all good", async () => {
    freshAccounts([["Account 1", "80000001"]]);
    serve(world({ apps: [{ id: "1", sku: "a", name: "A" }], rates: {} }));
    const code = await runDoctor("1.0.0");
    expect(output.join("\n")).toContain("✓ Sales reports (Trends) readable");
    expect(code).toBe(0);
  });
});

describe("update helpers", () => {
  test("version order", () => {
    expect(compareVersions("v1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.0", "v1.2.0")).toBe(0);
  });
  test("asset for each platform", () => {
    expect(assetName("win32", "x64", false)).toBe("asc-payout-windows-x64.exe");
    expect(assetName("win32", "arm64", false)).toBe("asc-payout-windows-arm64.exe");
    expect(assetName("linux", "x64", true)).toBe("asc-payout-linux-x64-musl");
    expect(assetName("freebsd", "x64", false)).toBeNull();
  });
});
