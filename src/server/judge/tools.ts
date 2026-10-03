import type { Database } from "bun:sqlite";
import { openDatabase } from "../../core/db.ts";
import { ArchipelagoError } from "../../core/errors.ts";
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
import { resolveVerdictTarget } from "../../core/targets.ts";
import {
  askInputSchema,
  boardWriteInputSchema,
  judgeVerdictInputSchema,
  landmarksInputSchema,
  reefProposalInputSchema,
  unlockInputSchema,
} from "../../core/validators.ts";
import type { Ask, BoardCard, Island, Message, MessageMode, MessageRole, ReefProposal, Verdict, VerdictState } from "../../core/types.ts";
import { buildJudgeContext, type JudgeContext } from "./context.ts";

/** Where a tool call writes: the database path, the island whose threads this turn belongs to, and whose turn it is. */
export type ToolDeps = { dbPath?: string; domain: string; island: string; mode?: MessageMode };

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

export function islandContext(deps: ToolDeps): JudgeContext {
  return withDb(deps.dbPath, (db) => buildJudgeContext(db, deps.domain, deps.island, deps.mode ?? "judge"));
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
        body: systemLine(target.label, parsed.state, island.slug),
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
      domainId: domain.id, islandId: island.id, role: "judge", kind: "reef_proposal", body: JSON.stringify(proposal),
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
      const answer = [...listMessages(db, island.id)].reverse().find((m) => m.role === "you" && m.kind === "text") ?? null;
      const lit = unlockLandmarkRow(db, island.id, parsed.slug, parsed.evidence, answer ? answer.id : null);
      addMessage(db, { domainId: domain.id, islandId: island.id, role: "judge", kind: "system", body: `landmark lit: ${lit.name}` });
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
  if (evidence.length < QUOTE_MIN_CHARS || evidence.split(/\s+/).length < QUOTE_MIN_WORDS) {
    throw new ArchipelagoError(`evidence must quote at least two words (${QUOTE_MIN_CHARS}+ characters) of the reader's latest message`);
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
