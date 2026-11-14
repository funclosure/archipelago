import { expect, test } from "bun:test";
import { nextPlace, settle, tabsEnabled, homeFloor, homeFocus, keyboardUp, keyboardRoom, takesKeyboard, NAME_BOX, NAME_MIN_PX, KEYBOARD_MIN } from "../../src/web/places-model.js";
import { boxScale } from "../../src/web/contour.js";
import { islandRadius } from "../../src/web/view-model.js";
import { NAME_FONT } from "../../src/web/draw.js";

const open = { pane: true, island: true }; // an island is selected and its pane is drawn
const none = { pane: false, island: false };
const chart = { pane: true, island: false }; // the cartographer's pane, no island

test("a tab goes where it says, or to the map when there is nothing to show there", () => {
  expect(nextPlace("map", { type: "tab", place: "islands" }, none)).toBe("islands");
  expect(nextPlace("islands", { type: "tab", place: "island" }, open)).toBe("island");
  expect(nextPlace("map", { type: "tab", place: "island" }, none)).toBe("map");
  expect(nextPlace("map", { type: "tab", place: "board" }, chart)).toBe("island"); // no island, so no board
});

test("picking an island opens its pane from anywhere, also the island already open", () => {
  expect(nextPlace("islands", { type: "select", slug: "queues" }, open)).toBe("island");
  expect(nextPlace("map", { type: "select", slug: "queues" }, open)).toBe("island");
  expect(nextPlace("island", { type: "select", slug: "queues" }, open)).toBe("island");
});

test("letting go of the island leaves the map as it was, and takes the pane and the board back to it", () => {
  expect(nextPlace("map", { type: "select", slug: null }, none)).toBe("map");
  expect(nextPlace("islands", { type: "select", slug: null }, none)).toBe("islands");
  expect(nextPlace("island", { type: "select", slug: null }, none)).toBe("map");
  expect(nextPlace("board", { type: "select", slug: null }, none)).toBe("map");
});

test("the map tab keeps the selection: only the place changes", () => {
  expect(nextPlace("island", { type: "tab", place: "map" }, open)).toBe("map");
  expect(nextPlace("map", { type: "tab", place: "island" }, open)).toBe("island");
});

test("the cartographer's pane opening takes the reader to it, and closing brings the map back", () => {
  expect(nextPlace("map", { type: "pane", open: true }, chart)).toBe("island");
  expect(nextPlace("island", { type: "pane", open: false }, none)).toBe("map");
  expect(nextPlace("islands", { type: "pane", open: false }, none)).toBe("islands");
});

test("the board closing by itself returns to the island; opening by itself shows it", () => {
  expect(nextPlace("island", { type: "board", open: true }, open)).toBe("board");
  expect(nextPlace("board", { type: "board", open: false }, open)).toBe("island");
  expect(nextPlace("map", { type: "board", open: false }, open)).toBe("map");
});

test("settle and the tabs agree on what can be shown", () => {
  expect(settle("board", none)).toBe("map");
  expect(settle("nowhere", open)).toBe("map");
  expect(tabsEnabled(none)).toEqual({ islands: true, map: true, island: false, board: false });
  expect(tabsEnabled(chart)).toEqual({ islands: true, map: true, island: true, board: false });
  expect(tabsEnabled(open)).toEqual({ islands: true, map: true, island: true, board: true });
});

// ---- the map at home ----

test("a phone's home is no further out than the scale at which an island's name can be read", () => {
  const radius = islandRadius(7);
  const floor = homeFloor(radius);
  expect(NAME_BOX * boxScale(radius) * floor).toBeCloseTo(NAME_MIN_PX); // the name's height on screen
  expect(2 * radius * floor).toBeGreaterThan(44); // and the island is a thumb's size across
  expect(2 * islandRadius(40) * homeFloor(islandRadius(40))).toBeGreaterThan(44); // however many share the scale
  expect(NAME_MIN_PX).toBeGreaterThanOrEqual(10);
  expect(NAME_FONT.startsWith(`${NAME_BOX}px `)).toBe(true); // the size the map really draws a name at
});

test("home is framed round where the reader goes next: the start, then the nearest open water, then the harbour", () => {
  const island = (slug, extra = {}) => ({ slug, name: slug, harbour: false, messages: 0, ...extra });
  const fresh = { islands: [island("a"), island("b", { harbour: true }), island("c")], harbour: "b", nearestOpenWater: ["c", "a"], sketch: null };
  expect(homeFocus(fresh)).toBe("b"); // nothing has a thread yet: where the bottom card says to begin
  const under = { ...fresh, islands: [island("a", { messages: 3 }), island("b", { harbour: true }), island("c")] };
  expect(homeFocus(under)).toBe("c");
  expect(homeFocus({ ...under, nearestOpenWater: [] })).toBe("b");
  expect(homeFocus({ ...under, nearestOpenWater: [], harbour: null })).toBe(null);
  expect(homeFocus({ islands: [], harbour: null, nearestOpenWater: [], sketch: { id: 1 } })).toBe(null); // only a sketch's drafts
  expect(homeFocus(null)).toBe(null);
});

// ---- the keyboard ----

test("a keyboard is up only while a field has it and the visible window is well short of its tallest", () => {
  expect(keyboardUp({ typing: true, visual: 508, tallest: 844 })).toBe(true);
  expect(keyboardUp({ typing: false, visual: 508, tallest: 844 })).toBe(false); // the window is short for another reason
  expect(keyboardUp({ typing: true, visual: 844, tallest: 844 })).toBe(false); // a hardware keyboard: nothing covered
  expect(keyboardUp({ typing: true, visual: 844 - KEYBOARD_MIN + 1, tallest: 844 })).toBe(false); // the browser's own bars
  expect(keyboardUp({ typing: true, visual: 300, tallest: 844, zoomed: true })).toBe(false); // pinched larger
});

test("what the keyboard leaves: where the visible part stands, how tall it is, and how much of the layout it covers", () => {
  expect(keyboardRoom({ up: false, layout: 844, visual: 508 })).toBe(null);
  expect(keyboardRoom({ up: true, layout: 844, visualTop: 0, visual: 508 })).toEqual({ top: 0, height: 508, under: 336 }); // laid over the page (iOS)
  expect(keyboardRoom({ up: true, layout: 508, visualTop: 0, visual: 508 })).toEqual({ top: 0, height: 508, under: 0 }); // the layout shrank for it (Android)
  expect(keyboardRoom({ up: true, layout: 844, visualTop: 120.4, visual: 508 })).toEqual({ top: 120, height: 508, under: 216 }); // panned under it
});

test("only a field that takes words raises a keyboard", () => {
  expect(takesKeyboard({ tag: "TEXTAREA" })).toBe(true);
  expect(takesKeyboard({ tag: "INPUT", type: "text" })).toBe(true);
  expect(takesKeyboard({ tag: "INPUT", type: "" })).toBe(true);
  expect(takesKeyboard({ tag: "INPUT", type: "radio" })).toBe(false);
  expect(takesKeyboard({ tag: "INPUT", type: "Checkbox" })).toBe(false);
  expect(takesKeyboard({ tag: "BUTTON" })).toBe(false);
  expect(takesKeyboard({ tag: "DIV", editable: true })).toBe(true);
});
