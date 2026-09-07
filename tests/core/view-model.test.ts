import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland, updateIsland, setHarbour } from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait } from "../../src/core/repositories/straitRepository.ts";
import { addVerdict } from "../../src/core/repositories/verdictRepository.ts";
import { addComment } from "../../src/core/repositories/commentRepository.ts";
import { setFocus } from "../../src/core/repositories/viewStateRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import { buildSnapshot, buildOutline, listCommentViews, formatTarget } from "../../src/core/view-model.ts";
import { NotFoundError } from "../../src/core/errors.ts";
import { setLandmarks, unlockLandmark } from "../../src/core/repositories/landmarkRepository.ts";

let db: Database;
let domainId: number;
let caching: number;
let queues: number;
let dbs: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  caching = upsertIsland(db, { domainId, slug: "caching", name: "Caching", sortOrder: 1 }).id;
  queues = upsertIsland(db, { domainId, slug: "queues", name: "Queues", sortOrder: 2 }).id;
  dbs = upsertIsland(db, { domainId, slug: "databases", name: "Databases", sortOrder: 3 }).id;
  upsertStrait(db, { domainId, fromIslandId: caching, toIslandId: dbs, name: "cache-aside" });
  upsertStrait(db, { domainId, fromIslandId: queues, toIslandId: dbs });
});

test("open water is absence, never a state", () => {
  const snap = buildSnapshot(db, "sd", null);
  expect(snap.islands.map((i) => i.slug)).toEqual(["caching", "queues", "databases"]);
  for (const island of snap.islands) expect(island.verdict).toBeNull();
  expect(JSON.stringify(snap)).not.toContain('"state":"open"');
  expect(snap.scale.path).toEqual([]);
  expect(snap.straits).toHaveLength(2);
  expect(snap.straits[0]).toMatchObject({ from: "caching", to: "databases", name: "cache-aside", verdict: null });
});

test("latest verdict wins and reefs are listed", () => {
  addVerdict(db, { targetType: "island", targetId: caching, state: "reef", confidence: 0.8, evidence: "TTL fixes everything" });
  addVerdict(db, { targetType: "island", targetId: caching, state: "settled", confidence: 0.9, evidence: "explained invalidation" });
  addVerdict(db, { targetType: "island", targetId: queues, state: "reef", confidence: 0.8, evidence: "exactly-once is free" });
  const snap = buildSnapshot(db, "sd", null);
  expect(snap.islands.find((i) => i.slug === "caching")!.verdict).toMatchObject({ state: "settled", evidence: "explained invalidation" });
  expect(snap.reefs).toEqual(["island:queues"]);
});

test("nearest open water prefers neighbours of charted islands, ordered by elevation", () => {
  addVerdict(db, { targetType: "island", targetId: caching, state: "mountainous", confidence: 0.9, evidence: "q" });
  addVerdict(db, { targetType: "island", targetId: queues, state: "sandbar", confidence: 0.6, evidence: "q" });
  const snap = buildSnapshot(db, "sd", null);
  // databases neighbours both; it is the only open island, so it is first and only.
  expect(snap.nearestOpenWater).toEqual(["databases"]);
  upsertIsland(db, { domainId, slug: "consensus", name: "Consensus", sortOrder: 4 });
  expect(buildSnapshot(db, "sd", null).nearestOpenWater).toEqual(["databases", "consensus"]);
  addVerdict(db, { targetType: "island", targetId: dbs, state: "settled", confidence: 0.9, evidence: "q" });
  expect(buildSnapshot(db, "sd", null).nearestOpenWater).toEqual(["consensus"]);
});

test("parent with no verdict rolls up its children and is never assigned a state", () => {
  const ev = upsertIsland(db, { domainId, slug: "cache-eviction", name: "Eviction", parentId: caching }).id;
  upsertIsland(db, { domainId, slug: "cache-invalidation", name: "Invalidation", parentId: caching });
  upsertIsland(db, { domainId, slug: "cache-warming", name: "Warming", parentId: caching });
  addVerdict(db, { targetType: "island", targetId: ev, state: "settled", confidence: 0.9, evidence: "q" });
  const top = buildSnapshot(db, "sd", null).islands.find((i) => i.slug === "caching")!;
  expect(top.verdict).toBeNull();
  expect(top.hasChildren).toBe(true);
  expect(top.children).toEqual({ total: 3, byState: { sandbar: 0, settled: 1, mountainous: 0, reef: 0, open: 2 } });
  const inner = buildSnapshot(db, "sd", "caching");
  expect(inner.scale.path).toEqual([{ slug: "caching", name: "Caching" }]);
  expect(inner.islands.map((i) => i.slug)).toEqual(["cache-eviction", "cache-invalidation", "cache-warming"]);
  expect(inner.straits).toEqual([]);
});

test("focus, unread count, version, and target formatting", () => {
  setFocus(db, domainId, queues);
  addComment(db, { domainId, targetType: "island", targetId: queues, body: "", kind: "probe_me" });
  const snap = buildSnapshot(db, "sd", null);
  expect(snap.focus).toBe("queues");
  expect(snap.unreadComments).toBe(1);
  expect(snap.unread).toEqual([{ kind: "probe_me", target: "island:queues" }]);
  expect(snap.version).toBeGreaterThan(0);
  const views = listCommentViews(db, domainId, true);
  expect(views[0]).toMatchObject({ kind: "probe_me", target: "island:queues" });
  expect(formatTarget(db, "domain", domainId)).toBe("domain:sd");
});

test("unknown domain or scale throws NotFoundError", () => {
  expect(() => buildSnapshot(db, "nope", null)).toThrow(NotFoundError);
  expect(() => buildSnapshot(db, "sd", "nope")).toThrow(NotFoundError);
});

test("snapshot islands carry their positions", () => {
  updateIsland(db, domainId, "caching", { x: 100, y: 200 });
  const snap = buildSnapshot(db, "sd", null);
  expect(snap.islands.find((i) => i.slug === "caching")).toMatchObject({ x: 100, y: 200 });
  expect(snap.islands.find((i) => i.slug === "queues")).toMatchObject({ x: null, y: null });
});

test("snapshot counts each island's thread", () => {
  addMessage(db, { domainId, islandId: caching, role: "judge", kind: "text", body: "Explain caching." });
  addMessage(db, { domainId, islandId: caching, role: "you", kind: "text", body: "hot data" });
  const snap = buildSnapshot(db, "sd", null);
  expect(snap.islands.map((i) => [i.slug, i.messages])).toEqual([["caching", 2], ["queues", 0], ["databases", 0]]);
});

test("snapshot carries each island's landmarks with lit state and evidence", () => {
  setLandmarks(db, domainId, caching, [{ slug: "hit-ratio", name: "Hit ratio" }, { slug: "invalidation", name: "Invalidation" }]);
  unlockLandmark(db, caching, "hit-ratio", "most reads never reach the database", null);
  const snap = buildSnapshot(db, "sd", null);
  const c = snap.islands.find((i) => i.slug === "caching")!;
  expect(c.landmarks).toEqual({
    total: 2, unlocked: 1,
    items: [
      { slug: "hit-ratio", name: "Hit ratio", lit: true, evidence: "most reads never reach the database" },
      { slug: "invalidation", name: "Invalidation", lit: false, evidence: null },
    ],
  });
  expect(snap.islands.find((i) => i.slug === "queues")!.landmarks).toEqual({ total: 0, unlocked: 0, items: [] });
});

test("the snapshot names the harbour at its own scale only", () => {
  const ttl = upsertIsland(db, { domainId, slug: "caching-ttl", name: "TTL", parentId: caching });
  expect(buildSnapshot(db, "sd", null).harbour).toBeNull();
  setHarbour(db, domainId, "queues");
  const top = buildSnapshot(db, "sd", null);
  expect(top.harbour).toBe("queues");
  expect(top.islands.filter((i) => i.harbour).map((i) => i.slug)).toEqual(["queues"]);
  expect(buildSnapshot(db, "sd", "caching").harbour).toBeNull();
  setHarbour(db, domainId, "caching-ttl");
  expect(buildSnapshot(db, "sd", "caching").harbour).toBe("caching-ttl");
  expect(buildSnapshot(db, "sd", null).harbour).toBe("queues");
  expect(ttl.harbour).toBe(0); // the row read before setHarbour is untouched
});

test("buildOutline nests islets under their parent with the scale the map needs, and counts over the whole tree", () => {
  const ttl = upsertIsland(db, { domainId, slug: "caching-ttl", name: "TTL", parentId: caching });
  const deep = upsertIsland(db, { domainId, slug: "caching-ttl-jitter", name: "Jitter", parentId: ttl.id });
  addVerdict(db, { targetType: "island", targetId: ttl.id, state: "settled", confidence: 0.8, evidence: "e" });
  addVerdict(db, { targetType: "island", targetId: dbs, state: "reef", confidence: 0.9, evidence: "r" });
  setLandmarks(db, domainId, caching, [{ slug: "a", name: "A" }, { slug: "b", name: "B" }, { slug: "c", name: "C" }, { slug: "d", name: "D" }]);
  unlockLandmark(db, caching, "a", "quote", null);
  setHarbour(db, domainId, "queues");
  setHarbour(db, domainId, "caching-ttl");

  const o = buildOutline(db, "sd");
  expect(o.domain).toEqual({ slug: "sd", name: "System Design" });
  expect(o.islands.map((i) => i.slug)).toEqual(["caching", "queues", "databases"]);
  const c = o.islands[0];
  expect(c).toMatchObject({ state: "open", landmarks: { total: 4, unlocked: 1 }, harbour: false, scale: null });
  expect(c.children.map((i) => i.slug)).toEqual(["caching-ttl"]);
  expect(c.children[0]).toMatchObject({ state: "settled", harbour: true, scale: "caching", landmarks: { total: 0, unlocked: 0 } });
  expect(c.children[0].children[0]).toMatchObject({ slug: "caching-ttl-jitter", scale: "caching-ttl", children: [] });
  expect(o.islands[1]).toMatchObject({ slug: "queues", harbour: true });
  expect(o.islands[2]).toMatchObject({ slug: "databases", state: "reef" });
  expect(o.harbour).toBe("queues");
  expect(o.charted).toBe(2); // ttl and databases
  expect(o.lit).toBe(1);
  expect(o.version).toBeGreaterThan(0);
  expect(() => buildOutline(db, "nope")).toThrow(NotFoundError);
});
