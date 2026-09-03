import type { Database } from "bun:sqlite";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { Island } from "../types.ts";

const COLS =
  "id, domain_id as domainId, parent_id as parentId, slug, name, summary, sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export type IslandUpsert = {
  domainId: number;
  slug: string;
  name: string;
  summary?: string | null;
  parentId?: number | null;
  sortOrder?: number | null;
};

export function upsertIsland(db: Database, input: IslandUpsert): Island {
  if (input.parentId != null) {
    const existing = getIsland(db, input.domainId, input.slug);
    if (existing) assertNotDescendant(db, existing, input.parentId);
  }
  return db
    .query<Island, Record<string, string | number | null>>(
      `insert into islands (domain_id, slug, name, summary, parent_id, sort_order)
       values ($domainId, $slug, $name, $summary, $parentId, coalesce($sortOrder, 0))
       on conflict(domain_id, slug) do update set
         name = excluded.name,
         summary = coalesce(excluded.summary, islands.summary),
         parent_id = coalesce(excluded.parent_id, islands.parent_id),
         sort_order = coalesce($sortOrder, islands.sort_order),
         updated_at = ${NOW}
       returning ${COLS}`,
    )
    .get({
      $domainId: input.domainId,
      $slug: input.slug,
      $name: input.name,
      $summary: input.summary ?? null,
      $parentId: input.parentId ?? null,
      $sortOrder: input.sortOrder ?? null,
    })!;
}

export function updateIsland(
  db: Database,
  domainId: number,
  slug: string,
  patch: { name?: string; summary?: string; sortOrder?: number },
): Island {
  const current = requireIsland(db, domainId, slug);
  return db
    .query<Island, Record<string, string | number | null>>(
      `update islands set name = $name, summary = $summary, sort_order = $sortOrder, updated_at = ${NOW}
       where id = $id returning ${COLS}`,
    )
    .get({
      $id: current.id,
      $name: patch.name ?? current.name,
      $summary: patch.summary ?? current.summary,
      $sortOrder: patch.sortOrder ?? current.sortOrder,
    })!;
}

export function getIsland(db: Database, domainId: number, slug: string): Island | null {
  return (
    db.query<Island, [number, string]>(`select ${COLS} from islands where domain_id = ? and slug = ?`).get(domainId, slug) ??
    null
  );
}

export function getIslandById(db: Database, id: number): Island | null {
  return db.query<Island, [number]>(`select ${COLS} from islands where id = ?`).get(id) ?? null;
}

export function listIslandSlugs(db: Database, domainId: number): string[] {
  return db
    .query<{ slug: string }, [number]>("select slug from islands where domain_id = ? order by slug")
    .all(domainId)
    .map((r) => r.slug);
}

export function requireIsland(db: Database, domainId: number, slug: string): Island {
  const island = getIsland(db, domainId, slug);
  if (!island) throw new NotFoundError(`no island "${slug}" in this domain`, listIslandSlugs(db, domainId));
  return island;
}

export function listIslands(db: Database, domainId: number, parentId: number | null): Island[] {
  if (parentId === null) {
    return db
      .query<Island, [number]>(`select ${COLS} from islands where domain_id = ? and parent_id is null order by sort_order, name`)
      .all(domainId);
  }
  return db
    .query<Island, [number, number]>(`select ${COLS} from islands where domain_id = ? and parent_id = ? order by sort_order, name`)
    .all(domainId, parentId);
}

/** Ancestors first, the island itself last. */
export function islandPath(db: Database, islandId: number): Island[] {
  const path: Island[] = [];
  const seen = new Set<number>();
  let current = getIslandById(db, islandId);
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parentId === null ? null : getIslandById(db, current.parentId);
  }
  return path;
}

/** Throws if `candidateParentId` is `island` itself or any descendant of it: a parent link there would form a cycle. */
function assertNotDescendant(db: Database, island: Island, candidateParentId: number): void {
  if (candidateParentId === island.id) throw new ConflictError(`"${island.slug}" cannot be its own parent`);
  const seen = new Set<number>();
  let current = getIslandById(db, candidateParentId);
  while (current && !seen.has(current.id)) {
    if (current.id === island.id) {
      throw new ConflictError(`"${island.slug}" cannot be moved under its own islet`);
    }
    seen.add(current.id);
    current = current.parentId === null ? null : getIslandById(db, current.parentId);
  }
}
