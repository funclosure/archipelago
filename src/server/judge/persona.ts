// A persona is everything that differs between the judge and the mentor: the protocol file, the closed
// tool list, how the context and the thread are rendered, and the stub turn. One runner serves both.
import type { Ask, Message, MessageMode } from "../../core/types.ts";
import { ArchipelagoError } from "../../core/errors.ts";
import {
  indent, renderBoard, renderIslandHead, renderPendingAsk, renderPendingReefs, renderReplay, renderSurroundings, type JudgeContext,
} from "./context.ts";
import type { JudgeRunner } from "./runner.ts";
import { judgeStubTurn } from "./stub.ts";

export const TOOL_NAMES = ["island_context", "record_verdict", "propose_reef", "set_landmarks", "unlock_landmark", "ask_reader", "board_write"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type Persona = {
  id: MessageMode;
  /** Beside protocol.ts; read fresh every turn. */
  protocolFile: string;
  /** The closed tool set: sdk.ts builds these and allows only these. */
  toolNames: readonly ToolName[];
  renderContext: (ctx: JudgeContext) => string;
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

export const judge: Persona = {
  id: "judge",
  protocolFile: "PROTOCOL.md",
  toolNames: TOOL_NAMES,
  renderContext: renderJudgeContext,
  renderThreadPrompt: renderJudgeThreadPrompt,
  stubTurn: judgeStubTurn,
};

const PERSONAS: Partial<Record<MessageMode, Persona>> = { judge };

export function personaFor(mode: MessageMode): Persona {
  const persona = PERSONAS[mode];
  if (!persona) throw new ArchipelagoError(`no persona for mode ${mode}`);
  return persona;
}
