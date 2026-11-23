---
name: asc-payout
description: Answers questions about App Store earnings with the asc-payout CLI, from the user's own App Store Connect data. Use when the user asks what Apple will pay them or has paid them, earnings or proceeds for a month, Apple fiscal months, Financial Reports vs Sales Trends, per-app or per-country revenue, payment dates, history and trends over months, subscribers, trials, MRR, refunds, cancellations, trial conversion, Apple Ads spend, profit or ROAS, or wants these numbers exported to CSV. Also use to install asc-payout, help set it up, or diagnose why it fails.
---

# asc-payout

`asc-payout` reads the user's App Store Connect reports with their own API key and answers "what will Apple pay me for this month?", per Apple fiscal month, plus subscriptions, refunds and cancellations, and profit after Apple Ads. It runs locally; nothing is sent anywhere except to Apple and to exchange-rate services (currency codes and dates only).

If the asc-payout MCP tools are available (`get_month`, `get_history`, `get_subscriptions`, `get_refunds_and_cancellations`, `get_profit`, `list_accounts`), use them: they return the same JSON as the commands below. Otherwise run the CLI yourself and read its JSON. Never guess numbers, and never compute payouts by hand from Apple's raw reports when the tool can answer.

## 1. Make sure it is installed

```bash
asc-payout --version
```

If the command is missing, install it (it puts `asc-payout` on PATH; a new terminal may be needed):

- macOS / Linux: `curl -fsSL https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.sh | bash`
- Windows (PowerShell): `irm https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.ps1 | iex`

Ask before installing software on the user's machine.

## 2. Make sure an account is set up

```bash
asc-payout status
```

If no account is set up, setup is **interactive**: you cannot complete it for the user. Ask them to run `asc-payout setup` in their own terminal. They need:

1. An App Store Connect API key with the **Finance** role (Users and Access > Integrations > App Store Connect API) and its downloaded `.p8` file.
2. Their **vendor number** (Payments and Financial Reports, top left).

For a one-off run without setup (CI, scripts), an account can come from environment variables: `ASC_PAYOUT_VENDOR`, `ASC_PAYOUT_ISSUER_ID`, `ASC_PAYOUT_KEY_ID`, `ASC_PAYOUT_KEY_FILE`.

Never print, copy, upload or paste the contents of key files (`*.p8`, `*.pem`) or of the settings folder (`~/.config/asc-payout`). Never ask the user to paste a private key into the chat.

## 3. Run commands the non-interactive way

Rules for every call:

- Add `--json`. Output is then machine-readable and always in English; progress goes to stderr. Parse stdout only.
- Name the account: `-a all`, or `-a <name or vendor number>` (a unique part of the name works). Without it, a computer with several accounts stops with a usage error instead of asking.
- Commands download reports, and the first run of a month can take a minute: use a generous timeout. Later runs use the local cache and are fast.
- Exit codes: `0` ok, `1` something could not be read (the JSON's `errors` says what; other numbers are still valid), `2` usage error (message on stderr).

| The user wants | Command |
|---|---|
| Last month's payment (the month that just closed) | `asc-payout -a all --json` |
| A given month | `asc-payout -a all -m 2026-10 --json` |
| This month so far | `asc-payout -a all -m <current YYYY-MM> --json` |
| By country | add `--by country` (countries are in `results[].countries` either way) |
| In another currency | add `-c EUR` (any ISO code) |
| The last N months / a year | `asc-payout history -a all --months 12 --json`, `asc-payout history -a all --year 2026 --json` |
| Subscribers, trials, MRR | `asc-payout subs -a all --json` (`--days 30` window for events) |
| Refunds, cancellations, trial conversion | `asc-payout churn -a all --days 30 --json` (7, 30 or 90 are typical) |
| Profit and ROAS with Apple Ads | `asc-payout profit -a all -m 2026-10 --json` (needs Apple Ads connected in `asc-payout setup`) |
| A spreadsheet | the same commands with `--csv` instead of `--json` |
| Something fails | `asc-payout doctor` (checks clock, keys, report access, network, cache, and prints the fix) |
| Try without an account | `asc-payout demo --account all --json` (made-up data; say so when you show it) |

Field-by-field descriptions of every JSON output: [references/json-output.md](references/json-output.md).

## 4. Read the numbers correctly

Apple's fiscal calendar and the two sources are the most common source of wrong answers:

- **Fiscal months, not calendar months.** `2026-10` means *October 2026* in Apple's fiscal calendar: Sep 27 - Oct 31, 2026 (`results[].period`). Fiscal years end on the last Saturday of September; quarters are 5 + 4 + 4 weeks. Always state the period when you give a number.
- **Reports** (`reports.total`) is Apple's Financial Report: final, and what the payment is based on. It appears a few days after the month closes; before that `reports.status` is `in-progress` or `not-published` and `total` is `null`.
- **Trends** (`trends.total`) adds up the daily Sales reports: the real sales so far while the month runs. It differs from Reports by a few percent in a normal month (timing at month edges, refunds, adjustments); `settlement` explains the difference exactly when available. Never add Reports and Trends together.
- **Payment** (`payment.amount`) is final only when `payment.basis` is `"reports"` (Apple's Financial Report). Before that it is the real sales so far (`trends-so-far`, month running) or of the whole month (`trends`, report not out yet): say it is not final yet. Never project the rest of the month from averages. `payment.date` is the expected payment day (about 33 days after the month ends); `paid: true` when that day has passed.
- Amounts are **proceeds after Apple's commission**, before tax withholding and bank fees, converted at the month-end exchange rate into `currency`. Apple's own rates differ slightly, so the bank amount will not match to the cent.
- Several accounts: each has its own entry in `results`; the combined figure is the sum of `payment.amount` across them (same currency).
- `rates.unconverted` lists amounts with no exchange rate; they are not in the totals. Mention them.
- MRR (`subs`) is monthly recurring proceeds of paying subscriptions at their current price; pay-up-front offers count as paying but not toward MRR.
- `profit`: revenue includes sales that did not come from ads, so ROAS there is revenue / ad spend for the app, not attributed revenue.

## 5. Answer the user

- Lead with the number they asked for, its currency, the fiscal period, and whether it is final (Reports) or the sales so far (Trends).
- Then the few lines that matter: biggest apps (`apps`, already sorted by size), the expected payment date, anything in `errors`, `reports.mismatches`, `trends.problems` or `rates.unconverted`.
- Keep the user's account names as they appear; don't invent labels.
- When numbers look surprising (a large Reports vs Trends gap, a month with nothing), check `reports.status`, `trends.available` vs `trends.days` and `trends.problems` before drawing conclusions, and suggest `asc-payout doctor` for access problems.

## Things the user can do only themselves

- `asc-payout setup` (accounts, currency, monthly goals, Apple Ads, language, notifications): interactive.
- The full-screen menu (`asc-payout` with no arguments): interactive; on a month, keys `← →` change month, `d` shows one app's details, `p` profit, `e` saves a CSV.
- `asc-payout update` changes the installed program: ask first.
