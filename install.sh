#!/usr/bin/env bash
# asc-payout installer for macOS and Linux
#
#   curl -fsSL https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.sh | bash
#
# Installs the latest release into ~/.local/bin after checking its SHA-256.
#   ASC_PAYOUT_VERSION=v1.0.0   install that version instead of the latest
#   ASC_PAYOUT_BIN_DIR=/opt/bin install somewhere else
# Without direct access to the release (a private repository), the GitHub CLI is used.
set -euo pipefail

repo="erenacarboga/asc-payout"
version="${ASC_PAYOUT_VERSION:-}"
bin_dir="${ASC_PAYOUT_BIN_DIR:-$HOME/.local/bin}"

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64)           asset="asc-payout-darwin-arm64" ;;
  Darwin/x86_64)          asset="asc-payout-darwin-x64" ;;
  Linux/x86_64)           asset="asc-payout-linux-x64" ;;
  Linux/aarch64|Linux/arm64) asset="asc-payout-linux-arm64" ;;
  *) echo "asc-payout: no build for $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [ -n "$version" ]; then url="https://github.com/$repo/releases/download/$version"
else url="https://github.com/$repo/releases/latest/download"; fi

get() {
  if command -v curl >/dev/null; then curl -fsSL -o "$2" "$1"; else wget -qO "$2" "$1"; fi
}

echo "Downloading $asset ${version:-(latest)}"
if ! { get "$url/$asset" "$work/$asset" && get "$url/SHA256SUMS" "$work/SHA256SUMS"; } 2>/dev/null; then
  command -v gh >/dev/null || { echo "Download failed. For a private repository, install the GitHub CLI and run: gh auth login" >&2; exit 1; }
  echo "Direct download not possible; using the GitHub CLI"
  gh release download ${version:+"$version"} -R "$repo" -p "$asset" -p SHA256SUMS -D "$work" --clobber
fi

want="$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$work/SHA256SUMS")"
if command -v sha256sum >/dev/null; then have="$(sha256sum "$work/$asset" | cut -d' ' -f1)"
else have="$(shasum -a 256 "$work/$asset" | cut -d' ' -f1)"; fi
[ -n "$want" ] && [ "$want" = "$have" ] || { echo "Checksum does not match; nothing installed." >&2; exit 1; }

mkdir -p "$bin_dir"
install -m 0755 "$work/$asset" "$bin_dir/asc-payout"
[ "$(uname -s)" = Darwin ] && xattr -d com.apple.quarantine "$bin_dir/asc-payout" 2>/dev/null || true

echo "Installed $("$bin_dir/asc-payout" --version) to $bin_dir/asc-payout"
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "Add it to your PATH, e.g. in ~/.zshrc or ~/.bashrc:  export PATH=\"$bin_dir:\$PATH\"" ;;
esac
echo "Next: asc-payout setup    (or try: asc-payout demo)"
