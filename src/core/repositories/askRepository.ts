import type { Database } from "bun:sqlite";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { Ask } from "../types.ts";

type Row = Omit<Ask, "options"> & { options: string };
const COLS = "id, domain_id as domainId, island_id as islandId, message_id as messageId, question, options, picked, picked_at as pickedAt, created_at as createdAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const parse = (r: Row): Ask => ({ ...r, options: JSON.parse(r.options) as string[] });

export type AskInsert = { domainId: number; islandId: number; question: string; options: string[] };

/** Records a question with its options, unattached: the route attaches it to the reply it stores. */
export function addAsk(db: Database, input: AskInsert): Ask {
  const row = db
    .query<Row, Record<string, string | number>>(`insert into asks (domain_id, island_id, question, options) values ($domainId, $islandId, $question, $options) returning ${COLS}`)
    .get({ $domainId: input.domainId, $islandId: input.islandId, $question: input.question, $options: JSON.stringify(input.options) })!;
  return parse(row);
}

export function listAsks(db: Database, islandId: number): Ask[] {
  return db.query<Row, [number]>(`select ${COLS} from asks where island_id = ? order by id`).all(islandId).map(parse);
}

export function requireAsk(db: Database, domainId: number, id: number): Ask {
  const row = db.query<Row, [number, number]>(`select ${COLS} from asks where id = ? and domain_id = ?`).get(id, domainId);
  if (!row) throw new NotFoundError(`no ask ${id} in this domain`);
  return parse(row);
}

/** The latest ask on the island that has a message and no pick, or null. */
export function pendingAsk(db: Database, islandId: number): Ask | null {
  const row = db
    .query<Row, [number]>(`select ${COLS} from asks where island_id = ? and message_id is not null and picked is null order by id desc limit 1`)
    .get(islandId);
  return row ? parse(row) : null;
}

/** Attaches every unattached ask on the island to the reply message. Returns how many rows changed. */
export function attachAsks(db: Database, islandId: number, messageId: number): number {
  return db.query<{ id: number }, [number, number]>(`update asks set message_id = ? where island_id = ? and message_id is null returning id`).all(messageId, islandId).length;
}

/** Records the reader's pick (an option or their own words). A second pick is a conflict. */
export function pickAsk(db: Database, domainId: number, id: number, picked: string): Ask {
  const ask = requireAsk(db, domainId, id);
  if (ask.picked !== null) throw new ConflictError(`ask ${id} was already answered`);
  return parse(db.query<Row, [string, number]>(`update asks set picked = ?, picked_at = ${NOW} where id = ? returning ${COLS}`).get(picked, id)!);
}
