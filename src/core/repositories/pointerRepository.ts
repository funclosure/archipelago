import type { Database } from "../sql.ts";
import type { IslandMode, Pointer } from "../types.ts";

type Row = { id: number; islandId: number | null; messageId: number | null; slug: string; name: string; scale: string | null; why: string; question: string | null; lens: IslandMode | null; createdAt: string };
const SELECT = `select p.id, p.island_id as islandId, p.message_id as messageId, t.slug, t.name, parent.slug as scale, p.why, p.question, p.lens, p.created_at as createdAt
  from pointers p join islands t on t.id = p.target_island_id left join islands parent on parent.id = t.parent_id`;
const fromRow = (r: Row): Pointer => ({
  id: r.id, islandId: r.islandId, messageId: r.messageId, island: { slug: r.slug, name: r.name, scale: r.scale }, why: r.why, question: r.question, lens: r.lens, createdAt: r.createdAt,
});

/** `islandId` null is the guide's pointer, from the whole domain; `lens` is the one it suggests. */
export type PointerInsert = { domainId: number; islandId: number | null; targetIslandId: number; why: string; question: string | null; lens?: IslandMode | null };

/** Records a pointer, unattached: the route attaches it to the reply it stores. */
export function addPointer(db: Database, input: PointerInsert): number {
  return db
    .query<{ id: number }, Record<string, string | number | null>>(
      `insert into pointers (domain_id, island_id, target_island_id, why, question, lens) values ($domainId, $islandId, $target, $why, $question, $lens) returning id`,
    )
    .get({ $domainId: input.domainId, $islandId: input.islandId, $target: input.targetIslandId, $why: input.why, $question: input.question, $lens: input.lens ?? null })!.id;
}

export function listPointers(db: Database, islandId: number): Pointer[] {
  return db.query<Row, [number]>(`${SELECT} where p.island_id = ? order by p.id`).all(islandId).map(fromRow);
}

/** The guide's pointers in a domain: those from no island. */
export function listGuidePointers(db: Database, domainId: number): Pointer[] {
  return db.query<Row, [number]>(`${SELECT} where p.domain_id = ? and p.island_id is null order by p.id`).all(domainId).map(fromRow);
}

/** The id of the island's newest pointer (the guide's, for null), 0 for none: a turn attaches only pointers made after it. */
export function pointerFloor(db: Database, islandId: number | null, domainId?: number): number {
  if (islandId === null) return db.query<{ id: number }, [number]>(`select coalesce(max(id), 0) as id from pointers where domain_id = ? and island_id is null`).get(domainId!)!.id;
  return db.query<{ id: number }, [number]>(`select coalesce(max(id), 0) as id from pointers where island_id = ?`).get(islandId)!.id;
}

/** Attaches every unattached pointer on the island created after `sinceId` to the reply message, as asks are. */
export function attachPointers(db: Database, islandId: number, messageId: number, sinceId: number): number {
  return db
    .query<{ id: number }, [number, number, number]>(`update pointers set message_id = ? where island_id = ? and message_id is null and id > ? returning id`)
    .all(messageId, islandId, sinceId).length;
}

/** The guide's twin of attachPointers: its unattached pointers in the domain, made after `sinceId`. */
export function attachGuidePointers(db: Database, domainId: number, messageId: number, sinceId: number): number {
  return db
    .query<{ id: number }, [number, number, number]>(`update pointers set message_id = ? where domain_id = ? and island_id is null and message_id is null and id > ? returning id`)
    .all(messageId, domainId, sinceId).length;
}
