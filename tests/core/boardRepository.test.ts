import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { getViewState } from "../../src/core/repositories/viewStateRepository.ts";
import { addCard, getCard, requireCard, listCards, updateCard, removeCard } from "../../src/core/repositories/boardRepository.ts";
import { NotFoundError } from "../../src/core/errors.ts";

let db: Database;
let domainId: number;
let islandId: number;
let otherId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  islandId = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
  otherId = upsertIsland(db, { domainId, slug: "databases", name: "Databases" }).id;
});

test("cards are added, listed in id order, fetched, and each write bumps the version", () => {
  const v0 = getViewState(db, domainId).version;
  const a = addCard(db, { domainId, islandId, kind: "diagram", title: "Request path", body: "flowchart TB\n  a --> b", author: "judge" });
  const b = addCard(db, { domainId, islandId, kind: "code", title: "Cache read", body: "let x = 1", lang: "swift", author: "you" });
  expect(a).toMatchObject({ kind: "diagram", title: "Request path", lang: null, author: "judge", islandId });
  expect(b).toMatchObject({ kind: "code", lang: "swift", author: "you" });
  expect(a.createdAt).toBe(a.updatedAt);
  expect(listCards(db, islandId).map((c) => c.id)).toEqual([a.id, b.id]);
  expect(listCards(db, otherId)).toEqual([]);
  expect(getCard(db, a.id)?.title).toBe("Request path");
  expect(getCard(db, 999)).toBeNull();
  expect(getViewState(db, domainId).version).toBe(v0 + 2);
});

test("updateCard applies only the given fields, stamps updated_at, and keeps the author", () => {
  const a = addCard(db, { domainId, islandId, kind: "note", title: "Claim", body: "caches never go stale", author: "you" });
  const v1 = getViewState(db, domainId).version;
  const u = updateCard(db, a.id, { body: "caches go stale on write" });
  expect(u).toMatchObject({ id: a.id, title: "Claim", body: "caches go stale on write", author: "you", lang: null });
  expect(u.updatedAt >= a.updatedAt).toBe(true);
  expect(getViewState(db, domainId).version).toBe(v1 + 1);
  const t = updateCard(db, a.id, { title: "The claim", lang: "swift" });
  expect(t).toMatchObject({ title: "The claim", body: "caches go stale on write", lang: "swift" });
  expect(() => updateCard(db, 999, { title: "x" })).toThrow(NotFoundError);
});

test("removeCard deletes and returns the card; requireCard scopes to the island", () => {
  const a = addCard(db, { domainId, islandId, kind: "note", title: "n", body: "b", author: "judge" });
  expect(requireCard(db, islandId, a.id).id).toBe(a.id);
  expect(() => requireCard(db, otherId, a.id)).toThrow(NotFoundError);
  const v1 = getViewState(db, domainId).version;
  expect(removeCard(db, a.id).title).toBe("n");
  expect(getViewState(db, domainId).version).toBe(v1 + 1);
  expect(listCards(db, islandId)).toEqual([]);
  expect(() => removeCard(db, a.id)).toThrow(NotFoundError);
});
