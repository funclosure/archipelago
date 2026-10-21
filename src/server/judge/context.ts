import type { Database } from "../../core/sql.ts";
import { requireDomain } from "../../core/repositories/domainRepository.ts";
import { getIslandById, islandPath, listIslands, requireIsland } from "../../core/repositories/islandRepository.ts";
import { listStraits } from "../../core/repositories/straitRepository.ts";
import { latestVerdict, latestVerdicts, verdictHistory } from "../../core/repositories/verdictRepository.ts";
import { listMessages, parseProposal } from "../../core/repositories/messageRepository.ts";
import { listLandmarks } from "../../core/repositories/landmarkRepository.ts";
import { listAsks } from "../../core/repositories/askRepository.ts";
import { listCards } from "../../core/repositories/boardRepository.ts";
import { confirmedReefClaims, getLearner, learnerGround, type GroundItem, type ReefClaim } from "../../core/repositories/learnerRepository.ts";
import { NOTE_MAX } from "../../core/validators.ts";
import { CHARTED_PREFIX } from "./tools.ts";
import { buildSnapshot } from "../../core/view-model.ts";
import type { Ask, BoardCard, Landmark, Message, MessageMode, MessageRole, ReefProposal, Verdict, VerdictState } from "../../core/types.ts";

/** What the mentor knows about the reader beyond this island. */
export type LearnerView = { note: string; ground: GroundItem[]; reefs: ReefClaim[] };

export type JudgeContext = {
  /** Whose turn this context is for. */
  mode: MessageMode;
  /** `angle`: the reader's words on where they chart the domain from and why, or null. */
  domain: { slug: string; name: string; angle: string | null };
  island: { slug: string; name: string; summary: string | null; path: string[] };
  verdict: Verdict | null;
  history: Verdict[];
  islets: { slug: string; name: string; state: VerdictState | null }[];
  straits: {
    target: string;
    name: string | null;
    neighbour: { slug: string; name: string; state: VerdictState | null };
    state: VerdictState | null;
  }[];
  nearestOpenWater: string[];
  pendingReefs: { id: number; proposal: ReefProposal }[];
  /** This mode's thread only: the judge never sees the mentor's, nor the mentor the judge's. */
  thread: Message[];
  landmarks: Landmark[];
  /** Asks attached to this thread's messages, plus any not attached yet. */
  asks: Ask[];
  board: BoardCard[];
  /** The judge's round: reader answers since this island was last charted in its thread (all of them if it never was). 0 for the mentor. */
  round: number;
  /** The mentor's learner block; null on the judge's turn, which never reads it. */
  learner: LearnerView | null;
};

/** Everything a persona sees about one island. Read fresh from the database; never cached. */
export function buildJudgeContext(db: Database, domainSlug: string, islandSlug: string, mode: MessageMode = "judge"): JudgeContext {
  const domain = requireDomain(db, domainSlug);
  const island = requireIsland(db, domain.id, islandSlug);
  const islets = listIslands(db, domain.id, island.id);
  const isletVerdicts = latestVerdicts(db, "island", islets.map((i) => i.id));
  const touching = listStraits(db, domain.id, island.parentId).filter(
    (s) => s.fromIslandId === island.id || s.toIslandId === island.id,
  );
  const straitVerdicts = latestVerdicts(db, "strait", touching.map((s) => s.id));
  const straits = touching.map((s) => {
    const from = getIslandById(db, s.fromIslandId)!;
    const to = getIslandById(db, s.toIslandId)!;
    const other = from.id === island.id ? to : from;
    return {
      target: `strait:${from.slug}~${to.slug}`,
      name: s.name,
      neighbour: { slug: other.slug, name: other.name, state: latestVerdict(db, "island", other.id)?.state ?? null },
      state: straitVerdicts.get(s.id)?.state ?? null,
    };
  });
  const parent = island.parentId === null ? null : getIslandById(db, island.parentId)!;
  const thread = listMessages(db, island.id, mode);
  const inThread = new Set(thread.map((m) => m.id));
  const pendingReefs = thread
    .filter((m) => m.kind === "reef_proposal")
    .map((m) => ({ id: m.id, proposal: parseProposal(m.body) }))
    .filter((p) => p.proposal.status === "pending");
  return {
    mode,
    domain: { slug: domain.slug, name: domain.name, angle: domain.angle },
    island: { slug: island.slug, name: island.name, summary: island.summary, path: islandPath(db, island.id).map((i) => i.slug) },
    verdict: latestVerdict(db, "island", island.id),
    history: verdictHistory(db, "island", island.id),
    islets: islets.map((i) => ({ slug: i.slug, name: i.name, state: isletVerdicts.get(i.id)?.state ?? null })),
    straits,
    nearestOpenWater: buildSnapshot(db, domain.slug, parent ? parent.slug : null).nearestOpenWater,
    pendingReefs,
    thread,
    landmarks: listLandmarks(db, island.id),
    asks: listAsks(db, island.id).filter((a) => a.messageId === null || inThread.has(a.messageId)),
    board: listCards(db, island.id),
    round: mode === "judge" ? roundOf(thread, latestVerdict(db, "island", island.id)?.createdAt ?? null) : 0,
    learner: mode === "mentor" ? { note: getLearner(db).note, ground: learnerGround(db), reefs: confirmedReefClaims(db) } : null,
  };
}

/**
 * Reader text messages after the last `charted as …` line: a re-probe starts its own four answers.
 * A verdict written outside the thread (the CLI repair path) leaves no such line, so when `verdictAt`
 * is given only answers newer than it count.
 */
export function roundOf(thread: Message[], verdictAt: string | null = null): number {
  const last = thread.findLast((m) => m.kind === "system" && m.body.startsWith(CHARTED_PREFIX));
  return thread.filter((m) => m.role === "you" && m.kind === "text" && (!last || m.id > last.id) && (!verdictAt || m.createdAt > verdictAt)).length;
}

export const stateOf = (state: VerdictState | null) => state ?? "open water";

/**
 * Indents the continuation lines of a stored body. Text the reader wrote is replayed inside a
 * line-oriented transcript, so an embedded newline must not be able to forge a `Judge:` or `[map]` line.
 */
export const indent = (body: string) => body.replace(/\r?\n/g, "\n  ");

// ---- line renderers: each returns lines; a persona (persona.ts) composes them ----

/** The island's name, place, and verdict: the head both personas see. */
export function renderIslandHead(ctx: JudgeContext): string[] {
  const lines = [`# This island`, ``];
  lines.push(`Domain: ${ctx.domain.name} (${ctx.domain.slug})`);
  lines.push(...renderAngle(ctx.domain.angle));
  lines.push(`Island: ${ctx.island.name} (island:${ctx.island.slug}), at ${ctx.island.path.join(" › ")}`);
  if (ctx.island.summary) lines.push(`Summary: ${indent(ctx.island.summary)}`);
  lines.push(
    ctx.verdict
      ? `Current verdict: ${ctx.verdict.state} (confidence ${ctx.verdict.confidence}) — evidence: "${indent(ctx.verdict.evidence)}"${ctx.verdict.rationale ? ` — ${ctx.verdict.rationale}` : ""}`
      : `Current verdict: open water (none yet)`,
  );
  if (ctx.history.length > 1) {
    lines.push(`Earlier verdicts: ${ctx.history.slice(1).map((v) => `${v.state} on ${v.createdAt.slice(0, 10)}`).join(", ")}`);
  }
  return lines;
}

/** The domain's angle, quoted as the reader wrote it: one line, or none when they gave none. */
export function renderAngle(angle: string | null): string[] {
  return angle ? [`Angle (the reader's words on where they chart this from and why): ${indent(angle)}`] : [];
}

/** `## The learner`: the note, solid ground in every domain, and the claims never to build on. */
export function renderLearner(learner: LearnerView): string[] {
  const lines = [`## The learner`, ``];
  const note = learner.note.slice(0, NOTE_MAX).trim();
  // A blockquote, every line marked: a line in the note can never pose as a heading of the protocol.
  if (note) lines.push(`Note:`, ...note.split(/\r\n|\r|\n/).map((l) => `> ${l}`), ``);
  else lines.push(`Note: none`, ``);
  if (learner.ground.length === 0) {
    lines.push(`Ground: none yet — use an everyday analogy and say so.`);
  } else {
    lines.push(`Ground (settled or mountainous, in every domain; mountainous first):`);
    for (const g of learner.ground) {
      lines.push(`- ${g.domain} › ${g.island} (${g.state})${g.summary ? `: ${indent(g.summary)}` : ""}${g.lit.length ? ` — lit: ${g.lit.join(", ")}` : ""}`);
    }
  }
  lines.push(``);
  if (learner.reefs.length === 0) {
    lines.push(`Avoid building on: none`);
  } else {
    lines.push(`Avoid building on (claims the reader once held that the judge found wrong):`);
    for (const r of learner.reefs) lines.push(`- ${r.domain} › ${r.island}: ${indent(r.claim)}`);
  }
  lines.push(``, `Left out: sandbars, open water, and anything only explored with you. Exploring is not demonstrating; never rest an analogy on it.`);
  return lines;
}

/** Islets, straits to neighbours, and the nearest open water at this scale. */
export function renderSurroundings(ctx: JudgeContext): string[] {
  const lines = [``, `Islets (${ctx.islets.length}):`];
  if (ctx.islets.length === 0) lines.push(`- none`);
  for (const i of ctx.islets) lines.push(`- ${i.name} (${i.slug}): ${stateOf(i.state)}`);
  lines.push(``, `Straits to neighbours:`);
  if (ctx.straits.length === 0) lines.push(`- none`);
  for (const s of ctx.straits) {
    lines.push(`- ${s.target}${s.name ? ` "${s.name}"` : ""}: ${stateOf(s.state)}; neighbour ${s.neighbour.name} is ${stateOf(s.neighbour.state)}`);
  }
  lines.push(``, `Nearest open water at this scale, in order: ${ctx.nearestOpenWater.length ? ctx.nearestOpenWater.join(", ") : "none"}`);
  return lines;
}

export function renderPendingReefs(ctx: JudgeContext): string[] {
  if (!ctx.pendingReefs.length) return [];
  const lines = [``, `Pending reef proposals (wait for the reader; do not propose again):`];
  for (const p of ctx.pendingReefs) lines.push(`- #${p.id} on ${p.proposal.target}: ${p.proposal.claim} — ${p.proposal.consequence}`);
  return lines;
}

export function renderPendingAsk(ctx: JudgeContext): string[] {
  const pending = ctx.asks.findLast((a) => a.messageId !== null && a.picked === null);
  return pending ? [``, `Pending question (wait for the reader's choice; do not ask again): ${pending.question} — options: ${pending.options.join(" | ")}`] : [];
}

// The judge's own board keeps its long-standing marks; the mentor's names the judge as MENTOR.md does.
const AUTHOR_MARK: Record<MessageRole, Record<MessageRole, string>> = {
  judge: { judge: "keeper", mentor: "mentor", you: "reader", cartographer: "cartographer" },
  mentor: { judge: "judge", mentor: "mentor", you: "reader", cartographer: "cartographer" },
  you: { judge: "keeper", mentor: "mentor", you: "reader", cartographer: "cartographer" },
  cartographer: { judge: "judge", mentor: "mentor", you: "reader", cartographer: "cartographer" },
};

/** The board, each card marked by its author and by what changed since `self`'s last reply in this thread. */
export function renderBoard(ctx: JudgeContext, self: MessageRole, emptyHint: string): string[] {
  if (ctx.board.length === 0) return [``, `Board: empty — ${emptyHint}`];
  const lastReply = ctx.thread.findLast((m) => m.role === self && m.kind === "text") ?? null;
  const lines = [``, `Board (${ctx.board.length} ${ctx.board.length === 1 ? "card" : "cards"}):`];
  for (const c of ctx.board) {
    const marks = [AUTHOR_MARK[self][c.author]];
    if (!lastReply || c.createdAt > lastReply.createdAt) marks.push("new since your last reply");
    else if (c.updatedAt > lastReply.createdAt) marks.push("edited since your last reply");
    lines.push(`- #${c.id} ${c.kind}${c.lang ? ` (${c.lang})` : ""}${c.title ? ` "${indent(c.title)}"` : ""} [${marks.join(", ")}]:`, `  ${indent(c.body)}`);
  }
  return lines;
}

const SPEAKER: Record<MessageRole, string> = { you: "Reader", judge: "Judge", mentor: "Mentor", cartographer: "Cartographer" };

/** The stored thread as transcript lines. Stateless: the model sees the whole thread every turn. */
export function renderReplay(thread: Message[], asks: Ask[]): string[] {
  return thread.map((m) => {
    if (m.kind === "system") return `[map] ${indent(m.body)}`;
    if (m.kind === "reef_proposal") {
      const p = parseProposal(m.body);
      return `[reef proposal #${m.id}, ${p.status}] ${p.claim} — ${p.consequence}`;
    }
    const ask = asks.find((a) => a.messageId === m.id);
    const line = `${SPEAKER[m.role]}: ${indent(m.body)}`;
    if (!ask) return line;
    // The markers sit at column 0: a reader's indented continuation lines (see `indent`) can never forge them.
    const markers = [`[options] ${ask.options.join(" | ")}`];
    if (ask.picked !== null) markers.push(`[picked] ${indent(ask.picked)}`);
    return [line, ...markers].join("\n");
  });
}
