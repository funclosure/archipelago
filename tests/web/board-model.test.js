import { test, expect } from "bun:test";
import { afterMove, tabWrap, kindName, keyOfKind, CARD_KINDS, stepCard, originOf, isDirty, draftKey, DEMO_STARTER, KIND_KEYS, withoutRemoving, startAdd, startEdit, canSave, writeOf, moveCard, keepCursor, authorLabel, bylineOf, hintCard } from "../../src/web/board-model.js";

test("startAdd and startEdit build editors without a title; lang lives only on code cards", () => {
  expect(startAdd("note")).toEqual({ id: null, kind: "note", body: "", lang: null });
  expect(startAdd("code")).toEqual({ id: null, kind: "code", body: "", lang: "swift" });
  const card = { id: 7, kind: "code", title: "Read", body: "let v = 1", lang: null, author: "you" };
  expect(startEdit(card)).toEqual({ id: 7, kind: "code", body: "let v = 1", lang: "plain" });
  expect(startEdit({ ...card, kind: "diagram", lang: "swift" }).lang).toBeNull();
});

test("canSave needs a body", () => {
  expect(canSave({ ...startAdd("note"), body: "b" })).toBe(true);
  expect(canSave({ ...startAdd("note"), body: "\n" })).toBe(false);
});

test("writeOf is the POST body: add or update, no title, lang only for code and null for plain", () => {
  expect(writeOf({ id: null, kind: "note", body: "x", lang: null })).toEqual({ op: "add", kind: "note", body: "x" });
  expect(writeOf({ id: null, kind: "code", body: "let v", lang: "swift" })).toEqual({ op: "add", kind: "code", body: "let v", lang: "swift" });
  expect(writeOf({ id: 3, kind: "code", body: "let v", lang: "plain" })).toEqual({ op: "update", id: 3, body: "let v", lang: null });
  expect(writeOf({ id: 3, kind: "diagram", body: "flowchart TB", lang: null })).toEqual({ op: "update", id: 3, body: "flowchart TB" });
});

test("moveCard walks the ids with j/k and arrows, clamps at the ends, and starts at the first", () => {
  const ids = [4, 8, 15];
  expect(moveCard(ids, null, "j")).toBe(4);
  expect(moveCard(ids, null, "k")).toBe(4);
  expect(moveCard(ids, null, "End")).toBe(15);
  expect(moveCard(ids, 4, "ArrowDown")).toBe(8);
  expect(moveCard(ids, 8, "ArrowUp")).toBe(4);
  expect(moveCard(ids, 15, "j")).toBeNull();
  expect(moveCard(ids, 4, "k")).toBeNull();
  expect(moveCard(ids, 8, "Home")).toBe(4);
  expect(moveCard(ids, 8, "x")).toBeNull();
  expect(moveCard([], null, "j")).toBeNull();
});

test("keepCursor keeps a cursor whose card is still there", () => {
  expect(keepCursor([1, 2], 2)).toBe(2);
  expect(keepCursor([1, 2], 3)).toBeNull();
  expect(keepCursor([], null)).toBeNull();
});

test("authorLabel names who wrote a card as the board says it", () => {
  expect(authorLabel("judge")).toBe("the Keeper");
  expect(authorLabel("mentor")).toBe("the mentor");
  expect(authorLabel("you")).toBe("you");
});

test("hintCard names the newest card a persona pinned, never the reader's own, and nothing once seen", () => {
  const you = { id: 1, author: "you" };
  const judge = { id: 2, author: "judge" };
  const mentor = { id: 3, author: "mentor" };
  expect(hintCard([], false)).toBeNull();
  expect(hintCard([you], false)).toBeNull();
  expect(hintCard([judge, you], false)).toBe(judge);
  expect(hintCard([judge, mentor, you], false)).toBe(mentor);
  expect(hintCard([judge], true)).toBeNull();
});

test("bylineOf: the author, or you and whose reply a pinned card came from", () => {
  expect(bylineOf({ author: "judge", forkedFrom: null })).toBe("the Keeper");
  expect(bylineOf({ author: "you", forkedFrom: "mentor" })).toBe("you · from the mentor");
  expect(bylineOf({ author: "you" })).toBe("you");
});

test("a new demo starts from a starter that runs; p adds one", () => {
  expect(startAdd("demo")).toEqual({ id: null, kind: "demo", body: DEMO_STARTER, lang: null });
  expect(DEMO_STARTER).toContain("<script>");
  expect(DEMO_STARTER).toContain("var(--lamp)"); // the page's colours, never its own
  expect(KIND_KEYS.p).toBe("demo");
});

test("a card waiting out its undo is off the board until it is deleted or brought back", () => {
  const cards = [{ id: 1 }, { id: 2 }, { id: 3 }];
  expect(withoutRemoving(cards, 2)).toEqual([{ id: 1 }, { id: 3 }]);
  expect(withoutRemoving(cards, null)).toBe(cards);
});

test("an editor is dirty once its body or language differs from what it started as", () => {
  const editor = startEdit({ id: 4, kind: "code", body: "let a = 1", lang: "swift" });
  const origin = originOf(editor);
  expect(isDirty(editor, origin)).toBe(false);
  expect(isDirty({ ...editor, body: "let a = 2" }, origin)).toBe(true);
  expect(isDirty({ ...editor, lang: "kotlin" }, origin)).toBe(true);
  expect(isDirty(startAdd("demo"), originOf(startAdd("demo")))).toBe(false); // the starter alone is nothing to lose
});

test("drafts are kept per island, per card, and per kind of new card", () => {
  expect(draftKey("caching", startEdit({ id: 4, kind: "demo", body: "x" }))).toBe("caching:4");
  expect(draftKey("caching", startAdd("demo"))).toBe("caching:new-demo");
  expect(draftKey("queues", startAdd("note"))).toBe("queues:new-note");
});

test("a card steps up or down one place, and the write names the card it now sits before", () => {
  const cards = [{ id: 1 }, { id: 2 }, { id: 3 }];
  expect(stepCard(cards, 1, 1)).toEqual({ cards: [{ id: 2 }, { id: 1 }, { id: 3 }], write: { op: "move", id: 1, before: 3 } });
  expect(stepCard(cards, 3, -1)).toEqual({ cards: [{ id: 1 }, { id: 3 }, { id: 2 }], write: { op: "move", id: 3, before: 2 } });
  expect(stepCard(cards, 2, 1)).toEqual({ cards: [{ id: 1 }, { id: 3 }, { id: 2 }], write: { op: "move", id: 2, before: null } });
  expect(stepCard(cards, 1, -1)).toBeNull();
  expect(stepCard(cards, 3, 1)).toBeNull();
  expect(stepCard(cards, 9, 1)).toBeNull();
});

test("after a move the cards stand as the server will order them, the card waiting out its undo among them", () => {
  const [a, b, c, d] = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const all = [a, b, c, d]; // b is off the board, waiting out its undo
  const up = stepCard([a, c, d], 3, -1); // c steps over a
  expect(up.write).toEqual({ op: "move", id: 3, before: 1 });
  expect(afterMove(all, 3, up.write.before)).toEqual([c, a, b, d]);
  const down = stepCard([a, c, d], 3, 1); // c steps to the end
  expect(afterMove(all, 3, down.write.before)).toEqual([a, b, d, c]);
  expect(afterMove(all, 9, null)).toBe(all); // no such card
  expect(afterMove(all, 2, 2)).toBe(all); // before itself: nothing moves
  expect(afterMove(all, 1, 99)).toEqual([b, c, d, a]); // a card gone meanwhile: the end, as a null would be
});

test("Tab in the editor comes round at either end and is the browser's in between", () => {
  expect(tabWrap(4, 3, false)).toBe(0); // Tab on the last stop
  expect(tabWrap(4, 0, true)).toBe(3); // Shift-Tab on the first
  expect(tabWrap(4, 1, false)).toBeNull();
  expect(tabWrap(4, 2, true)).toBeNull();
  expect(tabWrap(4, -1, false)).toBeNull(); // focus on the editor's own box: forward is the first stop anyway
  expect(tabWrap(4, -1, true)).toBe(3); // back from the box would leave the editor
  expect(tabWrap(0, -1, false)).toBeNull();
});

test("every kind has a name for its button and the key that adds it", () => {
  expect(CARD_KINDS.map(kindName)).toEqual(["Diagram", "Note", "Code", "Demo"]);
  expect(CARD_KINDS.map(keyOfKind)).toEqual(["d", "n", "c", "p"]);
  for (const kind of CARD_KINDS) expect(KIND_KEYS[keyOfKind(kind)]).toBe(kind);
  expect(keyOfKind("plot")).toBeNull();
});
