# Publishing

Steps that need your own accounts. Nothing here runs automatically.

## Homebrew and Scoop

Every release has `asc-payout.rb` (Homebrew formula) and `asc-payout.json` (Scoop manifest) attached, with the right URLs and checksums.

**Homebrew tap**

1. Create a public repository named `homebrew-tap` under your account.
2. Copy the release's `asc-payout.rb` into it as `Formula/asc-payout.rb` and push.
3. Users install with:
   ```
   brew install erenacarboga/tap/asc-payout
   ```
4. For each new release, replace the file with the new release's `asc-payout.rb`.

**Scoop bucket**

1. Create a public repository, e.g. `scoop-bucket`.
2. Copy the release's `asc-payout.json` into it as `bucket/asc-payout.json` and push.
3. Users install with:
   ```
   scoop bucket add erenacarboga https://github.com/erenacarboga/scoop-bucket
   scoop install asc-payout
   ```
   The manifest has `checkver` and `autoupdate`, so Scoop's tooling can update it.

## Signing the macOS builds

Builds downloaded with `curl` (the install script) are not quarantined and run as they are. A build downloaded **in a browser** is blocked by Gatekeeper until it is signed with a Developer ID and notarized. With an Apple Developer account:

1. In Xcode or developer.apple.com, create a **Developer ID Application** certificate and export it as a `.p12` with a password.
2. Create an app-specific password for your Apple ID (appleid.apple.com) for notarization.
3. On a Mac, for each of `asc-payout-darwin-arm64` and `asc-payout-darwin-x64` from a release:
   ```
   codesign --force --options runtime --timestamp --sign "Developer ID Application: <Your Name> (<TEAMID>)" asc-payout-darwin-arm64
   ditto -c -k --keepParent asc-payout-darwin-arm64 asc-payout-darwin-arm64.zip
   xcrun notarytool submit asc-payout-darwin-arm64.zip --apple-id <you@example.com> --team-id <TEAMID> --password <app-specific-password> --wait
   ```
   A bare executable can't be stapled; Gatekeeper checks the notarization online on first run.
4. Upload the signed files to the release (replacing the unsigned ones) and regenerate `SHA256SUMS`, `asc-payout.rb` and `asc-payout.json`:
   ```
   bun scripts/package-manifests.ts vX.Y.Z <folder with the files and SHA256SUMS>
   ```

To automate it later, store the `.p12` (base64), its password, the Apple ID, team ID and app-specific password as repository secrets and run the commands above on a `macos-latest` runner.

## Demo GIF

Actions > **Demo GIF** > Run workflow redraws `docs/demo.gif` from `docs/demo.tape` with made-up data and commits it.
