import { describe, expect, test } from "bun:test";
import { gradient, smoothBar, sparkline, visibleLength } from "../src/cli/look";
import { startUpdatePanel } from "../src/cli/update-panel";

describe("loading look", () => {
  test("the bar fills in eighths and keeps its width, with or without color", () => {
    for (const f of [0, 0.01, 0.37, 0.5, 0.999, 1]) {
      expect(visibleLength(smoothBar(f, 28, 5, false))).toBe(28);
      expect(visibleLength(smoothBar(f, 28, 5, true))).toBe(28);
    }
    expect(smoothBar(0.5, 8, 0, false)).toBe("████░░░░");
    expect(smoothBar(1 / 16, 8, 0, false)).toBe("▌░░░░░░░");
  });

  test("gradient ends and speed graph", () => {
    expect(gradient(0)).toEqual([34, 211, 238]);
    expect(gradient(1)).toEqual([236, 72, 153]);
    expect(sparkline([1, 2, 4, 8], false)).toBe("▂▃▅█");
    expect(sparkline([0, 0], false)).toBe("");
  });

  test("the update panel draws its steps and ends with the finish line", async () => {
    const out: string[] = [];
    const fake = { isTTY: true, columns: 90, write: (s: string) => void out.push(s) } as unknown as NodeJS.WriteStream;
    const panel = startUpdatePanel("1.7.2", "1.7.3", fake)!;
    panel.step(1);
    panel.bytes(50, 100);
    panel.step(2);
    await panel.finish();
    const text = out.join("");
    expect(text).toContain("1.7.2  →  1.7.3");
    expect(text).toContain("Release found");
    expect(text).toContain("Checking the download (SHA-256)");
    expect(text).toContain("asc-payout 1.7.3 is ready");
    expect(text).toContain("checksum verified");
    expect(text.endsWith("\x1b[?25h")).toBe(true); // the cursor is back
  });
});
