import { test, expect } from "bun:test";
import { visibleRows, dashClass, summaryLine, countNodes } from "../../src/web/outline-model.js";

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

test("dashClass ranks selected over charted over lit over dark", () => {
  expect(dashClass(node("a"), null)).toBe("dash");
  expect(dashClass(node("a", { landmarks: { total: 4, unlocked: 1 } }), null)).toBe("dash lit");
  expect(dashClass(node("a", { state: "sandbar", landmarks: { total: 4, unlocked: 4 } }), null)).toBe("dash done");
  expect(dashClass(node("a", { state: "settled" }), "a")).toBe("dash on");
});

test("summaryLine and countNodes count the whole tree", () => {
  expect(countNodes(tree)).toBe(4);
  expect(summaryLine({ charted: 1, lit: 3, islands: tree })).toBe("1 of 4 charted · 3 lit");
});
