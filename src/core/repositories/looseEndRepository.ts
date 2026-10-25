import type { Database } from "../sql.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { LooseEnd, LooseEndKind } from "../types.ts";

const COLS =
  "id, domain_id as domainId, island_id as islandId, landmark_id as landmarkId, kind, note, evidence, message_id as messageId, author, closed_at as closedAt, closed_by as closedBy, closed_evidence as closedEvidence, created_at as createdAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export type LooseEndInsert = {
  domainId: number; islandId: number; landmarkId: number | null; kind: LooseEndKind; note: string; evidence: string; messageId: number | null; author: "judge" | "mentor";
};

export function addLooseEnd(db: Database, input: LooseEndInsert): LooseEnd {
  return db
    .query<LooseEnd, Record<string, string | number | null>>(
      `insert into loose_ends (domain_id, island_id, landmark_id, kind, note, evidence, message_id, author)
       values ($domainId, $islandId, $landmarkId, $kind, $note, $evidence, $messageId, $author) returning ${COLS}`,
    )
    .get({
      $domainId: input.domainId, $islandId: input.islandId, $landmarkId: input.landmarkId, $kind: input.kind, $note: input.note,
      $evidence: input.evidence, $messageId: input.messageId, $author: input.author,
    })!;
}

/** The island's loose ends in the order they were noted; open ones only unless `all`. */
export function listLooseEnds(db: Database, islandId: number, all = false): LooseEnd[] {
  return db.query<LooseEnd, [number]>(`select ${COLS} from loose_ends where island_id = ?${all ? "" : " and closed_at is null"} order by id`).all(islandId);
}

/** Open loose ends per island id, for the given ids only. Islands with none are absent. */
export function listOpenLooseEndsByIsland(db: Database, islandIds: number[]): Map<number, LooseEnd[]> {
  const map = new Map<number, LooseEnd[]>();
  if (islandIds.length === 0) return map;
  const rows = db
    .query<LooseEnd, number[]>(`select ${COLS} from loose_ends where closed_at is null and island_id in (${islandIds.map(() => "?").join(", ")}) order by id`)
    .all(...islandIds);
  for (const row of rows) map.set(row.islandId, [...(map.get(row.islandId) ?? []), row]);
  return map;
}

/** Closes an open loose end on this island. Not on this island → NotFoundError; already closed → ConflictError. */
export function closeLooseEnd(db: Database, islandId: number, id: number, by: "judge" | "mentor" | "you", evidence: string | null): LooseEnd {
  const row = db.query<LooseEnd, [number]>(`select ${COLS} from loose_ends where id = ?`).get(id);
  if (!row || row.islandId !== islandId) throw new NotFoundError(`no loose end ${id} on this island`);
  if (row.closedAt !== null) throw new ConflictError(`loose end ${id} is already closed`);
  return db
    .query<LooseEnd, [string, string | null, number]>(`update loose_ends set closed_at = ${NOW}, closed_by = ?, closed_evidence = ? where id = ? returning ${COLS}`)
    .get(by, evidence, id)!;
}
