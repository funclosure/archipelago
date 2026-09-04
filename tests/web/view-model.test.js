import { test, expect } from "bun:test";
import { hashSeed, seededRandom, islandRadius, buildNodes, buildLinks, WORLD } from "../../src/web/view-model.js";

const island = (slug, verdict = null, pos = { x: null, y: null }, byState = { sandbar: 0, settled: 0, mountainous: 0, reef: 0, open: 0 }) => ({
  slug, name: slug, summary: null, hasChildren: Object.values(byState).some(Boolean), verdict, x: pos.x, y: pos.y,
  messages: 0,
  landmarks: { total: 0, unlocked: 0, items: [] },
  children: { total: Object.values(byState).reduce((a, b) => a + b, 0), byState },
});
const snapshot = (islands, straits = []) => ({
  version: 1, domain: { slug: "sd", name: "SD" }, scale: { path: [] }, islands, straits, focus: null, unreadComments: 0, nearestOpenWater: [], reefs: [],
});

test("hashSeed and seededRandom are deterministic", () => {
  expect(hashSeed("caching")).toBe(hashSeed("caching"));
  expect(hashSeed("caching")).not.toBe(hashSeed("queues"));
  const a = seededRandom(42), b = seededRandom(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});

test("radius depends on the island count at a scale, never on the verdict", () => {
  expect(islandRadius(1)).toBe(88);
  expect(islandRadius(9)).toBeCloseTo(220 / 3, 5);
  expect(islandRadius(100)).toBe(48);
  const nodes = buildNodes(snapshot([island("a", { state: "mountainous" }), island("b"), island("c", { state: "reef" })]));
  expect(new Set(nodes.map((n) => n.radius)).size).toBe(1);
  expect(nodes[0].radius).toBe(islandRadius(3));
  expect(nodes.every((n) => n.mass === 1)).toBe(true);
});

test("placed islands sit exactly at their stored coordinates, pinned, across rebuilds and verdict changes", () => {
  const first = buildNodes(snapshot([island("caching", null, { x: 120, y: 640 })]));
  expect(first[0]).toMatchObject({ x: 120, y: 640, placed: true, pinned: true });
  const previous = new Map(first.map((n) => [n.slug, { ...n, x: 5, y: 6 }]));
  const next = buildNodes(snapshot([island("caching", { state: "settled" }, { x: 120, y: 640 })]), previous);
  expect(next[0]).toMatchObject({ x: 120, y: 640, placed: true, state: "settled" });
  expect(next[0].stateAt).toBeGreaterThan(0);
});

test("unplaced islands start near their placed strait neighbours, else near the centre, and keep provisional spots", () => {
  const snap = snapshot(
    [island("a", null, { x: 100, y: 100 }), island("b", null, { x: 300, y: 100 }), island("c"), island("d")],
    [{ from: "a", to: "c", name: null, verdict: null }, { from: "b", to: "c", name: null, verdict: null }],
  );
  const nodes = buildNodes(snap);
  const c = nodes.find((n) => n.slug === "c");
  const d = nodes.find((n) => n.slug === "d");
  expect(c.placed).toBe(false);
  expect(Math.hypot(c.x - 200, c.y - 100)).toBeLessThan(200);
  expect(Math.hypot(d.x - WORLD / 2, d.y - WORLD / 2)).toBeLessThan(200);
  expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeGreaterThan(1);
  for (const n of nodes) {
    expect(n.x).toBeGreaterThanOrEqual(0);
    expect(n.x).toBeLessThanOrEqual(WORLD);
    expect(n.y).toBeGreaterThanOrEqual(0);
    expect(n.y).toBeLessThanOrEqual(WORLD);
  }
  const previous = new Map(nodes.map((n) => [n.slug, { ...n, x: 777, y: 888 }]));
  const again = buildNodes(snap, previous);
  expect(again.find((n) => n.slug === "c")).toMatchObject({ x: 777, y: 888, placed: false, pinned: false });
});

test("buildLinks joins nodes by slug and skips unknown ends", () => {
  const nodes = buildNodes(snapshot([island("a"), island("b")]));
  const links = buildLinks(snapshot([], [{ from: "a", to: "b", name: null, verdict: { state: "reef" } }, { from: "a", to: "zzz", name: null, verdict: null }]), nodes);
  expect(links).toHaveLength(1);
  expect(links[0].source.slug).toBe("a");
  expect(links[0].state).toBe("reef");
});

test("nodes remember when each landmark lit and when the state changed; nothing animates on first build", () => {
  const withLm = (slug, lit, verdict = null) => ({
    ...island(slug, verdict),
    landmarks: { total: 2, unlocked: lit.length, items: [{ slug: "a", name: "A", lit: lit.includes("a"), evidence: null }, { slug: "b", name: "B", lit: lit.includes("b"), evidence: null }] },
  });
  const first = buildNodes(snapshot([withLm("caching", ["a"])]));
  expect(first[0].stateAt).toBe(0);
  expect(first[0].litAt.get("a")).toBe(0);
  expect(first[0].litAt.has("b")).toBe(false);
  const prev = new Map(first.map((n) => [n.slug, n]));
  const second = buildNodes(snapshot([withLm("caching", ["a", "b"])]), prev);
  expect(second[0].litAt.get("a")).toBe(0); // already lit: no new animation
  expect(second[0].litAt.get("b")).toBeGreaterThan(0);
  expect(second[0].stateAt).toBe(0); // still open
  const prev2 = new Map(second.map((n) => [n.slug, n]));
  const third = buildNodes(snapshot([withLm("caching", ["a", "b"], { state: "settled", confidence: 0.8, evidence: "e", rationale: null, at: "2026-09-05" })]), prev2);
  expect(third[0].stateAt).toBeGreaterThan(0);
  expect(third[0].litAt.get("b")).toBe(second[0].litAt.get("b")); // unchanged lamps keep their time
});
