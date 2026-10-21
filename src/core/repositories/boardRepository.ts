import type { Database } from "../sql.ts";
import { NotFoundError } from "../errors.ts";
import type { BoardCard, BoardKind, MessageRole } from "../types.ts";

const COLS = "id, domain_id as domainId, island_id as islandId, kind, title, body, lang, author, created_at as createdAt, updated_at as updatedAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export type CardInsert = { domainId: number; islandId: number; kind: BoardKind; title: string; body: string; lang?: string | null; author: MessageRole };
export type CardPatch = { title?: string; body?: string; lang?: string | null };

export function addCard(db: Database, input: CardInsert): BoardCard {
  return db
    .query<BoardCard, Record<string, string | number | null>>(
      `insert into board_cards (domain_id, island_id, kind, title, body, lang, author)
       values ($domainId, $islandId, $kind, $title, $body, $lang, $author) returning ${COLS}`,
    )
    .get({ $domainId: input.domainId, $islandId: input.islandId, $kind: input.kind, $title: input.title, $body: input.body, $lang: input.lang ?? null, $author: input.author })!;
}

export function getCard(db: Database, id: number): BoardCard | null {
  return db.query<BoardCard, [number]>(`select ${COLS} from board_cards where id = ?`).get(id) ?? null;
}

/** The card, if it is on this island; a card elsewhere is not found here. */
export function requireCard(db: Database, islandId: number, id: number): BoardCard {
  const card = getCard(db, id);
  if (!card || card.islandId !== islandId) throw new NotFoundError(`no card ${id} on this island`);
  return card;
}

export function listCards(db: Database, islandId: number): BoardCard[] {
  return db.query<BoardCard, [number]>(`select ${COLS} from board_cards where island_id = ? order by id`).all(islandId);
}

/** Applies the given fields and stamps updated_at. Fields left out keep their value; the author never changes. */
export function updateCard(db: Database, id: number, patch: CardPatch): BoardCard {
  const current = getCard(db, id);
  if (!current) throw new NotFoundError(`no card ${id}`);
  return db
    .query<BoardCard, Record<string, string | number | null>>(
      `update board_cards set title = $title, body = $body, lang = $lang, updated_at = ${NOW} where id = $id returning ${COLS}`,
    )
    .get({
      $id: id,
      $title: patch.title ?? current.title,
      $body: patch.body ?? current.body,
      $lang: patch.lang === undefined ? current.lang : patch.lang,
    })!;
}

export function removeCard(db: Database, id: number): BoardCard {
  const row = db.query<BoardCard, [number]>(`delete from board_cards where id = ? returning ${COLS}`).get(id);
  if (!row) throw new NotFoundError(`no card ${id}`);
  return row;
}
