import type { Database } from "../../core/sql.ts";
import { openDatabase } from "../../core/db.ts";
import { ArchipelagoError, NotFoundError } from "../../core/errors.ts";
import { requireDomain } from "../../core/repositories/domainRepository.ts";
import { requireIsland } from "../../core/repositories/islandRepository.ts";
import { addVerdict } from "../../core/repositories/verdictRepository.ts";
import { activeSession } from "../../core/repositories/sessionRepository.ts";
import { addMessage, listMessages } from "../../core/repositories/messageRepository.ts";
import {
  setLandmarks as setLandmarkRows,
  unlockLandmark as unlockLandmarkRow,
  exploreLandmark as exploreLandmarkRow,
  listLandmarks,
} from "../../core/repositories/landmarkRepository.ts";
import { addAsk, listAsks } from "../../core/repositories/askRepository.ts";
import { addCard, removeCard, requireCard, updateCard } from "../../core/repositories/boardRepository.ts";
import { addLooseEnd, closeLooseEnd, listLooseEnds } from "../../core/repositories/looseEndRepository.ts";
import { resolveVerdictTarget } from "../../core/targets.ts";
import {
  askInputSchema,
  boardWriteInputSchema,
  judgeVerdictInputSchema,
  landmarksInputSchema,
  LOOSE_OPEN_MAX,
  looseEndInputSchema,
  reefProposalInputSchema,
  unlockInputSchema,
} from "../../core/validators.ts";
import type { Ask, BoardCard, Island, LooseEnd, Message, MessageMode, MessageRole, ReefProposal, Verdict, VerdictState } from "../../core/types.ts";
import { buildJudgeContext, type JudgeContext } from "./context.ts";
import type { Persona, ToolName } from "./persona.ts";
import { toolError, toolResult, type ToolResult } from "./tool-specs.ts";
import { chartContext, proposeSketchTool } from "./chart.ts";

/** Where a tool call writes: the database path, the island whose threads this turn belongs to, and whose turn it is. */
export type ToolDeps = { dbPath?: string; domain: string; island: string; mode?: MessageMode };
/** A turn's deps as the runners hold them: the island is absent only for the cartographer at the top scale. */
export type TurnDeps = Omit<ToolDeps, "island"> & { island?: string };

/** The island an island tool needs; a cartographer turn at the top scale has none. */
function onIsland(deps: TurnDeps): ToolDeps {
  if (deps.island === undefined) throw new ArchipelagoError("this tool needs an island");
  return { ...deps, island: deps.island };
}

/** Each tool call opens and closes the database, like every request. */
function withDb<T>(dbPath: string | undefined, fn: (db: Database) => T): T {
  const db = openDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** The system line that opens a thread's next round; src/web/thread.js keeps its own copy of this prefix. */
export const CHARTED_PREFIX = "charted as ";

/** The one-line record the thread shows after a verdict. Names the target unless it is this thread's island. */
export function systemLine(target: string, state: VerdictState, threadIsland: string): string {
  if (target === `island:${threadIsland}`) return `${CHARTED_PREFIX}${state}`;
  return `${target.replace(/^island:/, "island ").replace(/^strait:/, "strait ")} charted as ${state}`;
}

export function islandContext(deps: TurnDeps): JudgeContext {
  const { domain, island, mode } = onIsland(deps);
  return withDb(deps.dbPath, (db) => buildJudgeContext(db, domain, island, mode ?? "judge"));
}

/** A thread charts its own island, and a strait only when this island is one of its two ends. */
function requireOwnTarget(db: Database, domainId: number, island: Island, target: string, tool: string) {
  const resolved = resolveVerdictTarget(db, domainId, target);
  const own =
    resolved.targetType === "island"
      ? resolved.targetId === island.id
      : (() => {
          const s = db.query<{ from: number; to: number }, [number]>(
            "select from_island_id as \"from\", to_island_id as \"to\" from straits where id = ?",
          ).get(resolved.targetId)!;
          return s.from === island.id || s.to === island.id;
        })();
  if (!own) throw new ArchipelagoError(`this thread charts island:${island.slug}; ${tool} cannot chart ${resolved.label}`);
  return resolved;
}

/** Writes a sandbar/settled/mountainous verdict and the system line, in one transaction. Reefs are rejected by the schema. */
export function recordVerdict(deps: ToolDeps, input: unknown): { verdict: Verdict; target: string } {
  const parsed = judgeVerdictInputSchema.parse(input);
  return withDb(deps.dbPath, (db) =>
    db.transaction(() => {
      const domain = requireDomain(db, deps.domain);
      const island = requireIsland(db, domain.id, deps.island);
      const target = requireOwnTarget(db, domain.id, island, parsed.target, "record_verdict");
      const session = activeSession(db, domain.id);
      const verdict = addVerdict(db, {
        targetType: target.targetType, targetId: target.targetId, state: parsed.state, confidence: parsed.confidence,
        evidence: parsed.evidence, rationale: parsed.rationale, sessionId: session ? session.id : null,
      });
      addMessage(db, {
        domainId: domain.id, islandId: island.id, role: "judge", kind: "system",
        body: systemLine(target.label, parsed.state, island.slug), mode: "judge",
      });
      return { verdict, target: target.label };
    })(),
  );
}

/** Stores a pending reef proposal on this thread. Writes no verdict. */
export function proposeReef(deps: ToolDeps, input: unknown): { id: number; target: string } {
  const parsed = reefProposalInputSchema.parse(input);
  return withDb(deps.dbPath, (db) => {
    const domain = requireDomain(db, deps.domain);
    const island = requireIsland(db, domain.id, deps.island);
    const target = requireOwnTarget(db, domain.id, island, parsed.target, "propose_reef");
    const proposal: ReefProposal = {
      target: target.label, claim: parsed.claim, consequence: parsed.consequence, evidence: parsed.evidence,
      confidence: parsed.confidence, rationale: parsed.rationale, status: "pending",
    };
    const message = addMessage(db, {
      domainId: domain.id, islandId: island.id, role: "judge", kind: "reef_proposal", body: JSON.stringify(proposal), mode: "judge",
    });
    return { id: message.id, target: target.label };
  });
}

/** Writes an island's landmarks once. Refused when any exist: landmarks are cartography, not per-turn state. */
export function setLandmarks(deps: ToolDeps, input: unknown): { landmarks: string[] } {
  const parsed = landmarksInputSchema.parse(input);
  // No outer transaction: the repository's setLandmarks is one already, and bun:sqlite transactions do not nest.
  return withDb(deps.dbPath, (db) => {
    const domain = requireDomain(db, deps.domain);
    const island = requireIsland(db, domain.id, deps.island);
    if (listLandmarks(db, island.id).length > 0) throw new ArchipelagoError(`island:${island.slug} already has landmarks; they are set once`);
    return { landmarks: setLandmarkRows(db, domain.id, island.id, parsed.items).map((l) => l.slug) };
  });
}

/** Records a question with 2–4 options for the reader to choose from. The route attaches it to the reply this turn ends with. */
export function askReader(deps: ToolDeps, input: unknown): { askId: number; note: string } {
  const parsed = askInputSchema.parse(input);
  return withDb(deps.dbPath, (db) => {
    const domain = requireDomain(db, deps.domain);
    const island = requireIsland(db, domain.id, deps.island);
    const ask = addAsk(db, { domainId: domain.id, islandId: island.id, question: parsed.question, options: parsed.options });
    return { askId: ask.id, note: "the reader is choosing; end your reply with the question and stop" };
  });
}

/** Lights one landmark from the latest reader answer and records it in the thread. */
export function unlockLandmark(deps: ToolDeps, input: unknown): { slug: string; name: string; unlocked: number; total: number } {
  const parsed = unlockInputSchema.parse(input);
  return withDb(deps.dbPath, (db) =>
    db.transaction(() => {
      const domain = requireDomain(db, deps.domain);
      const island = requireIsland(db, domain.id, deps.island);
      const answer = [...listMessages(db, island.id, "judge")].reverse().find((m) => m.role === "you" && m.kind === "text") ?? null;
      const lit = unlockLandmarkRow(db, island.id, parsed.slug, parsed.evidence, answer ? answer.id : null);
      addMessage(db, { domainId: domain.id, islandId: island.id, role: "judge", kind: "system", body: `landmark lit: ${lit.name}`, mode: "judge" });
      const all = listLandmarks(db, island.id);
      return { slug: lit.slug, name: lit.name, unlocked: all.filter((l) => l.unlockedAt !== null).length, total: all.length };
    })(),
  );
}

/**
 * Marks one landmark explored from the reader's latest message in the mentor thread. The quote is checked
 * here, in code, not left to the prose. A repeat changes nothing and writes no line.
 */
// A quote must be one the reader could recognise as theirs, so a space, a letter, or a lone word is not one.
const QUOTE_MIN_CHARS = 12;
const QUOTE_MIN_WORDS = 2;
// Chinese, Japanese, and Korean put no spaces between words and carry a word in one or two characters, so there a
// quote is long enough at six of those characters (「快取失效會雪崩」), whatever the spaces say.
const QUOTE_MIN_CJK = 6;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/** Whether a quote is long enough to be the reader's own words: two words and twelve characters, or six CJK characters. */
export function isRecognisableQuote(evidence: string): boolean {
  if ((evidence.match(CJK)?.length ?? 0) >= QUOTE_MIN_CJK) return true;
  return evidence.length >= QUOTE_MIN_CHARS && evidence.split(/\s+/).length >= QUOTE_MIN_WORDS;
}

/**
 * Whether `answer` is the reader choosing one of an ask's options in this thread. POST /api/probe records a pick
 * and then its message in one transaction, so the pick's message is the first reader message at or after
 * `pickedAt`. Words typed instead of choosing are recorded as a pick too, but they are not one of the options.
 */
function isOptionPick(thread: Message[], asks: Ask[], answer: Message): boolean {
  const ids = new Set(thread.map((m) => m.id));
  return asks.some((a) => {
    if (a.messageId === null || !ids.has(a.messageId) || a.picked === null || a.pickedAt === null) return false;
    if (a.picked !== answer.body || !a.options.includes(a.picked) || a.pickedAt > answer.createdAt) return false;
    const pickMessage = thread.find((m) => m.role === "you" && m.kind === "text" && m.id > a.messageId! && m.createdAt >= a.pickedAt!);
    return pickMessage?.id === answer.id;
  });
}

export function markExplored(deps: ToolDeps, input: unknown): { slug: string; name: string; explored: number; total: number; already: boolean } {
  const parsed = unlockInputSchema.parse(input);
  const evidence = parsed.evidence.trim();
  if (!isRecognisableQuote(evidence)) {
    throw new ArchipelagoError(
      `evidence must quote at least two words (${QUOTE_MIN_CHARS}+ characters), or ${QUOTE_MIN_CJK} Chinese, Japanese, or Korean characters, of the reader's latest message`,
    );
  }
  return withDb(deps.dbPath, (db) =>
    db.transaction(() => {
      const domain = requireDomain(db, deps.domain);
      const island = requireIsland(db, domain.id, deps.island);
      // The mentor's tool: it always reads and writes the mentor thread.
      const thread = listMessages(db, island.id, "mentor");
      const answer = thread.findLast((m) => m.role === "you" && m.kind === "text");
      if (!answer) throw new ArchipelagoError("no reader message in the mentor thread to quote");
      if (isOptionPick(thread, listAsks(db, island.id), answer)) {
        throw new ArchipelagoError("the latest reader message is a pick from your options; explore needs the reader's own words");
      }
      if (!answer.body.includes(evidence)) {
        throw new ArchipelagoError("evidence must be a verbatim quote from the reader's latest message in this thread");
      }
      const { landmark, changed } = exploreLandmarkRow(db, island.id, parsed.slug, evidence, answer.id);
      if (changed) {
        addMessage(db, { domainId: domain.id, islandId: island.id, role: "mentor", kind: "system", body: `landmark explored: ${landmark.name}`, mode: "mentor" });
      }
      const all = listLandmarks(db, island.id);
      return { slug: landmark.slug, name: landmark.name, explored: all.filter((l) => l.exploredAt !== null).length, total: all.length, already: !changed };
    })(),
  );
}

/** The system lines a loose end leaves in the thread of the persona that wrote it; src/web/thread.js reads them back. */
export const LOOSE_OPENED_PREFIX = "loose end: ";
export const LOOSE_CLOSED_PREFIX = "loose end closed: ";

/**
 * Notes or closes a loose end on this island, as the judge or the mentor. Either way the evidence is checked here, in
 * code: a recognisable verbatim quote of the reader's latest message in this persona's own thread. Either persona may
 * close any open one; each write leaves one line in the writer's thread.
 */
export function looseEnd(deps: ToolDeps, input: unknown, author: "judge" | "mentor"): { looseEnd: LooseEnd; open: number } {
  const parsed = looseEndInputSchema.parse(input);
  if (!isRecognisableQuote(parsed.evidence)) {
    throw new ArchipelagoError(
      `evidence must quote at least two words (${QUOTE_MIN_CHARS}+ characters), or ${QUOTE_MIN_CJK} Chinese, Japanese, or Korean characters, of the reader's latest message`,
    );
  }
  return withDb(deps.dbPath, (db) =>
    db.transaction(() => {
      const domain = requireDomain(db, deps.domain);
      const island = requireIsland(db, domain.id, deps.island);
      const answer = listMessages(db, island.id, author).findLast((m) => m.role === "you" && m.kind === "text");
      if (!answer) throw new ArchipelagoError("no reader message in this thread to quote");
      if (!answer.body.includes(parsed.evidence)) throw new ArchipelagoError("evidence must be a verbatim quote from the reader's latest message in this thread");
      const open = listLooseEnds(db, island.id);
      let row: LooseEnd;
      if (parsed.op === "open") {
        if (open.length >= LOOSE_OPEN_MAX) throw new ArchipelagoError(`this island already has ${LOOSE_OPEN_MAX} open loose ends; close one first`);
        let landmarkId: number | null = null;
        if (parsed.landmark) {
          const landmarks = listLandmarks(db, island.id);
          const landmark = landmarks.find((l) => l.slug === parsed.landmark);
          if (!landmark) throw new NotFoundError(`no landmark "${parsed.landmark}" on this island`, landmarks.map((l) => l.slug));
          landmarkId = landmark.id;
        }
        row = addLooseEnd(db, {
          domainId: domain.id, islandId: island.id, landmarkId, kind: parsed.kind, note: parsed.note, evidence: parsed.evidence, messageId: answer.id, author,
        });
        addMessage(db, { domainId: domain.id, islandId: island.id, role: author, kind: "system", body: `${LOOSE_OPENED_PREFIX}${row.note}`, mode: author });
      } else {
        row = closeLooseEnd(db, island.id, parsed.id, author, parsed.evidence);
        addMessage(db, { domainId: domain.id, islandId: island.id, role: author, kind: "system", body: `${LOOSE_CLOSED_PREFIX}${row.note}`, mode: author });
      }
      return { looseEnd: row, open: listLooseEnds(db, island.id).length };
    })(),
  );
}

export type BoardWriteResult = { card: BoardCard } | { removed: number; title: string };

/**
 * Adds, updates, or removes a card on this island's board. The SDK tool calls it as its persona (judge or mentor),
 * the route as the reader. A persona may only update or remove its own cards and leaves one system line per write
 * in its own thread; the reader may edit any card and leaves none.
 */
export function boardWrite(deps: ToolDeps, input: unknown, author: MessageRole = "judge"): BoardWriteResult {
  const parsed = boardWriteInputSchema.parse(input);
  return withDb(deps.dbPath, (db) =>
    db.transaction((): BoardWriteResult => {
      const domain = requireDomain(db, deps.domain);
      const island = requireIsland(db, domain.id, deps.island);
      // The line names the card by its title, or by its kind when it has none (the reader's cards never do).
      const line = (verb: string, card: BoardCard) => {
        if (author === "you") return;
        const what = card.title ? `"${card.title}"` : `a ${card.kind}`;
        addMessage(db, { domainId: domain.id, islandId: island.id, role: author, kind: "system", body: `board: ${verb} ${what}`, mode: author });
      };
      if (parsed.op === "add") {
        const card = addCard(db, {
          domainId: domain.id, islandId: island.id, kind: parsed.kind, title: parsed.title ?? "", body: parsed.body,
          lang: parsed.kind === "code" ? parsed.lang ?? null : null, author,
        });
        line("pinned", card);
        return { card };
      }
      const existing = requireCard(db, island.id, parsed.id);
      if (author !== "you" && existing.author !== author) {
        const owner = existing.author === "you" ? "the reader" : `the ${existing.author}`;
        throw new ArchipelagoError(`${owner} wrote card ${existing.id}; add your own card instead`);
      }
      if (parsed.op === "remove") {
        removeCard(db, existing.id);
        line("removed", existing);
        return { removed: existing.id, title: existing.title };
      }
      const card = updateCard(db, existing.id, { title: parsed.title, body: parsed.body, lang: existing.kind === "code" ? parsed.lang : null });
      line("updated", card);
      return { card };
    })(),
  );
}

/** One tool call for a persona, as either runner makes it. A name outside the persona's list is refused, never dispatched. */
export function runTool(persona: Persona, deps: TurnDeps, name: string, input: unknown): ToolResult {
  if (!(persona.toolNames as readonly string[]).includes(name)) return toolError(new ArchipelagoError(`no tool named ${name} for the ${persona.id}`));
  try {
    switch (name as ToolName) {
      case "island_context": return toolResult(islandContext(deps));
      case "record_verdict": return toolResult(recordVerdict(onIsland(deps), input));
      case "propose_reef": return toolResult(proposeReef(onIsland(deps), input));
      case "set_landmarks": return toolResult(setLandmarks(onIsland(deps), input));
      case "unlock_landmark": return toolResult(unlockLandmark(onIsland(deps), input));
      case "ask_reader": return toolResult(askReader(onIsland(deps), input));
      case "board_write": return toolResult(boardWrite(onIsland(deps), input, persona.id));
      case "mark_explored": return toolResult(markExplored(onIsland(deps), input));
      case "loose_end": return toolResult(looseEnd(onIsland(deps), input, persona.id === "mentor" ? "mentor" : "judge"));
      case "chart_context": return toolResult(chartContext(deps));
      case "propose_sketch": return toolResult(proposeSketchTool(deps, input));
    }
  } catch (error) {
    return toolError(error);
  }
}
