import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { activeSession, startSession, endSession, listSessions } from "../../src/core/repositories/sessionRepository.ts";
import { NotFoundError } from "../../src/core/errors.ts";

let db: Database;
let domainId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
});

test("startSession reuses the open session", () => {
  expect(activeSession(db, domainId)).toBeNull();
  const a = startSession(db, domainId);
  const b = startSession(db, domainId);
  expect(b.id).toBe(a.id);
  expect(activeSession(db, domainId)?.id).toBe(a.id);
});

test("endSession closes with a summary; a new start opens a new one", () => {
  const a = startSession(db, domainId);
  const ended = endSession(db, domainId, "charted caching and queues");
  expect(ended.id).toBe(a.id);
  expect(ended.endedAt).not.toBeNull();
  expect(ended.summary).toBe("charted caching and queues");
  expect(activeSession(db, domainId)).toBeNull();
  expect(() => endSession(db, domainId, "again")).toThrow(NotFoundError);
  const b = startSession(db, domainId);
  expect(b.id).not.toBe(a.id);
  expect(listSessions(db, domainId).map((s) => s.id)).toEqual([b.id, a.id]);
});
