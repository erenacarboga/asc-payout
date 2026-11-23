import { afterEach, describe, expect, test } from "bun:test";
import { languageHint } from "../src/cli/setup";
import { loadSettings, saveSettings } from "../src/config/settings";
import { setLang, t } from "../src/i18n";

afterEach(() => {
  setLang(null);
  const s = loadSettings();
  delete s.language;
  saveSettings(s);
});

describe("language", () => {
  test("the language setting is saved and loaded, and removed for the system language", () => {
    saveSettings({ ...loadSettings(), language: "tr" });
    const loaded = loadSettings();
    expect(loaded.language).toBe("tr");
    expect(languageHint(loaded)).toBe("Türkçe");

    delete loaded.language;
    saveSettings(loaded);
    expect(loadSettings().language).toBeUndefined();
    expect(languageHint(loadSettings())).toMatch(/^System \((English|Türkçe)\)$/);
  });

  test("setup texts in Turkish", () => {
    setLang("tr");
    expect(t("Add an account")).toBe("Hesap ekle");
    expect(t("step {n} of {total}", { n: 2, total: 6 })).toBe("adım 2/6");
    expect(t("Goal for {name}, a month, in {currency}", { name: "Notes", currency: "EUR" })).toBe("Aylık hedef: Notes (EUR)");
    setLang("en");
    expect(t("Add an account")).toBe("Add an account");
  });
});
