import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import {
  upsertIsland, updateIsland, getIsland, requireIsland, listIslands, listIslandSlugs, islandPath,
} from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait, listStraits } from "../../src/core/repositories/straitRepository.ts";
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
