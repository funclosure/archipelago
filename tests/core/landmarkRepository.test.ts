import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import { getViewState } from "../../src/core/repositories/viewStateRepository.ts";
import {
  upsertLandmark, setLandmarks, unlockLandmark, exploreLandmark, listLandmarks, listLandmarksByIsland,
} from "../../src/core/repositories/landmarkRepository.ts";
import { ConflictError, NotFoundError } from "../../src/core/errors.ts";

let db: Database;
let domainId: number;
let caching: number;
let queues: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  caching = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
  queues = upsertIsland(db, { domainId, slug: "queues", name: "Queues" }).id;
});

test("upsert inserts or renames without touching the unlock, and lists in sort order", () => {
  const v0 = getViewState(db, domainId).version;
  upsertLandmark(db, { domainId, islandId: caching, slug: "invalidation", name: "Invalidation", sortOrder: 2 });
  upsertLandmark(db, { domainId, islandId: caching, slug: "hit-ratio", name: "Hit ratio", sortOrder: 1 });
  expect(listLandmarks(db, caching).map((l) => l.slug)).toEqual(["hit-ratio", "invalidation"]);
  expect(getViewState(db, domainId).version).toBe(v0 + 2);
  unlockLandmark(db, caching, "hit-ratio", "most reads never reach the database", null);
  const renamed = upsertLandmark(db, { domainId, islandId: caching, slug: "hit-ratio", name: "Hit rate" });
  expect(renamed).toMatchObject({ name: "Hit rate", sortOrder: 1 });
  expect(renamed.unlockedAt).not.toBeNull();
  // The same slug on another island is a different landmark.
  upsertLandmark(db, { domainId, islandId: queues, slug: "hit-ratio", name: "Hit ratio" });
  expect(listLandmarks(db, queues)).toHaveLength(1);
});

test("setLandmarks replaces dark landmarks, keeps lit ones, and orders by the list", () => {
  setLandmarks(db, domainId, caching, [{ slug: "a", name: "A" }, { slug: "b", name: "B" }, { slug: "c", name: "C" }]);
  unlockLandmark(db, caching, "b", "quote", null);
  const after = setLandmarks(db, domainId, caching, [{ slug: "c", name: "C2" }, { slug: "d", name: "D" }]);
  expect(after.map((l) => [l.slug, l.name, l.unlockedAt !== null])).toEqual([["c", "C2", false], ["d", "D", false], ["b", "B", true]]);
});

test("unlock records evidence and the message, once", () => {
  setLandmarks(db, domainId, caching, [{ slug: "a", name: "A" }]);
  const m = addMessage(db, { domainId, islandId: caching, role: "you", kind: "text", body: "the app checks the cache first" });
  const v1 = getViewState(db, domainId).version;
  const lit = unlockLandmark(db, caching, "a", "checks the cache first", m.id);
  expect(lit).toMatchObject({ slug: "a", evidence: "checks the cache first", messageId: m.id });
  expect(lit.unlockedAt).not.toBeNull();
  expect(getViewState(db, domainId).version).toBe(v1 + 1);
  expect(() => unlockLandmark(db, caching, "a", "again", null)).toThrow(ConflictError);
  const missing = (() => { try { unlockLandmark(db, caching, "zzz", "x", null); } catch (e) { return e; } })() as NotFoundError;
  expect(missing).toBeInstanceOf(NotFoundError);
  expect(missing.valid).toEqual(["a"]);
  db.run("delete from messages where id = ?", [m.id]);
  expect(listLandmarks(db, caching)[0]!.messageId).toBeNull();
});

test("listLandmarksByIsland groups by island and skips islands without any", () => {
  setLandmarks(db, domainId, caching, [{ slug: "a", name: "A" }, { slug: "b", name: "B" }]);
  const map = listLandmarksByIsland(db, [caching, queues]);
  expect(map.get(caching)?.map((l) => l.slug)).toEqual(["a", "b"]);
  expect(map.has(queues)).toBe(false);
  expect(listLandmarksByIsland(db, []).size).toBe(0);
});

test("deleting the island cascades its landmarks and bumps the version", () => {
  setLandmarks(db, domainId, queues, [{ slug: "a", name: "A" }]);
  const v = getViewState(db, domainId).version;
  db.run("delete from islands where id = ?", [queues]);
  expect(db.query<{ n: number }, []>("select count(*) as n from landmarks").get()!.n).toBe(0);
  expect(getViewState(db, domainId).version).toBeGreaterThan(v);
});

test("explore marks a landmark once, in its own columns apart from lit, and bumps the version", () => {
  setLandmarks(db, domainId, caching, [{ slug: "a", name: "A" }, { slug: "b", name: "B" }]);
  const m = addMessage(db, { domainId, islandId: caching, role: "you", kind: "text", body: "so it is like NSCache", mode: "mentor" });
  const v1 = getViewState(db, domainId).version;
  const first = exploreLandmark(db, caching, "a", "like NSCache", m.id);
  expect(first.changed).toBe(true);
  expect(first.landmark).toMatchObject({ slug: "a", exploredEvidence: "like NSCache", exploredMessageId: m.id, unlockedAt: null, evidence: null, messageId: null });
  expect(first.landmark.exploredAt).not.toBeNull();
  expect(getViewState(db, domainId).version).toBe(v1 + 1);
  const again = exploreLandmark(db, caching, "a", "other words", null);
  expect(again.changed).toBe(false);
  expect(again.landmark.exploredEvidence).toBe("like NSCache");
  expect(getViewState(db, domainId).version).toBe(v1 + 1); // a repeat writes nothing
  unlockLandmark(db, caching, "a", "q", null);
  expect(listLandmarks(db, caching)[0]).toMatchObject({ exploredEvidence: "like NSCache", evidence: "q" });
  const missing = (() => { try { exploreLandmark(db, caching, "zzz", "x", null); } catch (e) { return e; } })() as NotFoundError;
  expect(missing).toBeInstanceOf(NotFoundError);
  expect(missing.valid).toEqual(["a", "b"]);
  db.run("delete from messages where id = ?", [m.id]);
  expect(listLandmarks(db, caching)[0]!.exploredMessageId).toBeNull();
});
