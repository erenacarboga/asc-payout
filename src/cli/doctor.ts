import { createPrivateKey } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ascAll, AscError } from "../asc/client";
import { checkSalesAccess, downloadFinancialReport } from "../asc/reports";
import { financeReportDate, monthLabel, previous, recentMonths } from "../calendar/fiscal";
import { writeFileAtomic } from "../config/files";
import { cacheDir, resolveKeyFile, settingsFile } from "../config/paths";
import { accountFromEnv, loadSettings, readKeyFile, type Account } from "../config/settings";
import { ui } from "./ui";
import { compareVersions, latestVersion } from "./update";

type Level = "ok" | "warn" | "fail";
const MARK: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };

/**
 * Checks everything asc-payout depends on and says how to fix what fails.
 * Exit code 1 when something fails (warnings don't count).
 */
export async function runDoctor(version: string): Promise<number> {
  let failures = 0;
  const line = (level: Level, text: string, fix?: string) => {
    if (level === "fail") failures++;
    ui.print(`  ${MARK[level]} ${text}`);
    if (fix && level !== "ok") ui.print(`      ${fix}`);
  };

  ui.print("");
  ui.print(`  asc-payout ${version} · ${process.platform} ${process.arch}`);
  ui.print("");

  // Clock: tokens are rejected when it is far off
  try {
    const r = await fetch("https://api.appstoreconnect.apple.com/v1/apps", { method: "HEAD", signal: AbortSignal.timeout(15_000) });
    const server = Date.parse(r.headers.get("date") ?? "");
    const skew = Math.round((Date.now() - server) / 1000);
    if (Number.isNaN(server)) line("warn", "Clock: App Store Connect sent no time to compare with");
    else if (Math.abs(skew) > 300) line("fail", `Clock is ${Math.abs(skew)} s ${skew > 0 ? "ahead" : "behind"}`, "Sync the system clock (automatic time); App Store Connect rejects keys otherwise.");
    else if (Math.abs(skew) > 30) line("warn", `Clock is ${Math.abs(skew)} s ${skew > 0 ? "ahead" : "behind"}`, "Turn on automatic time sync to stay safe.");
    else line("ok", "Clock and App Store Connect reachable");
  } catch (error) {
    line("fail", `App Store Connect not reachable: ${(error as Error).message}`, "Check the internet connection, proxy or firewall.");
  }

  // Settings and accounts
  let accounts: Account[] = [];
  try {
    const env = accountFromEnv();
    accounts = env ? [env] : loadSettings().accounts;
    if (env) line("ok", `Using the account from ASC_PAYOUT_* variables (vendor ${env.vendor})`);
    else if (accounts.length === 0) line("fail", "No account set up", "Run: asc-payout setup");
    else line("ok", `${accounts.length} account(s) in ${settingsFile()}`);
  } catch (error) {
    line("fail", (error as Error).message);
  }

  const lastClosed = previous(recentMonths(1)[0]);
  for (const account of accounts) {
    ui.print("");
    ui.print(`  ${account.name} (vendor ${account.vendor})`);
    const keyPath = resolveKeyFile(account.key.keyFile);
    if (!existsSync(keyPath)) {
      line("fail", `Key file missing: ${keyPath}`, "Run: asc-payout setup > Edit an account > change the key");
      continue;
    }
    try {
      createPrivateKey(readKeyFile(account.key));
      line("ok", `Key ${account.key.keyId} readable`);
    } catch {
      line("fail", `Key file is not a valid .p8 key: ${keyPath}`, "Download the key again from App Store Connect and run setup.");
      continue;
    }

    const sales = await checkSalesAccess(account);
    line(sales.ok ? "ok" : "fail", sales.ok ? "Sales reports (Trends) readable" : sales.message, sales.ok ? undefined : "The key needs the Finance (or Sales) role, and the vendor number must belong to its team.");

    const finance = await downloadFinancialReport(account, financeReportDate(lastClosed), true);
    if (finance.status === "ok" || finance.status === "not-published") {
      line("ok", `Financial Reports (Reports) readable${finance.status === "not-published" ? `; ${monthLabel(lastClosed)} not published yet` : ""}`);
    } else if (finance.status === "no-access") {
      line("fail", "Financial Reports: this key can't read them", "Give the key the Finance role in App Store Connect > Users and Access > Integrations.");
    } else {
      line("warn", `Financial Reports: ${finance.message}`);
    }

    try {
      const apps = await ascAll<{ id: string }>(account.key, "/v1/apps?limit=200&fields[apps]=name");
      line("ok", `App names: ${apps.length} app(s)`);
    } catch (error) {
      const denied = error instanceof AscError && error.status === 403;
      line("warn", denied ? "App names: this key can't list apps; products are shown without app names" : `App names: ${(error as Error).message}`);
    }
    if (account.catalogKey) {
      try {
        createPrivateKey(readKeyFile(account.catalogKey));
        line("ok", `In-app purchase key ${account.catalogKey.keyId} readable`);
      } catch (error) {
        line("warn", `In-app purchase key: ${(error as Error).message}`);
      }
    }
  }

  // Exchange rates
  ui.print("");
  for (const [name, url] of [
    ["ECB rates (Frankfurter)", "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD"],
    ["exchange-api", "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json"],
  ] as const) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      line(r.ok ? "ok" : "warn", `${name}: ${r.ok ? "reachable" : `answered ${r.status}`}`);
    } catch {
      line("warn", `${name}: not reachable`, "Exchange rates fall back to other sources or stored rates.");
    }
  }

  // Cache folder
  const probe = join(cacheDir(), `.doctor-${process.pid}`);
  try {
    writeFileAtomic(probe, "ok");
    rmSync(probe, { force: true });
    line("ok", `Cache folder writable: ${cacheDir()}`);
  } catch (error) {
    line("fail", `Cache folder not writable: ${(error as Error).message}`, "Set ASC_PAYOUT_CACHE_DIR to a writable folder.");
  }

  // Version
  const latest = await latestVersion(10_000);
  if (latest && compareVersions(latest, version) > 0) line("warn", `Version ${latest.replace(/^v/, "")} is available`, "Run: asc-payout update");
  else if (latest) line("ok", "Latest version");

  ui.print("");
  ui.print(failures === 0 ? "  Everything needed works." : `  ${failures} problem(s) found.`);
  ui.print("");
  return failures === 0 ? 0 : 1;
}
