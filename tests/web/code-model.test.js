import { test, expect } from "bun:test";
import { SLOTS, SENTINELS, LANGS, contourTheme, resolveLang, labelOf, spansOf } from "../../src/web/code-model.js";

test("slots and sentinels line up", () => {
  expect(SLOTS).toEqual(["fg", "keyword", "string", "comment", "type", "number"]);
  expect(SENTINELS).toEqual(["#000001", "#000002", "#000003", "#000004", "#000005", "#000006"]);
  expect(LANGS).toHaveLength(12);
  expect(contourTheme.name).toBe("contour");
  expect(contourTheme.settings[0].settings.foreground).toBe("#000001");
});

test("resolveLang maps aliases, lowercases, and returns null for the unknown", () => {
  expect(resolveLang("swift")).toBe("swift");
  expect(resolveLang("SwiftUI")).toBe("swift");
  expect(resolveLang("objc")).toBe("objective-c");
  expect(resolveLang("objective-c")).toBe("objective-c");
  expect(resolveLang("ts")).toBe("typescript");
  expect(resolveLang("js")).toBe("javascript");
  expect(resolveLang("zsh")).toBe("bash");
  expect(resolveLang("py")).toBe("python");
  expect(resolveLang("yml")).toBe("yaml");
  expect(resolveLang("jsonc")).toBe("json");
  expect(resolveLang("cobol")).toBeNull();
  expect(resolveLang("")).toBeNull();
  expect(resolveLang("mermaid")).toBeNull();
});

test("labelOf names known languages, echoes unknown tags, and says code for none", () => {
  expect(labelOf("swift")).toBe("Swift");
  expect(labelOf("objc")).toBe("Objective-C");
  expect(labelOf("tsx")).toBe("TSX");
  expect(labelOf("yml")).toBe("YAML");
  expect(labelOf("cobol")).toBe("cobol");
  expect(labelOf("")).toBe("code");
});

test("spansOf maps sentinel colours to slots, unknown colours to fg, and italic font style", () => {
  const lines = [
    [{ content: "// hi", color: "#000004", fontStyle: 1 }, { content: "final", color: "#000002", fontStyle: 0 }],
    [{ content: "42", color: "#000006" }, { content: "?", color: "#ABCDEF" }, { content: "x" }],
  ];
  expect(spansOf(lines)).toEqual([
    [{ text: "// hi", slot: "comment", italic: true }, { text: "final", slot: "keyword", italic: false }],
    [{ text: "42", slot: "number", italic: false }, { text: "?", slot: "fg", italic: false }, { text: "x", slot: "fg", italic: false }],
  ]);
  expect(spansOf([[{ content: "A", color: "#000005" }]])[0][0].slot).toBe("type");
  expect(spansOf([[{ content: "A", color: "#000005".toUpperCase() }]])[0][0].slot).toBe("type");
});
