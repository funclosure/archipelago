import { test, expect } from "bun:test";
import { chartOpening, draftIslands, draftStraits, sketchRows, sketchSummary } from "../../src/web/chart-model.js";
import { buildLinks, buildNodes, islandRadius } from "../../src/web/view-model.js";

const marks = [{ slug: "a", name: "A" }, { slug: "b", name: "B" }, { slug: "c", name: "C" }, { slug: "d", name: "D" }];
const body = {
  islands: [{ slug: "queues", name: "Queues", summary: "Buffers between producers and consumers.", landmarks: marks }, { slug: "streams", name: "Streams", summary: "Ordered logs.", landmarks: marks }],
  straits: [{ from: "queues", to: "caching" }, { from: "queues", to: "streams", name: "fan-out" }],
  harbour: "queues",
  updates: [{ slug: "caching", summary: "Keeping hot data close." }],
};
const existing = { slug: "caching", name: "Caching", summary: null, hasChildren: false, verdict: null, children: { total: 0, byState: {} }, x: 500, y: 500, harbour: false, messages: 0, landmarks: { total: 0, unlocked: 0, explored: 0, items: [] } };
const snap = (sketch, islands = [existing], path = []) => ({
  version: 1, domain: { slug: "sd", name: "System Design" }, scale: { path }, islands, straits: [], focus: null, harbour: null, nearestOpenWater: [], reefs: [], sketch,
});

test("drafts: the sketch's new islands as island views, unplaced and unlit, with their straits", () => {
  const s = snap({ id: 1, body, messageId: null });
  const drafts = draftIslands(s);
  expect(drafts.map((d) => [d.slug, d.draft, d.x, d.verdict, d.harbour, d.landmarks.total])).toEqual([["queues", true, null, null, true, 4], ["streams", true, null, null, false, 4]]);
  expect(draftStraits(s).map((l) => [l.from, l.to, l.draft])).toEqual([["queues", "caching", true], ["queues", "streams", true]]);
  expect(draftIslands(snap(null))).toEqual([]);
});

test("buildNodes adds drafts after the islands, at the scale's shared radius; their straits pull but never draw", () => {
  const s = snap({ id: 1, body, messageId: null });
  const nodes = buildNodes(s);
  expect(nodes.map((n) => [n.slug, n.draft, n.placed])).toEqual([["caching", false, true], ["queues", true, false], ["streams", true, false]]);
  expect(nodes.every((n) => n.radius === islandRadius(3))).toBe(true);
  const links = buildLinks(s, nodes);
  expect(links.map((l) => [l.source.slug, l.target.slug, l.hidden])).toEqual([["queues", "caching", true], ["queues", "streams", true]]);
  // a draft keeps where the layout put it across refreshes, and an approved island starts there
  const moved = nodes.map((n) => (n.draft ? { ...n, x: 123, y: 456 } : n));
  const approved = snap(null, [existing, { ...existing, slug: "queues", name: "Queues", x: null, y: null }]);
  const next = buildNodes(approved, new Map(moved.map((n) => [n.slug, n])));
  expect(next.find((n) => n.slug === "queues")).toMatchObject({ draft: false, x: 123, y: 456, placed: false });
});

test("the sketch card's summary and rows name islands by name, old and new", () => {
  expect(sketchSummary(body, [existing])).toBe("2 islands · 2 straits · 1 update · harbour Queues");
  const rows = sketchRows(body, [existing]);
  expect(rows.islands[0]).toEqual({ name: "Queues", summary: "Buffers between producers and consumers.", landmarks: "A · B · C · D", harbour: true });
  expect(rows.straits).toEqual(["Queues ~ Caching", "Queues ~ Streams (fan-out)"]);
  expect(rows.updates).toEqual(["Caching: summary → Keeping hot data close."]);
  expect(rows.harbour).toBeNull(); // the harbour is one of the new islands, marked on its row
  expect(sketchRows({ islands: [], straits: [], updates: [], harbour: "caching" }, [existing]).harbour).toBe("Caching");
});

test("the empty pane: sketch a domain, sketch an island's islets, or ask for a change", () => {
  expect(chartOpening(snap(null, []))).toMatchObject({ action: "Sketch System Design" });
  expect(chartOpening(snap(null, [], [{ slug: "caching", name: "Caching" }]))).toMatchObject({ action: "Sketch the islets of Caching" });
  expect(chartOpening(snap(null)).action).toBeNull();
});
