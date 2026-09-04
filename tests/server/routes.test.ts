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
  expect(r.events.map((e) => e.type)).toEqual(["text", "done"]);
  expect(r.events[0]!.data.text).toContain("Databases");
  const t = await thread("databases");
  expect(t.island).toBe("databases");
  expect(t.messages.map((m: any) => [m.role, m.kind])).toEqual([["judge", "text"]]);
  expect(t.messages[0].body).toBe(r.events[0]!.data.text);
  expect((await get("/api/version?domain=sd")).json.version).toBe(v1 + 1);
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
    expect(await second.json()).toEqual({ error: "a turn is already running for this island" });
    release();
    expect(await first.text()).toContain("event: done");
    const third = await start();
    expect(third.status).toBe(200);
    release();
    await third.text();
  } finally {
    other.stop(true);
  }
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
