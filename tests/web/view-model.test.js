import { test, expect } from "bun:test";
import { hashSeed, seededRandom, rollupMass, buildNodes, buildLinks, STATE_MASS } from "../../src/web/view-model.js";

const island = (slug, verdict = null, byState = { sandbar: 0, settled: 0, mountainous: 0, reef: 0, open: 0 }) => ({
  slug, name: slug, summary: null, hasChildren: Object.values(byState).some(Boolean), verdict,
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

test("rollupMass uses own verdict, else the heaviest child state, else open", () => {
  expect(rollupMass(island("a", { state: "mountainous" }))).toBe(STATE_MASS.mountainous);
  expect(rollupMass(island("a", null, { sandbar: 1, settled: 2, mountainous: 0, reef: 0, open: 3 }))).toBe(STATE_MASS.settled);
  expect(rollupMass(island("a"))).toBe(STATE_MASS.open);
});

test("buildNodes seeds positions stably and keeps previous positions", () => {
  const first = buildNodes(snapshot([island("caching"), island("queues")]), 1000, 800);
  const again = buildNodes(snapshot([island("caching"), island("queues")]), 1000, 800);
  expect(first.map((n) => [n.x, n.y])).toEqual(again.map((n) => [n.x, n.y]));
  const previous = new Map(first.map((n) => [n.slug, { ...n, x: 5, y: 6, state: "open" }]));
  const next = buildNodes(snapshot([island("caching", { state: "settled" }), island("queues")]), 1000, 800, previous);
  expect(next[0].x).toBe(5);
  expect(next[0].state).toBe("settled");
  expect(next[0].changedAt).toBeGreaterThan(0);
  expect(next[1].changedAt).toBe(previous.get("queues").changedAt);
});

test("buildLinks joins nodes by slug and skips unknown ends", () => {
  const nodes = buildNodes(snapshot([island("a"), island("b")]), 800, 600);
  const links = buildLinks(snapshot([], [{ from: "a", to: "b", name: null, verdict: { state: "reef" } }, { from: "a", to: "zzz", name: null, verdict: null }]), nodes);
  expect(links).toHaveLength(1);
  expect(links[0].source.slug).toBe("a");
  expect(links[0].state).toBe("reef");
});
