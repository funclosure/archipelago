import { expect, test } from "bun:test";
import { nextPlace, settle, tabsEnabled } from "../../src/web/places-model.js";

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
