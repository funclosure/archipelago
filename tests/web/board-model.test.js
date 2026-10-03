import { test, expect } from "bun:test";
import { startAdd, startEdit, canSave, writeOf, moveCard, keepCursor, authorLabel } from "../../src/web/board-model.js";

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
