import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where exported files go: the Downloads folder if there is one, else the home folder. */
export function exportFolder(): string {
  if (process.env.ASC_PAYOUT_EXPORT_DIR) return process.env.ASC_PAYOUT_EXPORT_DIR;
  const downloads = join(homedir(), "Downloads");
  return existsSync(downloads) ? downloads : homedir();
}

/** Writes a CSV next to earlier exports without overwriting them; returns the path. */
export function saveExport(name: string, csv: string): string {
  const dir = exportFolder();
  const safe = name.replace(/[^\w.-]+/g, "-").toLowerCase();
  let path = join(dir, `${safe}.csv`);
  for (let n = 2; existsSync(path); n++) path = join(dir, `${safe}-${n}.csv`);
  // A byte order mark so Excel reads the UTF-8 (app names with accents) correctly
  writeFileSync(path, "﻿" + csv, "utf-8");
  return path;
}
