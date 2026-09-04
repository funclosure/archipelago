import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { latestVerdict } from "../../src/core/repositories/verdictRepository.ts";
import { addMessage, listMessages } from "../../src/core/repositories/messageRepository.ts";
import { listLandmarks } from "../../src/core/repositories/landmarkRepository.ts";
import { stubRunner } from "../../src/server/judge/stub.ts";
import { createRunner, type JudgeEvent } from "../../src/server/judge/runner.ts";

let dir: string;
let dbPath: string;
let domainId: number;
let caching: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-stub-"));
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  caching = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
  db.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function turn(lastMessage?: string) {
  if (lastMessage) {
    const db = openDatabase(dbPath);
    addMessage(db, { domainId, islandId: caching, role: "you", kind: "text", body: lastMessage });
    db.close();
  }
  const events: JudgeEvent[] = [];
  const reply = await stubRunner({ dbPath, domain: "sd", island: "caching", emit: (e) => events.push(e) });
  return { events, reply };
}

test("an empty thread gets an opening question", async () => {
  const { events, reply } = await turn();
  expect(reply).toContain("Caching");
  expect(events).toEqual([{ type: "progress", message: "set_landmarks" }, { type: "text", text: reply }]);
});

test("first open on a landmark-less island sets four canned landmarks; 'unlock <slug>' lights one", async () => {
  const opening = await turn();
  expect(opening.events[0]).toEqual({ type: "progress", message: "set_landmarks" });
  expect(opening.reply).toContain("shape");
  const db = openDatabase(dbPath);
  expect(listLandmarks(db, caching).map((l) => l.slug)).toEqual(["shape", "scale", "failure", "tradeoff"]);
  db.close();
  const { events } = await turn("here is how, unlock scale");
  expect(events[0]).toEqual({ type: "progress", message: "unlock_landmark" });
  const db2 = openDatabase(dbPath);
  expect(listLandmarks(db2, caching).find((l) => l.slug === "scale")?.unlockedAt).not.toBeNull();
  expect(listMessages(db2, caching).at(-1)).toMatchObject({ kind: "system", body: "landmark lit: Scale" });
  db2.close();
});

test("'settled' records a verdict through the real tool", async () => {
  const { events } = await turn("I think this one is settled");
  expect(events[0]).toEqual({ type: "progress", message: "record_verdict" });
  const db = openDatabase(dbPath);
  expect(latestVerdict(db, "island", caching)?.state).toBe("settled");
  expect(listMessages(db, caching).map((m) => m.kind)).toEqual(["text", "system"]);
  db.close();
});

test("'reef' proposes and writes no verdict; 'fail' throws", async () => {
  const { events } = await turn("a reef: caches never go stale");
  expect(events[0]).toEqual({ type: "progress", message: "propose_reef" });
  const db = openDatabase(dbPath);
  expect(latestVerdict(db, "island", caching)).toBeNull();
  expect(listMessages(db, caching).map((m) => m.kind)).toEqual(["text", "reef_proposal"]);
  db.close();
  await expect(turn("please fail")).rejects.toThrow("stub failure");
});

test("createRunner(true) is the stub", () => {
  expect(createRunner(true)).toBe(stubRunner);
});
