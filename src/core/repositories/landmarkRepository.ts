import type { Database } from "../sql.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { Landmark } from "../types.ts";

const COLS =
  "id, domain_id as domainId, island_id as islandId, slug, name, sort_order as sortOrder, unlocked_at as unlockedAt, evidence, message_id as messageId, explored_at as exploredAt, explored_evidence as exploredEvidence, explored_message_id as exploredMessageId, terms, created_at as createdAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

type Row = Omit<Landmark, "terms"> & { terms: string | null };
const fromRow = (row: Row): Landmark => ({ ...row, terms: row.terms === null ? null : (JSON.parse(row.terms) as string[]) });

export type LandmarkUpsert = { domainId: number; islandId: number; slug: string; name: string; sortOrder?: number | null; terms?: string[] };
export type LandmarkItem = { slug: string; name: string; terms?: string[] };

/** Insert or rename. Never touches the unlock: a renamed landmark stays lit. Terms left out keep the ones it has. */
export function upsertLandmark(db: Database, input: LandmarkUpsert): Landmark {
  return fromRow(
    db
      .query<Row, Record<string, string | number | null>>(
        `insert into landmarks (domain_id, island_id, slug, name, sort_order, terms)
         values ($domainId, $islandId, $slug, $name, coalesce($sortOrder, 0), $terms)
         on conflict(island_id, slug) do update set
           name = excluded.name,
           sort_order = coalesce($sortOrder, landmarks.sort_order),
           terms = coalesce(excluded.terms, landmarks.terms)
         returning ${COLS}`,
      )
      .get({
        $domainId: input.domainId, $islandId: input.islandId, $slug: input.slug, $name: input.name, $sortOrder: input.sortOrder ?? null,
        $terms: input.terms?.length ? JSON.stringify(input.terms) : null,
      })!,
  );
}

/**
 * Makes the island's landmarks match `items` in order, in one transaction: upserts each, then deletes
 * dark landmarks not in the list. Lit landmarks are always kept, after the listed ones.
 */
export function setLandmarks(db: Database, domainId: number, islandId: number, items: LandmarkItem[]): Landmark[] {
  return db.transaction(() => {
    items.forEach((item, i) => upsertLandmark(db, { domainId, islandId, slug: item.slug, name: item.name, sortOrder: i + 1, terms: item.terms }));
    const keep = items.map((i) => i.slug);
    const placeholders = keep.map(() => "?").join(", ");
    db.run(
      `delete from landmarks where island_id = ? and unlocked_at is null${keep.length ? ` and slug not in (${placeholders})` : ""}`,
      [islandId, ...keep],
    );
    // Lit landmarks that fell out of the list sort after the listed ones.
    db.run(`update landmarks set sort_order = ${items.length} + sort_order where island_id = ? and unlocked_at is not null and slug not in (${placeholders || "''"})`, [islandId, ...keep]);
    return listLandmarks(db, islandId);
  })();
}

/** Lights a dark landmark. Unknown slug → NotFoundError listing the island's slugs; already lit → ConflictError. */
export function unlockLandmark(db: Database, islandId: number, slug: string, evidence: string, messageId: number | null): Landmark {
  const current = listLandmarks(db, islandId);
  const landmark = current.find((l) => l.slug === slug);
  if (!landmark) throw new NotFoundError(`no landmark "${slug}" on this island`, current.map((l) => l.slug));
  if (landmark.unlockedAt !== null) throw new ConflictError(`landmark "${slug}" is already lit`);
  return fromRow(
    db
      .query<Row, [string, number | null, number]>(
        `update landmarks set unlocked_at = ${NOW}, evidence = ?, message_id = ? where id = ? returning ${COLS}`,
      )
      .get(evidence, messageId, landmark.id)!,
  );
}

export function listLandmarks(db: Database, islandId: number): Landmark[] {
  return db.query<Row, [number]>(`select ${COLS} from landmarks where island_id = ? order by sort_order, id`).all(islandId).map(fromRow);
}

/** Landmarks per island id, in sort order, for the given ids only. Islands with none are absent. */
export function listLandmarksByIsland(db: Database, islandIds: number[]): Map<number, Landmark[]> {
  const map = new Map<number, Landmark[]>();
  if (islandIds.length === 0) return map;
  const placeholders = islandIds.map(() => "?").join(", ");
  const rows = db
    .query<Row, number[]>(`select ${COLS} from landmarks where island_id in (${placeholders}) order by island_id, sort_order, id`)
    .all(...islandIds)
    .map(fromRow);
  for (const row of rows) {
    const list = map.get(row.islandId) ?? [];
    list.push(row);
    map.set(row.islandId, list);
  }
  return map;
}

/**
 * Marks a landmark explored with the mentor. Unknown slug → NotFoundError listing the island's slugs.
 * Already explored → the row as it is, `changed: false`: a repeat is a no-op, not an error.
 */
export function exploreLandmark(
  db: Database, islandId: number, slug: string, evidence: string, messageId: number | null,
): { landmark: Landmark; changed: boolean } {
  const current = listLandmarks(db, islandId);
  const landmark = current.find((l) => l.slug === slug);
  if (!landmark) throw new NotFoundError(`no landmark "${slug}" on this island`, current.map((l) => l.slug));
  if (landmark.exploredAt !== null) return { landmark, changed: false };
  const row = fromRow(
    db
      .query<Row, [string, number | null, number]>(
        `update landmarks set explored_at = ${NOW}, explored_evidence = ?, explored_message_id = ? where id = ? returning ${COLS}`,
      )
      .get(evidence, messageId, landmark.id)!,
  );
  return { landmark: row, changed: true };
}
