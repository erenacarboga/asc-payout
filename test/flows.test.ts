import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../src/cli/doctor";
import { navigate, run } from "../src/cli/run";
import { runSetup } from "../src/cli/setup";
import { ui } from "../src/cli/ui";
import { assetName, compareVersions } from "../src/cli/update";
import { loadSettings } from "../src/config/settings";
import { freshAccounts, serve, world } from "./fake-asc";

const realFetch = globalThis.fetch;
const realUi = { ...ui };
let output: string[];

/**
 * Answers prompts in order. Each step names the prompt it expects (a part of its
 * message), so a changed flow fails the test instead of answering the wrong question.
 */
function script(steps: [string, (config: any) => unknown][]) {
  const asked: string[] = [];
  const answer = async (config: { message: string }) => {
    asked.push(config.message);
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected prompt: ${config.message}`);
    if (!config.message.includes(step[0])) throw new Error(`Expected a prompt about "${step[0]}", got "${config.message}"`);
    return step[1](config);
  };
  ui.select = answer as typeof ui.select;
  ui.input = answer as typeof ui.input;
  ui.confirm = answer as typeof ui.confirm;
  return { asked, left: () => steps.length };
}

beforeEach(() => {
  output = [];
  ui.print = (t) => void output.push(t);
  ui.note = () => {};
  ui.interactive = () => true;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(ui, realUi);
  delete process.env.ASC_PAYOUT_KEY_SEARCH;
});

describe("setup", () => {
  test("first account: finds the downloaded key, reads its Key ID, checks access, saves", async () => {
    freshAccounts([]);
    const downloads = mkdtempSync(join(tmpdir(), "downloads-"));
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    writeFileSync(join(downloads, "AuthKey_ABCDE12345.p8"), privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    process.env.ASC_PAYOUT_KEY_SEARCH = downloads;
    serve(world({ sales: {}, apps: [{ id: "1", sku: "app.one", name: "One" }] }));

    const s = script([
      [".p8 key file", (c) => c.choices[0].value],
      ["Key ID", (c) => c.default], // read from the file name
      ["Issuer ID", () => "11111111-2222-4333-8444-555555555555"],
      ["Vendor number", () => "85012345"],
      ["Name for this account", () => "Studio"],
      ["Show amounts in", () => "EUR"],
    ]);
    await runSetup();
    expect(s.left()).toBe(0);

    const settings = loadSettings();
    expect(settings.currency).toBe("EUR");
    expect(settings.accounts).toEqual([
      { name: "Studio", vendor: "85012345", key: { issuerId: "11111111-2222-4333-8444-555555555555", keyId: "ABCDE12345", keyFile: join("keys", "AuthKey_ABCDE12345.p8") } },
    ]);
    // the key is copied next to the settings, so the folder can be moved as a whole
    expect(existsSync(join(process.env.ASC_PAYOUT_CONFIG_DIR!, "keys", "AuthKey_ABCDE12345.p8"))).toBe(true);
    expect(output.join("\n")).toContain("✓ Sales reports: OK");
    expect(output.join("\n")).toContain("✓ App names: 1 app(s)");
  });

  test("a rejected key is not saved unless asked to", async () => {
    freshAccounts([]);
    const downloads = mkdtempSync(join(tmpdir(), "downloads-"));
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    writeFileSync(join(downloads, "AuthKey_ZZZZZ99999.p8"), privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    process.env.ASC_PAYOUT_KEY_SEARCH = downloads;
    const w = world();
    serve(w);
    globalThis.fetch = (async () => new Response(JSON.stringify({ errors: [{ status: "401", detail: "bad" }] }), { status: 401 })) as unknown as typeof fetch;

    script([
      [".p8 key file", (c) => c.choices[0].value],
      ["Key ID", (c) => c.default],
      ["Issuer ID", () => "11111111-2222-4333-8444-555555555555"],
      ["Vendor number", () => "85012345"],
      ["Name for this account", () => "Studio"],
      ["Save it anyway?", () => false],
    ]);
    await runSetup();
    expect(loadSettings().accounts).toEqual([]);
    expect(output.join("\n")).toMatch(/✗ .*rejected \(401\)/);
  });

  test("a second account on the same team reuses the key", async () => {
    freshAccounts([["Company", "80000001"]]);
    serve(world());
    script([
      ["Setup:", () => "add"],
      ["API key:", (c) => c.choices.find((x: { name: string }) => x.name.includes("Same key"))!.value],
      ["Vendor number", () => "80000002"],
      ["Name for this account", () => "Personal"],
      ["Setup:", () => "done"],
    ]);
    await runSetup();
    const accounts = loadSettings().accounts;
    expect(accounts.map((a) => a.name)).toEqual(["Company", "Personal"]);
    expect(accounts[1].key).toEqual(accounts[0].key);
  });
});

describe("menus", () => {
  test("account and month menus default to the last account and the last closed month, and remember the choice", async () => {
    freshAccounts([["Company", "80000001"], ["Personal", "80000002"]]);
    serve(world());
    let monthDefault: unknown;
    script([
      ["Account:", (c) => {
        expect(c.choices.at(-1).name).toBe("All accounts");
        return "Personal";
      }],
      ["Month:", (c) => {
        monthDefault = c.default;
        return c.default;
      }],
    ]);
    ui.key = async () => "q";
    await run(["--no-clear"]).catch(() => 0);
    expect(loadSettings().lastAccount).toBe("Personal");
    expect(monthDefault).toBeDefined();
  });

  test("arrow keys move between months and accounts, c switches to countries", async () => {
    freshAccounts([["Company", "80000001"], ["Personal", "80000002"]]);
    serve(world());
    script([
      ["Account:", () => "Company"],
      ["Month:", (c) => c.default],
    ]);
    const keys = ["left", "down", "c", "x", "q"];
    ui.key = async () => keys.shift()!;
    await run(["--no-clear"]);
    expect(keys).toEqual([]);
    const screens = output.filter((t) => t.includes("App / product") || t.includes("Country"));
    // first screen, after left, after down (Personal), after c (countries); "x" is ignored
    expect(screens).toHaveLength(4);
    expect(screens[2]).toContain("Personal");
    expect(screens[3]).toContain("Country");
  });
});

describe("navigate", () => {
  const nov = { year: 2026, month: 11 };
  const s = { choice: 0, ym: { year: 2026, month: 10 }, by: "app" as const };
  test("months", () => {
    expect(navigate(s, "left", 3, nov)).toEqual({ ...s, ym: { year: 2026, month: 9 } });
    expect(navigate(s, "right", 3, nov)).toEqual({ ...s, ym: nov });
    expect(navigate({ ...s, ym: nov }, "right", 3, nov)).toBeNull(); // not past the current month
    expect(navigate({ ...s, ym: { year: 2026, month: 1 } }, "left", 3, nov)).toEqual({ ...s, ym: { year: 2025, month: 12 } });
  });
  test("accounts wrap around", () => {
    expect(navigate(s, "up", 3, nov)).toMatchObject({ choice: 2 });
    expect(navigate({ ...s, choice: 2 }, "down", 3, nov)).toMatchObject({ choice: 0 });
    expect(navigate(s, "down", 1, nov)).toBeNull();
  });
  test("other keys", () => {
    expect(navigate(s, "c", 1, nov)).toMatchObject({ by: "country" });
    expect(navigate(s, "q", 1, nov)).toBe("quit");
    expect(navigate(s, "z", 1, nov)).toBeNull();
  });
});

describe("doctor", () => {
  test("reports a missing key file with the fix", async () => {
    freshAccounts([["Company", "80000001"]]);
    const cfg = join(process.env.ASC_PAYOUT_CONFIG_DIR!, "config.json");
    writeFileSync(cfg, readFileSync(cfg, "utf-8").replace("AuthKey_TESTKEY001", "AuthKey_MISSING999"));
    serve(world());
    const code = await runDoctor("1.0.0");
    const text = output.join("\n");
    expect(code).toBe(1);
    expect(text).toContain("✗ Key file missing");
    expect(text).toContain("asc-payout setup");
  });

  test("all good", async () => {
    freshAccounts([["Company", "80000001"]]);
    serve(world({ apps: [{ id: "1", sku: "a", name: "A" }], rates: {} }));
    const code = await runDoctor("1.0.0");
    const text = output.join("\n");
    expect(text).toContain("✓ Sales reports (Trends) readable");
    expect(text).toContain("✓ App names: 1 app(s)");
    expect(code).toBe(0);
  });
});

describe("update helpers", () => {
  test("version order", () => {
    expect(compareVersions("v1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.0", "v1.2.0")).toBe(0);
    expect(compareVersions("1.2.0", "1.2.1")).toBe(-1);
  });
  test("asset for each platform", () => {
    expect(assetName("win32", "x64", false)).toBe("asc-payout-windows-x64.exe");
    expect(assetName("darwin", "arm64", false)).toBe("asc-payout-darwin-arm64");
    expect(assetName("linux", "x64", true)).toBe("asc-payout-linux-x64-musl");
    expect(assetName("freebsd", "x64", false)).toBeNull();
  });
});
