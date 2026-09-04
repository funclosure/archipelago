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
  listLandmarks,
} from "../../core/repositories/landmarkRepository.ts";
import { resolveVerdictTarget } from "../../core/targets.ts";
import { judgeVerdictInputSchema, landmarksInputSchema, reefProposalInputSchema, unlockInputSchema } from "../../core/validators.ts";
import type { ReefProposal, Verdict, VerdictState } from "../../core/types.ts";
import { buildJudgeContext, type JudgeContext } from "./context.ts";

/** Where a tool call writes: the database path and the island whose thread this turn belongs to. */
export type ToolDeps = { dbPath?: string; domain: string; island: string };

/** Each tool call opens and closes the database, like every request. */
function withDb<T>(dbPath: string | undefined, fn: (db: Database) => T): T {
  const db = openDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** The one-line record the thread shows after a verdict. Names the target unless it is this thread's island. */
export function systemLine(target: string, state: VerdictState, threadIsland: string): string {
  if (target === `island:${threadIsland}`) return `charted as ${state}`;
  return `${target.replace(/^island:/, "island ").replace(/^strait:/, "strait ")} charted as ${state}`;
}

export function islandContext(deps: ToolDeps): JudgeContext {
  return withDb(deps.dbPath, (db) => buildJudgeContext(db, deps.domain, deps.island));
}

/** Writes a sandbar/settled/mountainous verdict and the system line, in one transaction. Reefs are rejected by the schema. */
export function recordVerdict(deps: ToolDeps, input: unknown): { verdict: Verdict; target: string } {
  const parsed = judgeVerdictInputSchema.parse(input);
  return withDb(deps.dbPath, (db) =>
    db.transaction(() => {
      const domain = requireDomain(db, deps.domain);
      const island = requireIsland(db, domain.id, deps.island);
      const target = resolveVerdictTarget(db, domain.id, parsed.target);
      // A thread charts its own island. Straits are exempt: they legitimately name two islands.
      if (target.targetType === "island" && target.targetId !== island.id) {
        throw new ArchipelagoError(`this thread charts island:${deps.island}; record_verdict cannot chart another island`);
      }
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
    const target = resolveVerdictTarget(db, domain.id, parsed.target);
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
