// Loose ends: noted by either persona with the reader's words, read by both, closed by either or dismissed by the reader.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { setLandmarks } from "../../src/core/repositories/landmarkRepository.ts";
import { addMessage, listMessages } from "../../src/core/repositories/messageRepository.ts";
import { listLooseEnds } from "../../src/core/repositories/looseEndRepository.ts";
import { buildSnapshot } from "../../src/core/view-model.ts";
import { islandContext, looseEnd, runTool } from "../../src/server/judge/tools.ts";
import { cartographer, judge, mentor, renderJudgeContext, renderMentorContext } from "../../src/server/judge/persona.ts";
import { startServer } from "../../src/server/index.ts";

let dir: string;
let dbPath: string;
let ids: { domain: number; island: number };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-loose-"));
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const domain = upsertDomain(db, { slug: "rn", name: "React Native" }).id;
  const island = upsertIsland(db, { domainId: domain, slug: "mental-model", name: "React mental model" }).id;
  setLandmarks(db, domain, island, [
    { slug: "declarative", name: "Declarative vs imperative UI" },
    { slug: "state", name: "State and re-rendering" },
    { slug: "reconciliation", name: "Reconciliation and keys" },
    { slug: "data-flow", name: "One-way data flow" },
  ]);
  db.close();
  ids = { domain, island };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const deps = { get dbPath() { return dbPath; }, domain: "rn", island: "mental-model" };
const CONFUSED = "這行是我讀起來最困惑的，我知道這個是把useState 裡面兩個函式宣告給 array，而這樣寫只是一個convention 對嗎";

function say(mode: "judge" | "mentor", body: string) {
  const db = openDatabase(dbPath);
  addMessage(db, { domainId: ids.domain, islandId: ids.island, role: "you", kind: "text", body, mode });
  db.close();
}

const open = (author: "judge" | "mentor", over: Record<string, unknown> = {}) =>
  looseEnd(deps, { op: "open", kind: "confused", landmark: "state", note: "以為 useState 回傳兩個函式", evidence: "把useState 裡面兩個函式宣告給 array", ...over }, author);

test("the mentor notes one from the reader's words in its thread, tied to a landmark, with one line there", () => {
  say("mentor", CONFUSED);
  const out = open("mentor");
  expect(out.open).toBe(1);
  expect(out.looseEnd).toMatchObject({ kind: "confused", note: "以為 useState 回傳兩個函式", author: "mentor", closedAt: null });
  const db = openDatabase(dbPath);
  expect(listMessages(db, ids.island, "mentor").at(-1)!.body).toBe("loose end: 以為 useState 回傳兩個函式");
  expect(listMessages(db, ids.island, "judge")).toEqual([]);
  db.close();
});

test("the quote must be verbatim, recognisable, and from this persona's own thread; the landmark must exist", () => {
  say("mentor", CONFUSED);
  expect(() => open("mentor", { evidence: "useState returns two functions" })).toThrow(/verbatim/);
  expect(() => open("mentor", { evidence: "兩個函式" })).toThrow(/at least two words/);
  expect(() => open("mentor", { landmark: "hooks" })).toThrow(/no landmark "hooks"/);
  expect(() => open("judge")).toThrow(/no reader message in this thread/);
  expect(() => open("mentor", { note: "two\nlines" })).toThrow(/one line/);
});

test("an island holds at most six open; a note about the whole island has no landmark", () => {
  say("mentor", CONFUSED);
  for (let i = 0; i < 6; i++) open("mentor", { landmark: null, kind: "later" });
  expect(() => open("mentor")).toThrow(/6 open loose ends/);
});

test("both personas read it: the judge as the mentor's, never as evidence; the mentor as its own", () => {
  say("mentor", CONFUSED);
  open("mentor");
  const judgeText = renderJudgeContext(islandContext(deps));
  expect(judgeText).toContain("Loose ends (1 open; the reader's words, never evidence for a lit landmark or a verdict).");
  expect(judgeText).toMatch(/- #\d+ confused · State and re-rendering · noted by the mentor: 以為 useState 回傳兩個函式 — the reader: "把useState 裡面兩個函式宣告給 array"/);
  expect(judgeText).toContain("§11");
  const mentorText = renderMentorContext(islandContext({ ...deps, mode: "mentor" }));
  expect(mentorText).toContain("noted by you");
  expect(mentorText).toContain("§10");
});

test("the judge closes the mentor's with an answer in its own thread; a second close is refused", () => {
  say("mentor", CONFUSED);
  const id = open("mentor").looseEnd.id;
  say("judge", "useState 回傳的是 [值, setter]，中括號是 JavaScript 的陣列解構，名字我自己取");
  const closed = looseEnd(deps, { op: "close", id, evidence: "中括號是 JavaScript 的陣列解構" }, "judge");
  expect(closed).toMatchObject({ open: 0, looseEnd: { closedBy: "judge", closedEvidence: "中括號是 JavaScript 的陣列解構" } });
  const db = openDatabase(dbPath);
  expect(listMessages(db, ids.island, "judge").at(-1)!.body).toBe("loose end closed: 以為 useState 回傳兩個函式");
  db.close();
  expect(() => looseEnd(deps, { op: "close", id, evidence: "中括號是 JavaScript 的陣列解構" }, "judge")).toThrow(/already closed/);
  expect(renderJudgeContext(islandContext(deps))).not.toContain("Loose ends");
});

test("the tool is both personas', never the cartographer's", () => {
  expect(judge.toolNames).toContain("loose_end");
  expect(mentor.toolNames).toContain("loose_end");
  const refused = runTool(cartographer, deps, "loose_end", {});
  expect(refused.isError).toBe(true);
});

test("the snapshot carries the open ones with their landmark's slug; the reader dismisses one through the route", async () => {
  say("mentor", CONFUSED);
  const a = open("mentor").looseEnd.id;
  open("mentor", { landmark: null, kind: "asked", note: "問了陣列為什麼不是物件" });
  const db = openDatabase(dbPath);
  const view = buildSnapshot(db, "rn", null).islands[0]!;
  db.close();
  expect(view.looseEnds.map((e) => [e.landmark, e.kind, e.author])).toEqual([["state", "confused", "mentor"], [null, "asked", "mentor"]]);

  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  const server = startServer({ port: 0, dbPath, staticRoot: dir, stub: true });
  try {
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${server.port}/api/loose-ends`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const res = await post({ domain: "rn", island: "mental-model", id: a });
    expect(res.status).toBe(200);
    expect((await res.json()).looseEnd).toMatchObject({ closedBy: "you", closedEvidence: null });
    expect((await post({ domain: "rn", island: "mental-model", id: a })).status).toBe(409);
    expect((await post({ domain: "rn", island: "mental-model", id: 999 })).status).toBe(404);
  } finally {
    server.stop(true);
  }
  const after = openDatabase(dbPath);
  expect(listLooseEnds(after, ids.island).map((e) => e.kind)).toEqual(["asked"]);
  expect(listMessages(after, ids.island, "mentor").filter((m) => m.body.startsWith("loose end closed"))).toEqual([]);
  after.close();
});
