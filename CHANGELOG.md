# Changelog

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
