import { test, expect } from "bun:test";
import { startAdd, startEdit, canSave, writeOf, moveCard, keepCursor } from "../../src/web/board-model.js";

test("startAdd and startEdit build editors; lang lives only on code cards", () => {
  expect(startAdd("note")).toEqual({ id: null, kind: "note", title: "", body: "", lang: null });
  expect(startAdd("code")).toEqual({ id: null, kind: "code", title: "", body: "", lang: "swift" });
  const card = { id: 7, kind: "code", title: "Read", body: "let v = 1", lang: null, author: "you" };
  expect(startEdit(card)).toEqual({ id: 7, kind: "code", title: "Read", body: "let v = 1", lang: "plain" });
  expect(startEdit({ ...card, kind: "diagram", lang: "swift" }).lang).toBeNull();
});

test("canSave needs a title and a body", () => {
  expect(canSave({ ...startAdd("note"), title: "t", body: "b" })).toBe(true);
  expect(canSave({ ...startAdd("note"), title: " ", body: "b" })).toBe(false);
  expect(canSave({ ...startAdd("note"), title: "t", body: "\n" })).toBe(false);
});

test("writeOf is the POST body: add or update, trimmed title, lang only for code and null for plain", () => {
  expect(writeOf({ id: null, kind: "note", title: " Claim ", body: "x", lang: null })).toEqual({ op: "add", kind: "note", title: "Claim", body: "x" });
  expect(writeOf({ id: null, kind: "code", title: "R", body: "let v", lang: "swift" })).toEqual({ op: "add", kind: "code", title: "R", body: "let v", lang: "swift" });
  expect(writeOf({ id: 3, kind: "code", title: "R", body: "let v", lang: "plain" })).toEqual({ op: "update", id: 3, title: "R", body: "let v", lang: null });
  expect(writeOf({ id: 3, kind: "diagram", title: "P", body: "flowchart TB", lang: null })).toEqual({ op: "update", id: 3, title: "P", body: "flowchart TB" });
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
