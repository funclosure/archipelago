// The guide's side of a turn: the mentor before any island. One thread per domain; it reads the whole map and the
// reader, asks where they stand, and points them at an island to start on, in the lens that fits (GUIDE.md).
import { z } from "zod";
import type { Database } from "../../core/sql.ts";
import { openDatabase } from "../../core/db.ts";
import { ArchipelagoError } from "../../core/errors.ts";
import { requireDomain } from "../../core/repositories/domainRepository.ts";
import { getIslandById, listIslands, requireIsland } from "../../core/repositories/islandRepository.ts";
import { latestVerdicts } from "../../core/repositories/verdictRepository.ts";
import { listGuideMessages } from "../../core/repositories/messageRepository.ts";
import { listLandmarksByIsland } from "../../core/repositories/landmarkRepository.ts";
import { listStraits } from "../../core/repositories/straitRepository.ts";
import { listSeas } from "../../core/repositories/seaRepository.ts";
import { addPointer } from "../../core/repositories/pointerRepository.ts";
import { confirmedReefClaims, getLearner, learnerGround } from "../../core/repositories/learnerRepository.ts";
import { seaMembers } from "../../core/seas.ts";
import { islandModes, type Ask, type Island, type Message, type VerdictState } from "../../core/types.ts";
import { pointToInputSchema } from "../../core/validators.ts";
import { indent, renderDescription, renderLearner, renderReplay, renderReplyLanguage, stateOf, type LearnerView } from "./context.ts";
import { threadWithImages, type PromptImage, type ThreadMessage } from "./prompt-images.ts";

export type GuideDeps = { dbPath?: string; domain: string };

type GuideIsland = {
  slug: string;
  name: string;
  summary: string | null;
  harbour: boolean;
  state: VerdictState | null;
  landmarks: { total: number; lit: number; explored: number; names: string[] };
  /** Replies so far in each island thread: whether the reader has started there, and with whom. */
  started: { judge: number; mentor: number };
  islets: { slug: string; name: string; state: VerdictState | null }[];
};

export type GuideContext = {
  mode: "guide";
  domain: { slug: string; name: string; description: string | null; language: string | null };
  learner: LearnerView;
  islands: GuideIsland[];
  straits: { a: string; b: string; name: string | null }[];
  seas: { name: string; islands: string[] }[];
  /** The guide thread, with the reader's images. */
  thread: ThreadMessage[];
  /** The reader's images this turn shows whole, as base64. */
  images: PromptImage[];
  /** The guide never asks with options; kept so the runners treat every persona alike. */
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

/** Reader messages per island and island mode. */
function threadCounts(db: Database, ids: number[]): Map<number, { judge: number; mentor: number }> {
  const counts = new Map<number, { judge: number; mentor: number }>();
  if (ids.length === 0) return counts;
  const rows = db
    .query<{ islandId: number; mode: string; n: number }, number[]>(
      `select island_id as islandId, mode, count(*) as n from messages where role = 'you' and island_id in (${ids.map(() => "?").join(",")}) group by island_id, mode`,
    )
    .all(...ids);
  for (const r of rows) {
    const c = counts.get(r.islandId) ?? { judge: 0, mentor: 0 };
    if (r.mode === "judge" || r.mode === "mentor") c[r.mode] = r.n;
    counts.set(r.islandId, c);
  }
  return counts;
}

export function buildGuideContext(db: Database, domainSlug: string): GuideContext {
  const domain = requireDomain(db, domainSlug);
  const learner = getLearner(db);
  const top = listIslands(db, domain.id, null);
  const islets = new Map<number, Island[]>(top.map((i) => [i.id, listIslands(db, domain.id, i.id)]));
  const all = [...top, ...[...islets.values()].flat()];
  const verdicts = latestVerdicts(db, "island", all.map((i) => i.id));
  const landmarks = listLandmarksByIsland(db, top.map((i) => i.id));
  const counts = threadCounts(db, top.map((i) => i.id));
  const seas = listSeas(db, domain.id, null);
  const members = seaMembers(seas, top);
  return {
    mode: "guide",
    domain: { slug: domain.slug, name: domain.name, description: domain.description, language: learner.language },
    learner: { note: learner.note, ground: learnerGround(db), reefs: confirmedReefClaims(db) },
    islands: top.map((i) => {
      const marks = landmarks.get(i.id) ?? [];
      return {
        slug: i.slug,
        name: i.name,
        summary: i.summary,
        harbour: i.harbour === 1,
        state: verdicts.get(i.id)?.state ?? null,
        landmarks: { total: marks.length, lit: marks.filter((l) => l.unlockedAt !== null).length, explored: marks.filter((l) => l.exploredAt !== null).length, names: marks.map((l) => l.name) },
        started: counts.get(i.id) ?? { judge: 0, mentor: 0 },
        islets: (islets.get(i.id) ?? []).map((c) => ({ slug: c.slug, name: c.name, state: verdicts.get(c.id)?.state ?? null })),
      };
    }),
    straits: listStraits(db, domain.id, null).map((s) => ({ a: getIslandById(db, s.fromIslandId)!.slug, b: getIslandById(db, s.toIslandId)!.slug, name: s.name })),
    seas: seas.map((s) => ({ name: s.name, islands: members.get(s.id) ?? [] })),
    ...threadWithImages(db, domain.id, listGuideMessages(db, domain.id)),
    asks: [],
  };
}

export function guideContext(deps: GuideDeps): GuideContext {
  return withDb(deps.dbPath, (db) => buildGuideContext(db, deps.domain));
}

/** The guide's pointer: any island in the domain (top or islet), the lens to sail in, and whether to carry the question. */
export const suggestIslandInputSchema = pointToInputSchema.extend({
  lens: z.enum(islandModes),
  carry: z.boolean().optional(),
});

/** `suggest_island`: a "Sail to" card under the guide's reply. With `carry`, the reader's latest message goes along. */
export function suggestIsland(deps: GuideDeps, input: unknown): { island: string; name: string; lens: string; note: string } {
  const parsed = suggestIslandInputSchema.parse(input);
  return withDb(deps.dbPath, (db) => {
    const domain = requireDomain(db, deps.domain);
    const target = requireIsland(db, domain.id, parsed.island);
    const question = parsed.carry ? listGuideMessages(db, domain.id).findLast((m) => m.role === "you" && m.kind === "text")?.body || null : null;
    if (parsed.carry && question === null) throw new ArchipelagoError("carry takes the reader's latest message, and it has no words (none yet, or images alone)");
    addPointer(db, { domainId: domain.id, islandId: null, targetIslandId: target.id, why: parsed.why, question, lens: parsed.lens });
    return {
      island: target.slug,
      name: target.name,
      lens: parsed.lens,
      note: "A card to sail there appears under your reply. Name the island in your reply, say in a sentence why it fits, and stop.",
    };
  });
}

// ---- rendering ----

const LENS_NAME = { judge: "the Keeper", mentor: "the mentor" } as const;

function islandLine(i: GuideIsland): string {
  const marks = i.landmarks.total ? `${i.landmarks.lit} of ${i.landmarks.total} landmarks lit, ${i.landmarks.explored} explored` : "no landmarks yet";
  const started = islandModes.filter((m) => i.started[m] > 0).map((m) => `${i.started[m]} messages with ${LENS_NAME[m]}`);
  return [
    `- ${i.name} (${i.slug})${i.harbour ? " [harbour]" : ""}: ${stateOf(i.state)}; ${marks}; ${started.length ? started.join(", ") : "not started"}.`,
    i.summary ? `  Summary: ${indent(i.summary)}` : "",
    i.landmarks.names.length ? `  Landmarks: ${i.landmarks.names.join(", ")}` : "",
    i.islets.length ? `  Islets: ${i.islets.map((c) => `${c.name} (${c.slug}, ${stateOf(c.state)})`).join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

/** The guide's block, appended to GUIDE.md: the learner, then the whole map at the top scale. */
export function renderGuideContext(ctx: GuideContext): string {
  const lines = [...renderLearner(ctx.learner), ``, `## This domain`, ``, `Domain: ${ctx.domain.name} (${ctx.domain.slug})`];
  lines.push(...renderDescription(ctx.domain.description, ctx.domain.language));
  lines.push(``, `Islands at the top (${ctx.islands.length}), in the map's order (suggest_island takes the slug, of an island or an islet):`);
  if (ctx.islands.length === 0) lines.push(`- none yet: the cartographer has not sketched this domain. Say so in one line and stop.`);
  for (const i of ctx.islands) lines.push(islandLine(i));
  if (ctx.straits.length) {
    lines.push(``, `Straits (what connects two islands):`);
    for (const s of ctx.straits) lines.push(`- ${s.a}~${s.b}${s.name ? ` "${indent(s.name)}"` : ""}`);
  }
  if (ctx.seas.length) {
    lines.push(``, `Seas (the reader's grouping):`);
    for (const s of ctx.seas) lines.push(`- "${indent(s.name)}": ${s.islands.join(", ") || "no islands near it"}`);
  }
  if (ctx.domain.language && !ctx.thread.some((m) => m.role === "you" && m.kind === "text")) {
    lines.push(``, `No reader message yet: write this opening in the language of the reader's page (see above).`);
  }
  lines.push(...renderReplyLanguage(ctx.domain.language, ctx.thread));
  return lines.join("\n");
}

/** The guide's thread as the turn's prompt. */
export function renderGuideThreadPrompt(thread: ThreadMessage[], asks: Ask[] = []): string {
  if (thread.length === 0) return "Open the guide: welcome the reader to this map in a line, then ask where they stand.";
  return [...renderReplay(thread, asks), "", "Continue as the mentor."].join("\n");
}
