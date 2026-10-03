import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addVerdict } from "../../src/core/repositories/verdictRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import { setLandmarks, unlockLandmark, exploreLandmark } from "../../src/core/repositories/landmarkRepository.ts";
import { addCard } from "../../src/core/repositories/boardRepository.ts";
import { setLearnerNote } from "../../src/core/repositories/learnerRepository.ts";
import { islandContext } from "../../src/server/judge/tools.ts";
import { renderLearner } from "../../src/server/judge/context.ts";
import { renderJudgeContext, renderMentorContext, renderMentorThreadPrompt } from "../../src/server/judge/persona.ts";

let dir: string;
let dbPath: string;
let ids: { sd: number; caching: number };
const proposal = (claim: string, status: string) =>
  JSON.stringify({ target: "island:queues", claim, consequence: "UI work deadlocks", evidence: "q", confidence: 0.8, rationale: "r", status });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-mentor-"));
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const sd = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  const caching = upsertIsland(db, { domainId: sd, slug: "caching", name: "Caching", summary: "Hot data close." }).id;
  const databases = upsertIsland(db, { domainId: sd, slug: "databases", name: "Databases", summary: "Rows and indexes." }).id;
  addVerdict(db, { targetType: "island", targetId: databases, state: "settled", confidence: 0.9, evidence: "rows" });
  const ios = upsertDomain(db, { slug: "ios", name: "iOS" }).id;
  const memory = upsertIsland(db, { domainId: ios, slug: "memory", name: "Memory management", summary: "ARC and retain cycles." }).id;
  setLandmarks(db, ios, memory, [{ slug: "arc", name: "ARC" }, { slug: "cycles", name: "Retain cycles" }]);
  unlockLandmark(db, memory, "arc", "ARC counts references", null);
  addVerdict(db, { targetType: "island", targetId: memory, state: "mountainous", confidence: 0.9, evidence: "weak breaks the cycle" });
  const networking = upsertIsland(db, { domainId: ios, slug: "networking", name: "Networking" }).id;
  addVerdict(db, { targetType: "island", targetId: networking, state: "sandbar", confidence: 0.6, evidence: "URLSession" });
  const threads = upsertIsland(db, { domainId: ios, slug: "threads", name: "Threads" }).id;
  addVerdict(db, { targetType: "island", targetId: threads, state: "mountainous", confidence: 0.8, evidence: "x" });
  addVerdict(db, { targetType: "island", targetId: threads, state: "sandbar", confidence: 0.6, evidence: "a later probe" }); // latest wins
  const queues = upsertIsland(db, { domainId: ios, slug: "queues", name: "Queues" }).id;
  addMessage(db, { domainId: ios, islandId: queues, role: "judge", kind: "reef_proposal", body: proposal("the main queue is a thread", "confirmed") });
  addMessage(db, { domainId: ios, islandId: queues, role: "judge", kind: "reef_proposal", body: proposal("a pending claim", "pending") });
  const swiftui = upsertIsland(db, { domainId: ios, slug: "swiftui", name: "SwiftUI" }).id;
  setLandmarks(db, ios, swiftui, [{ slug: "state", name: "State" }]);
  exploreLandmark(db, swiftui, "state", "q", null); // explored only: never ground
  db.close();
  ids = { sd, caching };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const mentorDeps = () => ({ dbPath, domain: "sd", island: "caching", mode: "mentor" as const });

test("the learner block: solid ground only, mountainous first, confirmed reefs to avoid, and the note", () => {
  const db = openDatabase(dbPath);
  setLearnerNote(db, "iOS engineer.\nI think in UIKit.");
  db.close();
  const ctx = islandContext(mentorDeps());
  expect(ctx.learner!.ground.map((g) => [g.domain, g.island, g.state])).toEqual([
    ["iOS", "Memory management", "mountainous"], ["System Design", "Databases", "settled"],
  ]);
  expect(ctx.learner!.ground[0]!.lit).toEqual(["ARC"]);
  expect(ctx.learner!.reefs).toEqual([{ domain: "iOS", island: "Queues", claim: "the main queue is a thread" }]);
  const text = renderMentorContext(ctx);
  expect(text.startsWith("## The learner")).toBe(true);
  expect(text).toContain("Note: iOS engineer.\n  I think in UIKit.");
  expect(text).toContain("- iOS › Memory management (mountainous): ARC and retain cycles. — lit: ARC");
  expect(text).toContain("- System Design › Databases (settled): Rows and indexes.");
  expect(text).toContain("- iOS › Queues: the main queue is a thread");
  for (const absent of ["Networking", "Threads", "SwiftUI", "a pending claim"]) expect(text).not.toContain(absent);
  expect(islandContext({ dbPath, domain: "sd", island: "caching" }).learner).toBeNull(); // the judge never gets it
});

test("ground is capped at 40, newest verdict first within a state, and the note at 1000 characters", () => {
  const db = openDatabase(dbPath);
  const bulk = upsertDomain(db, { slug: "bulk", name: "Bulk" }).id;
  for (let n = 1; n <= 45; n++) {
    const id = upsertIsland(db, { domainId: bulk, slug: `i-${n}`, name: `Island ${n}` }).id;
    addVerdict(db, { targetType: "island", targetId: id, state: "settled", confidence: 0.8, evidence: "e" });
  }
  db.run("update learner set note = ?", ["n".repeat(1200)]); // past the validator, as an older row could be
  db.close();
  const ctx = islandContext(mentorDeps());
  expect(ctx.learner!.ground).toHaveLength(40);
  expect(ctx.learner!.ground[0]!.island).toBe("Memory management");
  expect(ctx.learner!.ground[1]!.island).toBe("Island 45");
  expect(ctx.learner!.ground.at(-1)!.island).toBe("Island 7");
  const text = renderMentorContext(ctx);
  expect(text).toContain(`Note: ${"n".repeat(1000)}\n`);
  expect(text).not.toContain("n".repeat(1001));
});

test("with no ground and no note, the block says to use an everyday analogy and say so", () => {
  const text = renderLearner({ note: "", ground: [], reefs: [] }).join("\n");
  expect(text).toContain("Note: none");
  expect(text).toContain("Ground: none yet — use an everyday analogy and say so.");
  expect(text).toContain("Avoid building on: none");
  expect(text).toContain("Exploring is not demonstrating");
});

test("the mentor's island block: landmarks explored or not, the next unexplored, its own thread, and the board", () => {
  const db = openDatabase(dbPath);
  setLandmarks(db, ids.sd, ids.caching, [{ slug: "invalidation", name: "Invalidation" }, { slug: "eviction", name: "Eviction" }]);
  addMessage(db, { domainId: ids.sd, islandId: ids.caching, role: "judge", kind: "text", body: "Judge secret question" });
  addMessage(db, { domainId: ids.sd, islandId: ids.caching, role: "mentor", kind: "text", body: "Here the coastline has two points.", mode: "mentor" });
  const said = addMessage(db, { domainId: ids.sd, islandId: ids.caching, role: "you", kind: "text", body: "eviction is NSCache dropping things", mode: "mentor" });
  exploreLandmark(db, ids.caching, "eviction", "NSCache dropping things", said.id);
  addCard(db, { domainId: ids.sd, islandId: ids.caching, kind: "note", title: "Analogy", body: "a pantry by the stove", author: "mentor" });
  db.close();
  const ctx = islandContext(mentorDeps());
  expect(ctx.thread.map((m) => m.role)).toEqual(["mentor", "you"]);
  const text = renderMentorContext(ctx);
  expect(text).toContain("# This island");
  expect(text).toContain("Landmarks (1 of 2 explored):");
  expect(text).toContain('- Eviction (eviction): explored — "NSCache dropping things"');
  expect(text).toContain("- Invalidation (invalidation): unexplored");
  expect(text).toContain("Nearest unexplored, in order: invalidation");
  expect(text).toContain('note "Analogy" [mentor');
  expect(text).not.toContain("Judge secret");
  expect(text).not.toContain("Round:");
  expect(renderMentorThreadPrompt(ctx.thread, ctx.asks).split("\n")).toEqual([
    "Mentor: Here the coastline has two points.", "Reader: eviction is NSCache dropping things", "", "Continue as the mentor.",
  ]);
  expect(renderMentorThreadPrompt([])).toBe("Open the session on this island: the coastline, one analogy, and where to start.");
  const db2 = openDatabase(dbPath);
  exploreLandmark(db2, ids.caching, "invalidation", "x", null);
  db2.close();
  expect(renderMentorContext(islandContext(mentorDeps()))).toContain("Every landmark is explored: hand off to the judge in one line (§7).");
});

test("the mentor's board names the judge's cards judge, the word MENTOR.md uses; the judge's own board still says keeper", () => {
  const db = openDatabase(dbPath);
  addCard(db, { domainId: ids.sd, islandId: ids.caching, kind: "note", title: "Claim", body: "the reader said so", author: "judge" });
  db.close();
  const text = renderMentorContext(islandContext(mentorDeps()));
  expect(text).toContain('note "Claim" [judge, new since your last reply]');
  expect(text).not.toContain("keeper");
  expect(renderJudgeContext(islandContext({ dbPath, domain: "sd", island: "caching" }))).toContain('note "Claim" [keeper, new since your last reply]');
});
