import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signToken } from "../src/asc/token";
import { parseArgs, UsageError } from "../src/cli/args";
import { findKeyFiles, keyIdFromFileName } from "../src/cli/keys";
import { accountFromEnv, findAccount, type Settings } from "../src/config/settings";

describe("parseArgs", () => {
  test("defaults", () => {
    expect(parseArgs([])).toEqual({ command: "report", json: false, csv: false, noCache: false, noClear: false, refresh: false });
  });
  test("short and long options, --x=y", () => {
    const a = parseArgs(["-a", "all", "--month=2026-10", "-c", "try", "--json"]);
    expect(a).toMatchObject({ account: "all", month: "2026-10", currency: "TRY", json: true });
  });
  test("commands and their flag forms", () => {
    expect(parseArgs(["setup"]).command).toBe("setup");
    expect(parseArgs(["--demo", "-m", "2026-11"]).command).toBe("demo");
    expect(parseArgs(["status", "--help"]).command).toBe("help");
  });
  test("mistakes are usage errors", () => {
    expect(() => parseArgs(["--mont", "2026-10"])).toThrow(UsageError);
    expect(() => parseArgs(["-a"])).toThrow(/needs a value/);
    expect(() => parseArgs(["-c", "dollars"])).toThrow(/3-letter/);
    expect(() => parseArgs(["report-now"])).toThrow(/Unknown command/);
  });
});

describe("accounts", () => {
  const key = { issuerId: "i", keyId: "K", keyFile: "k.p8" };
  const settings: Settings = {
    currency: "USD",
    accounts: [
      { name: "Example LLC", vendor: "80000001", key },
      { name: "Personal", vendor: "80000002", key },
    ],
  };
  test("by name, vendor or a unique part of the name", () => {
    expect(findAccount(settings, "personal")?.vendor).toBe("80000002");
    expect(findAccount(settings, "80000001")?.name).toBe("Example LLC");
    expect(findAccount(settings, "llc")?.name).toBe("Example LLC");
    expect(findAccount(settings, "e")).toBeUndefined(); // matches both
  });
  test("environment account", () => {
    expect(accountFromEnv({})).toBeNull();
    expect(() => accountFromEnv({ ASC_PAYOUT_VENDOR: "1" })).toThrow(/ASC_PAYOUT_ISSUER_ID/);
    const a = accountFromEnv({ ASC_PAYOUT_VENDOR: "1", ASC_PAYOUT_ISSUER_ID: "i", ASC_PAYOUT_KEY_ID: "K", ASC_PAYOUT_KEY_FILE: "/k.p8" });
    expect(a?.vendor).toBe("1");
  });
});

describe("API token", () => {
  test("ES256 JWT that verifies, short-lived and backdated", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const token = signToken("issuer-1", "ABCDE12345", pem, 1_800_000_000_000);
    const [h, p, s] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABCDE12345", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toEqual({ iss: "issuer-1", iat: 1_800_000_000 - 30, exp: 1_800_000_000 + 600, aud: "appstoreconnect-v1" });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(20 * 60);
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey.export({ type: "spki", format: "pem" }).toString(), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("key files", () => {
  test("Key ID from Apple's file name", () => {
    expect(keyIdFromFileName("/x/AuthKey_ABCDE12345.p8")).toBe("ABCDE12345");
    expect(keyIdFromFileName("key.p8")).toBeNull();
  });
  test("finds AuthKey_*.p8 files", () => {
    const dir = mkdtempSync(join(tmpdir(), "keys-"));
    writeFileSync(join(dir, "AuthKey_ABCDE12345.p8"), "x");
    writeFileSync(join(dir, "notes.txt"), "x");
    const found = findKeyFiles([dir, join(dir, "missing")]);
    expect(found.map((f) => f.keyId)).toEqual(["ABCDE12345"]);
  });
});
