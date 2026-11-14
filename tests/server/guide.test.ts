// The guide: the mentor before any island, one thread per domain, pointing the reader at an island and a lens.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server/index.ts";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { setHarbour, upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import { setLandmarks } from "../../src/core/repositories/landmarkRepository.ts";
import { parseSse } from "./sse.ts";
import { guide, personaFor } from "../../src/server/judge/persona.ts";
import { readProtocol } from "../../src/server/judge/protocol.ts";
import { createApiRunner, type OpenStream } from "../../src/server/judge/api.ts";
import { runTool } from "../../src/server/judge/tools.ts";
import { buildGuideContext, renderGuideContext, renderGuideThreadPrompt } from "../../src/server/judge/guide.ts";

let dir: string;
let dbPath: string;
let server: ReturnType<typeof startServer>;
let base: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-guide-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>map</title>");
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const d = upsertDomain(db, { slug: "vim", name: "Neovim", description: "Moving from VS Code." });
  const modes = upsertIsland(db, { domainId: d.id, slug: "modes", name: "Modes", summary: "Normal, insert, visual.", sortOrder: 1 });
  const grammar = upsertIsland(db, { domainId: d.id, slug: "grammar", name: "Editing grammar", sortOrder: 2 });
  upsertIsland(db, { domainId: d.id, slug: "operators", name: "Operators", parentId: grammar.id, sortOrder: 1 });
  setLandmarks(db, d.id, modes.id, ["normal", "insert", "visual", "escape"].map((slug) => ({ slug, name: slug })));
  setHarbour(db, d.id, "grammar");
  addMessage(db, { domainId: d.id, islandId: modes.id, role: "you", kind: "text", body: "hjkl?", mode: "mentor" });
  upsertDomain(db, { slug: "empty", name: "Empty" });
  db.close();
  server = startServer({ port: 0, dbPath, staticRoot: dir, stub: true });
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string) => (await fetch(base + path)).json() as Promise<any>;
const post = async (path: string, body: unknown) => {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text.startsWith("{") ? JSON.parse(text) : null, events: res.headers.get("content-type")?.startsWith("text/event-stream") ? parseSse(text) : [] };
};
const ask = (body: object = {}) => post("/api/probe", { domain: "vim", mode: "guide", ...body });

test("the guide opens with a question, then points at the harbour with a card that rides on its reply", async () => {
  const opening = await ask();
  expect(opening.events.map((e: any) => e.type)).toEqual(["text", "done"]);
  const turn = await ask({ message: "I'm new to this" });
  expect(turn.events.map((e: any) => e.type)).toEqual(["progress", "text", "done"]);
  const t = await get("/api/thread?domain=vim&mode=guide");
  expect(t.island).toBeNull();
  expect(t.messages.map((m: any) => [m.role, m.mode, m.islandId])).toEqual([["mentor", "guide", null], ["you", "guide", null], ["mentor", "guide", null]]);
  expect(t.pointers).toHaveLength(1);
  expect(t.pointers[0]).toMatchObject({ islandId: null, messageId: t.messages[2].id, island: { slug: "grammar", name: "Editing grammar", scale: null }, lens: "mentor", question: null });
  // The island threads are untouched: the guide's thread is the domain's own.
  expect((await get("/api/thread?domain=vim&island=modes&mode=mentor")).messages).toHaveLength(1);
});

test("the guide suggests the Keeper when the reader wants to be tested, and carries a question when asked to", async () => {
  await ask({ message: "test me, what is a text object?" });
  const [p] = (await get("/api/thread?domain=vim&mode=guide")).pointers;
  expect(p).toMatchObject({ lens: "judge", question: "test me, what is a text object?" });
});

test("the guide never takes an island or a pick; its lock is its own, apart from the islands'", async () => {
  expect((await ask({ island: "modes" })).status).toBe(400);
  expect((await ask({ message: "x", askId: 1 })).status).toBe(400);
  // A guide turn and an island turn run side by side.
  const [a, b] = await Promise.all([ask({ message: "hello" }), post("/api/probe", { domain: "vim", island: "modes", mode: "mentor" })]);
  expect([a.status, b.status]).toEqual([200, 200]);
});

test("on a map with no islands the guide says so and points nowhere", async () => {
  await post("/api/probe", { domain: "empty", mode: "guide", message: "where do I start?" });
  const t = await get("/api/thread?domain=empty&mode=guide");
  expect(t.messages.at(-1).body).toContain("no islands yet");
  expect(t.pointers).toEqual([]);
});

test("the guide persona: GUIDE.md, two tools, the whole map with where the reader has been", () => {
  expect(personaFor("guide")).toBe(guide);
  expect([...guide.toolNames]).toEqual(["guide_context", "suggest_island"]);
  expect(readProtocol(guide)).toContain("# The mentor, before an island");
  const db = openDatabase(dbPath);
  const ctx = buildGuideContext(db, "vim");
  db.close();
  expect(ctx.islands.map((i) => [i.slug, i.harbour, i.started])).toEqual([["modes", false, { judge: 0, mentor: 1 }], ["grammar", true, { judge: 0, mentor: 0 }]]);
  const text = renderGuideContext(ctx);
  expect(text).toContain("- Modes (modes): open water; 0 of 4 landmarks lit, 0 explored; 1 messages with the mentor.");
  expect(text).toContain("- Editing grammar (grammar) [harbour]: open water; no landmarks yet; not started.");
  expect(text).toContain("Islets: Operators (operators, open water)");
  expect(text).toContain("Moving from VS Code.");
  expect(renderGuideThreadPrompt([])).toContain("Open the guide");
});

test("suggest_island refuses an island that is not there, a lens that is not one, and a carry with nothing to carry", async () => {
  const run = (input: object) => JSON.parse(runTool(guide, { dbPath, domain: "vim" }, "suggest_island", input).content[0]!.text);
  expect(run({ island: "nowhere", why: "x", lens: "mentor" }).error).toContain("nowhere");
  expect(run({ island: "modes", why: "x", lens: "teacher" }).error).toContain("lens");
  expect(run({ island: "modes", why: "x", lens: "mentor", carry: true }).error).toContain("no");
  expect(run({ island: "operators", why: "where the verbs are", lens: "judge" })).toMatchObject({ island: "operators", lens: "judge" });
  // Unattached until a reply stores it: the thread shows none yet.
  expect((await get("/api/thread?domain=vim&mode=guide")).pointers).toEqual([]);
  // The guide has no island tools.
  expect(JSON.parse(runTool(guide, { dbPath, domain: "vim" }, "mark_explored", {}).content[0]!.text).error).toContain("no tool named mark_explored for the guide");
});

test("the API runner gives the guide exactly its two tools and its protocol", async () => {
  const requests: any[] = [];
  const open: OpenStream = (params) => {
    requests.push(params);
    const message =
      requests.length === 1
        ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "suggest_island", input: { island: "grammar", why: "start here", lens: "mentor" } }] }
        : { stop_reason: "end_turn", content: [{ type: "text", text: "Start with Editing grammar." }] };
    return { on: () => undefined, finalMessage: async () => message as any };
  };
  const runner = createApiRunner({ toolbox: { context: (persona, deps) => persona.buildContext(deps), run: runTool }, openStream: open, model: "m", effort: "high" });
  await runner({ dbPath, domain: "vim", mode: "guide", emit: () => undefined });
  expect(requests[0].tools.map((t: any) => t.name)).toEqual(["guide_context", "suggest_island"]);
  expect(requests[0].system[0].text).toContain("# The mentor, before an island");
  expect(JSON.parse(requests[1].messages[2].content[0].content[0].text)).toMatchObject({ island: "grammar", lens: "mentor" });
});
