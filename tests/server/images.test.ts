// The reader's images over HTTP: upload, attach with a message in every kind of thread, read back, remove, prune.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server/index.ts";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { parseSse } from "./sse.ts";

const png = readFileSync(new URL("../core/fixtures/images/px.png", import.meta.url));
const webp = readFileSync(new URL("../core/fixtures/images/px-lossy.webp", import.meta.url));

let dir: string;
let dbPath: string;
let server: ReturnType<typeof startServer>;
let base: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-images-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>map</title>");
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const d = upsertDomain(db, { slug: "vim", name: "Vim" });
  upsertIsland(db, { domainId: d.id, slug: "modes", name: "Modes" });
  upsertDomain(db, { slug: "git", name: "Git" });
  db.close();
  server = startServer({ port: 0, dbPath, staticRoot: dir, stub: true });
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers });
const post = async (path: string, body: unknown) => {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text.startsWith("{") ? JSON.parse(text) : null, events: res.headers.get("content-type")?.startsWith("text/event-stream") ? parseSse(text) : [] };
};
const upload = async (bytes: Buffer, domain = "vim") => (await post("/api/images", { domain, data: bytes.toString("base64") })).json.image as { id: number; width: number; height: number };

test("an upload is checked by its bytes and answers with its id and size", async () => {
  expect(await upload(png)).toMatchObject({ width: 7, height: 5, removed: false });
  const svg = await post("/api/images", { domain: "vim", data: Buffer.from("<svg/>").toString("base64") });
  expect([svg.status, svg.json.error]).toEqual([400, expect.stringContaining("not an image")]);
  expect((await post("/api/images", { domain: "vim", data: "not base64!" })).status).toBe(400);
  // A write that is not JSON is refused before anything reads it, as every write is.
  const raw = await fetch(`${base}/api/images?domain=vim`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
  expect(raw.status).toBe(415);
});

test("a message carries its images in every kind of thread, and may be images alone", async () => {
  const [a, b] = [await upload(png), await upload(webp)];
  const turn = await post("/api/probe", { domain: "vim", island: "modes", mode: "mentor", images: [a.id, b.id] });
  expect(turn.status).toBe(200);
  const mentor = await (await get("/api/thread?domain=vim&island=modes&mode=mentor")).json();
  const mine = mentor.messages.find((m: any) => m.role === "you");
  expect(mine.body).toBe("");
  expect(mine.images).toEqual([{ id: a.id, width: 7, height: 5, removed: false }, { id: b.id, width: 7, height: 5, removed: false }]);
  expect(mentor.messages.filter((m: any) => m.role !== "you").every((m: any) => Array.isArray(m.images) && m.images.length === 0)).toBe(true);

  const c = await upload(png);
  await post("/api/probe", { domain: "vim", mode: "guide", message: "where do I start?", images: [c.id] });
  const guide = await (await get("/api/thread?domain=vim&mode=guide")).json();
  expect(guide.messages.find((m: any) => m.role === "you").images.map((i: any) => i.id)).toEqual([c.id]);

  const d = await upload(png);
  await post("/api/probe", { domain: "vim", mode: "cartographer", message: "my syllabus", images: [d.id] });
  const chart = await (await get("/api/thread?domain=vim&mode=cartographer")).json();
  expect(chart.messages.find((m: any) => m.role === "you").images.map((i: any) => i.id)).toEqual([d.id]);
});

test("a bad image id stores no message: another domain's, one already used, or a pick with images", async () => {
  const theirs = await upload(png, "git");
  const refused = await post("/api/probe", { domain: "vim", island: "modes", mode: "judge", message: "look", images: [theirs.id] });
  expect(refused.status).toBe(404);
  const used = await upload(png);
  await post("/api/probe", { domain: "vim", island: "modes", mode: "judge", message: "first", images: [used.id] });
  const again = await post("/api/probe", { domain: "vim", island: "modes", mode: "judge", message: "second", images: [used.id] });
  expect(again.status).toBe(409);
  const said = (await (await get("/api/thread?domain=vim&island=modes&mode=judge")).json()).messages.filter((m: any) => m.role === "you").map((m: any) => m.body);
  expect(said).toEqual(["first"]);
  expect((await post("/api/probe", { domain: "vim", island: "modes", mode: "judge", message: "a", askId: 1, images: [used.id] })).status).toBe(400);
  expect((await post("/api/probe", { domain: "vim", island: "modes", mode: "judge", images: [1, 2, 3, 4, 5] })).status).toBe(400);
});

test("an image reads back as its bytes with its type, never to another site or another domain", async () => {
  const a = await upload(webp);
  const res = await get(`/api/image?domain=vim&id=${a.id}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/webp");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(Buffer.from(await res.arrayBuffer()).equals(webp)).toBe(true);
  expect((await get(`/api/image?domain=vim&id=${a.id}`, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect((await get(`/api/image?domain=git&id=${a.id}`)).status).toBe(404);
  expect((await get(`/api/image?domain=vim&id=abc`)).status).toBe(400);
});

test("removing one leaves a mark in the thread; usage and prune report and free the space", async () => {
  const [a, b] = [await upload(png), await upload(webp)];
  await post("/api/probe", { domain: "vim", island: "modes", mode: "mentor", message: "two", images: [a.id, b.id] });
  expect(await (await get("/api/images/usage?domain=vim")).json()).toEqual({ count: 2, bytes: png.length + webp.length, removed: 0 });
  expect((await (await get("/api/images/usage?domain=vim&older=30,90")).json()).older).toEqual({ "30": { count: 0, bytes: 0 }, "90": { count: 0, bytes: 0 } });
  expect((await get("/api/images/usage?domain=vim&older=x")).status).toBe(400);
  expect((await post("/api/images/remove", { domain: "vim", ids: [a.id] })).json).toEqual({ removed: 1 });
  const mine = (await (await get("/api/thread?domain=vim&island=modes&mode=mentor")).json()).messages.find((m: any) => m.role === "you");
  expect(mine.images.map((i: any) => i.removed)).toEqual([true, false]);
  expect((await get(`/api/image?domain=vim&id=${a.id}`)).status).toBe(404);
  // Nothing is older than 30 days yet; then every one goes.
  expect((await post("/api/images/prune", { domain: "vim", olderThanDays: 30 })).json).toMatchObject({ removed: 0, bytes: 0 });
  expect((await post("/api/images/prune", { domain: "vim", olderThanDays: null })).json).toEqual({ removed: 1, bytes: webp.length, usage: { count: 0, bytes: 0, removed: 2 } });
});

test("the stub's turn still answers with images and no words", async () => {
  const a = await upload(png);
  const turn = await post("/api/probe", { domain: "vim", island: "modes", mode: "judge", images: [a.id] });
  expect(turn.events.at(-1)).toMatchObject({ type: "done" });
});
