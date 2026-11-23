# asc-payout

[![Release](https://img.shields.io/github/v/release/erenacarboga/asc-payout)](https://github.com/erenacarboga/asc-payout/releases/latest) [![CI](https://github.com/erenacarboga/asc-payout/actions/workflows/ci.yml/badge.svg)](https://github.com/erenacarboga/asc-payout/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Türkçe](README.tr.md)

**What will Apple pay me for this month?** `asc-payout` answers from your own App Store Connect data, per Apple fiscal month, with two sources side by side:

- **Reports**: Apple's Financial Report. Final, and what the payment is based on. Published a few days after the month closes.
- **Trends**: the daily Sales reports of every day in the month, added up. Available while the month is running, with a forecast for the whole month.

One or many developer accounts, every currency converted at the month-end rate. Also: details per app, refunds and cancellations, profit after Apple Ads, monthly goals. In English or Turkish.

```
  Account 1  ·  October 2026  ·  Sep 27 - Oct 31, 2026

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
  Goal      ████████████████ 107%  $1,171.69 of $1,100.00  ·  reached, $71.69 over
  Reports   Apple Financial Report, the final figures.
            Rows match the report's own country summary.
  Trends    35 of 35 days (through Oct 31).
  Daily     ▄▂▂▂▃▃▂ ▃▂▃▂▃▄▄ ▃▂▃▂▂▄▇ ▄▂▄▃▂▃▆ ▄▂▅▅▃▃█  peak $97.22 on Oct 31
  Diff      Reports +$27.57 (+2.4%) vs Trends, because the Financial Report has:
               +$105.45  sales made before Sep 27, settled now
                -$77.88  this period's sales Apple settles in the next report
  Rates     as of Oct 31, 2026 · ECB
            Before tax withholding and bank fees; Apple's rates differ slightly.
```

Try it without an account: `asc-payout demo` (made-up numbers).

![asc-payout demo](docs/demo.gif)

## Install

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.ps1 | iex
```

Builds for Windows (x64, ARM64), macOS (Apple silicon, Intel) and Linux (x64, arm64, and musl for Alpine). The installer checks the SHA-256 of the download and puts `asc-payout` on your PATH: on Windows in your user PATH, on macOS and Linux by adding one line to your shell's startup file (`~/.zshrc`, `~/.bashrc`, `~/.bash_profile` or fish config; skip with `ASC_PAYOUT_NO_MODIFY_PATH=1`). Open a new terminal afterwards and type `asc-payout`. Run the installer again to update.


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

Type `asc-payout`. A menu opens; everything the tool can do is in it, no options to learn:

```
  asc-payout 1.6.0   All accounts  ·  USD

? What would you like to see?
  t This month so far           November 2026  ·  Nov 1 - Nov 28, 2026  ·  running
❯ l Last month                  October 2026  ·  Sep 27 - Oct 31, 2026
  m Another month…
  h History…                    months side by side, top apps
  s Subscriptions…              paying, trials, MRR
  c Refunds and cancellations…  who leaves, why, trial conversion
  p Profit after Apple Ads…     revenue, ad spend, ROAS by app
  e Export to a file…           CSV for Excel, Numbers, Google Sheets

  a Account                     All accounts
  o Settings                    accounts, goals, Apple Ads, language, updates
  d Check my setup              keys, access, clock, network
  q Quit
  ↑↓ move · enter select · q quit
```

Arrow keys and Enter, or the letter in front of an item. **Esc** always goes back one step, in menus and while setting up an account. On a month: **← →** previous / next month, **↑ ↓** another account, **c** countries, **d** details of an app, **p** profit after Apple Ads, **r** download again, **e** save as CSV, **b** back, **q** quit.

### App details

On a month, press **d** and pick an app: its products, a bar per day, refunds (units and money, and the share of units sold), and the countries it earned in.

### Refunds and cancellations

`asc-payout churn` (or *Refunds and cancellations…* in the menu), over the last 7, 30 or 90 days:

```
  Account 1  ·  Refunds and cancellations  ·  last 30 days, Oct 24 - Nov 22, 2026

  App                             Trials  → paid       Cancels  Refunds   Rate
  ────────────────────────────────────────────────────────────────────────────
  Photo Editor Pro                   147      16  11%      120        2     1%
  Task Planner                        87      26  30%       70        0     0%
  ────────────────────────────────────────────────────────────────────────────
  Total                              234      42  18%      190        2     1%
  → paid: trials that became paid in the same period.  Rate: refunded units of all sold (275).
  Refunded  $13.98

  Week               Trials  → paid  Rate  Cancels
  Oct 24 - Oct 25         9       1   11%        4  ██████
  Oct 26 - Nov 1         52       8   15%       41  █████████
  Nov 2 - Nov 8          63      13   21%       52  ████████████
  Nov 9 - Nov 15         58       9   16%       50  █████████
  Nov 16 - Nov 22        52      11   21%       43  ████████████

  Why       Canceled 186  ·  Billing issue 4
  Billing   21 had a payment problem  ·  14 recovered  ·  4 lost  (78% saved)
```

Trials started and how many became paid in the same days, cancellations and why (Apple's reason), billing problems and how many Apple recovered, and refunds by app. From the daily subscription event reports and the Sales reports.

### Monthly goals

Settings > Monthly goals: a goal per account, and one for all accounts together, in the currency you choose. The month screen shows how far along you are, and while the month is running, whether the forecast reaches it:

```
  Goal      ██████████████░░  85%  $851.12 of $1,000.00  ·  on track (forecast ~$1,142.90)
```

### Profit after Apple Ads

`asc-payout profit` (menu: *Profit after Apple Ads…*, or **p** on a month) puts each app's revenue next to what its Apple Ads campaigns spent in the same days:

```
  Profit after Apple Ads  ·  October 2026  ·  Sep 27 - Oct 31, 2026

  App                            Revenue    Ad spend      Profit   ROAS  Installs  Per install
  ────────────────────────────────────────────────────────────────────────────────────────────
  Photo Editor Pro               $847.22     $310.50     $536.72   2.7x       402        $0.77
  Task Planner                   $234.50      $96.20     $138.30   2.4x        88        $1.09
  Weather Glance                  $89.97           —      $89.97      —         —            —
  ────────────────────────────────────────────────────────────────────────────────────────────
  Total                        $1,171.69     $406.70     $764.99   2.9x       490        $0.83
```

Revenue is what Apple pays for the month (Reports, else Trends), so it includes sales without an ad: ROAS here is revenue / ad spend. Campaigns in other currencies are converted like everything else.

Connect it once in Settings > Apple Ads:

1. In Apple Ads > Account Settings > User Management, invite a user with an API role (API Account Read Only is enough) and sign in as that user.
2. In asc-payout choose *Make a new key for me*: it makes the key pair, keeps the private key in your settings folder and puts the public key on your clipboard.
3. In Apple Ads > Account Settings > API, paste the public key and save. Type the client ID, team ID and key ID it shows into asc-payout, which checks them with Apple before saving.

Already have a private key (.pem)? Choose *I already have a private key file*.

### Language

The menus and screens are in English or Turkish (Türkçe), following the system language. Change it in Settings > Language, or for one run with `ASC_PAYOUT_LANG=en` / `ASC_PAYOUT_LANG=tr`. `--json`, `--csv` and `--help` are always in English.

### Options, for scripts

The same things without the menu:

```
asc-payout                          choose account and month (defaults: last account, last closed month)
asc-payout -a "account 2" -m 2026-10  no questions; a part of the account name is enough
asc-payout -a all                   every account, then a combined table
asc-payout -m 2026-11 -c EUR        a running month, shown in euros
asc-payout -a all --json            machine-readable output
asc-payout history -a all           the last 12 months side by side, with your biggest apps
asc-payout -m 2026-10 --by country  where the money came from
asc-payout history --year 2026 --csv  a year, ready for a spreadsheet
asc-payout subs                     paying subscribers, trials, MRR and the last 30 days
asc-payout churn --days 90          refunds, cancellations and why, trial conversion by week
asc-payout profit -m 2026-10        revenue, Apple Ads spend, profit and ROAS by app
asc-payout watch                    announce last month's final numbers once Apple publishes them
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
| `history --year YYYY` | January to December of a year |
| `subs [--days N]` | active subscriptions per app (paying, trials, billing issues, MRR) and the last N days' trials, conversions, renewals, cancellations, refunds |
| `churn [--days N]` | per app: trials, trials that became paid, cancellations, refunds; weekly conversion; cancellation reasons; billing problems recovered or lost |
| `profit [-m YYYY-MM]` | revenue next to Apple Ads spend by app: profit, ROAS, installs, cost per install (needs Apple Ads in Settings) |
| `watch` | when last month's Financial Report is out: a desktop notification and a line of output, once |
| `--csv` | CSV instead of the table (month, history, subs, churn, profit) |
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

## Get told when the month is final

`asc-payout watch` checks whether Apple has published last month's Financial Report and announces it once (a desktop notification and a line of output). Run it every morning:

- **Windows:** `schtasks /create /sc daily /st 10:00 /tn asc-payout-watch /tr "%LOCALAPPDATA%\Programs\asc-payout\asc-payout.exe watch"`
- **macOS / Linux:** add `0 10 * * * ~/.local/bin/asc-payout watch` with `crontab -e`

`ASC_PAYOUT_NOTIFY=off` prints without a notification.

## Subscriptions

`asc-payout subs` reads Apple's subscription reports: on the latest published day, how many subscriptions pay (standard price or a paid offer), how many are in a free trial and how many have a billing problem, per app, with the monthly recurring proceeds (MRR: weekly × 4.35, yearly ÷ 12, at each subscription's current price, before tax). Below it, the last 30 days of events: new trials, trial-to-paid conversions, new paid subscriptions, renewals, cancellations and refunds. Apple sometimes answers "no sales" for a snapshot that is only late; asc-payout then uses the day before instead of showing zero.

## Privacy

Runs on your computer only. It talks to App Store Connect (and Apple Ads, if you connect it) with your keys and sends nothing but currency codes and dates to the exchange-rate services. No telemetry. Settings and keys are in `~/.config/asc-payout` (Windows: `%USERPROFILE%\.config\asc-payout`), downloaded reports in `~/.cache/asc-payout`; `asc-payout status` shows the exact folders. Copy the settings folder to move your setup to another computer, and keep it private: it holds your API keys.

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
