import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server/index.ts";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { parseSse } from "./sse.ts";
import type { JudgeRunner } from "../../src/server/judge/runner.ts";
import { cartographer, personaFor } from "../../src/server/judge/persona.ts";
import { readProtocol } from "../../src/server/judge/protocol.ts";
import { createApiRunner, type OpenStream } from "../../src/server/judge/api.ts";
import { runTool } from "../../src/server/judge/tools.ts";
import { buildChartContext, renderChartContext } from "../../src/server/judge/chart.ts";

let dir: string;
let dbPath: string;
let server: ReturnType<typeof startServer>;
let base: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-chart-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>map</title>");
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  upsertDomain(db, { slug: "sd", name: "System Design" });
  db.close();
  server = startServer({ port: 0, dbPath, staticRoot: dir, stub: true });
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string) => (await fetch(base + path)).json() as Promise<any>;
const post = async (path: string, body: unknown, at = base) => {
  const res = await fetch(at + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text.startsWith("{") ? JSON.parse(text) : null, events: res.headers.get("content-type")?.startsWith("text/event-stream") ? parseSse(text) : [] };
};
const chart = (body: object) => post("/api/probe", { domain: "sd", mode: "cartographer", ...body });

test("POST /api/domains makes a domain from a name; a taken slug is 409", async () => {
  const made = await post("/api/domains", { name: "Swift Concurrency" });
  expect(made.status).toBe(200);
  expect(made.json.domain).toMatchObject({ slug: "swift-concurrency", name: "Swift Concurrency" });
  expect((await post("/api/domains", { name: "Swift  concurrency!" })).status).toBe(409);
  expect((await post("/api/domains", { name: "Café Ops", slug: "ops" })).json.domain.slug).toBe("ops");
  expect((await post("/api/domains", { name: "???" })).status).toBe(400);
});

test("a cartographer turn at the top scale proposes a sketch that rides on its reply; nothing reaches the map yet", async () => {
  const turn = await chart({ message: "Sketch System Design." });
  expect(turn.status).toBe(200);
  expect(turn.events.map((e: any) => e.type)).toEqual(["progress", "text", "done"]);
  const t = await get("/api/thread?domain=sd&mode=cartographer");
  expect(t.island).toBeNull();
  expect(t.messages.map((m: any) => [m.role, m.mode, m.islandId])).toEqual([["you", "cartographer", null], ["cartographer", "cartographer", null]]);
  expect(t.sketch.body.islands.map((i: any) => i.slug)).toEqual(["foundations", "tools", "patterns", "failure-modes", "trade-offs", "practice"]);
  expect(t.sketch.messageId).toBe(t.messages[1].id);
  expect((await get("/api/snapshot?domain=sd")).islands).toEqual([]);
});

test("approving the sketch draws it; the thread says so; discarding a second one leaves the map alone", async () => {
  await chart({ message: "Sketch it." });
  const { sketch } = await get("/api/thread?domain=sd&mode=cartographer");
  const approved = await post("/api/sketch", { domain: "sd", sketchId: sketch.id, action: "approve" });
  expect(approved.status).toBe(200);
  expect(approved.json).toMatchObject({ islands: 6, straits: 5, harbour: "foundations" });
  expect((await get("/api/snapshot?domain=sd")).islands.map((i: any) => i.slug)).toHaveLength(6);
  expect((await post("/api/sketch", { domain: "sd", sketchId: sketch.id, action: "approve" })).status).toBe(409);

  await chart({ message: "rename the first one" });
  const second = (await get("/api/thread?domain=sd&mode=cartographer")).sketch;
  expect(second.body.updates).toEqual([{ slug: "foundations", summary: "Foundations, as the reader asked." }]);
  expect((await post("/api/sketch", { domain: "sd", sketchId: second.id, action: "discard" })).json.sketch.status).toBe("discarded");
  const t = await get("/api/thread?domain=sd&mode=cartographer");
  expect(t.sketch).toBeNull();
  expect(t.messages.filter((m: any) => m.kind === "system").map((m: any) => m.body)).toEqual(["sketch approved: 6 islands, 5 straits, 2 seas, harbour foundations", "sketch discarded"]);
});

test("sailing closer: the cartographer at an island's scale proposes islets in that island's thread", async () => {
  const db = openDatabase(dbPath);
  upsertIsland(db, { domainId: 1, slug: "caching", name: "Caching" });
  db.close();
  const turn = await chart({ island: "caching", message: "Sail closer." });
  expect(turn.events.at(-1)?.type).toBe("done");
  const t = await get("/api/thread?domain=sd&mode=cartographer&island=caching");
  expect(t.island).toBe("caching");
  expect(t.sketch.body.islands.map((i: any) => i.slug)).toEqual(["caching-basics", "caching-mechanics", "caching-edge-cases", "caching-in-practice"]);
  expect((await get("/api/thread?domain=sd&mode=cartographer")).messages).toEqual([]);
  // a sketch is decided at its own scale only
  expect((await post("/api/sketch", { domain: "sd", sketchId: t.sketch.id, action: "approve" })).status).toBe(404);
  expect((await post("/api/sketch", { domain: "sd", island: "caching", sketchId: t.sketch.id, action: "approve" })).status).toBe(200);
  expect((await get("/api/snapshot?domain=sd&scale=caching")).islands).toHaveLength(4);
});

test("the judge and the mentor still need an island; the cartographer takes no picks", async () => {
  expect((await post("/api/probe", { domain: "sd", mode: "judge" })).status).toBe(400);
  expect((await chart({ message: "x", askId: 1 })).status).toBe(400);
});

test("the cartographer at an island's scale shares the island's lock with the judge", async () => {
  const db = openDatabase(dbPath);
  upsertIsland(db, { domainId: 1, slug: "caching", name: "Caching" });
  db.close();
  let release!: () => void;
  const slow: JudgeRunner = () => new Promise((resolve) => (release = () => resolve("ok")));
  const other = startServer({ port: 0, dbPath, staticRoot: dir, runner: slow });
  const at = `http://127.0.0.1:${other.port}`;
  try {
    const sailing = fetch(at + "/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "caching", mode: "cartographer" }) });
    const first = await sailing;
    expect(first.status).toBe(200);
    const judgeTurn = await post("/api/probe", { domain: "sd", island: "caching" }, at);
    expect(judgeTurn.status).toBe(409);
    expect(judgeTurn.json.error).toBe("the cartographer is answering on this island; try again when it ends");
    // a sketch at a scale is decided only when no turn is running there
    expect((await post("/api/sketch", { domain: "sd", island: "caching", sketchId: 1, action: "discard" }, at)).status).toBe(409);
    release();
    expect(await first.text()).toContain("event: done");
  } finally {
    release?.();
    other.stop(true);
  }
});

test("the cartographer persona: CARTOGRAPHER.md, two tools, its own context", () => {
  expect(personaFor("cartographer")).toBe(cartographer);
  expect([...cartographer.toolNames]).toEqual(["chart_context", "propose_sketch"]);
  expect(readProtocol(cartographer)).toContain("# The cartographer");
  const db = openDatabase(dbPath);
  const ctx = buildChartContext(db, "sd");
  db.close();
  expect(ctx).toMatchObject({ mode: "cartographer", scale: null, islands: [], limits: [6, 10], pending: null });
  expect(renderChartContext(ctx)).toContain("The next sketch here adds 6–10 new islands.");
});

test("the API runner gives the cartographer exactly its two tools and its protocol, with no island at the top scale", async () => {
  const requests: any[] = [];
  const open: OpenStream = (params) => {
    requests.push(params);
    const message =
      requests.length === 1
        ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "propose_sketch", input: { islands: Array.from({ length: 6 }, (_, i) => ({ slug: `s${i}`, name: `S${i}`, summary: "x", landmarks: ["a", "b", "c", "d"].map((l) => ({ slug: l, name: l })) })) } }] }
        : { stop_reason: "end_turn", content: [{ type: "text", text: "Approve it?" }] };
    return { on: () => undefined, finalMessage: async () => message as any };
  };
  const runner = createApiRunner({ toolbox: { context: (persona, deps) => persona.buildContext(deps), run: runTool }, openStream: open, model: "m", effort: "high" });
  await runner({ dbPath, domain: "sd", mode: "cartographer", emit: () => undefined });
  expect(requests[0].tools.map((t: any) => t.name)).toEqual(["chart_context", "propose_sketch"]);
  expect(requests[0].system[0].text).toContain("# The cartographer");
  expect(requests[0].messages[0].content).toBe("Sketch this scale.");
  const result = JSON.parse(requests[1].messages[2].content[0].content[0].text);
  expect(result).toMatchObject({ islands: 6 });
  expect((await get("/api/thread?domain=sd&mode=cartographer")).sketch.body.islands).toHaveLength(6);
});
