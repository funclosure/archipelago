import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait, listStraits, getStrait, requireStrait } from "../../src/core/repositories/straitRepository.ts";
import { ConflictError, NotFoundError } from "../../src/core/errors.ts";

let db: Database;
let domainId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
});

test("strait is stored as an unordered pair and upserts", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const s1 = upsertStrait(db, { domainId, fromIslandId: b.id, toIslandId: a.id, name: "cache aside" });
  const s2 = upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id, summary: "when to cache reads" });
  expect(s2.id).toBe(s1.id);
  expect(s2.fromIslandId).toBe(Math.min(a.id, b.id));
  expect(s2.name).toBe("cache aside");
  expect(s2.summary).toBe("when to cache reads");
  expect(getStrait(db, b.id, a.id)?.id).toBe(s1.id);
  expect(requireStrait(db, a, b).id).toBe(s1.id);
});

test("straits must join siblings", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const child = upsertIsland(db, { domainId, slug: "cache-eviction", name: "Eviction", parentId: a.id });
  expect(() => upsertStrait(db, { domainId, fromIslandId: b.id, toIslandId: child.id })).toThrow(ConflictError);
  expect(() => upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: a.id })).toThrow(ConflictError);
});

test("listStraits filters by parent scale", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const c1 = upsertIsland(db, { domainId, slug: "cache-eviction", name: "Eviction", parentId: a.id });
  const c2 = upsertIsland(db, { domainId, slug: "cache-invalidation", name: "Invalidation", parentId: a.id });
  upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id });
  upsertStrait(db, { domainId, fromIslandId: c1.id, toIslandId: c2.id });
  expect(listStraits(db, domainId, null)).toHaveLength(1);
  expect(listStraits(db, domainId, a.id)).toHaveLength(1);
  expect(listStraits(db, domainId, b.id)).toHaveLength(0);
  expect(() => requireStrait(db, a, c1)).toThrow(NotFoundError);
});
