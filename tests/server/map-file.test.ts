// The map file over the API: GET /api/map, POST /api/map. The terminal's half is tests/cli/map-file.test.ts.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait } from "../../src/core/repositories/straitRepository.ts";
import { startServer } from "../../src/server/index.ts";

let dir: string;
let dbPath: string;
let server: ReturnType<typeof startServer>;
let base: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-map-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>map</title>");
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const d = upsertDomain(db, { slug: "caching", name: "Caching" });
  const a = upsertIsland(db, { domainId: d.id, slug: "eviction", name: "Eviction", sortOrder: 1 });
  const b = upsertIsland(db, { domainId: d.id, slug: "warming", name: "Warming", sortOrder: 2 });
  upsertStrait(db, { domainId: d.id, fromIslandId: a.id, toIslandId: b.id });
  db.close();
  server = startServer({ port: 0, dbPath, staticRoot: dir, stub: true });
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const FILE = { archipelago: 1, name: "Caching", slug: "caching", islands: [{ slug: "eviction", name: "Eviction" }, { slug: "warming", name: "Warming" }], straits: [{ from: "eviction", to: "warming" }] };
const post = async (body: unknown) => {
  const res = await fetch(`${base}/api/map`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};

test("GET /api/map is the domain as a file, and POST /api/map makes a new domain from one", async () => {
  const got = await fetch(`${base}/api/map?domain=caching`);
  expect([got.status, await got.json()]).toEqual([200, FILE]);
  expect((await fetch(`${base}/api/map?domain=nowhere`)).status).toBe(404);
  const made = await post(FILE);
  expect(made).toMatchObject({ status: 200, json: { domain: { slug: "caching-2", name: "Caching" }, islands: 2, straits: 1, seas: 0 } });
  const domains = (await (await fetch(`${base}/api/domains`)).json()) as any;
  expect(domains.domains.map((d: any) => d.slug).sort()).toEqual(["caching", "caching-2"]);
});

test("POST /api/map refuses what is not a map with a 400 and the reason", async () => {
  const refused = await post({ ...FILE, straits: [{ from: "eviction", to: "nowhere" }] });
  expect(refused.status).toBe(400);
  expect(refused.json.error).toContain('names "nowhere"');
  expect((await post({ hello: "world" })).status).toBe(400);
});
