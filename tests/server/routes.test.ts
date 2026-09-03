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
  server = startServer({ port: 0, dbPath, staticRoot: dir });
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

  const ok = await post("/api/comment", { domain: "sd", targetType: "island", targetId: "caching", body: "hello", kind: "note" });
  expect(ok.status).toBe(200);
  expect(ok.json.comment.kind).toBe("note");
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
