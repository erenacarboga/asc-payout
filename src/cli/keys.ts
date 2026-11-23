import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { ensureDir, keysDir } from "../config/paths";
import { t } from "../i18n";

const KEY_FILE = /^AuthKey_([A-Z0-9]{10})\.p8$/;

/** "AuthKey_ABCDE12345.p8" -> "ABCDE12345" (Apple's download name carries the Key ID). */
export function keyIdFromFileName(path: string): string | null {
  return KEY_FILE.exec(basename(path))?.[1] ?? null;
}

/** Folders where a freshly downloaded .p8 usually is. */
export function keySearchFolders(): string[] {
  // ASC_PAYOUT_KEY_SEARCH lists the folders instead (separated like PATH)
  if (process.env.ASC_PAYOUT_KEY_SEARCH) return process.env.ASC_PAYOUT_KEY_SEARCH.split(delimiter).filter(Boolean);
  const home = homedir();
  return [join(home, "Downloads"), join(home, "Desktop"), join(home, "Documents"), home, process.cwd(), keysDir()];
}

/** AuthKey_*.p8 files in `folders`, newest first. */
export function findKeyFiles(folders: string[] = keySearchFolders()): { path: string; keyId: string; modified: number }[] {
  const found = new Map<string, { path: string; keyId: string; modified: number }>();
  for (const folder of folders) {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      const keyId = keyIdFromFileName(name);
      if (!keyId) continue;
      const path = resolve(folder, name);
      try {
        found.set(path.toLowerCase(), { path, keyId, modified: statSync(path).mtimeMs });
      } catch {
        // unreadable
      }
    }
  }
  return [...found.values()].sort((a, b) => b.modified - a.modified);
}

/** Paths dragged or pasted from a file manager often come quoted. */
export const cleanPath = (value: string): string => value.trim().replace(/^["']|["']$/g, "").replace(/^~(?=$|[\\/])/, homedir());

export function checkKeyFile(path: string): true | string {
  const p = cleanPath(path);
  if (!p) return t("Enter the path of the .p8 file");
  if (!existsSync(p)) return t("File not found: {path}", { path: p });
  try {
    const text = readFileSync(p, "utf-8");
    if (!text.includes("BEGIN PRIVATE KEY")) return t("This doesn't look like an App Store Connect .p8 key");
  } catch {
    return t("Cannot read {path}", { path: p });
  }
  return true;
}

/** Copies the key next to the settings; returns the path to store (relative to the config folder). */
export function storeKeyFile(path: string): string {
  const source = resolve(cleanPath(path));
  const dir = ensureDir(keysDir());
  const target = join(dir, basename(source));
  if (resolve(target).toLowerCase() !== source.toLowerCase()) copyFileSync(source, target);
  return join("keys", basename(source));
}
