import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addVerdict, latestVerdict, verdictHistory, latestVerdicts } from "../../src/core/repositories/verdictRepository.ts";

let db: Database;
let islandId: number;
let otherId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  const domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  islandId = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
  otherId = upsertIsland(db, { domainId, slug: "queues", name: "Queues" }).id;
});

test("verdicts append and the latest wins", () => {
  addVerdict(db, { targetType: "island", targetId: islandId, state: "reef", confidence: 0.7, evidence: "TTL always fixes it" });
  addVerdict(db, { targetType: "island", targetId: islandId, state: "settled", confidence: 0.9, evidence: "explained invalidation" });
  expect(latestVerdict(db, "island", islandId)?.state).toBe("settled");
  expect(verdictHistory(db, "island", islandId).map((v) => v.state)).toEqual(["settled", "reef"]);
});

test("open water is absence: no row means null", () => {
  expect(latestVerdict(db, "island", islandId)).toBeNull();
  expect(latestVerdicts(db, "island", [islandId, otherId]).size).toBe(0);
});

test("latestVerdicts maps only charted targets", () => {
  addVerdict(db, { targetType: "island", targetId: islandId, state: "sandbar", confidence: 0.6, evidence: "roughly right" });
  addVerdict(db, { targetType: "island", targetId: islandId, state: "mountainous", confidence: 0.95, evidence: "edge case handled" });
  const map = latestVerdicts(db, "island", [islandId, otherId]);
  expect(map.get(islandId)?.state).toBe("mountainous");
  expect(map.has(otherId)).toBe(false);
});

test("state and confidence are constrained by the schema", () => {
  expect(() =>
    addVerdict(db, { targetType: "island", targetId: islandId, state: "open" as never, confidence: 0.5, evidence: "x" }),
  ).toThrow();
});
