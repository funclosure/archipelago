import type { Database } from "./sql.ts";
import type { Comment, CommentTargetType, Island, Landmark, SketchBody, Verdict, VerdictState, CommentKind } from "./types.ts";
import { requireDomain } from "./repositories/domainRepository.ts";
import { getIslandById, islandPath, listIslands, requireIsland } from "./repositories/islandRepository.ts";
import { getStraitById, listStraits } from "./repositories/straitRepository.ts";
import { latestVerdicts } from "./repositories/verdictRepository.ts";
import { listComments } from "./repositories/commentRepository.ts";
import { getViewState } from "./repositories/viewStateRepository.ts";
import { countMessages } from "./repositories/messageRepository.ts";
import { listLandmarksByIsland } from "./repositories/landmarkRepository.ts";
import { pendingSketch } from "./repositories/sketchRepository.ts";
import { listSeas } from "./repositories/seaRepository.ts";

export type VerdictView = { state: VerdictState; confidence: number; evidence: string; rationale: string | null; at: string };
export type RollupState = Record<VerdictState | "open", number>;
export type LandmarkView = { slug: string; name: string; lit: boolean; evidence: string | null; exploredAt: string | null };
export type IslandView = {
  slug: string;
  name: string;
  summary: string | null;
  hasChildren: boolean;
  verdict: VerdictView | null;
  children: { total: number; byState: RollupState };
  x: number | null;
  y: number | null;
  harbour: boolean;
  messages: number;
  landmarks: { total: number; unlocked: number; explored: number; items: LandmarkView[] };
};
export type StraitView = { from: string; to: string; name: string | null; verdict: VerdictView | null };
export type Snapshot = {
  version: number;
  domain: { slug: string; name: string };
  scale: { path: { slug: string; name: string }[] };
  islands: IslandView[];
  straits: StraitView[];
  focus: string | null;
  harbour: string | null;
  unreadComments: number;
  unread: { kind: CommentKind; target: string }[];
  nearestOpenWater: string[];
  reefs: string[];
  /** The cartographer's pending sketch at this scale, drawn as drafts until the reader approves it. */
  sketch: { id: number; body: SketchBody; messageId: number | null } | null;
  /** The seas the reader named at this scale. */
  seas: { id: number; name: string; x: number; y: number }[];
};
export type CommentView = Comment & { target: string };

export type OutlineNode = {
  slug: string;
  name: string;
  state: VerdictState | "open";
  landmarks: { total: number; unlocked: number; explored: number };
  harbour: boolean;
  scale: string | null; // the parent slug the map needs to show this island; null at the top
  children: OutlineNode[];
};
export type Outline = {
  version: number;
  domain: { slug: string; name: string };
  harbour: string | null;
  charted: number;
  lit: number;
  /** Landmarks explored with the mentor, and islands with any, over the whole tree: the mentor lens's counts. */
  explored: number;
  exploredIslands: number;
  islands: OutlineNode[];
};

const ELEVATION: Record<VerdictState, number> = { reef: 1, sandbar: 1, settled: 2, mountainous: 3 };

function toView(v: Verdict | undefined): VerdictView | null {
  return v ? { state: v.state, confidence: v.confidence, evidence: v.evidence, rationale: v.rationale, at: v.createdAt } : null;
}

function emptyRollup(): RollupState {
  return { sandbar: 0, settled: 0, mountainous: 0, reef: 0, open: 0 };
}

function landmarkView(list: Landmark[]): { total: number; unlocked: number; explored: number; items: LandmarkView[] } {
  const items = list.map((l) => ({ slug: l.slug, name: l.name, lit: l.unlockedAt !== null, evidence: l.evidence, exploredAt: l.exploredAt }));
  return {
    total: items.length,
    unlocked: items.filter((i) => i.lit).length,
    explored: items.filter((i) => i.exploredAt !== null).length,
    items,
  };
}

export function buildSnapshot(db: Database, domainSlug: string, scaleSlug: string | null): Snapshot {
  const domain = requireDomain(db, domainSlug);
  const scaleIsland = scaleSlug ? requireIsland(db, domain.id, scaleSlug) : null;
  const parentId = scaleIsland ? scaleIsland.id : null;
  const path = scaleIsland ? islandPath(db, scaleIsland.id).map((i) => ({ slug: i.slug, name: i.name })) : [];

  const islands = listIslands(db, domain.id, parentId);
  const islandVerdicts = latestVerdicts(db, "island", islands.map((i) => i.id));
  const messageCounts = countMessages(db, islands.map((i) => i.id));
  const landmarksByIsland = listLandmarksByIsland(db, islands.map((i) => i.id));
  const islandViews: IslandView[] = islands.map((island) => {
    const children = listIslands(db, domain.id, island.id);
    const childVerdicts = latestVerdicts(db, "island", children.map((c) => c.id));
    const byState = emptyRollup();
    for (const child of children) {
      const v = childVerdicts.get(child.id);
      if (v) byState[v.state] += 1;
      else byState.open += 1;
    }
    return {
      slug: island.slug,
      name: island.name,
      summary: island.summary,
      hasChildren: children.length > 0,
      verdict: toView(islandVerdicts.get(island.id)),
      children: { total: children.length, byState },
      x: island.x,
      y: island.y,
      harbour: island.harbour === 1,
      messages: messageCounts.get(island.id) ?? 0,
      landmarks: landmarkView(landmarksByIsland.get(island.id) ?? []),
    };
  });

  const straits = listStraits(db, domain.id, parentId);
  const straitVerdicts = latestVerdicts(db, "strait", straits.map((s) => s.id));
  const slugById = new Map(islands.map((i) => [i.id, i.slug]));
  const straitViews: StraitView[] = straits.map((s) => ({
    from: slugById.get(s.fromIslandId)!,
    to: slugById.get(s.toIslandId)!,
    name: s.name,
    verdict: toView(straitVerdicts.get(s.id)),
  }));

  const pending = pendingSketch(db, domain.id, parentId);
  const state = getViewState(db, domain.id);
  const focusIsland = state.focusIslandId === null ? null : getIslandById(db, state.focusIslandId);

  return {
    version: state.version,
    domain: { slug: domain.slug, name: domain.name },
    scale: { path },
    islands: islandViews,
    straits: straitViews,
    focus: focusIsland ? focusIsland.slug : null,
    harbour: islandViews.find((i) => i.harbour)?.slug ?? null,
    unreadComments: listComments(db, domain.id, { unreadOnly: true }).length,
    unread: listCommentViews(db, domain.id, true).map((c) => ({ kind: c.kind, target: c.target })),
    nearestOpenWater: nearestOpenWater(islandViews, straitViews),
    reefs: [
      ...islandViews.filter((i) => i.verdict?.state === "reef").map((i) => `island:${i.slug}`),
      ...straitViews.filter((s) => s.verdict?.state === "reef").map((s) => `strait:${s.from}~${s.to}`),
    ],
    sketch: pending ? { id: pending.id, body: pending.body, messageId: pending.messageId } : null,
    seas: listSeas(db, domain.id, parentId).map((s) => ({ id: s.id, name: s.name, x: s.x, y: s.y })),
  };
}

/** The whole domain as a tree, for the outline panel. Islets are few, so one query per level is fine. */
export function buildOutline(db: Database, domainSlug: string): Outline {
  const domain = requireDomain(db, domainSlug);
  let charted = 0;
  let lit = 0;
  let explored = 0;
  let exploredIslands = 0;
  const level = (parent: Island | null): OutlineNode[] => {
    const islands = listIslands(db, domain.id, parent ? parent.id : null);
    const verdicts = latestVerdicts(db, "island", islands.map((i) => i.id));
    const landmarks = listLandmarksByIsland(db, islands.map((i) => i.id));
    return islands.map((island) => {
      const v = verdicts.get(island.id);
      const items = landmarks.get(island.id) ?? [];
      const unlocked = items.filter((l) => l.unlockedAt !== null).length;
      const exploredHere = items.filter((l) => l.exploredAt !== null).length;
      if (v) charted += 1;
      lit += unlocked;
      explored += exploredHere;
      if (exploredHere) exploredIslands += 1;
      return {
        slug: island.slug,
        name: island.name,
        state: v ? v.state : "open",
        landmarks: { total: items.length, unlocked, explored: exploredHere },
        harbour: island.harbour === 1,
        scale: parent ? parent.slug : null,
        children: level(island),
      };
    });
  };
  const islands = level(null);
  return {
    version: getViewState(db, domain.id).version,
    domain: { slug: domain.slug, name: domain.name },
    harbour: islands.find((i) => i.harbour)?.slug ?? null,
    charted,
    lit,
    explored,
    exploredIslands,
    islands,
  };
}

/**
 * Spec §7: open-water islands that share a strait with a charted island, ordered by the charted
 * neighbour's elevation (highest first), then every remaining open-water island in map order.
 */
export function nearestOpenWater(islands: IslandView[], straits: StraitView[]): string[] {
  const byslug = new Map(islands.map((i) => [i.slug, i]));
  const bestNeighbour = new Map<string, number>();
  for (const s of straits) {
    for (const [open, charted] of [
      [s.from, s.to],
      [s.to, s.from],
    ] as const) {
      const o = byslug.get(open);
      const c = byslug.get(charted);
      if (!o || !c || o.verdict || !c.verdict) continue;
      const elevation = ELEVATION[c.verdict.state];
      bestNeighbour.set(open, Math.max(bestNeighbour.get(open) ?? 0, elevation));
    }
  }
  const adjacent = [...bestNeighbour.entries()].sort((a, b) => b[1] - a[1]).map(([slug]) => slug);
  const rest = islands.filter((i) => !i.verdict && !bestNeighbour.has(i.slug)).map((i) => i.slug);
  return [...adjacent, ...rest];
}

export function formatTarget(db: Database, targetType: CommentTargetType | "island" | "strait", targetId: number): string {
  if (targetType === "island") {
    const island = getIslandById(db, targetId);
    return `island:${island ? island.slug : targetId}`;
  }
  if (targetType === "strait") {
    const strait = getStraitById(db, targetId);
    if (!strait) return `strait:${targetId}`;
    const a = getIslandById(db, strait.fromIslandId);
    const b = getIslandById(db, strait.toIslandId);
    return `strait:${a?.slug ?? strait.fromIslandId}~${b?.slug ?? strait.toIslandId}`;
  }
  const domain = db
    .query<{ slug: string }, [number]>("select slug from domains where id = ?")
    .get(targetId);
  return `domain:${domain ? domain.slug : targetId}`;
}

export function listCommentViews(db: Database, domainId: number, unreadOnly: boolean): CommentView[] {
  return listComments(db, domainId, { unreadOnly }).map((c) => ({ ...c, target: formatTarget(db, c.targetType, c.targetId) }));
}
