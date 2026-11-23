import { join } from "node:path";
import { downloadFinancialReport } from "../asc/reports";
import { financeReportDate, monthLabel, previous, recentMonths, shortDate } from "../calendar/fiscal";
import { readJson, writeFileAtomic } from "../config/files";
import { cacheDir } from "../config/paths";
import type { Account } from "../config/settings";
import { computeMonth } from "../earnings/month";
import { t } from "../i18n";
import { money } from "../money/format";
import { ui } from "./ui";

/**
 * Checks whether Apple has published the Financial Report of the month that just ended,
 * and announces it once per account and month (desktop notification + output).
 * Made to be run on a schedule (Task Scheduler, cron, launchd).
 */
export async function runWatch(accounts: Account[], currency: string): Promise<number> {
  const ym = previous(recentMonths(1)[0]);
  const stateFile = join(cacheDir(), "watch.json");
  const told = readJson<Record<string, string>>(stateFile) ?? {};
  let changed = false;

  for (const account of accounts) {
    const key = `${account.vendor}:${financeReportDate(ym)}`;
    if (told[key]) {
      ui.print(`  ${t("{account}: {month} already announced.", { account: account.name, month: monthLabel(ym) })}`);
      continue;
    }
    const report = await downloadFinancialReport(account, financeReportDate(ym), true);
    if (report.status === "not-published") {
      ui.print(`  ${t("{account}: {month} not published yet.", { account: account.name, month: monthLabel(ym) })}`);
      continue;
    }
    if (report.status !== "ok") {
      ui.note(`  ${account.name}: ${report.message}`);
      continue;
    }
    const r = await computeMonth(account, ym, { currency, useCache: true, refreshCatalog: false, log: () => {}, settlement: false });
    const message = t("{month} is final: {amount}, expected around {date}.", { month: monthLabel(ym), amount: money(r.payment.amount, currency), date: shortDate(r.payment.date) });
    ui.print(`  ${account.name}: ${message}`);
    notify(`asc-payout · ${account.name}`, message);
    told[key] = new Date().toISOString();
    changed = true;
  }
  if (changed) writeFileAtomic(stateFile, JSON.stringify(told, null, 1));
  return 0;
}

/** Best-effort desktop notification; never fails the command. ASC_PAYOUT_NOTIFY=off disables it. */
export function notify(title: string, body: string): void {
  if (process.env.ASC_PAYOUT_NOTIFY === "off") return;
  try {
    if (process.platform === "darwin") {
      Bun.spawnSync(["osascript", "-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`]);
    } else if (process.platform === "win32") {
      // A Windows toast through PowerShell, with no extra modules
      const xml = `<toast><visual><binding template="ToastGeneric"><text>${esc(title)}</text><text>${esc(body)}</text></binding></visual></toast>`;
      const script = [
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
        "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
        "$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
        `$x.LoadXml('${xml.replace(/'/g, "''")}')`,
        "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))",
      ].join("; ");
      Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", script]);
    } else {
      Bun.spawnSync(["notify-send", title, body]);
    }
  } catch {
    // no notification system: the printed line is enough
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
