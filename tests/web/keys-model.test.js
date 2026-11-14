import { test, expect } from "bun:test";
import { REGIONS, nextRegion, isTyping, escapeRung, moveCursor, cheatSheet, isImeKey, KEY_SECTIONS, PALETTE_KEY } from "../../src/web/keys-model.js";
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

test("a gathered group lets go on Escape before a selected sea or island", () => {
  expect(escapeRung({ group: true, sea: true, selected: true })).toBe("group");
  expect(escapeRung({ chart: true, group: true })).toBe("chart");
  expect(escapeRung({ group: false, sea: true })).toBe("sea");
});

test("escapeRung returns the top rung only, in order", () => {
  const all = { dialog: true, menuOpen: true, typing: true, cursor: true, selected: true };
  expect(escapeRung(all)).toBe("dialog");
  expect(escapeRung({ ...all, dialog: false })).toBe("menu");
  expect(escapeRung({ ...all, dialog: false, menuOpen: false })).toBe("blur");
  expect(escapeRung({ ...all, dialog: false, menuOpen: false, typing: false })).toBe("cursor");
  expect(escapeRung({ dialog: false, menuOpen: false, typing: false, cursor: false, selected: true })).toBe("deselect");
  expect(escapeRung({ dialog: false, menuOpen: false, typing: false, cursor: false, selected: false })).toBeNull();
  expect(escapeRung({})).toBeNull(); // every flag defaults to off
});

test("a pinned hint folds on Escape after a menu and before anything under it changes", () => {
  const all = { menuOpen: true, hint: true, turn: true, typing: true, board: true, selected: true };
  expect(escapeRung(all)).toBe("menu");
  expect(escapeRung({ ...all, menuOpen: false })).toBe("hint");
  expect(escapeRung({ ...all, menuOpen: false, hint: false })).toBe("stop");
  expect(escapeRung({ hint: true, selected: true })).toBe("hint"); // it used to deselect the island and leave the hint up
});

test("unfolded loose ends fold on Escape before the pane closes", () => {
  expect(escapeRung({ loose: true, selected: true })).toBe("loose");
  expect(escapeRung({ loose: true, chart: true, cursor: true })).toBe("loose");
  expect(escapeRung({ loose: true, board: true })).toBe("board"); // the board is over the map; it goes first
  expect(escapeRung({ loose: true, typing: true })).toBe("blur");
  expect(escapeRung({ loose: false, selected: true })).toBe("deselect");
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

/** A section's rows as [caps joined as written, label], for reading in a test. */
const rowsOf = (section) => section.rows.map((r) => [r.gesture ?? r.keys.map((chord) => chord.join("")).join(" "), r.label]);

test("cheatSheet lists every section of where the page is: Everywhere, then the three regions", () => {
  const sheet = cheatSheet("outline");
  expect(sheet.map((s) => s.title)).toEqual(["Everywhere", "Outline", "Map", "Pane"]);
  expect(sheet.map((s) => s.id)).toEqual(["everywhere", "outline", "map", "pane"]);
  expect(rowsOf(sheet[0])).toContainEqual(["t", "Next theme"]);
  expect(rowsOf(sheet[0])).toContainEqual(["Tab ⇧Tab", "Next or previous region"]);
  expect(rowsOf(sheet[1])).toContainEqual(["↑ ↓ j k", "Move the cursor"]);
  expect(rowsOf(sheet[3]).some(([k]) => k === "1–4")).toBe(true);
});

test("cheatSheet marks the section of the region that has the keyboard, and never Everywhere", () => {
  const here = (region, flags) => cheatSheet(region, flags).filter((s) => s.here).map((s) => s.id);
  expect(here("outline")).toEqual(["outline"]);
  expect(here("map")).toEqual(["map"]);
  expect(here("pane")).toEqual(["pane"]);
  expect(here("map", { board: true })).toEqual(["board"]);
  expect(here("pane", { chart: true })).toEqual(["chart"]);
  expect(here("nowhere")).toEqual(["outline"]);
});

test("a cheat sheet row's keys are caps: alternatives apart, keys pressed together as one chord", () => {
  const board = cheatSheet("map", { board: true })[2];
  const move = board.rows.find((r) => r.label === "Move the card down or up");
  expect(move.keys).toEqual([["⇧", "J"], ["⇧", "K"]]);
  expect(board.rows.find((r) => r.label === "Save the card").keys).toEqual([["⌘", "↵"]]);
  expect(board.rows.find((r) => r.label === "Move the cursor").keys).toEqual([["↑"], ["↓"], ["j"], ["k"]]);
  expect(cheatSheet("outline")[0].rows[0].keys).toEqual([["Tab"], ["⇧", "Tab"]]);
});

test("a gesture is words, not caps", () => {
  const map = cheatSheet("map")[2];
  const name = map.rows.find((r) => r.label === "Name a sea");
  expect(name).toEqual({ keys: [], gesture: "double-click water", label: "Name a sea" });
  expect(map.rows.filter((r) => r.gesture).length).toBe(4);
  expect(map.rows.filter((r) => !r.gesture).every((r) => r.keys.length > 0)).toBe(true);
});

test("every section's rows are [keys, words] with nothing empty, so a new key is one row", () => {
  expect(Object.keys(KEY_SECTIONS)).toEqual(["everywhere", "outline", "map", "board", "pane", "chart"]);
  for (const section of Object.values(KEY_SECTIONS)) {
    expect(section.title.length).toBeGreaterThan(0);
    for (const [keys, label, kind] of section.rows) {
      expect(keys.trim().length).toBeGreaterThan(0);
      expect(label.trim().length).toBeGreaterThan(0);
      expect([undefined, "gesture"]).toContain(kind);
    }
  }
  expect(PALETTE_KEY).toBe("⌘K");
});

test("escapeRung has editor and board rungs between blur and cursor", () => {
  const all = { dialog: false, menuOpen: false, typing: false, editor: true, board: true, cursor: true, selected: true };
  expect(escapeRung({ ...all, typing: true })).toBe("blur");
  expect(escapeRung(all)).toBe("editor");
  expect(escapeRung({ ...all, editor: false })).toBe("board");
  expect(escapeRung({ ...all, editor: false, board: false })).toBe("cursor");
  expect(escapeRung({ dialog: false, menuOpen: false, typing: false, cursor: false, selected: true })).toBe("deselect");
});

test("cheatSheet shows the board keys in the map's slot while the board is open", () => {
  expect(cheatSheet("map")[2].title).toBe("Map");
  const board = cheatSheet("map", { board: true })[2];
  expect(board.title).toBe("Board");
  expect(rowsOf(board).map(([k]) => k)).toEqual(["↑ ↓ j k", "↵", "⇧J ⇧K", "d n c p", "x", "⌘↵", "b"]);
  expect(cheatSheet("pane", { board: true })[3].title).toBe("Pane");
  expect(rowsOf(cheatSheet("map")[0])).toContainEqual(["b", "Open or close the board"]);
});

test("the cheat sheet lists m, the switch between the Keeper and the mentor", () => {
  expect(rowsOf(cheatSheet("outline")[0])).toContainEqual(["m", "Switch Keeper and Mentor"]);
});

test("escapeRung: an open dialog is the top rung, even over a menu, a turn, or typing in it", () => {
  const all = { dialog: true, menuOpen: true, hint: true, turn: true, typing: true, editor: true, board: true, loose: true, cursor: true, selected: true };
  expect(escapeRung(all)).toBe("dialog");
  expect(escapeRung({ ...all, dialog: false })).toBe("menu");
  expect(escapeRung({ menuOpen: false, typing: false, cursor: false, selected: false })).toBeNull(); // dialog defaults to closed
});

test("a key the input method owns is never the page's: mid-composition, or Safari's confirming Enter (keyCode 229)", () => {
  expect(isImeKey({ key: "Enter", isComposing: true, keyCode: 13 })).toBe(true);
  expect(isImeKey({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(true);
  expect(isImeKey({ key: "Escape", isComposing: true, keyCode: 27 })).toBe(true); // Escape cancels the candidate, not the page
  expect(isImeKey({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(false);
  expect(isImeKey({ key: "a" })).toBe(false);
});

test("Escape stops a running turn before it blurs or closes anything below the overlays", () => {
  const base = { dialog: false, menuOpen: false, typing: true, editor: false, board: false, cursor: false, selected: true };
  expect(escapeRung({ ...base, turn: true })).toBe("stop");
  expect(escapeRung({ ...base, turn: true, dialog: true })).toBe("dialog"); // an overlay closes first
  expect(escapeRung({ ...base, turn: true, menuOpen: true })).toBe("menu");
  expect(escapeRung({ ...base, turn: false })).toBe("blur");
  expect(escapeRung(base)).toBe("blur"); // turn defaults to false
});

test("Escape closes the cartographer's pane after the cursor and before a selection; the sheet shows its keys", () => {
  expect(escapeRung({ chart: true, cursor: true })).toBe("cursor");
  expect(escapeRung({ chart: true, selected: true })).toBe("chart");
  expect(escapeRung({ chart: true, turn: true })).toBe("stop");
  expect(cheatSheet("pane", { chart: true })[3].title).toBe("Cartographer");
  expect(cheatSheet("pane")[3].title).toBe("Pane");
});
