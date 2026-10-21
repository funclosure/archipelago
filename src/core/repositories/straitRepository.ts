import type { Database } from "../sql.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { Island, Strait } from "../types.ts";
import { getIslandById } from "./islandRepository.ts";

const COLS =
  "s.id, s.domain_id as domainId, s.from_island_id as fromIslandId, s.to_island_id as toIslandId, s.name, s.summary, s.created_at as createdAt";
/** RETURNING does not see the table alias (verified: "no such column: s.id"); use unprefixed names there. */
const RETURNING_COLS =
  "id, domain_id as domainId, from_island_id as fromIslandId, to_island_id as toIslandId, name, summary, created_at as createdAt";

export type StraitUpsert = {
  domainId: number;
  fromIslandId: number;
  toIslandId: number;
  name?: string | null;
  summary?: string | null;
};

export function upsertStrait(db: Database, input: StraitUpsert): Strait {
  const a = getIslandById(db, input.fromIslandId);
  const b = getIslandById(db, input.toIslandId);
  if (!a || !b || a.domainId !== input.domainId || b.domainId !== input.domainId) {
    throw new NotFoundError("both strait endpoints must be islands in this domain");
  }
  if (a.id === b.id) throw new ConflictError(`a strait needs two different islands, got "${a.slug}" twice`);
  if (a.parentId !== b.parentId) {
    throw new ConflictError(
      `straits join siblings at one scale; "${a.slug}" and "${b.slug}" have different parents`,
    );
  }
  const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  return db
    .query<Strait, Record<string, string | number | null>>(
      `insert into straits as s (domain_id, from_island_id, to_island_id, name, summary)
       values ($domainId, $lo, $hi, $name, $summary)
       on conflict(from_island_id, to_island_id) do update set
         name = coalesce(excluded.name, s.name),
         summary = coalesce(excluded.summary, s.summary)
       returning ${RETURNING_COLS}`,
    )
    .get({ $domainId: input.domainId, $lo: lo, $hi: hi, $name: input.name ?? null, $summary: input.summary ?? null })!;
}

export function getStrait(db: Database, aIslandId: number, bIslandId: number): Strait | null {
  const [lo, hi] = aIslandId < bIslandId ? [aIslandId, bIslandId] : [bIslandId, aIslandId];
  return (
    db
      .query<Strait, [number, number]>(`select ${COLS} from straits s where from_island_id = ? and to_island_id = ?`)
      .get(lo, hi) ?? null
  );
}

export function getStraitById(db: Database, id: number): Strait | null {
  return db.query<Strait, [number]>(`select ${COLS} from straits s where id = ?`).get(id) ?? null;
}

export function requireStrait(db: Database, a: Island, b: Island): Strait {
  const strait = getStrait(db, a.id, b.id);
  if (!strait) throw new NotFoundError(`no strait between "${a.slug}" and "${b.slug}"`);
  return strait;
}

/** How many straits touch this island, on either end. */
export function countStraitsTouching(db: Database, islandId: number): number {
  return db
    .query<{ n: number }, [number, number]>(
      "select count(*) as n from straits where from_island_id = ? or to_island_id = ?",
    )
    .get(islandId, islandId)!.n;
}

/** Straits between islands that share the given parent (null = top level). */
export function listStraits(db: Database, domainId: number, parentId: number | null): Strait[] {
  if (parentId === null) {
    return db
      .query<Strait, [number]>(
        `select ${COLS} from straits s join islands i on i.id = s.from_island_id
         where s.domain_id = ? and i.parent_id is null order by s.id`,
      )
      .all(domainId);
  }
  return db
    .query<Strait, [number, number]>(
      `select ${COLS} from straits s join islands i on i.id = s.from_island_id
       where s.domain_id = ? and i.parent_id = ? order by s.id`,
    )
    .all(domainId, parentId);
}
