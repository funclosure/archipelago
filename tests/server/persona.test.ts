import { test, expect } from "bun:test";
import { judge, mentor, personaFor, renderJudgeContext, renderJudgeThreadPrompt, renderMentorContext, renderMentorThreadPrompt } from "../../src/server/judge/persona.ts";
import { readProtocol } from "../../src/server/judge/protocol.ts";
import { judgeStubTurn, mentorStubTurn } from "../../src/server/judge/stub.ts";
import { allowedToolsFor } from "../../src/server/judge/sdk.ts";
import { toolDescriptionsFor } from "../../src/server/judge/tool-specs.ts";

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

test("the mentor persona: MENTOR.md, its five tools and no verdict tool, its renderers, its stub", () => {
  expect(mentor.id).toBe("mentor");
  expect(readProtocol(mentor)).toContain("# The mentor");
  expect([...mentor.toolNames]).toEqual(["island_context", "set_landmarks", "mark_explored", "ask_reader", "board_write"]);
  for (const verdictTool of ["record_verdict", "propose_reef", "unlock_landmark"]) expect([...mentor.toolNames]).not.toContain(verdictTool);
  expect(judge.toolNames).not.toContain("mark_explored");
  expect(mentor.renderContext).toBe(renderMentorContext);
  expect(mentor.renderThreadPrompt).toBe(renderMentorThreadPrompt);
  expect(mentor.stubTurn).toBe(mentorStubTurn);
  expect(personaFor("mentor")).toBe(mentor);
  expect(allowedToolsFor(mentor)).toEqual([
    "mcp__archipelago__island_context", "mcp__archipelago__set_landmarks", "mcp__archipelago__mark_explored",
    "mcp__archipelago__ask_reader", "mcp__archipelago__board_write",
  ]);
});

test("tool descriptions speak the persona: the mentor's say nothing of reefs or a reader who already understood", () => {
  const m = toolDescriptionsFor(mentor);
  expect(Object.keys(m)).toEqual([...mentor.toolNames]);
  for (const d of Object.values(m)) for (const phrase of ["reef", "verdict", "already understood", "lit"]) expect(d).not.toContain(phrase);
  expect(m.island_context).toContain("Who the reader is");
  expect(m.ask_reader).toContain("check-in");
  const j = toolDescriptionsFor(judge);
  expect(Object.keys(j)).toEqual([...judge.toolNames]);
  expect(j.island_context).toContain("pending reef proposals");
  expect(j.ask_reader).toContain("what they would say if they already understood");
});
