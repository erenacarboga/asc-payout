# asc-payout

[Türkçe](README.tr.md)

**What will Apple pay me for this month?** `asc-payout` answers from your own App Store Connect data, per Apple fiscal month, with two sources side by side:

- **Reports**: Apple's Financial Report. Final, and what the payment is based on. Published a few days after the month closes.
- **Trends**: the daily Sales reports of every day in the month, added up. Available while the month is running, with a forecast for the whole month.

One or many accounts (say, a company and a personal developer account), every currency converted at the month-end rate.

```
  Demo Studio  ·  October 2026  ·  Sep 27 - Oct 31, 2026

  App / product                                   Reports       Trends
  ────────────────────────────────────────────────────────────────────
  Photo Editor Pro                                $847.22      $812.40
    Pro Yearly                                    $599.99      $580.10
    Pro Monthly                                   $247.23      $232.30

  Task Planner                                    $234.50      $241.75
    Premium Upgrade                               $234.50      $241.75

  Weather Glance                                   $89.97       $89.97
  ────────────────────────────────────────────────────────────────────
  Total                                         $1,171.69    $1,144.12

  Payment   ~$1,171.69  ·  expected around Dec 3, 2026  (from Reports)
  Reports   Apple Financial Report, the final figures.
            Rows match the report's own country summary.
  Trends    35 of 35 days (through Oct 31).
  Daily     ▆▅▄▄▄▄▅ ▅▅▅▄▅▅▆ ▅▄▅▄▄▅▇ ▆▅▆▅▄▅▇ ▆▄▆▆▅▅█  peak $55.76 on Oct 31
  Diff      Reports +$27.57 (+2.4%) vs Trends, because the Financial Report has:
               +$105.45  sales made before Sep 27, settled now
                -$77.88  this period's sales Apple settles in the next report
  Rates     as of Oct 31, 2026 · ECB
            Before tax withholding and bank fees; Apple's rates differ slightly.
```

Try it without an account: `asc-payout demo` (made-up numbers).

## Install

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.ps1 | iex
```

Builds for Windows x64, macOS (Apple silicon and Intel) and Linux (x64 and arm64). The installer checks the SHA-256 of the download and puts `asc-payout` on your PATH: on Windows in your user PATH, on macOS and Linux by adding one line to your shell's startup file (`~/.zshrc`, `~/.bashrc`, `~/.bash_profile` or fish config; skip with `ASC_PAYOUT_NO_MODIFY_PATH=1`). Open a new terminal afterwards and type `asc-payout`. Run the installer again to update.

<details>
<summary>While the repository is private</summary>

Sign in once with the [GitHub CLI](https://cli.github.com) (`gh auth login`), then:

```bash
gh api repos/erenacarboga/asc-payout/contents/install.sh -H "Accept: application/vnd.github.raw" | bash
```

```powershell
gh api repos/erenacarboga/asc-payout/contents/install.ps1 -H "Accept: application/vnd.github.raw" | Out-String | iex
```
</details>

## Set up

```
asc-payout setup
```

You need two things from App Store Connect:

1. **An API key with the Finance role**: Users and Access > Integrations > App Store Connect API. Download the `.p8` file. Setup finds it in your Downloads folder and reads the Key ID from its name; you paste the Issuer ID shown above the keys list.
2. **Your vendor number**: Payments and Financial Reports, top left.

Setup checks both with Apple before saving. Add a second account the same way; on the same App Store Connect team it can reuse the key.

One key is enough: app names come from your app list, and in-app purchases are matched to their app through the Sales reports. A second key with the App Manager role is optional (setup > edit account) and only helps name in-app purchases that had no sales in the months you look at.

## Use

```
asc-payout                          choose account and month (defaults: last account, last closed month)
asc-payout -a personal -m 2026-10   no questions; a part of the account name is enough
asc-payout -a all                   every account, then a combined table
asc-payout -m 2026-11 -c EUR        a running month, shown in euros
asc-payout -a all --json            machine-readable output
asc-payout history -a all           the last 12 months side by side, with your biggest apps
asc-payout -m 2026-10 --by country  where the money came from
```

Picked from the menus, the month stays on screen: **← →** go to the previous or next month, **↑ ↓** switch account (or all accounts), **c** switches between apps and countries, **q** quits.

| Option | |
|---|---|
| `-a, --account <name>` | account name (or part of it), vendor number, or `all` |
| `-m, --month <YYYY-MM>` | fiscal month named after the calendar month: `2026-10` is Sep 27 - Oct 31, 2026 |
| `-c, --currency <CODE>` | display currency for this run |
| `--json` | JSON on stdout, progress on stderr |
| `--no-cache` | download reports again |
| `--refresh` | reload app names |
| `--by country` | one row per country instead of per app |
| `history [--months N]` | payments of the last N months (default 12), month-on-month change, top apps |
| `--no-clear` | keep the screen; by default it is cleared first (also `ASC_PAYOUT_NO_CLEAR=1`) |
| `setup`, `status`, `demo` | manage accounts, show where files are, try with made-up data |
| `doctor` | check clock, keys, access to each report, network and cache, with the fix for anything wrong |
| `update` | install the latest release (also told once a day when one is out) |

For scripts and CI, an account can come from environment variables instead of setup: `ASC_PAYOUT_VENDOR`, `ASC_PAYOUT_ISSUER_ID`, `ASC_PAYOUT_KEY_ID`, `ASC_PAYOUT_KEY_FILE` (and optionally `ASC_PAYOUT_CURRENCY`).

## How the numbers are made

- **Fiscal months.** Apple's fiscal year ends on the last Saturday of September; quarters are 5, 4 and 4 weeks, and a 53-week year adds its extra week to December. When the Financial Report exists, its own dates are used.
- **Reports** add up `Extended Partner Share` per `Partner Share Currency`, and check the rows against the per-country summary at the end of the same report.
- **Trends** add up `Units × Developer Proceeds` per `Currency of Proceeds` from one daily report per day; refunds have negative units. Days Apple has not published yet are told apart from days without sales, and failures are listed instead of counted as zero.
- **Why Reports and Trends differ, exactly.** The Financial Detail Report has the day of every transaction. asc-payout splits the difference into sales made before the month that Apple settled in this report, and this month's sales that Apple settles in the next one; the two add up to the difference to the cent. (Shown only when the detail report adds up exactly to the Financial Report.)
- **Daily** shows one bar per day of the month (Trends), a space between weeks, `·` for days Apple hasn't published yet.
- **Forecast**, for a running month: sales so far plus the remaining days at the last 7 days' average.
- **Exchange rates** are the same for both columns, taken on the last day of the month: ECB reference rates ([Frankfurter](https://frankfurter.dev)), then [exchange-api](https://github.com/fawazahmed0/exchange-api) and [open.er-api.com](https://www.exchangerate-api.com) for currencies the ECB doesn't cover. An amount without any rate is listed separately, never counted 1:1.
- **Reports and Trends differ** by a few percent in a normal month: sales near the month edge can fall into the neighbouring Financial Report, refunds can be dated differently, and adjustments only appear in Reports. For an account that only sold on a few days, the gap can be large.
- **Nothing half-done is used.** Downloads are written to the cache in one step, and every stored report is checked before it is read again (its own row count or totals). A damaged file is thrown away and downloaded again.
- **Same numbers every time.** The exchange rates of a past day are stored, so a closed month always shows the same totals, even offline.
- **Payment** is expected about 33 days after the month ends. Amounts are before tax withholding and bank fees, and Apple's own exchange rates differ slightly from the ones used here.

## Privacy

Runs on your computer only. It talks to App Store Connect with your key and sends nothing but currency codes and dates to the exchange-rate services. No telemetry. Settings and keys are in `~/.config/asc-payout` (Windows: `%USERPROFILE%\.config\asc-payout`), downloaded reports in `~/.cache/asc-payout`; `asc-payout status` shows the exact folders. Copy the settings folder to move your setup to another computer, and keep it private: it holds your API keys.

## Develop

```bash
bun install
bun run dev demo     # run from source
bun test
bun run typecheck
```

To release: set `version` in `package.json`, add a line to `CHANGELOG.md`, then `git tag v1.2.3 && git push origin v1.2.3`.

## License

MIT. Not affiliated with Apple. App Store and App Store Connect are trademarks of Apple Inc.
