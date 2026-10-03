import { test, expect } from "bun:test";
import { visibleRows, collapsible, dashClass, summaryLine, countNodes, rowMarks } from "../../src/web/outline-model.js";

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
  expect(summaryLine({ charted: 1, lit: 3, islands: tree })).toBe("1 of 4 charted · 3 lit");
});

test("in the mentor lens a row shows what was explored, never a verdict", () => {
  const settled = node("a", { state: "settled", landmarks: { total: 5, unlocked: 5, explored: 0 } });
  expect(rowMarks(settled, "judge")).toEqual({ dot: "dot settled", open: false, count: "5/5" });
  expect(rowMarks(settled, "mentor")).toEqual({ dot: "dot open", open: true, count: "0/5" }); // nothing explored is open water
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
  expect(summaryLine({ charted: 1, lit: 3, explored: 2, exploredIslands: 1, islands: tree }, "mentor")).toBe("1 of 4 explored · 2 landmarks");
  expect(summaryLine({ charted: 1, lit: 3, explored: 2, exploredIslands: 1, islands: tree }, "judge")).toBe("1 of 4 charted · 3 lit");
});
