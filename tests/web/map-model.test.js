import { test, expect } from "bun:test";
import { agentPrompt, mapFileName, mapFromText, PROMPT_EXAMPLE } from "../../src/web/map-model.js";
import { parseMapFile } from "../../src/core/map-file.ts";
import { openDatabase } from "../../src/core/db.ts";
import { importMap } from "../../src/core/map-file.ts";

test("the prompt's example is a map the app imports", () => {
  expect(parseMapFile(structuredClone(PROMPT_EXAMPLE))).toEqual(PROMPT_EXAMPLE);
  const db = openDatabase(":memory:");
  expect(importMap(db, PROMPT_EXAMPLE)).toMatchObject({ domain: { slug: "caching" }, islands: 2, straits: 1, seas: 1 });
});

test("the prompt carries the reader's subject, the example, and the page's language", () => {
  const en = agentPrompt({ subject: "  Wine, as a curious beginner " });
  expect(en).toContain("The subject: Wine, as a curious beginner\n");
  expect(en).toContain(JSON.stringify(PROMPT_EXAMPLE, null, 2));
  expect(en).toContain("6 to 10 islands");
  expect(en).toContain("4 to 6 \"landmarks\"");
  expect(agentPrompt()).toContain("The subject: <say the subject here");
  expect(agentPrompt({ language: "zh-TW" })).toContain("Traditional Chinese");
  expect(agentPrompt({ language: "fr" })).toContain("language of the subject line");
});

test("a map is read out of a paste, whatever a model wrapped it in", () => {
  const json = JSON.stringify(PROMPT_EXAMPLE, null, 2);
  expect(mapFromText(json)).toEqual(PROMPT_EXAMPLE);
  expect(mapFromText("Here is your map:\n\n```json\n" + json + "\n```\n\nLet me know if you want islets.")).toEqual(PROMPT_EXAMPLE);
  for (const not of ["", "no braces here", "{ not json }", "} {", "[1, 2]"]) expect(mapFromText(not)).toBeNull();
});

test("a map downloads under its domain's slug", () => {
  expect(mapFileName("system-design")).toBe("system-design.archipelago.json");
});
