// The cartographer's side of a turn: what it sees at one scale, its two tools, and how its context and
// thread are rendered. It proposes sketches; the reader approves them through POST /api/sketch.
import type { Database } from "../../core/sql.ts";
import { openDatabase } from "../../core/db.ts";
import { requireDomain } from "../../core/repositories/domainRepository.ts";
import { islandPath, listIslands, listIslandSlugs, requireIsland, getIslandById } from "../../core/repositories/islandRepository.ts";
import { listStraits } from "../../core/repositories/straitRepository.ts";
import { latestVerdict, latestVerdicts } from "../../core/repositories/verdictRepository.ts";
import { listMessages, listScaleMessages } from "../../core/repositories/messageRepository.ts";
import { listLandmarks, listLandmarksByIsland } from "../../core/repositories/landmarkRepository.ts";
import { listCards } from "../../core/repositories/boardRepository.ts";
import { pendingSketch, proposeSketch, SKETCH_LIMITS } from "../../core/repositories/sketchRepository.ts";
import type { Ask, BoardCard, Landmark, Message, Sketch, VerdictState } from "../../core/types.ts";
import { getLearner } from "../../core/repositories/learnerRepository.ts";
import { NOTE_MAX } from "../../core/validators.ts";
import { indent, renderDescription, renderReplay, stateOf } from "./context.ts";

/** Where a cartographer turn reads and writes: a domain, and the island whose islets it sketches (absent: the top scale). */
export type ChartDeps = { dbPath?: string; domain: string; island?: string };

export type ChartContext = {
  mode: "cartographer";
  /** `provisional`: the name is a placeholder taken from the description; the first sketch names the domain. */
  domain: { slug: string; name: string; description: string | null; provisional: boolean };
  /** The reader's About you note, the same one the mentor reads; empty when they wrote none. */
  learnerNote: string;
  /** The island whose islets this scale holds; null at the domain's top scale. */
  scale: null | {
    slug: string;
    name: string;
    summary: string | null;
    path: string[];
    state: VerdictState | null;
    landmarks: Landmark[];
    board: BoardCard[];
    /** The island's other two threads, read so the islets follow what they found. */
    judgeThread: Message[];
    mentorThread: Message[];
  };
  islands: { slug: string; name: string; summary: string | null; state: VerdictState | null; harbour: boolean; landmarks: string[] }[];
  straits: { a: string; b: string; name: string | null; state: VerdictState | null }[];
  /** Every island slug in the domain, so a sketch never takes one. */
  slugs: string[];
  /** How many new islands the next sketch may add here. */
  limits: readonly [number, number];
  pending: Sketch | null;
  thread: Message[];
  /** The cartographer never asks with options; kept so the runners treat every persona alike. */
  asks: Ask[];
};

function withDb<T>(dbPath: string | undefined, fn: (db: Database) => T): T {
  const db = openDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function buildChartContext(db: Database, domainSlug: string, islandSlug?: string): ChartContext {
  const domain = requireDomain(db, domainSlug);
  const island = islandSlug === undefined ? null : requireIsland(db, domain.id, islandSlug);
  const parentId = island ? island.id : null;
  const siblings = listIslands(db, domain.id, parentId);
  const verdicts = latestVerdicts(db, "island", siblings.map((i) => i.id));
  const landmarks = listLandmarksByIsland(db, siblings.map((i) => i.id));
  const straits = listStraits(db, domain.id, parentId);
  const straitVerdicts = latestVerdicts(db, "strait", straits.map((s) => s.id));
  return {
    mode: "cartographer",
    domain: { slug: domain.slug, name: domain.name, description: domain.description, provisional: domain.provisional === 1 },
    learnerNote: getLearner(db).note.slice(0, NOTE_MAX).trim(),
    scale: island && {
      slug: island.slug,
      name: island.name,
      summary: island.summary,
      path: islandPath(db, island.id).map((i) => i.slug),
      state: latestVerdict(db, "island", island.id)?.state ?? null,
      landmarks: listLandmarks(db, island.id),
      board: listCards(db, island.id),
      judgeThread: listMessages(db, island.id, "judge"),
      mentorThread: listMessages(db, island.id, "mentor"),
    },
    islands: siblings.map((i) => ({
      slug: i.slug, name: i.name, summary: i.summary, state: verdicts.get(i.id)?.state ?? null, harbour: Boolean(i.harbour),
      landmarks: (landmarks.get(i.id) ?? []).map((l) => l.name),
    })),
    straits: straits.map((s) => ({
      a: getIslandById(db, s.fromIslandId)!.slug, b: getIslandById(db, s.toIslandId)!.slug, name: s.name, state: straitVerdicts.get(s.id)?.state ?? null,
    })),
    slugs: listIslandSlugs(db, domain.id),
    limits: SKETCH_LIMITS[island ? "islets" : "top"][siblings.length === 0 ? "first" : "more"],
    pending: pendingSketch(db, domain.id, parentId),
    thread: listScaleMessages(db, domain.id, parentId),
    asks: [],
  };
}

export function chartContext(deps: ChartDeps): ChartContext {
  return withDb(deps.dbPath, (db) => buildChartContext(db, deps.domain, deps.island));
}

/** `propose_sketch`: records the scale's pending sketch. Nothing reaches the map until the reader approves it. */
export function proposeSketchTool(deps: ChartDeps, input: unknown): { sketchId: number; islands: number; straits: number; updates: number; note: string } {
  return withDb(deps.dbPath, (db) => {
    const domain = requireDomain(db, deps.domain);
    const scale = deps.island === undefined ? null : requireIsland(db, domain.id, deps.island);
    const sketch = proposeSketch(db, domain.id, scale ? scale.id : null, input);
    return {
      sketchId: sketch.id,
      islands: sketch.body.islands.length,
      straits: sketch.body.straits.length,
      updates: sketch.body.updates.length,
      note: "The reader sees the sketch on the map and approves it there. Do not print it; end with one line asking them to approve it or say what to change.",
    };
  });
}

// ---- rendering ----

const scaleName = (ctx: ChartContext) => (ctx.scale ? `the islets of ${ctx.scale.name} (${ctx.scale.slug})` : `the top scale of ${ctx.domain.name}`);

function renderThread(label: string, thread: Message[]): string[] {
  const text = thread.filter((m) => m.kind !== "reef_proposal");
  if (text.length === 0) return [``, `${label}: empty`];
  return [``, `${label}:`, ...renderReplay(text, []).map((l) => `  ${l}`)];
}

/** The cartographer's block, appended to CARTOGRAPHER.md. */
export function renderChartContext(ctx: ChartContext): string {
  const [min, max] = ctx.limits;
  const lines = [`## This scale`, ``, `Domain: ${ctx.domain.name} (${ctx.domain.slug})`];
  if (ctx.domain.provisional) lines.push(`Name: provisional, taken from the reader's description. Name the domain in this sketch (§1).`);
  lines.push(...renderDescription(ctx.domain.description));
  lines.push(`About the reader (their note): ${ctx.learnerNote ? indent(ctx.learnerNote) : "none written"}`);
  lines.push(`Scale: ${scaleName(ctx)}`);
  if (ctx.scale) {
    const s = ctx.scale;
    lines.push(`Path: ${s.path.join(" › ")}`, `Summary: ${s.summary ? indent(s.summary) : "none"}`, `Verdict: ${stateOf(s.state)}`, ``, `Its landmarks:`);
    if (s.landmarks.length === 0) lines.push(`- none`);
    for (const l of s.landmarks) lines.push(`- ${l.name} (${l.slug}): ${l.unlockedAt ? "lit" : l.exploredAt ? "explored with the mentor, not lit" : "dark"}`);
    lines.push(``, `Its board:`);
    if (s.board.length === 0) lines.push(`- empty`);
    for (const c of s.board) lines.push(`- ${c.kind}${c.title ? ` "${indent(c.title)}"` : ""} [${c.author}]: ${indent(c.body)}`);
    lines.push(...renderThread("Its judge thread", s.judgeThread), ...renderThread("Its mentor thread", s.mentorThread));
  }
  lines.push(``, `Islands at this scale (${ctx.islands.length}):`);
  if (ctx.islands.length === 0) lines.push(`- none yet`);
  for (const i of ctx.islands) {
    lines.push(`- ${i.name} (${i.slug})${i.harbour ? " [harbour]" : ""}: ${stateOf(i.state)}. ${i.summary ? indent(i.summary) : "No summary."} Landmarks: ${i.landmarks.join(", ") || "none"}`);
  }
  lines.push(``, `Straits at this scale:`);
  if (ctx.straits.length === 0) lines.push(`- none`);
  for (const s of ctx.straits) lines.push(`- ${s.a}~${s.b}${s.name ? ` "${s.name}"` : ""}: ${stateOf(s.state)}`);
  lines.push(``, `Slugs already taken in this domain: ${ctx.slugs.length ? ctx.slugs.join(", ") : "none"}`);
  lines.push(`The next sketch here adds ${min === max ? min : `${min}–${max}`} new islands.`);
  if (ctx.pending) {
    lines.push(``, `Pending sketch #${ctx.pending.id} (the reader has not approved it; a new proposal replaces it):`, `  ${JSON.stringify(ctx.pending.body)}`);
  }
  return lines.join("\n");
}

/** The cartographer's thread as the turn's prompt. An empty thread is a new domain or a sail-closer. */
export function renderChartThreadPrompt(thread: Message[], asks: Ask[] = []): string {
  if (thread.length === 0) return "Sketch this scale.";
  return [...renderReplay(thread, asks), "", "Continue as the cartographer."].join("\n");
}
