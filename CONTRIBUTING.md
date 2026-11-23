# Contributing

Bug reports and pull requests are welcome.

```bash
bun install
bun run dev demo
bun test
bun run typecheck
```

- Anything that changes how money, dates or exchange rates are calculated needs a test in `test/`.
- Test data is made up. Never add real reports, `.p8` keys, issuer IDs, vendor numbers or revenue.
- Output should stay readable at 80 columns and with `NO_COLOR=1`.

Releases: bump `version` in `package.json`, note it in `CHANGELOG.md`, push a tag `vX.Y.Z`. The release workflow refuses a tag that doesn't match `package.json`.
