import type { Database } from "../sql.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { Island } from "../types.ts";

const COLS =
  "id, domain_id as domainId, parent_id as parentId, slug, name, summary, sort_order as sortOrder, x, y, harbour, created_at as createdAt, updated_at as updatedAt";
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
  return db.transaction(() => {
    const existing = getIsland(db, input.domainId, input.slug);
    // A moved island gets new siblings: its position and its harbour (one per parent) do not travel with it.
    const resetPosition = existing != null && input.parentId != null && input.parentId !== existing.parentId;
    if (existing && input.parentId != null) {
      assertNotDescendant(db, existing, input.parentId);
      if (input.parentId !== existing.parentId) {
        // A moved island has new siblings; its old straits would join non-siblings, so they go.
        db.run("delete from straits where from_island_id = ? or to_island_id = ?", [existing.id, existing.id]);
      }
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
           x = case when $resetPosition then null else islands.x end,
           y = case when $resetPosition then null else islands.y end,
           harbour = case when $resetPosition then 0 else islands.harbour end,
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
        $resetPosition: resetPosition ? 1 : 0,
      })!;
  })();
}

export function updateIsland(
  db: Database,
  domainId: number,
  slug: string,
  patch: { name?: string; summary?: string; sortOrder?: number; x?: number; y?: number },
): Island {
  const current = requireIsland(db, domainId, slug);
  return db
    .query<Island, Record<string, string | number | null>>(
      `update islands set name = $name, summary = $summary, sort_order = $sortOrder, x = $x, y = $y, updated_at = ${NOW}
       where id = $id returning ${COLS}`,
    )
    .get({
      $id: current.id,
      $name: patch.name ?? current.name,
      $summary: patch.summary ?? current.summary,
      $sortOrder: patch.sortOrder ?? current.sortOrder,
      $x: patch.x ?? current.x,
      $y: patch.y ?? current.y,
    })!;
}

export type IslandPosition = { slug: string; x: number; y: number };

/**
 * Writes every position or none: all slugs are resolved first, so an unknown one fails the batch
 * before any row changes. Each row update fires `islands_au`, bumping the version once per island.
 */
export function setIslandPositions(db: Database, domainId: number, positions: IslandPosition[]): number {
  return db.transaction(() => {
    const rows = positions.map((p) => ({ id: requireIsland(db, domainId, p.slug).id, x: p.x, y: p.y }));
    const update = db.prepare(`update islands set x = ?, y = ?, updated_at = ${NOW} where id = ?`);
    for (const row of rows) update.run(row.x, row.y, row.id);
    return rows.length;
  })();
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

/** Marks `slug` as the harbour among its siblings, clearing whichever sibling had it. Idempotent. */
export function setHarbour(db: Database, domainId: number, slug: string): Island {
  const island = requireIsland(db, domainId, slug);
  return db.transaction(() => {
    clearHarbour(db, domainId, island.parentId);
    return db
      .query<Island, [number]>(`update islands set harbour = 1, updated_at = ${NOW} where id = ? returning ${COLS}`)
      .get(island.id)!;
  })();
}

/** Clears the harbour among one parent's children (null = the top scale). Returns how many rows changed. */
export function clearHarbour(db: Database, domainId: number, parentId: number | null): number {
  const rows =
    parentId === null
      ? db
          .query<{ id: number }, [number]>(
            `update islands set harbour = 0, updated_at = ${NOW} where domain_id = ? and parent_id is null and harbour = 1 returning id`,
          )
          .all(domainId)
      : db
          .query<{ id: number }, [number, number]>(
            `update islands set harbour = 0, updated_at = ${NOW} where domain_id = ? and parent_id = ? and harbour = 1 returning id`,
          )
          .all(domainId, parentId);
  return rows.length;
}

/** The harbour among one parent's children (null = the top scale), or null. */
export function getHarbour(db: Database, domainId: number, parentId: number | null): Island | null {
  if (parentId === null) {
    return db.query<Island, [number]>(`select ${COLS} from islands where domain_id = ? and parent_id is null and harbour = 1`).get(domainId) ?? null;
  }
  return db.query<Island, [number, number]>(`select ${COLS} from islands where domain_id = ? and parent_id = ? and harbour = 1`).get(domainId, parentId) ?? null;
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

/** Every island in the domain with the name of the island it sits in (null at the top), top scale first, in map order. */
export function listDomainIslands(db: Database, domainId: number): { slug: string; name: string; parent: string | null }[] {
  return db
    .query<{ slug: string; name: string; parent: string | null }, [number]>(
      `select i.slug, i.name, p.name as parent from islands i left join islands p on p.id = i.parent_id
       where i.domain_id = ? order by i.parent_id is not null, p.sort_order, p.id, i.sort_order, i.id`,
    )
    .all(domainId);
}
