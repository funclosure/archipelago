import { expect, test } from "bun:test";
import { STEPS, stepPhrase, thinkingLine } from "../../src/web/progress-model.js";
import { TOOL_SHAPES } from "../../src/server/judge/tool-specs.ts";

test("every tool a persona can call has a plain step", () => {
  for (const tool of Object.keys(TOOL_SHAPES)) expect(STEPS[tool]).toBeString();
});

test("the waiting line names who and what, capitalised", () => {
  expect(thinkingLine("the cartographer")).toBe("The cartographer is thinking");
  expect(thinkingLine("the Keeper", "island_context")).toBe("The Keeper is reading the island");
  expect(stepPhrase("some_new_tool")).toBe("some new tool");
});
