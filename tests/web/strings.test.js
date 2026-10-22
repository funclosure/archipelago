import { describe, expect, test } from "bun:test";
import { TABLES } from "../../src/web/strings/index.js";
import { LANGUAGES, pickLanguage, t, useLanguage } from "../../src/web/i18n.js";

const sample = { n: 2, name: "X", count: 3, scale: "S", step: "s", total: 4, explored: 1, a: "A", b: "B" };
const text = (v) => (typeof v === "function" ? v(sample) : v);
const holes = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

describe("strings", () => {
  for (const [ns, table] of Object.entries(TABLES)) {
    test(`${ns}: every language has every key, with the same placeholders`, () => {
      const keys = Object.keys(table.en).sort();
      for (const { id } of LANGUAGES) {
        expect(Object.keys(table[id] ?? {}).sort()).toEqual(keys);
        for (const k of keys) {
          expect(text(table[id][k]).trim().length).toBeGreaterThan(0);
          if (typeof table.en[k] === "string") expect(holes(table[id][k])).toEqual(holes(table.en[k]));
        }
      }
    });
  }

  test("a stored choice wins, any Chinese browser reads zh-TW, else English", () => {
    expect(pickLanguage("en", ["zh-TW"])).toBe("en");
    expect(pickLanguage(null, ["zh-Hant-TW", "en"])).toBe("zh-TW");
    expect(pickLanguage(null, ["zh-CN"])).toBe("zh-TW");
    expect(pickLanguage("fr", ["en-US"])).toBe("en");
  });

  test("t fills placeholders, falls back to English, and names a missing key", () => {
    useLanguage("zh-TW");
    expect(t("nope.missing")).toBe("nope.missing");
    useLanguage("en");
  });
});
