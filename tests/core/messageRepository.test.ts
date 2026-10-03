import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { getViewState } from "../../src/core/repositories/viewStateRepository.ts";
import {
  addMessage, listMessages, getMessage, countMessages, setReefStatus, parseProposal,
} from "../../src/core/repositories/messageRepository.ts";
import { ConflictError } from "../../src/core/errors.ts";

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

const proposalBody = (status = "pending") =>
  JSON.stringify({
    target: "island:caching", claim: "caches never go stale", consequence: "price changes never show",
    evidence: "the cache is always right", confidence: 0.8, rationale: "confident and wrong", status,
  });

test("messages are listed per island in insertion order and counted per island", () => {
  const v0 = getViewState(db, domainId).version;
  const a = addMessage(db, { domainId, islandId: caching, role: "judge", kind: "text", body: "Explain caching." });
  const b = addMessage(db, { domainId, islandId: caching, role: "you", kind: "text", body: "It keeps hot data close." });
  addMessage(db, { domainId, islandId: queues, role: "judge", kind: "text", body: "Explain queues." });
  expect(listMessages(db, caching).map((m) => m.id)).toEqual([a.id, b.id]);
  expect(listMessages(db, caching)[0]).toMatchObject({ role: "judge", kind: "text", body: "Explain caching.", islandId: caching });
  expect(getMessage(db, b.id)?.body).toBe("It keeps hot data close.");
  expect(getMessage(db, 999)).toBeNull();
  expect(countMessages(db, [caching, queues])).toEqual(new Map([[caching, 2], [queues, 1]]));
  expect(countMessages(db, [])).toEqual(new Map());
  expect(getViewState(db, domainId).version).toBe(v0 + 3);
});

test("reef status moves from pending once, and bumps the version", () => {
  const m = addMessage(db, { domainId, islandId: caching, role: "judge", kind: "reef_proposal", body: proposalBody() });
  const v1 = getViewState(db, domainId).version;
  expect(parseProposal(m.body).status).toBe("pending");
  const confirmed = setReefStatus(db, m.id, "confirmed");
  expect(parseProposal(confirmed.body)).toMatchObject({ status: "confirmed", claim: "caches never go stale" });
  expect(getViewState(db, domainId).version).toBe(v1 + 1);
  expect(() => setReefStatus(db, m.id, "disputed")).toThrow(ConflictError);
  const text = addMessage(db, { domainId, islandId: caching, role: "you", kind: "text", body: "hi" });
  expect(() => setReefStatus(db, text.id, "confirmed")).toThrow(ConflictError);
  expect(() => setReefStatus(db, 999, "confirmed")).toThrow(/no message/);
});

test("parseProposal rejects bodies that are not proposals", () => {
  expect(() => parseProposal("not json")).toThrow();
  expect(() => parseProposal(JSON.stringify({ claim: "x" }))).toThrow();
});

test("threads are per mode: listMessages reads the judge thread unless asked for the mentor's", () => {
  const j = addMessage(db, { domainId, islandId: caching, role: "judge", kind: "text", body: "Explain caching." });
  const m = addMessage(db, { domainId, islandId: caching, role: "mentor", kind: "text", body: "Caching is a pantry by the stove.", mode: "mentor" });
  addMessage(db, { domainId, islandId: caching, role: "you", kind: "text", body: "so it goes stale?", mode: "mentor" });
  expect(j.mode).toBe("judge");
  expect(listMessages(db, caching).map((x) => x.id)).toEqual([j.id]);
  expect(listMessages(db, caching, "judge").map((x) => x.id)).toEqual([j.id]);
  expect(listMessages(db, caching, "mentor").map((x) => [x.role, x.mode])).toEqual([["mentor", "mentor"], ["you", "mentor"]]);
  expect(getMessage(db, m.id)?.mode).toBe("mentor");
  expect(countMessages(db, [caching])).toEqual(new Map([[caching, 3]])); // the snapshot's count is the island's, both threads
});
