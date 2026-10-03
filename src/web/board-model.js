// Pure, DOM-free: the board's editor state, the POST body it becomes, and the keyboard cursor over cards.

export const CARD_KINDS = ["diagram", "note", "code"];
/** The key that adds each kind while the board is open. */
export const KIND_KEYS = { d: "diagram", n: "note", c: "code" };
const DEFAULT_LANG = "swift";
/** The language select's value for a code card with no language. */
export const PLAIN = "plain";

/** A fresh editor for a new card of `kind`. Code cards start in Swift; other kinds carry no lang. */
export function startAdd(kind) {
  return { id: null, kind, body: "", lang: kind === "code" ? DEFAULT_LANG : null };
}

/** An editor over an existing card. */
export function startEdit(card) {
  return { id: card.id, kind: card.kind, body: card.body, lang: card.kind === "code" ? card.lang ?? PLAIN : null };
}

/** A card needs a body; titles are the Keeper's to give, never the reader's. */
export function canSave(editor) {
  return editor.body.trim().length > 0;
}

/** The write for POST /api/board (without domain and island). No title; lang travels only for code; plain becomes null. */
export function writeOf(editor) {
  const base = { body: editor.body };
  if (editor.kind === "code") base.lang = editor.lang === PLAIN ? null : editor.lang;
  return editor.id === null ? { op: "add", kind: editor.kind, ...base } : { op: "update", id: editor.id, ...base };
}

/** The card id the cursor moves to on `key`, or null when it stays. */
export function moveCard(ids, cursor, key) {
  if (ids.length === 0) return null;
  const down = key === "ArrowDown" || key === "j";
  const up = key === "ArrowUp" || key === "k";
  const i = ids.indexOf(cursor);
  if (i < 0) {
    if (down || up || key === "Home") return ids[0];
    return key === "End" ? ids[ids.length - 1] : null;
  }
  if (down) return i + 1 < ids.length ? ids[i + 1] : null;
  if (up) return i > 0 ? ids[i - 1] : null;
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  return null;
}

/** The cursor after the list changed: the same id if its card is still there, else null. */
export function keepCursor(ids, cursor) {
  return cursor !== null && ids.includes(cursor) ? cursor : null;
}

/** Who wrote a card, as the board's caption says it. The page says the Keeper for the judge. */
export const AUTHOR_LABELS = { judge: "the Keeper", mentor: "the mentor", you: "you" };

export function authorLabel(author) {
  return AUTHOR_LABELS[author] ?? author;
}
