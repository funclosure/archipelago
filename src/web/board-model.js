// Pure, DOM-free: the board's editor state, the POST body it becomes, and the keyboard cursor over cards.
import { t } from "./i18n.js";

export const CARD_KINDS = ["diagram", "note", "code", "demo"];
/** The key that adds each kind while the board is open. */
export const KIND_KEYS = { d: "diagram", n: "note", c: "code", p: "demo" };
const DEFAULT_LANG = "swift";
/** The language select's value for a code card with no language. */
export const PLAIN = "plain";

/** What a new demo starts as: something that already runs, in the page's colours, to change rather than face a blank box. */
export const DEMO_STARTER = `<button id="go">Count</button>
<span id="n" style="margin-left: 8px; color: var(--lamp)">0</span>
<script>
  let n = 0;
  document.getElementById("go").onclick = () => {
    n += 1;
    document.getElementById("n").textContent = n;
    console.log("count is " + n);
  };
</script>`;

/** A fresh editor for a new card of `kind`. Code cards start in Swift; other kinds carry no lang; a demo starts from `DEMO_STARTER`. */
export function startAdd(kind) {
  return { id: null, kind, body: kind === "demo" ? DEMO_STARTER : "", lang: kind === "code" ? DEFAULT_LANG : null };
}

/**
 * The cards after one moves a step up (`dir` -1) or down (+1), and the write that says so: `before` is the id of
 * the card it now sits before, or null at the end. Null when it is already at that end.
 */
export function stepCard(cards, id, dir) {
  const from = cards.findIndex((c) => c.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= cards.length) return null;
  const next = [...cards];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return { cards: next, write: { op: "move", id, before: next[to + 1]?.id ?? null } };
}

/** A card waiting out its undo: the cards as the board shows them meanwhile. */
export function withoutRemoving(cards, removingId) {
  return removingId === null ? cards : cards.filter((c) => c.id !== removingId);
}

/** An editor over an existing card. */
export function startEdit(card) {
  return { id: card.id, kind: card.kind, body: card.body, lang: card.kind === "code" ? card.lang ?? PLAIN : null };
}

/** What an editor started from, to tell later whether anything changed. */
export function originOf(editor) {
  return { body: editor.body, lang: editor.lang };
}

/** Whether the editor holds changes its card does not. */
export function isDirty(editor, origin) {
  return editor.body !== origin.body || editor.lang !== origin.lang;
}

/** Where an editor's unsaved words are kept when it closes without a decision: one per card, one per new kind, per island. */
export function draftKey(slug, editor) {
  return `${slug}:${editor.id === null ? `new-${editor.kind}` : editor.id}`;
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
export const AUTHOR_LABELS = { judge: t("boardModel.authorJudge"), mentor: t("boardModel.authorMentor"), you: t("boardModel.authorYou") };

/** Each card kind as the page names it. */
export const KIND_LABELS = { diagram: t("boardModel.kindDiagram"), note: t("boardModel.kindNote"), code: t("boardModel.kindCode"), demo: t("boardModel.kindDemo") };

export function kindLabel(kind) {
  return KIND_LABELS[kind] ?? kind;
}

export function authorLabel(author) {
  return AUTHOR_LABELS[author] ?? author;
}

/** The caption's who: the author, or for a card pinned from a reply, you and whose reply it came from. */
export function bylineOf(card) {
  return card.forkedFrom ? t("boardModel.pinnedFrom", { author: authorLabel(card.forkedFrom) }) : authorLabel(card.author);
}

/**
 * The card the first-board hint points at: the newest one a persona pinned, until the reader has opened a board
 * (or waved the hint away) once in this browser. Null when there is nothing to say.
 */
export function hintCard(cards, seen) {
  if (seen) return null;
  for (let i = cards.length - 1; i >= 0; i--) if (cards[i].author !== "you") return cards[i];
  return null;
}
