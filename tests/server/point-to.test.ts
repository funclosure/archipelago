// point_to: a persona's "sail to" another island, riding on its reply and carrying the reader's question.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { listPointers } from "../../src/core/repositories/pointerRepository.ts";
import { islandContext, pointTo, runTool } from "../../src/server/judge/tools.ts";
import { cartographer, renderJudgeContext, renderMentorContext } from "../../src/server/judge/persona.ts";
import { startServer } from "../../src/server/index.ts";
import { parseSse } from "./sse.ts";

let dir: string;
let dbPath: string;
let caching: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-point-"));
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const domain = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  caching = upsertIsland(db, { domainId: domain, slug: "caching", name: "Caching", sortOrder: 1 }).id;
  const databases = upsertIsland(db, { domainId: domain, slug: "databases", name: "Databases", sortOrder: 2 }).id;
  upsertIsland(db, { domainId: domain, slug: "indexes", name: "Indexes", parentId: databases });
  db.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const deps = () => ({ dbPath, domain: "sd", island: "caching" });

test("both personas see every other island by scale, never this one", () => {
  const text = renderJudgeContext(islandContext(deps()));
  expect(text).toContain("Islands elsewhere in this domain (point_to takes the slug):");
  expect(text).toContain("- Top: Databases (databases)");
  expect(text).toContain("- Inside Databases: Indexes (indexes)");
  expect(text).not.toContain("Caching (caching)");
  expect(renderMentorContext(islandContext({ ...deps(), mode: "mentor" }))).toContain("- Inside Databases: Indexes (indexes)");
});

test("a pointer names another island at any scale, never this one or one that does not exist", () => {
  expect(pointTo(deps(), { island: "indexes", why: "Column order lives there." }, "mentor")).toMatchObject({ island: "indexes", name: "Indexes" });
  expect(() => pointTo(deps(), { island: "caching", why: "x" }, "mentor")).toThrow(/this island/);
  expect(() => pointTo(deps(), { island: "queues", why: "x" }, "mentor")).toThrow();
  expect(() => pointTo(deps(), { island: "indexes", why: "two\nlines" }, "mentor")).toThrow(/one line/);
  const db = openDatabase(dbPath);
  expect(listPointers(db, caching)).toMatchObject([{ messageId: null, island: { slug: "indexes", name: "Indexes", scale: "databases" }, why: "Column order lives there.", question: null }]);
  db.close();
  expect(runTool(cartographer, deps(), "point_to", { island: "indexes", why: "x" }).isError).toBe(true);
});

test("the route attaches the turn's pointer to the reply, with the reader's question, in that thread only", async () => {
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  const server = startServer({ port: 0, dbPath, staticRoot: dir, stub: true });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const probe = async (body: unknown) =>
      parseSse(await (await fetch(base + "/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).text());
    await probe({ domain: "sd", island: "caching", mode: "mentor" });
    const events = await probe({ domain: "sd", island: "caching", mode: "mentor", message: "how do I order index columns? asking elsewhere" });
    expect(events.some((e) => e.type === "progress" && e.data.message === "point_to")).toBe(true);
    const mentor = await (await fetch(`${base}/api/thread?domain=sd&island=caching&mode=mentor`)).json();
    const reply = mentor.messages.at(-1);
    expect(mentor.pointers).toMatchObject([{ messageId: reply.id, island: { slug: "databases" }, question: "how do I order index columns? asking elsewhere" }]);
    const judge = await (await fetch(`${base}/api/thread?domain=sd&island=caching&mode=judge`)).json();
    expect(judge.pointers).toEqual([]);
  } finally {
    server.stop(true);
  }
});

test("an opening's context ends with the page's language; once the reader writes, it does not", async () => {
  const { setLearnerLanguage } = await import("../../src/core/repositories/learnerRepository.ts");
  const { addMessage } = await import("../../src/core/repositories/messageRepository.ts");
  const db = openDatabase(dbPath);
  setLearnerLanguage(db, "zh-TW");
  db.close();
  const last = (text: string) => text.trimEnd().split("\n").at(-1);
  expect(last(renderMentorContext(islandContext({ ...deps(), mode: "mentor" })))).toBe(
    "No reader message yet: write this opening in Traditional Chinese (zh-TW, as written in Taiwan), the language of the reader's page.",
  );
  const db2 = openDatabase(dbPath);
  addMessage(db2, { domainId: 1, islandId: caching, role: "you", kind: "text", body: "hello", mode: "judge" });
  db2.close();
  expect(renderJudgeContext(islandContext(deps()))).not.toContain("No reader message yet");
});
