import { afterEach, expect, test } from "bun:test";
import { render } from "@inquirer/testing";
import { ask, menu } from "../src/cli/prompts";
import { setLang } from "../src/i18n";

afterEach(() => setLang(null));

test("menus and prompts speak Turkish when asked to", async () => {
  setLang("tr");
  const items = [{ label: "Geçen ay", value: "last", key: "l" }];
  const m = await render(menu, { message: "Seçin", items, quit: true });
  const screen = m.getScreen();
  expect(screen).toContain("← Geri");
  expect(screen).toContain("↑↓ gez · enter seç · esc geri · q çık");
  m.events.keypress("enter");
  expect(await m.answer).toBe("last");

  const a = await render(ask, { message: "Ad", default: "x" });
  expect(a.getScreen()).toContain("enter onayla · tab doldur · esc geri");
  a.events.keypress("enter");
  expect(await a.answer).toBe("x");
});
