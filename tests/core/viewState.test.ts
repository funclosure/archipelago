import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait } from "../../src/core/repositories/straitRepository.ts";
import { addVerdict } from "../../src/core/repositories/verdictRepository.ts";
import { addComment, markCommentsRead } from "../../src/core/repositories/commentRepository.ts";
import { startSession } from "../../src/core/repositories/sessionRepository.ts";
import { getViewState, setFocus } from "../../src/core/repositories/viewStateRepository.ts";

let db: Database;
let domainId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
});

const version = () => getViewState(db, domainId).version;

test("every write bumps the domain version", () => {
  expect(version()).toBe(0);
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  expect(version()).toBe(1);
  const b = upsertIsland(db, { domainId, slug: "queues", name: "Queues" });
  expect(version()).toBe(2);
  const s = upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id });
  expect(version()).toBe(3);
  addVerdict(db, { targetType: "island", targetId: a.id, state: "settled", confidence: 0.9, evidence: "q" });
  expect(version()).toBe(4);
  addVerdict(db, { targetType: "strait", targetId: s.id, state: "sandbar", confidence: 0.6, evidence: "q" });
  expect(version()).toBe(5);
  const c = addComment(db, { domainId, targetType: "island", targetId: a.id, body: "", kind: "probe_me" });
  expect(version()).toBe(6);
  markCommentsRead(db, domainId, [c.id]);
  expect(version()).toBe(7);
  startSession(db, domainId);
  expect(version()).toBe(8);
  setFocus(db, domainId, a.id);
  expect(version()).toBe(9);
  expect(getViewState(db, domainId).focusIslandId).toBe(a.id);
  setFocus(db, domainId, null);
  expect(version()).toBe(10);
});

test("a write in one domain does not bump another", () => {
  const other = upsertDomain(db, { slug: "ios", name: "iOS" }).id;
  upsertIsland(db, { domainId: other, slug: "swiftui", name: "SwiftUI" });
  expect(version()).toBe(0);
});

test("renaming a domain bumps its version by 1", () => {
  const before = version();
  upsertDomain(db, { slug: "sd", name: "Systems Design" });
  expect(version()).toBe(before + 1);
});

test("reparenting an island with one strait bumps the version by exactly 2", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const c = upsertIsland(db, { domainId, slug: "queues", name: "Queues" });
  upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id });
  const before = version();
  upsertIsland(db, { domainId, slug: "caching", name: "Caching", parentId: c.id });
  expect(version() - before).toBe(2);
});
