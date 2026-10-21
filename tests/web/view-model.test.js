import { test, expect } from "bun:test";
import { hashSeed, seededRandom, islandRadius, buildNodes, buildLinks, WORLD, stripItems, HINTS, landmarkLit, lensState, lensMarks, allExplored } from "../../src/web/view-model.js";

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

test("unplaced islands start near their placed strait neighbours, else just outside the placed islands, and keep provisional spots", () => {
  const snap = snapshot(
    [island("a", null, { x: 100, y: 100 }), island("b", null, { x: 300, y: 100 }), island("c"), island("d")],
    [{ from: "a", to: "c", name: null, verdict: null }, { from: "b", to: "c", name: null, verdict: null }],
  );
  const nodes = buildNodes(snap);
  const c = nodes.find((n) => n.slug === "c");
  const d = nodes.find((n) => n.slug === "d");
  expect(c.placed).toBe(false);
  expect(Math.hypot(c.x - 200, c.y - 100)).toBeLessThan(200);
  // d has no placed neighbour: it lands in open water beyond a and b, not between them
  const fromCentroid = (n) => Math.hypot(n.x - 200, n.y - 100);
  expect(fromCentroid(d)).toBeGreaterThan(100 + d.radius * 2);
  expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeGreaterThan(1);
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

test("stripItems: harbour, open water, reefs, and the cartographer, each with a hint", () => {
  const verdict = { state: "settled", confidence: 0.8 };
  const base = snapshot([island("caching", verdict), island("queues"), island("db")]);
  const plain = stripItems({ ...base, harbour: null, nearestOpenWater: ["queues"], reefs: [], sketch: null });
  expect(plain.map((i) => i.label)).toEqual(["Nearest open water", "Reefs", "Cartographer"]);
  expect(plain[0].value).toBe("queues");
  expect(plain[1].value).toBe("none charted");
  expect(plain.every((i) => typeof i.hint === "string" && i.hint.length > 20)).toBe(true);

  const charted = stripItems({ ...base, harbour: "caching", nearestOpenWater: [], reefs: ["island:db", "strait:caching~db"], sketch: null });
  expect(charted[0]).toEqual({ label: "Home port", value: "caching", hint: HINTS.homePort });
  expect(charted[1].value).toBe("none at this scale");
  expect(charted[2].value).toBe("db · strait caching~db");
  expect(stripItems({ ...base, harbour: "queues", nearestOpenWater: [], reefs: [], sketch: null })[0]).toEqual({ label: "Set out from", value: "queues", hint: HINTS.harbour });

  // the last cell opens the cartographer, and names a pending sketch when there is one
  expect(plain[2]).toEqual({ label: "Cartographer", value: "ask to sketch or change", hint: HINTS.cartographer, action: "chart" });
  const body = { islands: [{ slug: "q", name: "Queues", summary: "s", landmarks: [] }], straits: [{ from: "q", to: "db" }], updates: [], harbour: undefined };
  const sketched = stripItems({ ...base, harbour: null, nearestOpenWater: [], reefs: [], sketch: { id: 1, body, messageId: null } });
  expect(sketched[2].value).toBe("sketch to approve · 1 island · 1 strait");
});

test("a landmark is lit in the judge's lens by the judge, in the mentor's by being explored", () => {
  const lit = { slug: "a", name: "A", lit: true, evidence: "q", exploredAt: null };
  const explored = { slug: "b", name: "B", lit: false, evidence: null, exploredAt: "2026-10-01T00:00:00.000Z" };
  expect([landmarkLit(lit), landmarkLit(explored)]).toEqual([true, false]);
  expect([landmarkLit(lit, "mentor"), landmarkLit(explored, "mentor")]).toEqual([false, true]);
  expect(landmarkLit({ slug: "c", name: "C", lit: false, evidence: null }, "mentor")).toBe(false); // an older snapshot without the field
  const reefy = { ...island("q", { state: "reef" }), landmarks: { total: 2, unlocked: 1, explored: 1, items: [lit, explored] } };
  expect(lensState(reefy)).toBe("reef");
  expect(lensState(reefy, "mentor")).toBe("open");
  expect(lensMarks(reefy, "mentor")).toEqual({ total: 2, items: [{ slug: "a", lit: false }, { slug: "b", lit: true }] });
});

test("the mentor lens draws no elevation, reef, rollup, or strait, and lights explored landmarks in their own lamp; a switch animates nothing", () => {
  const items = [
    { slug: "a", name: "A", lit: true, evidence: "q", exploredAt: null },
    { slug: "b", name: "B", lit: false, evidence: null, exploredAt: "2026-10-01T00:00:00.000Z" },
  ];
  const reefy = { ...island("caching", { state: "reef" }), landmarks: { total: 2, unlocked: 1, explored: 1, items } };
  const parent = island("db", null, { x: null, y: null }, { sandbar: 0, settled: 2, mountainous: 0, reef: 0, open: 1 });
  const snap = snapshot([reefy, parent], [{ from: "caching", to: "db", name: null, verdict: { state: "settled" } }]);
  const judging = buildNodes(snap);
  expect(judging[0]).toMatchObject({ lens: "judge", state: "reef", lamp: "lamp", rollup: false });
  expect(judging[1].rollup).toBe(true);
  expect(judging[0].marks.items.map((m) => [m.slug, m.lit])).toEqual([["a", true], ["b", false]]);
  const mentoring = buildNodes(snap, new Map(judging.map((n) => [n.slug, n])), "mentor");
  expect(mentoring[0]).toMatchObject({ lens: "mentor", state: "open", lamp: "explore", rollup: false });
  expect(mentoring[1].rollup).toBe(false);
  expect(mentoring[0].marks.items.map((m) => [m.slug, m.lit])).toEqual([["a", false], ["b", true]]);
  expect(mentoring[0].stateAt).toBe(0);
  expect(mentoring[0].litAt.get("b")).toBe(0);
  expect(mentoring[0].x).toBe(judging[0].x); // the switch keeps provisional positions
  expect(buildLinks(snap, mentoring, "mentor")[0].hidden).toBe(true);
  expect(buildLinks(snap, judging)[0].hidden).toBe(false);
});

test("stripItems in the mentor lens counts explored landmarks and names islands with nothing explored", () => {
  const lm = (explored, total) => ({ total, unlocked: 0, explored, items: [] });
  const s = {
    ...snapshot([{ ...island("caching"), landmarks: lm(2, 4) }, { ...island("queues"), landmarks: lm(0, 4) }, island("db")]),
    harbour: null, nearestOpenWater: ["queues"], reefs: ["island:db"], sketch: null,
  };
  const items = stripItems(s, "mentor");
  expect(items.map((i) => i.label)).toEqual(["Explored", "Not yet explored", "Cartographer"]);
  expect(items[0]).toEqual({ label: "Explored", value: "2 of 8 landmarks", hint: HINTS.explored });
  expect(items[1]).toEqual({ label: "Not yet explored", value: "queues · db", hint: HINTS.unexplored });
  expect(stripItems({ ...s, islands: [island("x")] }, "mentor")[0].value).toBe("no landmarks yet");
  expect(stripItems(s).map((i) => i.label)).toEqual(["Nearest open water", "Reefs", "Cartographer"]); // the judge's lens is unchanged
});

test("allExplored needs at least one landmark, and every one explored", () => {
  const at = "2026-10-01T00:00:00.000Z";
  const withItems = (items) => ({ ...island("caching"), landmarks: { total: items.length, unlocked: 0, explored: 0, items } });
  expect(allExplored(island("caching"))).toBe(false);
  expect(allExplored(withItems([{ slug: "a", lit: true, exploredAt: null }]))).toBe(false); // lit is not explored
  expect(allExplored(withItems([{ slug: "a", lit: false, exploredAt: at }, { slug: "b", lit: false, exploredAt: null }]))).toBe(false);
  expect(allExplored(withItems([{ slug: "a", lit: false, exploredAt: at }, { slug: "b", lit: true, exploredAt: at }]))).toBe(true);
});
