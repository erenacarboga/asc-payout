# asc-payout JSON output

Every command with `--json` prints one JSON object on stdout with a `version` field. Amounts are numbers in the display currency (`currency`, default from settings, or `-c`). Dates are `YYYY-MM-DD`. Months are `{ "year": 2026, "month": 10 }`, named after the calendar month the fiscal month mostly covers.

## Month: `asc-payout [-a …] [-m YYYY-MM] --json`

```jsonc
{
  "version": "1.6.1",
  "results": [ /* one per account */ ],
  "errors": [{ "account": "Account 2", "error": "…" }]   // accounts that could not be read
}
```

Each entry of `results`:

| Field | Meaning |
|---|---|
| `account.name`, `account.vendor` | Account name and vendor number |
| `month`, `period.start`, `period.end` | Fiscal month and its first/last day |
| `currency` | Currency of every amount in this result |
| `payment.amount` | **What Apple pays for this month** when `basis` is `reports`; before that, the real sales so far (no projection) |
| `payment.basis` | `reports` (final, Apple's Financial Report), `trends` (month complete, no Financial Report yet: Trends total), `trends-so-far` (month running: Trends so far) |
| `payment.date`, `payment.paid` | Expected payment day; `true` once that day has passed |
| `reports.status` | `ok`, `in-progress` (month not over), `not-published` (Apple hasn't published it yet), `none` (nothing was settled), `no-access` (the key lacks the Finance role), `failed` (`reports.message` says why) |
| `reports.total` | Financial Report total, or `null` when not available |
| `reports.mismatches[]` | Currencies whose rows don't add up to the report's own summary (should be empty) |
| `trends.total` | Sum of the daily Sales reports for the period (so far) |
| `trends.days`, `trends.available`, `trends.through` | Days in the period, days with a published report, last day included |
| `trends.problems[]` | Days that could not be read (not counted as zero) |
| `trends.skipped` | `true` when daily reports were not downloaded (a history month that already has its Financial Report) |
| `apps[]` | Per app, largest first: `name`, `appId` (App Store ID, when known), `reports`, `trends`, and `items[]` per product (in-app purchases, subscriptions) with the same fields |
| `countries[]` | `{ code, reports, trends }` per country (ISO code) |
| `daily[]` | `{ date, total }` per day; `total` is `null` for days not published yet |
| `settlement` | When available: `earlier` (sales made before the period, settled in this report), `inPeriod`, `later` (this period's sales settled in the next report). `reports.total - trends.total = earlier - later` |
| `rates.date`, `rates.sources` | Exchange rates used and where they came from |
| `rates.unconverted[]` | `{ in, currency, amount }` amounts with no exchange rate, **not** in the totals |

## History: `asc-payout history [-a …] [--months N | --year YYYY] --json`

```jsonc
{ "version": "…", "history": [ { "name": "Account 1", "months": [ /* month results, newest first; null if unreadable */ ], "errors": [] } ] }
```

Each month is the same object as in `results` above. For closed months with a Financial Report, `trends.skipped` is usually `true` (only Reports were read).

## Subscriptions: `asc-payout subs [-a …] [--days N] --json`

```jsonc
{ "version": "…", "subscriptions": [ /* per account */ ], "errors": [] }
```

| Field | Meaning |
|---|---|
| `asOf` | Day of the subscription snapshot (the latest Apple has published, usually yesterday) |
| `apps[].paying` | Subscriptions paying the standard price or a paid offer |
| `apps[].trials` | In a free trial (introductory, promotional, offer code, win-back) |
| `apps[].billingIssues` | In billing retry or a grace period |
| `apps[].mrr` | Monthly recurring proceeds in `currency` (weekly × 4.35, yearly ÷ 12, at current prices; pay-up-front offers excluded) |
| `apps[].events` | Over `window` (`from`, `to`, `days`, `available`): `trialStarts`, `trialConversions`, `newPaid`, `renewals`, `cancellations` (turned off renewal), `refunds`, `billingRecovered`, and `all` (every Apple event name with its quantity) |
| `unconverted[]` | Currencies with no exchange rate (left out of `mrr`) |

## Refunds and cancellations: `asc-payout churn [-a …] [--days N] --json`

```jsonc
{ "version": "…", "churn": [ /* per account */ ], "errors": [] }
```

| Field | Meaning |
|---|---|
| `window` | `{ from, to, days, available }`: the days covered and how many had reports |
| `apps[]` | Per app: `trialStarts`, `conversions` (trials that became paid in the window), `newPaid`, `cancellations` (turned off renewal), `sold` and `refunded` (units, from Sales reports), `refundAmount` (in `currency`) |
| `weeks[]` | `{ from, to, trialStarts, conversions, cancellations }`, oldest first |
| `reasons` | Cancellation reason (as Apple writes it, e.g. `Canceled`, `Billing issue`, `Price increase`, or `Not given`) → count |
| `billing` | `entered` (a payment failed: into billing retry or grace period), `recovered`, `lost` (cancelled after billing retry) |

Refund rate = `refunded / sold`. Trial conversion = `conversions / trialStarts` (both within the same window, so recent trials may still convert).

## Profit: `asc-payout profit [-a …] [-m YYYY-MM] --json`

Needs Apple Ads connected in `asc-payout setup`.

```jsonc
{ "version": "…", "profit": { "month": {…}, "period": {…}, "spendFrom": "…", "spendTo": "…", "currency": "USD", "revenueBasis": "reports", "apps": [ … ], "orgs": [ … ], "unconverted": [] } }
```

| Field | Meaning |
|---|---|
| `apps[].revenue` | What Apple pays for the app for the month (Reports, else Trends); `null` for an advertised app none of the accounts sells |
| `apps[].spend` | Apple Ads spend on the app's campaigns over `spendFrom`..`spendTo`, in `currency` |
| `apps[].installs`, `apps[].taps`, `apps[].campaigns` | From Apple Ads |
| `revenueBasis` | `reports`, `trends`, or `mixed` (several accounts in different states) |
| `orgs[]` | Apple Ads organizations read |
| `unconverted[]` | Spend with no exchange rate, not in `spend` |

Profit = `revenue - spend`; ROAS = `revenue / spend`; cost per install = `spend / installs`. Revenue includes sales not caused by ads.

## CSV

`--csv` gives the same data as flat rows (header row first, `\r\n` line ends): month (per product), history (per month), subs (per app), churn (per app), profit (per app).
