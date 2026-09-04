import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import {
  upsertIsland, updateIsland, getIsland, requireIsland, listIslands, listIslandSlugs, islandPath, setIslandPositions,
  setHarbour, clearHarbour, getHarbour,
} from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait, listStraits } from "../../src/core/repositories/straitRepository.ts";
import { getViewState } from "../../src/core/repositories/viewStateRepository.ts";
import { ConflictError, NotFoundError } from "../../src/core/errors.ts";

let db: Database;
let domainId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
});

test("upsert by slug keeps summary and parent when omitted", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching", summary: "Keep hot data close." });
  const b = upsertIsland(db, { domainId, slug: "caching", name: "Caching!" });
  expect(b.id).toBe(a.id);
  expect(b.name).toBe("Caching!");
  expect(b.summary).toBe("Keep hot data close.");
  expect(b.parentId).toBeNull();
});

test("islets hang off a parent and list by parent", () => {
  const parent = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  upsertIsland(db, { domainId, slug: "cache-invalidation", name: "Invalidation", parentId: parent.id, sortOrder: 2 });
  upsertIsland(db, { domainId, slug: "cache-eviction", name: "Eviction", parentId: parent.id, sortOrder: 1 });
  expect(listIslands(db, domainId, null).map((i) => i.slug)).toEqual(["caching"]);
  expect(listIslands(db, domainId, parent.id).map((i) => i.slug)).toEqual(["cache-eviction", "cache-invalidation"]);
});

test("slug is unique per domain across depths; an island cannot parent itself", () => {
  const caching = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const databases = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const moved = upsertIsland(db, { domainId, slug: "caching", name: "Caching", parentId: databases.id });
  expect(moved.id).toBe(caching.id);
  expect(moved.parentId).toBe(databases.id);
  expect(listIslandSlugs(db, domainId)).toEqual(["caching", "databases"]);
  expect(() => upsertIsland(db, { domainId, slug: "caching", name: "Caching", parentId: caching.id })).toThrow(ConflictError);
  const islet = upsertIsland(db, { domainId, slug: "cache-eviction", name: "Eviction", parentId: caching.id });
  const deeper = upsertIsland(db, { domainId, slug: "lru", name: "LRU", parentId: islet.id });
  expect(() => upsertIsland(db, { domainId, slug: "caching", name: "Caching", parentId: deeper.id })).toThrow(ConflictError);
  expect(islandPath(db, deeper.id).map((i) => i.slug)).toEqual(["databases", "caching", "cache-eviction", "lru"]);
});

test("islandPath walks root to self", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "cache-invalidation", name: "Invalidation", parentId: a.id });
  const c = upsertIsland(db, { domainId, slug: "ttl", name: "TTL", parentId: b.id });
  expect(islandPath(db, c.id).map((i) => i.slug)).toEqual(["caching", "cache-invalidation", "ttl"]);
});

test("requireIsland lists valid slugs; updateIsland patches fields", () => {
  upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  expect(getIsland(db, domainId, "nope")).toBeNull();
  expect(() => requireIsland(db, domainId, "nope")).toThrow(NotFoundError);
  try { requireIsland(db, domainId, "nope"); } catch (e) { expect((e as NotFoundError).valid).toEqual(["caching"]); }
  const updated = updateIsland(db, domainId, "caching", { summary: "new" });
  expect(updated.summary).toBe("new");
  expect(updated.name).toBe("Caching");
});

test("reparenting an island drops its straits, which joined its old siblings", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const c = upsertIsland(db, { domainId, slug: "queues", name: "Queues" });
  upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id });
  upsertStrait(db, { domainId, fromIslandId: b.id, toIslandId: c.id });
  upsertIsland(db, { domainId, slug: "caching", name: "Caching", parentId: c.id });
  expect(listStraits(db, domainId, null).map((s) => [s.fromIslandId, s.toIslandId])).toEqual([[b.id, c.id]]);
  expect(listStraits(db, domainId, c.id)).toEqual([]);
});

test("islands start unplaced and positions persist through upsert", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  expect(a.x).toBeNull();
  expect(a.y).toBeNull();
  updateIsland(db, domainId, "caching", { x: 120.5, y: 640 });
  const again = upsertIsland(db, { domainId, slug: "caching", name: "Caching renamed" });
  expect(again.x).toBe(120.5);
  expect(again.y).toBe(640);
  expect(getIsland(db, domainId, "caching")!.name).toBe("Caching renamed");
});

test("reparenting nulls the stored position; a same-parent re-add keeps it", () => {
  const a = upsertIsland(db, { domainId, slug: "a", name: "A" });
  const b = upsertIsland(db, { domainId, slug: "b", name: "B" });
  updateIsland(db, domainId, "a", { x: 900, y: 900 });
  const moved = upsertIsland(db, { domainId, slug: "a", name: "A", parentId: b.id });
  expect(moved.parentId).toBe(b.id);
  expect(moved.x).toBeNull();
  expect(moved.y).toBeNull();

  updateIsland(db, domainId, "b", { x: 500, y: 500 });
  const same = upsertIsland(db, { domainId, slug: "b", name: "B" });
  expect(same.x).toBe(500);
  expect(same.y).toBe(500);
});

test("setIslandPositions writes all rows or none and bumps the version once per island", () => {
  upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const before = getViewState(db, domainId).version;
  expect(setIslandPositions(db, domainId, [{ slug: "caching", x: 100, y: 200 }, { slug: "databases", x: 300, y: 400 }])).toBe(2);
  expect(getViewState(db, domainId).version).toBe(before + 2);
  expect(getIsland(db, domainId, "databases")).toMatchObject({ x: 300, y: 400 });
  try {
    setIslandPositions(db, domainId, [{ slug: "caching", x: 1, y: 1 }, { slug: "nope", x: 2, y: 2 }]);
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(NotFoundError);
    expect((e as NotFoundError).valid).toEqual(["caching", "databases"]);
  }
  expect(getIsland(db, domainId, "caching")).toMatchObject({ x: 100, y: 200 });
  expect(getViewState(db, domainId).version).toBe(before + 2);
});

test("harbour: one per parent, moves between siblings, islets keep their own, clear counts", () => {
  const caching = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  upsertIsland(db, { domainId, slug: "caching-ttl", name: "TTL", parentId: caching.id });
  expect(getHarbour(db, domainId, null)).toBeNull();
  expect(caching.harbour).toBe(0);

  const v0 = getViewState(db, domainId).version;
  expect(setHarbour(db, domainId, "caching").harbour).toBe(1);
  expect(getViewState(db, domainId).version).toBeGreaterThan(v0);
  expect(getHarbour(db, domainId, null)?.slug).toBe("caching");

  setHarbour(db, domainId, "databases");
  expect(getHarbour(db, domainId, null)?.slug).toBe("databases");
  expect(getIsland(db, domainId, "caching")?.harbour).toBe(0);

  setHarbour(db, domainId, "caching-ttl");
  expect(getHarbour(db, domainId, caching.id)?.slug).toBe("caching-ttl");
  expect(getHarbour(db, domainId, null)?.slug).toBe("databases"); // the top scale is untouched

  expect(setHarbour(db, domainId, "databases").harbour).toBe(1); // idempotent
  expect(getHarbour(db, domainId, null)?.slug).toBe("databases");

  expect(clearHarbour(db, domainId, null)).toBe(1);
  expect(clearHarbour(db, domainId, null)).toBe(0);
  expect(getHarbour(db, domainId, null)).toBeNull();
  expect(getHarbour(db, domainId, caching.id)?.slug).toBe("caching-ttl");

  expect(() => setHarbour(db, domainId, "nope")).toThrow(NotFoundError);
  try {
    setHarbour(db, domainId, "nope");
  } catch (e) {
    expect((e as NotFoundError).valid).toEqual(["caching", "caching-ttl", "databases"]);
  }
});

test("re-parenting an island drops its harbour, since the flag is one per parent", () => {
  const caching = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  setHarbour(db, domainId, "databases");
  const moved = upsertIsland(db, { domainId, slug: "databases", name: "Databases", parentId: caching.id });
  expect(moved.harbour).toBe(0);
  expect(getHarbour(db, domainId, null)).toBeNull();
  expect(getHarbour(db, domainId, caching.id)).toBeNull();
});
