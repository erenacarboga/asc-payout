/**
 * Writes the Homebrew formula and the Scoop manifest for a release, from its
 * SHA256SUMS. Run by the release workflow:
 *
 *   bun scripts/package-manifests.ts <version> <folder with SHA256SUMS>
 *
 * Copy asc-payout.rb into a tap repository (Formula/asc-payout.rb) and
 * asc-payout.json into a Scoop bucket (bucket/asc-payout.json).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [version, dir] = process.argv.slice(2);
if (!version || !dir) throw new Error("usage: bun scripts/package-manifests.ts <version> <folder>");
const v = version.replace(/^v/, "");
const repo = "https://github.com/erenacarboga/asc-payout";
const base = `${repo}/releases/download/v${v}`;
const description = "What Apple will pay you, per fiscal month: App Store Connect Financial Reports and Sales Trends side by side";

const sums = new Map(
  readFileSync(join(dir, "SHA256SUMS"), "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, file] = line.trim().split(/\s+\*?/);
      return [file, hash] as const;
    }),
);
const sha = (asset: string) => {
  const h = sums.get(asset);
  if (!h) throw new Error(`${asset} missing from SHA256SUMS`);
  return h;
};

const brew = `class AscPayout < Formula
  desc "${description}"
  homepage "${repo}"
  version "${v}"
  license "MIT"

  on_macos do
    on_arm do
      url "${base}/asc-payout-darwin-arm64"
      sha256 "${sha("asc-payout-darwin-arm64")}"
    end
    on_intel do
      url "${base}/asc-payout-darwin-x64"
      sha256 "${sha("asc-payout-darwin-x64")}"
    end
  end

  on_linux do
    on_arm do
      url "${base}/asc-payout-linux-arm64"
      sha256 "${sha("asc-payout-linux-arm64")}"
    end
    on_intel do
      url "${base}/asc-payout-linux-x64"
      sha256 "${sha("asc-payout-linux-x64")}"
    end
  end

  def install
    bin.install Dir["asc-payout-*"].first => "asc-payout"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/asc-payout --version")
  end
end
`;

const scoop = {
  version: v,
  description,
  homepage: repo,
  license: "MIT",
  architecture: {
    "64bit": { url: `${base}/asc-payout-windows-x64.exe#/asc-payout.exe`, hash: sha("asc-payout-windows-x64.exe") },
    arm64: { url: `${base}/asc-payout-windows-arm64.exe#/asc-payout.exe`, hash: sha("asc-payout-windows-arm64.exe") },
  },
  bin: "asc-payout.exe",
  checkver: "github",
  autoupdate: {
    architecture: {
      "64bit": { url: `${repo}/releases/download/v$version/asc-payout-windows-x64.exe#/asc-payout.exe` },
      arm64: { url: `${repo}/releases/download/v$version/asc-payout-windows-arm64.exe#/asc-payout.exe` },
    },
    hash: { url: `${repo}/releases/download/v$version/SHA256SUMS` },
  },
};

writeFileSync(join(dir, "asc-payout.rb"), brew);
writeFileSync(join(dir, "asc-payout.json"), JSON.stringify(scoop, null, 2) + "\n");
console.log(`wrote asc-payout.rb and asc-payout.json for ${v}`);
