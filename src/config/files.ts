import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensureDir } from "./paths";

/**
 * Writes the whole file or nothing: data goes to a temporary file that then replaces
 * the target in one step. A crash or Ctrl+C mid-write can never leave half a report in
 * the cache, where it would be read as a complete one later.
 */
export function writeFileAtomic(path: string, data: string): void {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, data, "utf-8");
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** Reads a cached file, or null when it is missing or fails `isValid` (then it is deleted). */
export function readCached(path: string, isValid: (text: string) => boolean): string | null {
  if (!existsSync(path)) return null;
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  if (isValid(text)) return text;
  rmSync(path, { force: true });
  return null;
}

export function readJson<T>(path: string): T | null {
  const text = readCached(path, (t) => {
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  });
  return text === null ? null : (JSON.parse(text) as T);
}
