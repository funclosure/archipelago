import type { Database } from "bun:sqlite";
import { requireDomain } from "../../core/repositories/domainRepository.ts";
import { getIslandById, islandPath, listIslands, requireIsland } from "../../core/repositories/islandRepository.ts";
import { listStraits } from "../../core/repositories/straitRepository.ts";
import { latestVerdict, latestVerdicts, verdictHistory } from "../../core/repositories/verdictRepository.ts";
import { listMessages, parseProposal } from "../../core/repositories/messageRepository.ts";
import { listLandmarks } from "../../core/repositories/landmarkRepository.ts";
import { listAsks } from "../../core/repositories/askRepository.ts";
import { buildSnapshot } from "../../core/view-model.ts";
import type { Ask, Landmark, Message, ReefProposal, Verdict, VerdictState } from "../../core/types.ts";

export type JudgeContext = {
  domain: { slug: string; name: string };
  islandId: number;
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
  thread: Message[];
  landmarks: Landmark[];
  asks: Ask[];
  /** Reader answers so far: the count of `you` text messages. */
  round: number;
};

/** Everything the judge sees about one island. Read fresh from the database; never cached. */
export function buildJudgeContext(db: Database, domainSlug: string, islandSlug: string): JudgeContext {
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
  const thread = listMessages(db, island.id);
  const pendingReefs = thread
    .filter((m) => m.kind === "reef_proposal")
    .map((m) => ({ id: m.id, proposal: parseProposal(m.body) }))
    .filter((p) => p.proposal.status === "pending");
  return {
    domain: { slug: domain.slug, name: domain.name },
    islandId: island.id,
    island: { slug: island.slug, name: island.name, summary: island.summary, path: islandPath(db, island.id).map((i) => i.slug) },
    verdict: latestVerdict(db, "island", island.id),
    history: verdictHistory(db, "island", island.id),
    islets: islets.map((i) => ({ slug: i.slug, name: i.name, state: isletVerdicts.get(i.id)?.state ?? null })),
    straits,
    nearestOpenWater: buildSnapshot(db, domain.slug, parent ? parent.slug : null).nearestOpenWater,
    pendingReefs,
    thread,
    landmarks: listLandmarks(db, island.id),
    asks: listAsks(db, island.id),
    round: thread.filter((m) => m.role === "you" && m.kind === "text").length,
  };
}

const stateOf = (state: VerdictState | null) => state ?? "open water";

/**
 * Indents the continuation lines of a stored body. Text the reader wrote is replayed inside a
 * line-oriented transcript, so an embedded newline must not be able to forge a `Judge:` or `[map]` line.
 */
const indent = (body: string) => body.replace(/\r?\n/g, "\n  ");

/** The island block appended to the protocol as the system prompt. */
export function renderContext(ctx: JudgeContext): string {
  const lines: string[] = [];
  lines.push(`# This island`, ``);
  lines.push(`Domain: ${ctx.domain.name} (${ctx.domain.slug})`);
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
  const lit = ctx.landmarks.filter((l) => l.unlockedAt !== null).length;
  if (ctx.landmarks.length === 0) {
    lines.push(``, `Landmarks: none yet — call set_landmarks with 4–6 before your opening question.`);
  } else {
    lines.push(``, `Landmarks (${lit} of ${ctx.landmarks.length} lit):`);
    for (const l of ctx.landmarks) {
      lines.push(`- ${l.name} (${l.slug}): ${l.unlockedAt ? `lit — "${indent(l.evidence ?? "")}"` : "dark"}`);
    }
  }
  if (ctx.round >= 4 && !ctx.verdict) {
    lines.push(`Round: ${ctx.round} of 4. This is the fourth answer: decide now with record_verdict or propose_reef before writing anything else.`);
  } else {
    lines.push(`Round: ${ctx.round} of 4 (reader answers so far; the verdict lands after the fourth at the latest)`);
  }
  lines.push(``, `Islets (${ctx.islets.length}):`);
  if (ctx.islets.length === 0) lines.push(`- none`);
  for (const i of ctx.islets) lines.push(`- ${i.name} (${i.slug}): ${stateOf(i.state)}`);
  lines.push(``, `Straits to neighbours:`);
  if (ctx.straits.length === 0) lines.push(`- none`);
  for (const s of ctx.straits) {
    lines.push(`- ${s.target}${s.name ? ` "${s.name}"` : ""}: ${stateOf(s.state)}; neighbour ${s.neighbour.name} is ${stateOf(s.neighbour.state)}`);
  }
  lines.push(``, `Nearest open water at this scale, in order: ${ctx.nearestOpenWater.length ? ctx.nearestOpenWater.join(", ") : "none"}`);
  if (ctx.pendingReefs.length) {
    lines.push(``, `Pending reef proposals (wait for the reader; do not propose again):`);
    for (const p of ctx.pendingReefs) lines.push(`- #${p.id} on ${p.proposal.target}: ${p.proposal.claim} — ${p.proposal.consequence}`);
  }
  const pending = ctx.asks.findLast((a) => a.messageId !== null && a.picked === null);
  if (pending) lines.push(``, `Pending question (wait for the reader's choice; do not ask again): ${pending.question} — options: ${pending.options.join(" | ")}`);
  return lines.join("\n");
}

/** The stored thread as the turn's prompt. Stateless: the model sees the whole thread every turn. */
export function renderThreadPrompt(thread: Message[], asks: Ask[] = []): string {
  if (thread.length === 0) return "Open the probe on this island.";
  const lines = thread.map((m) => {
    if (m.kind === "system") return `[map] ${indent(m.body)}`;
    if (m.kind === "reef_proposal") {
      const p = parseProposal(m.body);
      return `[reef proposal #${m.id}, ${p.status}] ${p.claim} — ${p.consequence}`;
    }
    const ask = asks.find((a) => a.messageId === m.id);
    const line = `${m.role === "you" ? "Reader" : "Judge"}: ${indent(m.body)}`;
    if (!ask) return line;
    // The markers sit at column 0: a reader's indented continuation lines (see `indent`) can never forge them.
    const markers = [`[options] ${ask.options.join(" | ")}`];
    if (ask.picked !== null) markers.push(`[picked] ${indent(ask.picked)}`);
    return [line, ...markers].join("\n");
  });
  return [...lines, "", "Continue as the judge."].join("\n");
}
