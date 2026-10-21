import type { Database } from "../sql.ts";
import { NotFoundError } from "../errors.ts";
import type { Sea } from "../types.ts";

const COLS = "id, domain_id as domainId, parent_island_id as parentIslandId, name, x, y, created_at as createdAt, updated_at as updatedAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** The seas at one scale (null = the top), in the order they were named. */
export function listSeas(db: Database, domainId: number, parentIslandId: number | null): Sea[] {
  return db
    .query<Sea, [number, number | null]>(`select ${COLS} from seas where domain_id = ? and parent_island_id is ? order by id`)
    .all(domainId, parentIslandId);
}

export function addSea(db: Database, input: { domainId: number; parentIslandId: number | null; name: string; x: number; y: number }): Sea {
  return db
    .query<Sea, [number, number | null, string, number, number]>(`insert into seas (domain_id, parent_island_id, name, x, y) values (?, ?, ?, ?, ?) returning ${COLS}`)
    .get(input.domainId, input.parentIslandId, input.name, input.x, input.y)!;
}

/** The sea, if it is in this domain; a sea elsewhere is not found here. */
export function requireSea(db: Database, domainId: number, id: number): Sea {
  const sea = db.query<Sea, [number, number]>(`select ${COLS} from seas where id = ? and domain_id = ?`).get(id, domainId);
  if (!sea) throw new NotFoundError(`no sea ${id} in this domain`);
  return sea;
}

/** Renames or moves a sea; what is left out stays. */
export function updateSea(db: Database, domainId: number, id: number, patch: { name?: string; x?: number; y?: number }): Sea {
  const sea = requireSea(db, domainId, id);
  return db
    .query<Sea, [string, number, number, number]>(`update seas set name = ?, x = ?, y = ?, updated_at = ${NOW} where id = ? returning ${COLS}`)
    .get(patch.name ?? sea.name, patch.x ?? sea.x, patch.y ?? sea.y, id)!;
}

export function removeSea(db: Database, domainId: number, id: number): void {
  requireSea(db, domainId, id);
  db.run("delete from seas where id = ?", [id]);
}
