import type { Database } from "../sql.ts";
import { NotFoundError } from "../errors.ts";
import type { Sea } from "../types.ts";
import { ArchipelagoError } from "../errors.ts";
import { listIslands } from "./islandRepository.ts";

const COLS = "id, domain_id as domainId, parent_island_id as parentIslandId, name, x, y, anchor, created_at as createdAt, updated_at as updatedAt";

type Row = Omit<Sea, "anchor"> & { anchor: string | null };
const fromRow = (row: Row): Sea => ({ ...row, anchor: row.anchor === null ? null : (JSON.parse(row.anchor) as string[]) });
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** The seas at one scale (null = the top), in the order they were named. */
export function listSeas(db: Database, domainId: number, parentIslandId: number | null): Sea[] {
  return db
    .query<Row, [number, number | null]>(`select ${COLS} from seas where domain_id = ? and parent_island_id is ? order by id`)
    .all(domainId, parentIslandId)
    .map(fromRow);
}

/** A sea placed where the reader named it, or (from an approved sketch) unplaced, with the islands it groups as `anchor`. */
export function addSea(
  db: Database,
  input: { domainId: number; parentIslandId: number | null; name: string } & ({ x: number; y: number } | { anchor: string[] }),
): Sea {
  const at = "anchor" in input ? { x: null, y: null, anchor: JSON.stringify(input.anchor) } : { x: input.x, y: input.y, anchor: null };
  return fromRow(
    db
      .query<Row, [number, number | null, string, number | null, number | null, string | null]>(
        `insert into seas (domain_id, parent_island_id, name, x, y, anchor) values (?, ?, ?, ?, ?, ?) returning ${COLS}`,
      )
      .get(input.domainId, input.parentIslandId, input.name, at.x, at.y, at.anchor)!,
  );
}

/** A new sea from a write: at a point, or over islands, which must be at its scale. */
export function addSeaFrom(
  db: Database,
  input: { domainId: number; parentIslandId: number | null; name: string; x?: number; y?: number; islands?: string[] },
): Sea {
  const { domainId, parentIslandId, name } = input;
  if (!input.islands) return addSea(db, { domainId, parentIslandId, name, x: input.x!, y: input.y! });
  const here = new Set(listIslands(db, domainId, parentIslandId).map((i) => i.slug));
  for (const slug of input.islands) if (!here.has(slug)) throw new ArchipelagoError(`"${slug}" is not an island at this scale`);
  return addSea(db, { domainId, parentIslandId, name, anchor: input.islands });
}

/** The sea, if it is in this domain; a sea elsewhere is not found here. */
export function requireSea(db: Database, domainId: number, id: number): Sea {
  const sea = db.query<Row, [number, number]>(`select ${COLS} from seas where id = ? and domain_id = ?`).get(id, domainId);
  if (!sea) throw new NotFoundError(`no sea ${id} in this domain`);
  return fromRow(sea);
}

/** Renames or moves a sea; what is left out stays. Placing a suggested sea drops its anchor: it is like any other now. */
export function updateSea(db: Database, domainId: number, id: number, patch: { name?: string; x?: number; y?: number }): Sea {
  const sea = requireSea(db, domainId, id);
  const placed = patch.x !== undefined && patch.y !== undefined;
  return fromRow(
    db
      .query<Row, [string, number | null, number | null, string | null, number]>(
        `update seas set name = ?, x = ?, y = ?, anchor = ?, updated_at = ${NOW} where id = ? returning ${COLS}`,
      )
      .get(patch.name ?? sea.name, placed ? patch.x! : sea.x, placed ? patch.y! : sea.y, placed || !sea.anchor ? null : JSON.stringify(sea.anchor), id)!,
  );
}

export function removeSea(db: Database, domainId: number, id: number): void {
  requireSea(db, domainId, id);
  db.run("delete from seas where id = ?", [id]);
}
