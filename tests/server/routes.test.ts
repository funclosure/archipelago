import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server/index.ts";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait } from "../../src/core/repositories/straitRepository.ts";
import { addVerdict } from "../../src/core/repositories/verdictRepository.ts";
import { addAsk } from "../../src/core/repositories/askRepository.ts";
import { parseSse } from "./sse.ts";
import type { JudgeRunner } from "../../src/server/judge/runner.ts";

let dir: string;
let server: ReturnType<typeof startServer>;
let base: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-srv-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>map</title>");
  const dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id });
  addVerdict(db, { targetType: "island", targetId: a.id, state: "settled", confidence: 0.9, evidence: "q" });
  db.close();
  server = startServer({ port: 0, dbPath, staticRoot: dir, stub: true });
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, json: await res.json() };
};
const post = async (path: string, body: unknown) => {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};
const probe = async (body: unknown) => {
  const res = await fetch(base + "/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if ((res.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
    return { status: res.status, events: parseSse(await res.text()), json: null as any };
  }
  return { status: res.status, events: [] as ReturnType<typeof parseSse>, json: await res.json() };
};
const thread = async (island: string) => (await get(`/api/thread?domain=sd&island=${island}`)).json;
const islandView = async (slug: string) => (await get("/api/snapshot?domain=sd")).json.islands.find((i: any) => i.slug === slug);

test("domains, version, snapshot", async () => {
  expect((await get("/api/domains")).json.domains.map((d: any) => d.slug)).toEqual(["sd"]);
  const v1 = (await get("/api/version?domain=sd")).json.version;
  expect(v1).toBeGreaterThan(0);
  const snap = (await get("/api/snapshot?domain=sd")).json;
  expect(snap.islands.map((i: any) => i.slug)).toEqual(["caching", "databases"]);
  expect(snap.nearestOpenWater).toEqual(["databases"]);
  expect((await get("/api/snapshot?domain=sd&scale=caching")).json.islands).toEqual([]);
});

test("focus and comment write rows and bump the version", async () => {
  const v1 = (await get("/api/version?domain=sd")).json.version;
  const focus = await post("/api/focus", { domain: "sd", island: "caching" });
  expect(focus.status).toBe(200);
  expect(focus.json.focus).toBe("caching");
  expect(focus.json.version).toBe(v1 + 1);
  const comment = await post("/api/comment", { domain: "sd", targetType: "strait", targetId: "databases~caching", body: "", kind: "probe_me" });
  expect(comment.status).toBe(200);
  expect(comment.json.comment.kind).toBe("probe_me");
  expect(comment.json.version).toBe(v1 + 2);
  const snap = (await get("/api/snapshot?domain=sd")).json;
  expect(snap.focus).toBe("caching");
  expect(snap.unreadComments).toBe(1);
});

test("history for the island card", async () => {
  const res = await get("/api/history?domain=sd&target=island:caching");
  expect(res.status).toBe(200);
  expect(res.json.history).toHaveLength(1);
  expect(res.json.history[0].state).toBe("settled");
});

test("errors map to status codes with { error }", async () => {
  expect((await get("/api/snapshot?domain=nope")).status).toBe(404);
  expect((await get("/api/snapshot?domain=nope")).json).toEqual({ error: 'no domain "nope"', valid: ["sd"] });
  expect((await post("/api/comment", { domain: "sd", targetType: "island", targetId: "caching", kind: "shout" })).status).toBe(400);
  expect((await post("/api/focus", { domain: "sd", island: "nope" })).status).toBe(404);
  expect((await get("/api/nothing")).status).toBe(404);
});

test("cross-site POSTs are rejected", async () => {
  const evil = await fetch(base + "/api/comment", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ domain: "sd", targetType: "island", targetId: "caching", body: "hi", kind: "note" }),
  });
  expect(evil.status).toBe(403);
  expect(await evil.json()).toEqual({ error: "cross-origin writes are not allowed" });

  const wrongType = await fetch(base + "/api/comment", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ domain: "sd", targetType: "island", targetId: "caching", body: "hi", kind: "note" }),
  });
  expect(wrongType.status).toBe(415);
  expect(await wrongType.json()).toEqual({ error: "expected application/json" });

  // The page's own requests carry the server's origin; both localhost spellings must match the URL port.
  for (const origin of [base, base.replace("127.0.0.1", "localhost")]) {
    const ok = await fetch(base + "/api/comment", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ domain: "sd", targetType: "island", targetId: "caching", body: "hello", kind: "note" }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).comment.kind).toBe("note");
  }
});

test("positions persist as a batch and reject unknown slugs whole", async () => {
  const v1 = (await get("/api/version?domain=sd")).json.version;
  const ok = await post("/api/positions", { domain: "sd", positions: [{ island: "caching", x: 100, y: 200 }, { island: "databases", x: 300, y: 400 }] });
  expect(ok.status).toBe(200);
  expect(ok.json).toEqual({ written: 2, version: v1 + 2 });
  const snap = (await get("/api/snapshot?domain=sd")).json;
  expect(snap.islands.find((i: any) => i.slug === "databases")).toMatchObject({ x: 300, y: 400 });

  const bad = await post("/api/positions", { domain: "sd", positions: [{ island: "caching", x: 1, y: 1 }, { island: "nope", x: 2, y: 2 }] });
  expect(bad.status).toBe(404);
  expect(bad.json).toEqual({ error: 'no island "nope" in this domain', valid: ["caching", "databases"] });
  expect((await get("/api/snapshot?domain=sd")).json.islands.find((i: any) => i.slug === "caching")).toMatchObject({ x: 100, y: 200 });
  expect((await get("/api/version?domain=sd")).json.version).toBe(v1 + 2);

  expect((await post("/api/positions", { domain: "sd", positions: [{ island: "caching", x: 5000, y: 1 }] })).status).toBe(400);
  expect((await post("/api/positions", { domain: "sd", positions: [] })).status).toBe(400);
  const foreign = await fetch(base + "/api/positions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ domain: "sd", positions: [{ island: "caching", x: 1, y: 1 }] }),
  });
  expect(foreign.status).toBe(403);
});

test("static files are served fresh and traversal is blocked", async () => {
  const res = await fetch(base + "/");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-cache");
  expect(await res.text()).toContain("map");
  expect((await fetch(base + "/../package.json")).status).toBe(404);
  expect((await fetch(base + "/missing.js")).status).toBe(404);
  expect((await fetch(base + "/%E0%A4%A")).status).toBe(404);
  expect((await fetch(base + "/%00")).status).toBe(404);
});

test("probe opens a thread: the judge asks first, the reply is stored, the stream ends with done", async () => {
  const v1 = (await get("/api/version?domain=sd")).json.version;
  const r = await probe({ domain: "sd", island: "databases" });
  expect(r.status).toBe(200);
  expect(r.events.map((e) => e.type)).toEqual(["progress", "text", "done"]);
  expect(r.events[0]!.data.message).toBe("set_landmarks");
  expect(r.events[1]!.data.text).toContain("Databases");
  const t = await thread("databases");
  expect(t.island).toBe("databases");
  expect(t.messages.map((m: any) => [m.role, m.kind])).toEqual([["judge", "text"]]);
  expect(t.messages[0].body).toBe(r.events[1]!.data.text);
  // Four landmark inserts on this landmark-less island, plus the judge's stored message.
  expect((await get("/api/version?domain=sd")).json.version).toBe(v1 + 5);
  expect((await islandView("databases")).messages).toBe(1);
});

test("a settling message writes the verdict, the system line, then the reply", async () => {
  const r = await probe({ domain: "sd", island: "databases", message: "I'd say this one is settled" });
  expect(r.events.map((e) => e.type)).toEqual(["progress", "text", "done"]);
  expect(r.events[0]!.data.message).toBe("record_verdict");
  const t = await thread("databases");
  expect(t.messages.map((m: any) => [m.role, m.kind])).toEqual([["you", "text"], ["judge", "system"], ["judge", "text"]]);
  expect(t.messages[1].body).toBe("charted as settled");
  expect((await islandView("databases")).verdict.state).toBe("settled");
});

test("a reef is proposed, then confirmed or disputed by the reader", async () => {
  await probe({ domain: "sd", island: "databases", message: "reef: indexes make every write faster" });
  const proposal = (await thread("databases")).messages.find((m: any) => m.kind === "reef_proposal");
  expect(JSON.parse(proposal.body)).toMatchObject({ target: "island:databases", status: "pending" });
  expect((await islandView("databases")).verdict).toBeNull();

  const confirm = await post("/api/probe/reef", { domain: "sd", id: proposal.id, answer: "confirm" });
  expect(confirm.status).toBe(200);
  expect(confirm.json).toMatchObject({ id: proposal.id, status: "confirmed" });
  expect((await islandView("databases")).verdict.state).toBe("reef");
  const after = await thread("databases");
  expect(after.messages.at(-1)).toMatchObject({ role: "judge", kind: "system", body: "charted as reef" });
  expect(JSON.parse(after.messages.find((m: any) => m.id === proposal.id).body).status).toBe("confirmed");
  expect((await post("/api/probe/reef", { domain: "sd", id: proposal.id, answer: "dispute" })).status).toBe(409);
  expect((await post("/api/probe/reef", { domain: "sd", id: 999, answer: "confirm" })).status).toBe(404);
  expect((await post("/api/probe/reef", { domain: "sd", id: proposal.id, answer: "maybe" })).status).toBe(400);

  await probe({ domain: "sd", island: "caching", message: "reef: caches never go stale" });
  const p2 = (await thread("caching")).messages.find((m: any) => m.kind === "reef_proposal");
  const dispute = await post("/api/probe/reef", { domain: "sd", id: p2.id, answer: "dispute", note: "I never said never" });
  expect(dispute.json.status).toBe("disputed");
  const caching = await thread("caching");
  expect(caching.messages.at(-1)).toMatchObject({ role: "you", kind: "text", body: "I never said never" });
  expect(JSON.parse(caching.messages.find((m: any) => m.id === p2.id).body).status).toBe("disputed");
  expect((await islandView("caching")).verdict.state).toBe("settled");
});

test("a runner failure streams one error and stores no judge message", async () => {
  const r = await probe({ domain: "sd", island: "databases", message: "please fail" });
  expect(r.events.map((e) => e.type)).toEqual(["error"]);
  expect(r.events[0]!.data.message).toBe("stub failure");
  expect((await thread("databases")).messages.map((m: any) => m.role)).toEqual(["you"]);
});

test("ARCHIPELAGO_STUB=1 selects the stub runner through startServer when no stub option is passed", async () => {
  const prevEnv = process.env.ARCHIPELAGO_STUB;
  process.env.ARCHIPELAGO_STUB = "1";
  let envServer: ReturnType<typeof startServer> | undefined;
  try {
    envServer = startServer({ port: 0, dbPath: join(dir, "test.sqlite"), staticRoot: dir });
    const envBase = `http://127.0.0.1:${envServer.port}`;
    const res = await fetch(envBase + "/api/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "sd", island: "databases" }),
    });
    expect(res.status).toBe(200);
    const events = parseSse(await res.text());
    expect(events.map((e) => e.type)).toEqual(["progress", "text", "done"]);
    expect(events[1]!.data.text).toContain("Databases");
  } finally {
    if (prevEnv === undefined) delete process.env.ARCHIPELAGO_STUB;
    else process.env.ARCHIPELAGO_STUB = prevEnv;
    envServer?.stop(true);
  }
});

test("a second turn on the same island while one runs is 409, and the lock clears afterwards", async () => {
  let release!: () => void;
  const slow: JudgeRunner = ({ emit }) =>
    new Promise((resolve) => {
      release = () => {
        emit({ type: "text", text: "late" });
        resolve("late");
      };
    });
  const other = startServer({ port: 0, dbPath: join(dir, "test.sqlite"), staticRoot: dir, runner: slow });
  const otherBase = `http://127.0.0.1:${other.port}`;
  const start = () =>
    fetch(otherBase + "/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "databases" }) });
  try {
    const first = await start();
    expect(first.status).toBe(200);
    const second = await start();
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "the Keeper is answering on this island; try again when it ends" });
    release();
    expect(await first.text()).toContain("event: done");
    const third = await start();
    expect(third.status).toBe(200);
    release();
    await third.text();
  } finally {
    release?.();
    other.stop(true);
  }
});

test("a turn that never answers times out, releases the island, and stores nothing", async () => {
  let aborted = false;
  const hung: JudgeRunner = ({ signal }) =>
    new Promise<string>((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      });
    });
  const other = startServer({ port: 0, dbPath: join(dir, "test.sqlite"), staticRoot: dir, runner: hung, turnTimeoutMs: 50 });
  const otherBase = `http://127.0.0.1:${other.port}`;
  const start = () =>
    fetch(otherBase + "/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "databases" }) });
  try {
    const first = await start();
    expect(first.status).toBe(200);
    const events = parseSse(await first.text());
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0]!.data.message).toBe(`the judge did not answer within ${50 / 1000} s`);
    expect(aborted).toBe(true);
    const second = await start(); // the lock is released, not wedged until restart
    expect(second.status).toBe(200);
    await second.text();
    expect((await thread("databases")).messages).toEqual([]);
  } finally {
    other.stop(true);
  }
});

test("the outline lists the whole tree", async () => {
  const r = await get("/api/outline?domain=sd");
  expect(r.status).toBe(200);
  expect(r.json.domain.slug).toBe("sd");
  expect(r.json.islands.map((i: any) => [i.slug, i.state, i.scale])).toEqual([["caching", "settled", null], ["databases", "open", null]]);
  expect(r.json.charted).toBe(1);
  expect((await get("/api/outline?domain=nope")).status).toBe(404);
});

test("an ask attaches to the reply, shows in the thread, is picked through probe once", async () => {
  // the stub asks on the second answer
  await probe({ domain: "sd", island: "databases" });
  await probe({ domain: "sd", island: "databases", message: "one" });
  const r = await probe({ domain: "sd", island: "databases", message: "two" });
  expect(r.status).toBe(200);
  const t = await thread("databases");
  expect(t.asks).toHaveLength(1);
  const ask = t.asks[0];
  expect(ask.picked).toBeNull();
  expect(ask.messageId).toBe(t.messages.at(-1).id);
  expect(t.messages.at(-1).body).toBe("Stub check: which of these is true?");
  const pick = await probe({ domain: "sd", island: "databases", message: "the first option", askId: ask.id });
  expect(pick.status).toBe(200);
  const after = await thread("databases");
  expect(after.asks[0].picked).toBe("the first option");
  const again = await probe({ domain: "sd", island: "databases", message: "the second option", askId: ask.id });
  expect(again.status).toBe(409);
  const missing = await probe({ domain: "sd", island: "databases", askId: ask.id });
  expect(missing.status).toBe(400);
  expect((await probe({ domain: "sd", island: "databases", message: "x", askId: 999 })).status).toBe(404);
  // an ask picked from another island's pane is not found there
  expect((await probe({ domain: "sd", island: "caching", message: "x", askId: ask.id })).status).toBe(404);
});

test("an ask orphaned from an earlier turn never attaches to a later reply", async () => {
  const dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  const islandId = upsertIsland(db, { domainId, slug: "databases", name: "Databases" }).id;
  const orphan = addAsk(db, { domainId, islandId, question: "Orphaned: which resource saturates first?", options: ["CPU", "Memory"] });
  db.close();
  const r = await probe({ domain: "sd", island: "databases", message: "hello" });
  expect(r.status).toBe(200);
  const t = await thread("databases");
  expect(t.asks.find((a: any) => a.id === orphan.id)?.messageId).toBeNull();
  expect(t.messages.some((m: any) => m.body === orphan.question)).toBe(false);
});

test("thread and probe errors, and the cross-site guard on probe", async () => {
  expect((await get("/api/thread?domain=sd&island=nope")).status).toBe(404);
  expect((await get("/api/thread?domain=sd&island=nope")).json).toEqual({ error: 'no island "nope" in this domain', valid: ["caching", "databases"] });
  expect((await probe({ domain: "sd", island: "nope" })).status).toBe(404);
  expect((await probe({ domain: "sd", island: "caching", message: "   " })).status).toBe(400);
  const evil = await fetch(base + "/api/probe", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ domain: "sd", island: "caching" }),
  });
  expect(evil.status).toBe(403);
  const wrongType = await fetch(base + "/api/probe", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  expect(wrongType.status).toBe(415);
});

test("mermaid is served from the vendor route", async () => {
  const r = await fetch(`${base}/vendor/mermaid.js`);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("javascript");
  expect((await r.text()).length).toBeGreaterThan(100000);
});

test("the oniguruma wasm is served beside the bundle as application/wasm", async () => {
  const r = await fetch(`${base}/vendor/onig.wasm`);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("application/wasm");
  expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(400000);
});

test("shiki is bundled and served from the vendor route with an ETag", async () => {
  const r = await fetch(`${base}/vendor/shiki.js`);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("javascript");
  const etag = r.headers.get("etag");
  expect(etag).toMatch(/^"[0-9a-f]+"$/);
  const body = await r.text();
  expect(body.length).toBeGreaterThan(500000);
  expect(body).toContain("createHighlighterCore");
  expect(body).toContain("createOnigurumaEngine");
  const again = await fetch(`${base}/vendor/shiki.js`, { headers: { "if-none-match": etag! } });
  expect(again.status).toBe(304);
  expect(await again.text()).toBe("");
});

test("function-plot is bundled and served from the vendor route with an ETag", async () => {
  const r = await fetch(`${base}/vendor/plot.js`);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("javascript");
  const etag = r.headers.get("etag");
  expect(etag).toMatch(/^"[0-9a-f]+"$/);
  const body = await r.text();
  expect(body.length).toBeGreaterThan(100000);
  expect(body).toContain("functionPlot");
  const again = await fetch(`${base}/vendor/plot.js`, { headers: { "if-none-match": etag! } });
  expect(again.status).toBe(304);
  expect(await again.text()).toBe("");
});

test("the board is read and written through /api/board; reader writes leave no thread message", async () => {
  expect((await get("/api/board?domain=sd&island=caching")).json).toEqual({ island: "caching", cards: [] });
  const v0 = (await get("/api/version?domain=sd")).json.version;
  const add = await post("/api/board", { domain: "sd", island: "caching", op: "add", kind: "diagram", title: "Request path", body: "flowchart TB\n  a --> b", lang: "swift" });
  expect(add.status).toBe(200);
  expect(add.json.card).toMatchObject({ kind: "diagram", title: "Request path", author: "you", lang: null });
  expect(add.json.version).toBe(v0 + 1);
  const id = add.json.card.id;
  const upd = await post("/api/board", { domain: "sd", island: "caching", op: "update", id, title: "Path" });
  expect(upd.json.card).toMatchObject({ id, title: "Path", body: "flowchart TB\n  a --> b" });
  expect((await get("/api/board?domain=sd&island=caching")).json.cards.map((c: any) => c.title)).toEqual(["Path"]);
  expect((await thread("caching")).messages).toEqual([]);
  expect((await post("/api/board", { domain: "sd", island: "databases", op: "remove", id })).status).toBe(404);
  expect((await post("/api/board", { domain: "sd", island: "caching", op: "add", kind: "note", title: "t", body: " " })).status).toBe(400);
  expect((await post("/api/board", { domain: "sd", island: "caching", op: "update", id })).status).toBe(400);
  const rm = await post("/api/board", { domain: "sd", island: "caching", op: "remove", id });
  expect(rm.json).toMatchObject({ removed: id, title: "Path" });
  expect((await get("/api/board?domain=sd&island=caching")).json.cards).toEqual([]);
  expect((await get("/api/board?domain=sd&island=nope")).status).toBe(404);
});

test("a reader who leaves mid-turn aborts the runner and frees the island", async () => {
  let aborted = false;
  const hung: JudgeRunner = ({ signal }) =>
    new Promise<string>((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      });
    });
  const other = startServer({ port: 0, dbPath: join(dir, "test.sqlite"), staticRoot: dir, runner: hung });
  const otherBase = `http://127.0.0.1:${other.port}`;
  const client = new AbortController();
  try {
    const res = await fetch(otherBase + "/api/probe", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "databases" }), signal: client.signal,
    });
    expect(res.status).toBe(200);
    client.abort();
    for (let i = 0; i < 50 && !aborted; i++) await Bun.sleep(20);
    expect(aborted).toBe(true);
    await Bun.sleep(20);
    const again = await fetch(otherBase + "/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "databases" }) });
    expect(again.status).toBe(200);
    again.body?.cancel();
  } finally {
    other.stop(true);
  }
});

test("after a timeout the island stays locked until the runner has actually stopped", async () => {
  let settled = false;
  const slowToStop: JudgeRunner = ({ signal }) =>
    new Promise<string>((resolve) => {
      signal?.addEventListener("abort", () => setTimeout(() => { settled = true; resolve(""); }, 150));
    });
  const other = startServer({ port: 0, dbPath: join(dir, "test.sqlite"), staticRoot: dir, runner: slowToStop, turnTimeoutMs: 50 });
  const otherBase = `http://127.0.0.1:${other.port}`;
  try {
    const first = await fetch(otherBase + "/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "databases" }) });
    const events = parseSse(await first.text()); // the stream closes only once the lock is released
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(settled).toBe(true);
  } finally {
    other.stop(true);
  }
});

test("a reef cannot be confirmed while a turn is running on its island", async () => {
  await probe({ domain: "sd", island: "databases", message: "reef: indexes make every write faster" });
  const proposal = (await thread("databases")).messages.find((m: any) => m.kind === "reef_proposal");
  let release!: () => void;
  const slow: JudgeRunner = () => new Promise((resolve) => { release = () => resolve("ok"); });
  const other = startServer({ port: 0, dbPath: join(dir, "test.sqlite"), staticRoot: dir, runner: slow });
  const otherBase = `http://127.0.0.1:${other.port}`;
  const postTo = (path: string, body: unknown) =>
    fetch(otherBase + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const turn = await postTo("/api/probe", { domain: "sd", island: "databases", message: "more" });
    const confirm = await postTo("/api/probe/reef", { domain: "sd", id: proposal.id, answer: "confirm" });
    expect(confirm.status).toBe(409);
    expect(await confirm.json()).toEqual({ error: "a turn is running on this island; answer when it ends" });
    release();
    await turn.text();
    expect((await postTo("/api/probe/reef", { domain: "sd", id: proposal.id, answer: "confirm" })).status).toBe(200);
  } finally {
    release?.();
    other.stop(true);
  }
});

test("a read through a rebinding hostname is refused", async () => {
  const { handleRequest } = await import("../../src/server/routes.ts");
  const req = new Request(base + "/api/domains", { headers: { host: "evil.example" } });
  const res = await handleRequest(req, { dbPath: join(dir, "test.sqlite"), staticRoot: dir, runner: async () => "", turnTimeoutMs: 1000 });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "unknown host" });
  const okRes = await fetch(base.replace("127.0.0.1", "localhost") + "/api/domains");
  expect(okRes.status).toBe(200);
});

test("/api/learner reads and writes the one learner note; the write reaches every domain's map", async () => {
  expect((await get("/api/learner")).json).toMatchObject({ note: "" });
  const v0 = (await get("/api/version?domain=sd")).json.version;
  const set = await post("/api/learner", { note: "  iOS engineer; memory management is solid  " });
  expect(set.status).toBe(200);
  expect(set.json.note).toBe("iOS engineer; memory management is solid");
  expect((await get("/api/learner")).json.note).toBe("iOS engineer; memory management is solid");
  expect((await get("/api/version?domain=sd")).json.version).toBe(v0 + 1);
  const long = await post("/api/learner", { note: "x".repeat(1001) });
  expect(long.status).toBe(400);
  expect(long.json).toEqual({ error: "note: a note is at most 1000 characters" });
});

const mentorThread = async (island: string) => (await get(`/api/thread?domain=sd&island=${island}&mode=mentor`)).json;

test("mode passes through: a mentor turn writes the mentor thread only, and an explored landmark reaches the snapshot", async () => {
  const opening = await probe({ domain: "sd", island: "databases", mode: "mentor" });
  expect(opening.status).toBe(200);
  expect(opening.events.map((e) => e.type)).toEqual(["progress", "text", "done"]);
  expect(opening.events[1]!.data.text).toContain("Where do you want to start?");
  const r = await probe({ domain: "sd", island: "databases", mode: "mentor", message: "so it is a ledger: explore shape" });
  expect(r.events[0]!.data.message).toBe("mark_explored");
  const t = await mentorThread("databases");
  expect(t.mode).toBe("mentor");
  expect(t.messages.map((m: any) => [m.role, m.kind, m.mode])).toEqual([
    ["mentor", "text", "mentor"], ["you", "text", "mentor"], ["mentor", "system", "mentor"], ["mentor", "text", "mentor"],
  ]);
  expect(t.messages[2].body).toBe("landmark explored: Shape");
  const judgeThread = await thread("databases");
  expect(judgeThread.mode).toBe("judge");
  expect(judgeThread.messages).toEqual([]);
  const view = await islandView("databases");
  expect(view.landmarks.explored).toBe(1);
  expect(view.landmarks.unlocked).toBe(0);
  expect(view.landmarks.items.find((l: any) => l.slug === "shape").exploredAt).not.toBeNull();
  expect(view.verdict).toBeNull(); // the mentor never writes one
  expect((await get("/api/thread?domain=sd&island=databases&mode=tutor")).status).toBe(400);
  expect((await probe({ domain: "sd", island: "databases", mode: "tutor" })).status).toBe(400);
});

test("one turn per island across both modes: a mentor turn makes a judge turn 409", async () => {
  let release!: () => void;
  const seen: (string | undefined)[] = [];
  const slow: JudgeRunner = ({ mode }) => {
    seen.push(mode);
    return new Promise((resolve) => {
      release = () => resolve("ok");
    });
  };
  const other = startServer({ port: 0, dbPath: join(dir, "test.sqlite"), staticRoot: dir, runner: slow });
  const otherBase = `http://127.0.0.1:${other.port}`;
  const start = (mode: string) =>
    fetch(otherBase + "/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "databases", mode }) });
  try {
    const mentorTurn = await start("mentor");
    expect(mentorTurn.status).toBe(200);
    const judgeTurn = await start("judge");
    expect(judgeTurn.status).toBe(409);
    expect(await judgeTurn.json()).toEqual({ error: "the mentor is answering on this island; try again when it ends" });
    release();
    expect(await mentorTurn.text()).toContain("event: done");
    expect(seen).toEqual(["mentor"]);
    expect((await mentorThread("databases")).messages.map((m: any) => [m.role, m.mode, m.body])).toEqual([["mentor", "mentor", "ok"]]);
    expect((await thread("databases")).messages).toEqual([]);
  } finally {
    release?.();
    other.stop(true);
  }
});

test("an ask in the judge's thread is not pickable from the mentor's pane, nor listed there", async () => {
  // the judge stub asks on the second answer
  await probe({ domain: "sd", island: "databases" });
  await probe({ domain: "sd", island: "databases", message: "one" });
  await probe({ domain: "sd", island: "databases", message: "two" });
  const ask = (await thread("databases")).asks[0];
  expect(ask.messageId).not.toBeNull();
  const wrong = await probe({ domain: "sd", island: "databases", mode: "mentor", message: "the first option", askId: ask.id });
  expect(wrong.status).toBe(404);
  expect(wrong.json).toEqual({ error: `no ask ${ask.id} in the mentor thread of island:databases` });
  expect((await mentorThread("databases")).asks).toEqual([]);
  expect((await thread("databases")).asks[0].picked).toBeNull();
});

test("a mentor turn that asks: the reply is stored as the mentor's and the ask attaches in the mentor thread", async () => {
  const dbPath = join(dir, "test.sqlite");
  const asking: JudgeRunner = async ({ domain, island }) => {
    const db = openDatabase(dbPath);
    const d = upsertDomain(db, { slug: domain, name: "System Design" });
    const i = upsertIsland(db, { domainId: d.id, slug: island, name: "Databases" });
    addAsk(db, { domainId: d.id, islandId: i.id, question: "Which sounds closer?", options: ["a ledger", "a pantry"] });
    db.close();
    return "Let me check where you are.";
  };
  const other = startServer({ port: 0, dbPath, staticRoot: dir, runner: asking });
  const otherBase = `http://127.0.0.1:${other.port}`;
  try {
    const res = await fetch(otherBase + "/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "databases", mode: "mentor" }) });
    expect(await res.text()).toContain("event: done");
  } finally {
    other.stop(true);
  }
  const mt = await mentorThread("databases");
  expect(mt.messages.map((m: any) => [m.role, m.mode])).toEqual([["mentor", "mentor"]]);
  expect(mt.asks).toHaveLength(1);
  expect(mt.asks[0].messageId).toBe(mt.messages[0].id);
  const jt = await thread("databases");
  expect(jt.messages).toEqual([]);
  expect(jt.asks).toEqual([]);
});
