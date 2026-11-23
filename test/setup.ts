import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests never touch the real settings, cache or screen.
const root = mkdtempSync(join(tmpdir(), "asc-payout-test-"));
process.env.ASC_PAYOUT_CONFIG_DIR = join(root, "config");
process.env.ASC_PAYOUT_CACHE_DIR = join(root, "cache");
process.env.ASC_PAYOUT_NO_CLEAR = "1";
process.env.NO_COLOR = "1";
process.env.ASC_PAYOUT_NO_UPDATE_CHECK = "1";
for (const name of ["ASC_PAYOUT_VENDOR", "ASC_PAYOUT_ISSUER_ID", "ASC_PAYOUT_KEY_ID", "ASC_PAYOUT_KEY_FILE", "ASC_PAYOUT_CURRENCY"]) {
  delete process.env[name];
}
