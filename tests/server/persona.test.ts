import { test, expect } from "bun:test";
import { judge, personaFor, renderJudgeContext, renderJudgeThreadPrompt } from "../../src/server/judge/persona.ts";
import { readProtocol } from "../../src/server/judge/protocol.ts";
import { judgeStubTurn } from "../../src/server/judge/stub.ts";
import { allowedToolsFor } from "../../src/server/judge/sdk.ts";

test("the judge persona: PROTOCOL.md, its seven tools, its renderers, its stub", () => {
  expect(judge.id).toBe("judge");
  expect(readProtocol(judge)).toBe(readProtocol());
  expect([...judge.toolNames]).toEqual(["island_context", "record_verdict", "propose_reef", "set_landmarks", "unlock_landmark", "ask_reader", "board_write"]);
  expect(judge.renderContext).toBe(renderJudgeContext);
  expect(judge.renderThreadPrompt).toBe(renderJudgeThreadPrompt);
  expect(judge.renderThreadPrompt([])).toBe("Open the probe on this island.");
  expect(judge.stubTurn).toBe(judgeStubTurn);
  expect(personaFor("judge")).toBe(judge);
});

test("the SDK's allowed tools are the persona's own, namespaced to the archipelago server", () => {
  expect(allowedToolsFor(judge)).toEqual([
    "mcp__archipelago__island_context", "mcp__archipelago__record_verdict", "mcp__archipelago__propose_reef", "mcp__archipelago__set_landmarks",
    "mcp__archipelago__unlock_landmark", "mcp__archipelago__ask_reader", "mcp__archipelago__board_write",
  ]);
});
