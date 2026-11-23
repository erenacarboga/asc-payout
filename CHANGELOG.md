# Changelog

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
