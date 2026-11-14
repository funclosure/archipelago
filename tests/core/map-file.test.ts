// A map file: a domain's structure out and in again, with nothing of the reader's in it, and a file another program
// wrote refused in words that say where it went wrong.
import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { listDomains, upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { listIslands, setHarbour, setIslandPositions, upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { listLandmarks, setLandmarks, unlockLandmark } from "../../src/core/repositories/landmarkRepository.ts";
import { listStraits, upsertStrait } from "../../src/core/repositories/straitRepository.ts";
import { addSea, listSeas } from "../../src/core/repositories/seaRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import { exportMap, importMap, parseMapFile, MAP_DEPTH_MAX, MAP_FILE_VERSION, type MapFile, type MapIsland } from "../../src/core/map-file.ts";

let db: Database;
beforeEach(() => {
  db = openDatabase(":memory:");
});

const marks = ["what", "why", "when", "limits"].map((slug) => ({ slug, name: slug }));

/** A domain charted by hand: two scales, landmarks with terms, straits, a placed sea and a suggested one, and the reader's own traces. */
function seed() {
  const d = upsertDomain(db, { slug: "caching", name: "Caching", description: "For interviews." });
  const a = upsertIsland(db, { domainId: d.id, slug: "eviction", name: "Eviction", summary: "What leaves, and when", sortOrder: 1 });
  const b = upsertIsland(db, { domainId: d.id, slug: "invalidation", name: "Invalidation", summary: "Knowing it is stale", sortOrder: 2 });
  upsertIsland(db, { domainId: d.id, slug: "warming", name: "Warming", sortOrder: 3 });
  setLandmarks(db, d.id, a.id, [{ slug: "lru", name: "Least recently used", terms: ["LRU", "recency"] }, ...marks]);
  upsertStrait(db, { domainId: d.id, fromIslandId: a.id, toIslandId: b.id, name: "TTL" });
  setIslandPositions(db, d.id, [{ slug: "eviction", x: 120, y: -40.5 }]);
  addSea(db, { domainId: d.id, parentIslandId: null, name: "Freshness", x: 10, y: 20 });
  addSea(db, { domainId: d.id, parentIslandId: null, name: "Capacity", anchor: ["eviction", "warming"] });
  const a1 = upsertIsland(db, { domainId: d.id, slug: "lfu", name: "LFU", parentId: a.id, sortOrder: 1 });
  const a2 = upsertIsland(db, { domainId: d.id, slug: "arc", name: "ARC", parentId: a.id, sortOrder: 2 });
  upsertStrait(db, { domainId: d.id, fromIslandId: a1.id, toIslandId: a2.id });
  // Where to start is structure: it travels, at each scale.
  setHarbour(db, d.id, "eviction");
  setHarbour(db, d.id, "arc");
  // The reader's own: none of it belongs in the file.
  const said = addMessage(db, { domainId: d.id, islandId: a.id, role: "you", kind: "text", body: "the one touched longest ago goes first" });
  unlockLandmark(db, a.id, "lru", "the one touched longest ago goes first", said.id);
  return d;
}

test("a domain exports as its structure and the reader's arrangement, and nothing they said", () => {
  seed();
  const file = exportMap(db, "caching");
  expect(file).toEqual({
    archipelago: MAP_FILE_VERSION,
    name: "Caching",
    slug: "caching",
    description: "For interviews.",
    islands: [
      {
        slug: "eviction", name: "Eviction", summary: "What leaves, and when", harbour: true, x: 120, y: -40.5,
        landmarks: [{ slug: "lru", name: "Least recently used", terms: ["LRU", "recency"] }, ...marks],
        islets: [{ slug: "lfu", name: "LFU" }, { slug: "arc", name: "ARC", harbour: true }],
        straits: [{ from: "lfu", to: "arc" }],
      },
      { slug: "invalidation", name: "Invalidation", summary: "Knowing it is stale" },
      { slug: "warming", name: "Warming" },
    ],
    straits: [{ from: "eviction", to: "invalidation", name: "TTL" }],
    seas: [{ name: "Freshness", x: 10, y: 20 }, { name: "Capacity", islands: ["eviction", "warming"] }],
  });
  const text = JSON.stringify(file);
  for (const own of ["touched longest ago", "unlocked", "evidence"]) expect(text).not.toContain(own);
  // What it writes, it reads.
  expect(parseMapFile(JSON.parse(text))).toEqual(file);
});

test("importing makes a new domain with the same map, dark and unanswered, and never touches one that is there", () => {
  seed();
  const file = exportMap(db, "caching");
  const made = importMap(db, file);
  expect(made).toMatchObject({ domain: { slug: "caching-2", name: "Caching", description: "For interviews.", provisional: 0 }, islands: 5, straits: 2, seas: 2 });
  expect(exportMap(db, "caching-2")).toEqual({ ...file, slug: "caching-2" });
  const top = listIslands(db, made.domain.id, null);
  expect(top.map((i) => [i.slug, i.x, i.harbour])).toEqual([["eviction", 120, 1], ["invalidation", null, 0], ["warming", null, 0]]);
  expect(listIslands(db, made.domain.id, top[0]!.id).map((i) => [i.slug, i.harbour])).toEqual([["lfu", 0], ["arc", 1]]);
  expect(listLandmarks(db, top[0]!.id).every((l) => l.unlockedAt === null && l.exploredAt === null)).toBe(true);
  expect(listSeas(db, made.domain.id, null).map((s) => [s.name, s.x, s.anchor])).toEqual([["Freshness", 10, null], ["Capacity", null, ["eviction", "warming"]]]);
  expect(listStraits(db, made.domain.id, top[0]!.id)).toHaveLength(1);
  expect(importMap(db, file).domain.slug).toBe("caching-3");
  // The first domain is as it was.
  expect(exportMap(db, "caching")).toEqual(file);
});

test("a file with no slug takes its name's, and one with no ASCII in its name still lands", () => {
  const islands = [{ slug: "a", name: "A" }];
  expect(importMap(db, { archipelago: 1, name: "System Design", islands }).domain.slug).toBe("system-design");
  expect(importMap(db, { archipelago: 1, name: "分散式系統", islands }).domain).toMatchObject({ slug: "map", name: "分散式系統" });
  expect(importMap(db, { archipelago: 1, name: "快取", islands }).domain.slug).toBe("map-2");
});

test("a file that is not a map is refused in words that say where, and nothing is written", () => {
  const ok: MapFile = { archipelago: 1, name: "X", islands: [{ slug: "a", name: "A" }, { slug: "b", name: "B", islets: [{ slug: "b1", name: "B1" }, { slug: "b2", name: "B2" }] }] };
  const bad = (change: (f: any) => void) => {
    const file = structuredClone(ok);
    change(file);
    try {
      importMap(db, file);
    } catch (error) {
      return (error as Error).message;
    }
    return "accepted";
  };
  expect(bad(() => {})).toBe("accepted");
  expect(bad((f) => delete f.name)).toMatch(/^not a map file: name: /);
  expect(bad((f) => (f.islands = []))).toMatch(/^not a map file: islands: /);
  expect(bad((f) => (f.islands[0].slug = "Not A Slug"))).toMatch(/islands\.0\.slug/);
  expect(bad((f) => (f.archipelago = 2))).toBe("this map file is version 2; this Archipelago reads up to 1");
  expect(bad((f) => (f.islands[1].islets[0].slug = "a"))).toContain('the slug "a" is used twice');
  expect(bad((f) => (f.straits = [{ from: "a", to: "b1" }]))).toContain('names "b1", which is not an island of the top scale');
  expect(bad((f) => (f.straits = [{ from: "a", to: "a" }]))).toContain("two different islands");
  expect(bad((f) => (f.straits = [{ from: "a", to: "b" }, { from: "b", to: "a" }]))).toContain("listed twice");
  expect(bad((f) => (f.islands[1].seas = [{ name: "Inner", islands: ["a"] }]))).toContain('the sea "Inner" names "a", which is not an island of b');
  expect(bad((f) => (f.seas = [{ name: "Nowhere" }]))).toMatch(/seas\.0/);
  expect(bad((f) => (f.islands[0].x = 4))).toMatch(/both x and y/);
  expect(bad((f) => (f.islands[0].straits = [{ from: "x", to: "y" }]))).toContain("straits or seas but no islets");
  expect(bad((f) => (f.islands[0].landmarks = [{ slug: "m", name: "M" }, { slug: "m", name: "M again" }]))).toContain("two landmarks with one slug");
  expect(bad((f) => (f.islands[0].harbour = true, f.islands[1].harbour = true))).toContain("the top scale has 2 harbours (a, b)");
  expect(bad((f) => (f.islands[0].harbour = "yes"))).toMatch(/islands\.0\.harbour/);
  // Too deep: islands inside islands past the limit.
  let inner: MapIsland = { slug: "d0", name: "D0" };
  for (let n = 1; n <= MAP_DEPTH_MAX; n++) inner = { slug: `d${n}`, name: `D${n}`, islets: [inner] };
  expect(bad((f) => f.islands.push(inner))).toContain(`more than ${MAP_DEPTH_MAX} scales deep`);
  // Every refusal above left the database alone: only the one accepted file made a domain.
  expect(listDomains(db).map((d) => d.slug)).toEqual(["x"]);
});
