// A persona is everything that differs between the judge, the mentor, and the cartographer: the protocol
// file, the closed tool list, the context it reads and how it and the thread are rendered, and the stub
// turn. One runner serves all three.
import type { Ask, Message, MessageMode } from "../../core/types.ts";
import {
  indent, renderBoard, renderIslandHead, renderLearner, renderPendingAsk, renderPendingReefs, renderReplay, renderSurroundings, type JudgeContext,
} from "./context.ts";
import type { JudgeRunner } from "./runner.ts";
import { cartographerStubTurn, judgeStubTurn, mentorStubTurn } from "./stub.ts";
import { islandContext, type TurnDeps } from "./tools.ts";
import { chartContext, renderChartContext, renderChartThreadPrompt, type ChartContext } from "./chart.ts";

export const TOOL_NAMES = [
  "island_context", "record_verdict", "propose_reef", "set_landmarks", "unlock_landmark", "ask_reader", "board_write", "mark_explored",
  "chart_context", "propose_sketch",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** What every persona's context carries for the runners: its thread and the asks on it. */
export type PersonaContext = { thread: Message[]; asks: Ask[] };

export type Persona<C extends PersonaContext = any> = {
  id: MessageMode;
  /** Beside protocol.ts; read fresh every turn. */
  protocolFile: string;
  /** The closed tool set: the runners build these and allow only these. */
  toolNames: readonly ToolName[];
  /** The turn's context, read fresh from the database before the first request. */
  buildContext: (deps: TurnDeps) => C;
  renderContext: (ctx: C) => string;
  renderThreadPrompt: (thread: Message[], asks?: Ask[]) => string;
  stubTurn: JudgeRunner;
};

// ---- the judge ----

function judgeLandmarks(ctx: JudgeContext): string[] {
  if (ctx.landmarks.length === 0) return [``, `Landmarks: none yet — call set_landmarks with 4–6 before your opening question.`];
  const lit = ctx.landmarks.filter((l) => l.unlockedAt !== null).length;
  return [
    ``,
    `Landmarks (${lit} of ${ctx.landmarks.length} lit):`,
    ...ctx.landmarks.map((l) => `- ${l.name} (${l.slug}): ${l.unlockedAt ? `lit — "${indent(l.evidence ?? "")}"` : "dark"}`),
  ];
}

/** One line, when any landmark was explored in the other thread. The judge never reads that thread. */
function exploredLine(ctx: JudgeContext): string[] {
  const names = ctx.landmarks.filter((l) => l.exploredAt !== null).map((l) => l.name);
  return names.length ? [`Explored with the mentor: *${names.join(", ")}*. Exploring is not evidence; probe these like any other landmark.`] : [];
}

function roundLine(round: number): string {
  return round >= 4
    ? `Round: ${round} of 4. This is the fourth answer: decide now with record_verdict or propose_reef before writing anything else.`
    : `Round: ${round} of 4 (reader answers since this island was last charted here; the verdict lands after the fourth at the latest)`;
}

/** The judge's island block, appended to PROTOCOL.md as the system prompt. */
export function renderJudgeContext(ctx: JudgeContext): string {
  return [
    ...renderIslandHead(ctx),
    ...judgeLandmarks(ctx),
    ...exploredLine(ctx),
    roundLine(ctx.round),
    ...renderSurroundings(ctx),
    ...renderPendingReefs(ctx),
    ...renderPendingAsk(ctx),
    ...renderBoard(ctx, "judge", "pin with board_write when a diagram or a claim will be referred to again."),
  ].join("\n");
}

/** The judge's thread as the turn's prompt. */
export function renderJudgeThreadPrompt(thread: Message[], asks: Ask[] = []): string {
  if (thread.length === 0) return "Open the probe on this island.";
  return [...renderReplay(thread, asks), "", "Continue as the judge."].join("\n");
}

// ---- the mentor ----

function mentorLandmarks(ctx: JudgeContext): string[] {
  if (ctx.landmarks.length === 0) return [``, `Landmarks: none yet — call set_landmarks with 4–6 before your opening line.`];
  const explored = ctx.landmarks.filter((l) => l.exploredAt !== null).length;
  const lines = [``, `Landmarks (${explored} of ${ctx.landmarks.length} explored):`];
  for (const l of ctx.landmarks) {
    lines.push(`- ${l.name} (${l.slug}): ${l.exploredAt ? `explored — "${indent(l.exploredEvidence ?? "")}"` : "unexplored"}`);
  }
  const next = ctx.landmarks.filter((l) => l.exploredAt === null).map((l) => l.slug);
  lines.push(next.length ? `Nearest unexplored, in order: ${next.join(", ")}` : `Every landmark is explored: hand off to the judge in one line (§7).`);
  return lines;
}

/** The mentor's block, appended to MENTOR.md: the learner first, then this island. No verdict tools, no round. */
export function renderMentorContext(ctx: JudgeContext): string {
  return [
    ...renderLearner(ctx.learner ?? { note: "", ground: [], reefs: [] }),
    ``,
    ...renderIslandHead(ctx),
    ...mentorLandmarks(ctx),
    ...renderPendingAsk(ctx),
    ...renderBoard(ctx, "mentor", "pin an analogy or a diagram with board_write when it will be pointed at again."),
  ].join("\n");
}

/** The mentor's thread as the turn's prompt. */
export function renderMentorThreadPrompt(thread: Message[], asks: Ask[] = []): string {
  if (thread.length === 0) return "Open the session on this island: the coastline, one analogy, and where to start.";
  return [...renderReplay(thread, asks), "", "Continue as the mentor."].join("\n");
}

export const judge: Persona<JudgeContext> = {
  id: "judge",
  protocolFile: "PROTOCOL.md",
  buildContext: (deps) => islandContext(deps),
  toolNames: ["island_context", "record_verdict", "propose_reef", "set_landmarks", "unlock_landmark", "ask_reader", "board_write"],
  renderContext: renderJudgeContext,
  renderThreadPrompt: renderJudgeThreadPrompt,
  stubTurn: judgeStubTurn,
};

export const mentor: Persona<JudgeContext> = {
  id: "mentor",
  protocolFile: "MENTOR.md",
  buildContext: (deps) => islandContext(deps),
  // No verdict tools: the mentor never writes a verdict, never lights a landmark, never proposes a reef.
  toolNames: ["island_context", "set_landmarks", "mark_explored", "ask_reader", "board_write"],
  renderContext: renderMentorContext,
  renderThreadPrompt: renderMentorThreadPrompt,
  stubTurn: mentorStubTurn,
};

export const cartographer: Persona<ChartContext> = {
  id: "cartographer",
  protocolFile: "CARTOGRAPHER.md",
  // Sketches only: no verdict, no landmark, no board. What it proposes reaches the map when the reader approves.
  toolNames: ["chart_context", "propose_sketch"],
  buildContext: (deps) => chartContext(deps),
  renderContext: renderChartContext,
  renderThreadPrompt: renderChartThreadPrompt,
  stubTurn: cartographerStubTurn,
};

const PERSONAS: Record<MessageMode, Persona> = { judge, mentor, cartographer };

export function personaFor(mode: MessageMode): Persona {
  return PERSONAS[mode];
}
