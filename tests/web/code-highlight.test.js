// The sentinel theme against real shiki output: every colour the highlighter hands back must be one
// of ours, and the slots must land where the CSS expects. One highlighter for the file, oniguruma
// (the JavaScript regex engine mis-tokenized end-of-line comments in swift and typescript).
import { test, expect, beforeAll } from "bun:test";
import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import swift from "@shikijs/langs/swift";
import objectiveC from "@shikijs/langs/objective-c";
import kotlin from "@shikijs/langs/kotlin";
import typescript from "@shikijs/langs/typescript";
import tsx from "@shikijs/langs/tsx";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import bash from "@shikijs/langs/bash";
import python from "@shikijs/langs/python";
import sql from "@shikijs/langs/sql";
import yaml from "@shikijs/langs/yaml";
import { contourTheme, SENTINELS, LANGS, spansOf } from "../../src/web/code-model.js";

/** One short sample per bundled language: a keyword or structural token, and a trailing comment. */
const SAMPLES = {
  swift: "let n = 1 // note",
  "objective-c": "int n = 1; // note",
  kotlin: "val n = 1 // note",
  typescript: "const n = 1; // note",
  tsx: "const A = () => <div>{1}</div>; // note",
  javascript: "const n = 1; // note",
  json: '{ "a": 1 }',
  bash: 'for f in *.log; do echo "$f"; done # note',
  python: "n = 1  # note",
  sql: "select 1 from t -- note",
  yaml: "a: 1 # note",
};

let highlighter;

beforeAll(async () => {
  highlighter = await createHighlighterCore({
    langs: [swift, objectiveC, kotlin, typescript, tsx, javascript, json, bash, python, sql, yaml],
    themes: [contourTheme],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });
});

const spans = (lang) => spansOf(highlighter.codeToTokens(SAMPLES[lang], { lang, theme: "contour" }).tokens).flat();

test("every language is bundled with a sample", () => {
  expect(Object.keys(SAMPLES).sort()).toEqual([...LANGS].sort());
});

for (const lang of LANGS) {
  test(`${lang} tokenizes into sentinel colours only`, () => {
    const tokens = highlighter.codeToTokens(SAMPLES[lang], { lang, theme: "contour" }).tokens.flat();
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) {
      if (t.color === undefined) continue;
      expect(SENTINELS).toContain(String(t.color).toLowerCase());
    }
  });
}

test("the typescript sample gets a keyword, a number, and an italic comment", () => {
  const line = spans("typescript");
  expect(line.map((s) => s.slot)).toContain("keyword");
  expect(line.map((s) => s.slot)).toContain("number");
  expect(line.find((s) => s.slot === "number").text).toBe("1");
  const comment = line.find((s) => s.slot === "comment");
  expect(comment).toEqual({ text: "// note", slot: "comment", italic: true });
});

test("the swift sample keeps its end-of-line comment whole", () => {
  const comment = spans("swift").find((s) => s.slot === "comment");
  expect(comment).toEqual({ text: "// note", slot: "comment", italic: true });
});

test("the json sample separates the key from the number", () => {
  const line = spans("json");
  // The key carries `support.type.property-name.json` over `string.json`, so it lands in `type`.
  expect(line.find((s) => s.text === '"a"').slot).toBe("type");
  expect(line.find((s) => s.slot === "number").text).toBe("1");
});
