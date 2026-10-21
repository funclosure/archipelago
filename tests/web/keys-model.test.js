import { test, expect } from "bun:test";
import { REGIONS, nextRegion, isTyping, escapeRung, aboutKey, moveCursor, cheatSheet, isImeKey } from "../../src/web/keys-model.js";
import { visibleRows } from "../../src/web/outline-model.js";

const lm = { total: 0, unlocked: 0 };
const node = (slug, children = []) => ({ slug, name: slug, state: "open", landmarks: lm, harbour: false, scale: null, children });
const tree = [node("a", [node("a1"), node("a2", [node("a2x")])]), node("b"), node("c", [node("c1")])];

test("nextRegion cycles both ways", () => {
  expect(REGIONS).toEqual(["outline", "map", "pane"]);
  expect(nextRegion("outline")).toBe("map");
  expect(nextRegion("pane")).toBe("outline");
  expect(nextRegion("outline", true)).toBe("pane");
  expect(nextRegion("map", true)).toBe("outline");
});

test("isTyping is true for inputs, textareas, selects, and contentEditable", () => {
  expect(isTyping({ tagName: "TEXTAREA" })).toBe(true);
  expect(isTyping({ tagName: "INPUT" })).toBe(true);
  expect(isTyping({ tagName: "SELECT" })).toBe(true);
  expect(isTyping({ tagName: "DIV", isContentEditable: true })).toBe(true);
  expect(isTyping({ tagName: "DIV" })).toBe(false);
  expect(isTyping(null)).toBe(false);
});

test("a selected sea lets go on Escape before the island is deselected", () => {
  expect(escapeRung({ sea: true, selected: true })).toBe("sea");
  expect(escapeRung({ chart: true, sea: true, selected: true })).toBe("chart");
  expect(escapeRung({ sea: false, selected: true })).toBe("deselect");
});

test("escapeRung returns the top rung only, in order", () => {
  const all = { sheetOpen: true, menuOpen: true, typing: true, cursor: true, selected: true };
  expect(escapeRung(all)).toBe("sheet");
  expect(escapeRung({ ...all, sheetOpen: false })).toBe("menu");
  expect(escapeRung({ ...all, sheetOpen: false, menuOpen: false })).toBe("blur");
  expect(escapeRung({ ...all, sheetOpen: false, menuOpen: false, typing: false })).toBe("cursor");
  expect(escapeRung({ sheetOpen: false, menuOpen: false, typing: false, cursor: false, selected: true })).toBe("deselect");
  expect(escapeRung({ sheetOpen: false, menuOpen: false, typing: false, cursor: false, selected: false })).toBeNull();
});

test("moveCursor: down and up stop at the ends; Home and End jump", () => {
  const rows = visibleRows(tree, new Set(), null); // a, b, c
  expect(moveCursor(rows, "a", "ArrowDown")).toEqual({ cursor: "b" });
  expect(moveCursor(rows, "a", "j")).toEqual({ cursor: "b" });
  expect(moveCursor(rows, "c", "ArrowDown")).toBeNull();
  expect(moveCursor(rows, "b", "k")).toEqual({ cursor: "a" });
  expect(moveCursor(rows, "a", "ArrowUp")).toBeNull();
  expect(moveCursor(rows, "b", "Home")).toEqual({ cursor: "a" });
  expect(moveCursor(rows, "a", "End")).toEqual({ cursor: "c" });
  expect(moveCursor(rows, null, "ArrowDown")).toEqual({ cursor: "a" });
  expect(moveCursor(rows, "zzz", "ArrowDown")).toEqual({ cursor: "a" });
});

test("moveCursor: Right expands a collapsed parent, then descends; Left ascends, then collapses", () => {
  const closed = visibleRows(tree, new Set(), null);
  expect(moveCursor(closed, "a", "ArrowRight")).toEqual({ toggle: "a" });
  expect(moveCursor(closed, "b", "ArrowRight")).toBeNull(); // no islets
  const open = visibleRows(tree, new Set(["a", "a2"]), null); // a, a1, a2, a2x, b, c
  expect(moveCursor(open, "a", "ArrowRight")).toEqual({ cursor: "a1" });
  expect(moveCursor(open, "a1", "ArrowLeft")).toEqual({ cursor: "a" });
  expect(moveCursor(open, "a2x", "ArrowLeft")).toEqual({ cursor: "a2" });
  expect(moveCursor(open, "a", "ArrowLeft")).toEqual({ toggle: "a" });
  expect(moveCursor(open, "b", "ArrowLeft")).toBeNull(); // top level, collapsed, no parent
  expect(moveCursor(open, "b", "x")).toBeNull();
});

test("cheatSheet lists Everywhere and the region's keys", () => {
  const sheet = cheatSheet("outline");
  expect(sheet[0].keys.some(([k, what]) => k === "t" && what === "theme")).toBe(true);
  expect(sheet.map((s) => s.title)).toEqual(["Everywhere", "Outline"]);
  expect(sheet[0].keys.some(([k]) => k === "Tab")).toBe(true);
  expect(sheet[1].keys.some(([k, label]) => k === "↓ j" && label === "move")).toBe(true);
  expect(cheatSheet("map")[1].title).toBe("Map");
  expect(cheatSheet("pane")[1].keys.some(([k]) => k === "1–4")).toBe(true);
});

test("escapeRung has editor and board rungs between blur and cursor", () => {
  const all = { sheetOpen: false, menuOpen: false, typing: false, editor: true, board: true, cursor: true, selected: true };
  expect(escapeRung({ ...all, typing: true })).toBe("blur");
  expect(escapeRung(all)).toBe("editor");
  expect(escapeRung({ ...all, editor: false })).toBe("board");
  expect(escapeRung({ ...all, editor: false, board: false })).toBe("cursor");
  expect(escapeRung({ sheetOpen: false, menuOpen: false, typing: false, cursor: false, selected: true })).toBe("deselect");
});

test("cheatSheet shows the board keys in the map's slot while the board is open", () => {
  expect(cheatSheet("map")[1].title).toBe("Map");
  const board = cheatSheet("map", { board: true })[1];
  expect(board.title).toBe("Board");
  expect(board.keys.map(([k]) => k)).toEqual(["↓ j", "↑ k", "↵", "d n c", "x", "⌘↵", "b"]);
  expect(cheatSheet("pane", { board: true })[1].title).toBe("Pane");
  expect(cheatSheet("map")[0].keys).toContainEqual(["b", "board"]);
});

test("the cheat sheet lists m, the switch between the Keeper and the mentor", () => {
  expect(cheatSheet("outline")[0].keys).toContainEqual(["m", "keeper / mentor"]);
});

test("escapeRung closes the About you editor right after the sheet, even while typing in it", () => {
  const all = { sheetOpen: false, about: true, menuOpen: true, typing: true, editor: true, board: true, cursor: true, selected: true };
  expect(escapeRung({ ...all, sheetOpen: true })).toBe("sheet");
  expect(escapeRung(all)).toBe("about");
  expect(escapeRung({ ...all, about: false })).toBe("menu");
  expect(escapeRung({ sheetOpen: false, menuOpen: false, typing: false, cursor: false, selected: false })).toBeNull(); // about defaults to closed
});

test("aboutKey: the open About editor is modal; only Escape, Cmd-Enter and Tab act", () => {
  const k = (key, o = {}) => aboutKey({ key, ...o });
  expect(k("Escape")).toBe("escape");
  expect(k("Enter", { meta: true })).toBe("save");
  expect(k("Tab", { inAbout: true })).toBe("native"); // the browser's Tab order inside the editor
  expect(k("Tab", { inAbout: false })).toBe("enter"); // Tab from outside pulls focus into it, never to another region
  expect(k("Tab", { meta: true })).toBe("ignore");
  for (const key of ["t", "m", "b", "j", "k", "Enter", "?", "[", "/", "ArrowDown"]) expect(k(key)).toBe("block");
  expect(k("Enter", { ctrl: true })).toBe("block");
});

test("a key the input method owns is never the page's: mid-composition, or Safari's confirming Enter (keyCode 229)", () => {
  expect(isImeKey({ key: "Enter", isComposing: true, keyCode: 13 })).toBe(true);
  expect(isImeKey({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(true);
  expect(isImeKey({ key: "Escape", isComposing: true, keyCode: 27 })).toBe(true); // Escape cancels the candidate, not the page
  expect(isImeKey({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(false);
  expect(isImeKey({ key: "a" })).toBe(false);
});

test("Escape stops a running turn before it blurs or closes anything below the overlays", () => {
  const base = { sheetOpen: false, about: false, menuOpen: false, typing: true, editor: false, board: false, cursor: false, selected: true };
  expect(escapeRung({ ...base, turn: true })).toBe("stop");
  expect(escapeRung({ ...base, turn: true, sheetOpen: true })).toBe("sheet"); // an overlay closes first
  expect(escapeRung({ ...base, turn: true, menuOpen: true })).toBe("menu");
  expect(escapeRung({ ...base, turn: false })).toBe("blur");
  expect(escapeRung(base)).toBe("blur"); // turn defaults to false
});

test("Escape closes the cartographer's pane after the cursor and before a selection; the sheet shows its keys", () => {
  expect(escapeRung({ chart: true, cursor: true })).toBe("cursor");
  expect(escapeRung({ chart: true, selected: true })).toBe("chart");
  expect(escapeRung({ chart: true, turn: true })).toBe("stop");
  expect(cheatSheet("pane", { chart: true })[1].title).toBe("Cartographer");
  expect(cheatSheet("pane")[1].title).toBe("Pane");
});
