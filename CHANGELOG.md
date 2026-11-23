# Changelog

## 1.7.3

- Updating is a live panel: the versions, each step with its state (found, downloading, checked with SHA-256, installed), a smooth progress bar with the percentage, megabytes, speed with a small speed graph, and time left. It ends with a short finish line: the new version, size, time, and that the checksum was verified.
- The loading line has a smooth gradient bar that fills in eighths of a character, with a shine moving across it, and a spinner that changes color as it turns. Truecolor where the terminal has it, 256 colors otherwise, plain characters with `NO_COLOR`.

## 1.7.2

- Updating shows a live progress line: megabytes downloaded, speed and time left, then checking the download and installing, and ends with "asc-payout updated: 1.7.1 → 1.7.2". The download no longer stops after two minutes on a slow connection; it only gives up when no data arrives for 30 seconds.
- A loading line everywhere asc-payout waits: checking an account while setting it up, looking for a new version, the update check at start (only when it isn't instant), Settings > Notifications > Check now, Check my setup, and exchange rates for monthly goals.
- Lines printed while something is loading appear above the loading line instead of mixing with it.

## 1.7.1

- Windows: updating no longer stops when an older copy of asc-payout is still open in another window (its file is locked). The running program is moved aside under a name of its own, and old copies are removed on a later start once they are closed.

## 1.7.0

- `asc-payout mcp`: a Model Context Protocol server over stdio, so AI assistants (Claude Desktop, Claude Code, VS Code, Cursor, ...) can ask asc-payout directly. Tools: accounts, a month, history, subscriptions, refunds and cancellations, profit after Apple Ads. Each runs the matching command with `--json`, so the numbers are the ones the terminal shows. Runs locally; keys never leave the computer.
- A Claude Desktop extension (`asc-payout.mcpb`, attached to every release): open it to install. It starts the installed asc-payout, and explains how to install or update it when it can't.
- An Agent Skill (`skills/asc-payout`) so AI coding assistants can answer earnings questions by running asc-payout: a Claude Code plugin (`/plugin marketplace add erenacarboga/asc-payout`), and a folder to copy for VS Code (GitHub Copilot), Cursor and Codex. With a field-by-field reference of every `--json` output.
- `--help` lists `ASC_PAYOUT_LANG`.
- CI: the macOS check runs on its own (Intel Mac), so a long wait for a Mac runner no longer fails the main checks.

## 1.6.1

- On start, when a new version is out, asc-payout asks whether to update now (yes, not now, or skip this version). On yes it updates itself and opens again on the new version. Not asked in scripts, with `--json`, `--csv` or `watch`, or with `ASC_PAYOUT_NO_UPDATE_CHECK=1`.
- Refunds and cancellations: a subscription going into a grace period counts as a payment problem, and moving from the grace period into billing retry no longer counts as a second one. Recoveries from a grace period count as recovered.
- Cancellations are the people who turned off renewal, the same number on the Subscriptions and the Refunds and cancellations screens; subscriptions lost to a failed payment are shown under billing ("lost").
- Subscriptions: recoveries from a grace period count as recovered; a pay-up-front offer counts as paying but not toward MRR (Apple's report gives its price for the whole offer, not per month).
- The Windows installer honours `ASC_PAYOUT_NO_MODIFY_PATH=1`, like the macOS and Linux one.

## 1.6.0

- **App details**: press **d** on a month and pick an app: its products, its day-by-day sales, refunds, and the countries it earns in.
- **Refunds and cancellations** (`asc-payout churn`, or from the menu): per app, trials started and how many became paid, cancellations, refunds and the refund rate; trial conversion week by week; why people cancelled; billing problems and how many were recovered. `--days 7|30|90`, `--csv`, `--json`.
- **Profit after Apple Ads** (`asc-payout profit`, from the menu, or **p** on a month): revenue, ad spend, profit, ROAS, installs and cost per install by app, for the same days. Connect Apple Ads in Settings: asc-payout can make the key pair for you and put the public key on the clipboard; the client, team and key IDs are checked with Apple before saving.
- **Monthly goals** (Settings > Monthly goals): a goal per account and one for all accounts together, in any currency. The month screen shows a progress bar, and while the month is running, whether the forecast reaches it.
- **Türkçe**: menus and screens in Turkish, with Turkish month names, dates and number formats. It follows the system language; change it in Settings > Language, or with `ASC_PAYOUT_LANG=en|tr`. `--json`, `--csv` and `--help` stay in English.
- Export menu: refunds and cancellations as CSV.

## 1.5.0

- A home menu: `asc-payout` opens a menu with everything the tool does (this month, last month, any month, history, subscriptions, export, account, settings, check setup), so no option has to be learned.
- Esc goes back one step everywhere, and every menu has a "← Back" entry; on a month screen **b** goes back to the menu and **q** quits.
- Account setup is a form: the fields filled in so far, the current step, and Esc to go back without losing what was typed. Before saving, the key and vendor number are checked; on a problem you can go back and fix it.
- Settings: accounts (change, check access, remove), currency, notifications (check now, turn a daily check on or off: Task Scheduler, launchd or cron), check for updates, refresh app names, where files are kept.
- Export to CSV from the menu (a month, the last 12 months, a year, subscriptions), or with **e** on a month; files go to the Downloads folder.
- First run without an account: set one up, or look around with demo data.
- A month with nothing to pay says so, and a long-closed month without a Financial Report says nothing was settled.
- Key presses on the month screen work reliably on Windows (the second key press was lost before).

## 1.4.1

- Builds for Windows ARM64 and musl Linux (Alpine); the installers pick them automatically.
- Every release carries a Homebrew formula and a Scoop manifest (see docs/publishing.md).
- Animated demo in the README, rendered from docs/demo.tape with made-up data.
- Shorter forecast line, so it fits 80 columns.

## 1.4.0

- `asc-payout subs`: active subscriptions per app (paying, free trials, billing retry and grace period), MRR, and the last 30 days of trials, trial-to-paid conversions, new paid subscriptions, renewals, cancellations and refunds (`--days N`).
- `--csv` for the month view, history and subscriptions.
- `asc-payout history --year 2026`: the months of a calendar year.
- `asc-payout watch`: announces last month's final numbers once Apple publishes them, with a desktop notification (Windows, macOS, Linux). Made for a daily scheduled run.
- A live loading line while reports download: the current step, a progress bar for daily reports and the time so far. It disappears when the results are shown, and is off when output is not a terminal (`ASC_PAYOUT_NO_SPINNER=1`).
- Apple sometimes answers "no sales" for a report that is only late. Such answers are no longer stored for the last three days or for subscription snapshots, and a late snapshot falls back to the day before.

## 1.3.0

- The difference between Reports and Trends is explained to the cent from the Financial Detail Report: sales made before the month that Apple settled in this report, and this month's sales that settle in the next one.
- Daily bar chart of the month (Trends) with the best day.
- Keyboard: a month picked from the menus stays on screen; arrow keys move between months and accounts, `c` toggles apps and countries, `q` quits.
- `asc-payout history`: payments of the last 12 months (`--months N`), per account and in total, month-on-month change, and the biggest apps.
- `--by country`: earnings per country.
- Months long closed without a Financial Report (no sales) are remembered, not asked for again.
- Financial Detail rows without a transaction date (they occur in real reports) are counted by their settlement date.

## 1.2.0

- Reports are written to the cache in one step and checked before every use (row count or totals against the report's own summary); a damaged or incomplete file is downloaded again instead of being counted.
- Exchange rates of past days are stored: a closed month always shows the same totals, also offline.
- `asc-payout doctor`: checks clock, keys, access to Sales reports, Financial Reports and the app list, exchange-rate services and the cache folder, and says how to fix problems.
- `asc-payout update`: installs the latest release in place (checksum verified); a quiet hint appears once a day when a new release is out (`ASC_PAYOUT_NO_UPDATE_CHECK=1` turns it off).
- Rows that include an amount without an exchange rate are marked with `*`.
- End-to-end tests against a simulated App Store Connect (missing days, rate limits, server errors, incomplete files, no access) and tests for setup and menus.

## 1.1.0

- The screen is cleared when asc-payout starts, like `clear`; `--no-clear` or `ASC_PAYOUT_NO_CLEAR=1` keeps it. Never for `--json` or piped output.
- macOS and Linux installer adds the install folder to PATH in your shell's startup file, so `asc-payout` works in new terminals.

## 1.0.1

- Windows installer no longer changes settings of the PowerShell window it runs in.

## 1.0.0

First release.

- Reports (Financial Report) and Trends (daily Sales reports) side by side, per app and in-app purchase.
- Apple fiscal calendar, including 53-week years.
- Financial Reports checked against their own country summary.
- Exchange rates as of the month end, with fallbacks; no 1:1 guesses.
- Forecast for a running month.
- Several accounts, `--account all` with a combined table.
- One Finance key is enough; in-app purchases are grouped through Sales reports.
- Setup finds the downloaded `.p8` key and reads the Key ID from its name, and checks access before saving.
- `--json`, `--currency`, partial account names, remembered account choice.
