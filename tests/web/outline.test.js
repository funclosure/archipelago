import { test, expect } from "bun:test";
import { FULL_W, OUTLINE_MAX, OUTLINE_MIN, outlineWidth, visibleRows, collapsible, dashClass, summaryLine, countNodes, rowMarks, rowTip, cursorStart, menuMove, menuGroups, menuKeys, menuStep } from "../../src/web/outline-model.js";

const node = (slug, extra = {}, children = []) => ({
  slug, name: slug, state: "open", landmarks: { total: 4, unlocked: 0 }, harbour: false, scale: null, children, ...extra,
});
const tree = [
  node("caching", {}, [node("caching-ttl", { scale: "caching" }, [node("caching-ttl-jitter", { scale: "caching-ttl" })])]),
  node("databases", { state: "settled" }),
];

test("visibleRows shows islets only for expanded islands, or those holding the selection", () => {
  const closed = visibleRows(tree, new Set(), null);
  expect(closed.map((r) => [r.node.slug, r.depth, r.hasChildren, r.open])).toEqual([["caching", 0, true, false], ["databases", 0, false, false]]);
  const expanded = visibleRows(tree, new Set(["caching"]), null);
  expect(expanded.map((r) => r.node.slug)).toEqual(["caching", "caching-ttl", "databases"]);
  expect(expanded[1].depth).toBe(1);
  const deep = visibleRows(tree, new Set(), "caching-ttl-jitter");
  expect(deep.map((r) => r.node.slug)).toEqual(["caching", "caching-ttl", "caching-ttl-jitter", "databases"]);
  expect(deep[0].open).toBe(true);
  expect(deep[2].depth).toBe(2);
});

test("collapsible is false for a parent held open by the selection", () => {
  const open = new Set(["caching"]);
  expect(collapsible(tree, open, null, "caching")).toBe(true);
  expect(collapsible(tree, open, "caching-ttl", "caching")).toBe(false); // its own islet is selected
  expect(collapsible(tree, open, "caching-ttl-jitter", "caching")).toBe(false); // a grandchild is selected
  expect(collapsible(tree, new Set(), null, "caching")).toBe(false); // already collapsed
  expect(collapsible(tree, open, null, "databases")).toBe(false); // no islets to hide
});

test("dashClass ranks selected over charted over lit over dark", () => {
  expect(dashClass(node("a"), null)).toBe("dash");
  expect(dashClass(node("a", { landmarks: { total: 4, unlocked: 1 } }), null)).toBe("dash lit");
  expect(dashClass(node("a", { state: "sandbar", landmarks: { total: 4, unlocked: 4 } }), null)).toBe("dash done");
  expect(dashClass(node("a", { state: "settled" }), "a")).toBe("dash on");
  expect(dashClass(node("a", { state: "reef" }), null)).toBe("dash reef");
});

test("summaryLine and countNodes count the whole tree", () => {
  expect(countNodes(tree)).toBe(4);
  expect(summaryLine({ charted: 1, lit: 3, islands: tree })).toBe("1 of 4 islands charted · 3 lit");
  expect(summaryLine({ charted: 0, lit: 0, islands: [node("only")] })).toBe("0 of 1 island charted · 0 lit");
});

test("in the mentor lens a row shows what was explored, never a verdict", () => {
  const settled = node("a", { state: "settled", landmarks: { total: 5, unlocked: 5, explored: 0 } });
  expect(rowMarks(settled, "judge")).toEqual({ dot: "dot settled", open: false, count: "5/5" });
  expect(rowMarks(settled, "mentor")).toEqual({ dot: "dot open", open: true, count: null }); // nothing explored is open water, and open water is no score
  const some = node("b", { state: "reef", landmarks: { total: 4, unlocked: 0, explored: 2 } });
  expect(rowMarks(some, "mentor")).toEqual({ dot: "dot explored", open: false, count: "2/4" });
  const all = node("c", { landmarks: { total: 4, unlocked: 1, explored: 4 } });
  expect(rowMarks(all, "mentor")).toEqual({ dot: "dot explored all", open: false, count: "4/4" });
  expect(rowMarks(node("d", { landmarks: { total: 4, unlocked: 1, explored: 0 } }), "judge")).toEqual({ dot: "dot open lit", open: true, count: "1/4" });
});

test("the rail dash and the summary follow the lens", () => {
  const n = node("a", { state: "settled", landmarks: { total: 4, unlocked: 4, explored: 1 } });
  expect(dashClass(n, null)).toBe("dash done");
  expect(dashClass(n, null, "mentor")).toBe("dash explored");
  expect(dashClass(node("b", { state: "reef" }), null, "mentor")).toBe("dash"); // a reef is the Keeper's
  expect(dashClass(n, "a", "mentor")).toBe("dash on");
  expect(summaryLine({ charted: 1, lit: 3, explored: 2, exploredIslands: 1, islands: tree }, "mentor")).toBe("1 of 4 islands explored · 2 landmarks");
  expect(summaryLine({ charted: 1, lit: 3, explored: 1, exploredIslands: 1, islands: tree }, "mentor")).toBe("1 of 4 islands explored · 1 landmark"); // never "1 landmarks"
  expect(summaryLine({ charted: 1, lit: 3, explored: 2, exploredIslands: 1, islands: tree }, "judge")).toBe("1 of 4 islands charted · 3 lit");
});

test("an island nothing has touched shows no count; one with a verdict keeps its count even at zero", () => {
  expect(rowMarks(node("a"), "judge")).toEqual({ dot: "dot open", open: true, count: null }); // never "0/4" on open water
  expect(rowMarks(node("a", { landmarks: { total: 0, unlocked: 0 } }), "judge").count).toBe(null);
  expect(rowMarks(node("a", { landmarks: { total: 4, unlocked: 0, explored: 0 } }), "mentor").count).toBe(null);
  expect(rowMarks(node("a", { state: "reef", landmarks: { total: 3, unlocked: 0 } }), "judge").count).toBe("0/3"); // judged: the count is a fact
  expect(rowMarks(node("a", { state: "sandbar", landmarks: { total: 3, unlocked: 0 } }), "judge").count).toBe("0/3");
});

test("a row's tip says what the dot and count mean in the lens, after the whole name when the row cuts it", () => {
  const lm = (unlocked, explored = 0, total = 3) => ({ total, unlocked, explored });
  expect(rowTip(node("Vectors"), "judge")).toBe("Open water");
  expect(rowTip(node("Vectors", { landmarks: lm(2) }), "judge")).toBe("Open water · 2 of 3 landmarks lit");
  expect(rowTip(node("Vectors", { state: "sandbar", landmarks: lm(1) }), "judge")).toBe("Sandbar · 1 of 3 landmarks lit");
  expect(rowTip(node("Vectors", { state: "settled", landmarks: lm(3) }), "judge")).toBe("Settled · 3 of 3 landmarks lit");
  expect(rowTip(node("Vectors", { state: "mountainous", landmarks: lm(1, 0, 1) }), "judge")).toBe("Mountainous · 1 of 1 landmark lit");
  expect(rowTip(node("Vectors", { state: "reef", landmarks: lm(0) }), "judge")).toBe("Reef · 0 of 3 landmarks lit");
  expect(rowTip(node("Vectors", { state: "settled", landmarks: lm(3) }), "mentor")).toBe("Not yet explored"); // the verdict is the Keeper's
  expect(rowTip(node("Vectors", { landmarks: lm(0, 2) }), "mentor")).toBe("2 of 3 landmarks explored");
  // a name the row cuts short leads the tip; one that reads in full is not said twice
  const plain = (s) => s.replaceAll("\u2060", "").replaceAll("\u00A0", " ");
  const named = rowTip(node("Vectors: arrows you can add", { state: "settled", landmarks: lm(3) }), "judge", true);
  expect(plain(named)).toBe("Vectors: arrows you can add · Settled · 3 of 3 landmarks lit");
  expect(named.startsWith("Vectors: arrows you can add · ")).toBe(true); // the name may wrap, and the line may break after it
  expect(named.slice("Vectors: arrows you can add · ".length)).not.toMatch(/ /); // what the dot means stays on one line
  expect(plain(rowTip(node("Vectors: arrows you can add"), "mentor", true))).toBe("Vectors: arrows you can add · Not yet explored");
});

test("the cursor starts from the selected row, else appears on the harbour or the first row without moving on", () => {
  const rows = visibleRows([node("a"), node("b", { harbour: true }), node("c")], new Set(), null);
  expect(cursorStart(rows, "c", "ArrowUp")).toEqual({ cursor: "c", apply: true }); // the key moves on from the selection
  expect(cursorStart(rows, null, "j")).toEqual({ cursor: "b", apply: false }); // the harbour: where the map says to begin
  expect(cursorStart(rows, "gone", "j")).toEqual({ cursor: "b", apply: false }); // a selection not among the rows counts for nothing
  expect(cursorStart(rows, null, "End")).toEqual({ cursor: "c", apply: false });
  expect(cursorStart(rows, null, "Home")).toEqual({ cursor: "a", apply: false });
  expect(cursorStart(visibleRows([node("a"), node("c")], new Set(), null), null, "k")).toEqual({ cursor: "a", apply: false });
  expect(cursorStart([], null, "j")).toBe(null);
});

test("menuMove steps and wraps, jumps to either end, and starts from nothing", () => {
  expect(menuMove(4, 0, "ArrowDown")).toBe(1);
  expect(menuMove(4, 3, "ArrowDown")).toBe(0); // wraps
  expect(menuMove(4, 3, "j")).toBe(0);
  expect(menuMove(4, 0, "ArrowUp")).toBe(3);
  expect(menuMove(4, 2, "k")).toBe(1);
  expect(menuMove(4, 2, "Home")).toBe(0);
  expect(menuMove(4, 1, "End")).toBe(3);
  expect(menuMove(4, -1, "ArrowDown")).toBe(0); // focus was nowhere: Down takes the first row, Up the last
  expect(menuMove(4, -1, "ArrowUp")).toBe(3);
  expect(menuMove(4, 1, "x")).toBe(null);
  expect(menuMove(4, 1, "Tab")).toBe(null);
  expect(menuMove(0, -1, "ArrowDown")).toBe(null);
});

const DOMAINS = [
  { slug: "la", name: "Linear algebra", description: "twenty years after school" },
  { slug: "la-2", name: "Linear algebra", description: "as a data analyst" },
  { slug: "sd", name: "System design", description: null },
];
const THEMES = [{ id: "ink", name: "Ink" }, { id: "chart", name: "Paper chart" }];
const LANGS = [{ id: "en", name: "English" }, { id: "zh-TW", name: "繁體中文" }];
const menu = (extra = {}) => menuGroups({ domains: DOMAINS, current: "la", themes: THEMES, theme: "chart", languages: LANGS, language: "en", ...extra });

test("the menu's groups: domains then New, this domain, appearance, you; the hosted build adds its three rows", () => {
  const groups = menu();
  expect(groups.map((g) => g.id)).toEqual(["domains", "domain", "appearance", "you"]);
  expect(menuKeys(groups)).toEqual(["domain:la", "domain:la-2", "domain:sd", "new", "export", "images", "edit", "theme", "language", "about"]);
  expect(menuKeys(menu({ hosted: true })).slice(-4)).toEqual(["about", "key", "backup", "restore"]);
  const [la, la2, sd] = groups[0].rows;
  expect([la.on, la2.on, sd.on]).toEqual([true, false, false]); // the check goes to the open domain
  expect([la.desc, la2.desc, sd.desc]).toEqual(["twenty years after school", "as a data analyst", null]); // namesakes carry their descriptions
  const theme = groups[2].rows.find((r) => r.k === "theme");
  expect(theme).toEqual({ k: "theme", value: "Paper chart", chosen: "chart", open: false });
});

test("a list opens under its row, one at a time, with the chosen one marked", () => {
  const groups = menu({ sub: "theme" });
  expect(menuKeys(groups)).toEqual(["domain:la", "domain:la-2", "domain:sd", "new", "export", "images", "edit", "theme", "theme:ink", "theme:chart", "language", "about"]);
  const rows = groups[2].rows;
  expect(rows.find((r) => r.k === "theme").open).toBe(true);
  expect(rows.find((r) => r.k === "theme:chart")).toEqual({ k: "theme:chart", parent: "theme", id: "chart", name: "Paper chart", on: true });
  expect(rows.find((r) => r.k === "theme:ink").on).toBe(false);
  expect(menuKeys(menu({ sub: "language" }))).toContain("language:zh-TW");
  expect(menuKeys(menu({ sub: "language" }))).not.toContain("theme:ink");
});

test("menuStep: arrows walk every row, Right opens a list onto its chosen row, Left closes it", () => {
  const closed = menu();
  expect(menuStep(closed, "domain:la", "ArrowDown")).toEqual({ focus: "domain:la-2" });
  expect(menuStep(closed, "about", "j")).toEqual({ focus: "domain:la" }); // wraps
  expect(menuStep(closed, "domain:la", "k")).toEqual({ focus: "about" });
  expect(menuStep(closed, "edit", "End")).toEqual({ focus: "about" });
  expect(menuStep(closed, "edit", "Home")).toEqual({ focus: "domain:la" });
  expect(menuStep(closed, null, "ArrowDown")).toEqual({ focus: "domain:la" }); // nothing focused yet
  expect(menuStep(closed, "theme", "ArrowRight")).toEqual({ sub: "theme", focus: "theme:chart" });
  expect(menuStep(closed, "language", "ArrowRight")).toEqual({ sub: "language", focus: "language:en" });
  expect(menuStep(closed, "export", "ArrowRight")).toBe(null); // not a row that opens
  expect(menuStep(closed, "theme", "ArrowLeft")).toBe(null); // nothing open to close
  expect(menuStep(closed, "theme", "Tab")).toBe(null);
  expect(menuStep(closed, "theme", "x")).toBe(null);
  const open = menu({ sub: "theme" });
  expect(menuStep(open, "theme", "ArrowRight")).toEqual({ focus: "theme:chart" }); // already open: step in
  expect(menuStep(open, "theme", "ArrowDown")).toEqual({ focus: "theme:ink" });
  expect(menuStep(open, "theme:chart", "ArrowDown")).toEqual({ focus: "language" });
  expect(menuStep(open, "theme:ink", "ArrowLeft")).toEqual({ sub: null, focus: "theme" });
  expect(menuStep(open, "theme", "ArrowLeft")).toEqual({ sub: null, focus: "theme" });
  expect(menuStep(open, "language", "ArrowRight")).toEqual({ sub: "language", focus: "language:en" }); // the other list takes its place
});

test("outlineWidth clamps a dragged or stored width, and starts at FULL_W", () => {
  expect(outlineWidth(null)).toBe(FULL_W);
  expect(outlineWidth("junk")).toBe(FULL_W);
  expect(outlineWidth("300")).toBe(300);
  expect(outlineWidth(301.6)).toBe(302);
  expect(outlineWidth(10)).toBe(OUTLINE_MIN);
  expect(outlineWidth(5000)).toBe(OUTLINE_MAX);
});
