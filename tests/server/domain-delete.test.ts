// Deleting a domain: everything charted in it goes, every other domain stays, and the terminal can do the same.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { removeDomain, upsertDomain, listDomains } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { setLandmarks } from "../../src/core/repositories/landmarkRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import { addSea } from "../../src/core/repositories/seaRepository.ts";
import { proposeSketch } from "../../src/core/repositories/sketchRepository.ts";
import { startServer } from "../../src/server/index.ts";

let dir: string;
let dbPath: string;
let server: ReturnType<typeof startServer>;
let base: string;

/** Two domains with something in every kind of table, so a cascade that misses one shows. */
function seed() {
  const db = openDatabase(dbPath);
  for (const slug of ["gone", "kept"]) {
    const d = upsertDomain(db, { slug, name: slug });
    const isl = upsertIsland(db, { domainId: d.id, slug: `${slug}-a`, name: "A" });
    upsertIsland(db, { domainId: d.id, slug: `${slug}-b`, name: "B", parentId: isl.id });
    setLandmarks(db, d.id, isl.id, ["w", "x", "y", "z"].map((s) => ({ slug: s, name: s })));
    addMessage(db, { domainId: d.id, islandId: isl.id, role: "you", kind: "text", body: "hi" });
    addSea(db, { domainId: d.id, parentIslandId: null, name: "Sea", x: 0, y: 0 });
    proposeSketch(db, d.id, isl.id, { updates: [{ slug: `${slug}-b`, summary: "s" }] });
  }
  db.close();
}

/** Rows that still belong to a domain, in every table with a domain_id column. */
function leftovers(slug: string): Record<string, number> {
  const db = openDatabase(dbPath);
  const tables = db.query<{ name: string }, []>("select name from sqlite_master where type = 'table' and sql like '%domain_id%'").all();
  const id = db.query<{ id: number }, [string]>("select id from domains where slug = ?").get(slug)?.id ?? -1;
  const ids = db.query<{ id: number }, []>("select id from domains").all().map((d) => d.id);
  const out: Record<string, number> = {};
  for (const { name } of tables) {
    const n = db.query<{ n: number }, []>(`select count(*) as n from ${name} where domain_id not in (${ids.join(",") || "-1"})`).get()!.n;
    if (n) out[name] = n;
  }
  out.own = id === -1 ? 0 : 1;
  db.close();
  return out;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-del-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>map</title>");
  dbPath = join(dir, "test.sqlite");
  seed();
  server = startServer({ port: 0, dbPath, staticRoot: dir, stub: true });
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const post = async (path: string, body: unknown) => {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};

test("deleting a domain removes everything in it and nothing in the others", async () => {
  expect((await post("/api/domains/delete", { domain: "gone" })).json).toEqual({ removed: "gone" });
  expect(leftovers("gone")).toEqual({ own: 0 });
  const db = openDatabase(dbPath);
  expect(listDomains(db).map((d) => d.slug)).toEqual(["kept"]);
  expect(db.query<{ n: number }, []>("select count(*) as n from islands").get()!.n).toBe(2);
  expect(db.query<{ n: number }, []>("select count(*) as n from seas").get()!.n).toBe(1);
  db.close();
});

test("deleting a domain that is not there is a 404", async () => {
  expect((await post("/api/domains/delete", { domain: "nope" })).status).toBe(404);
});

test("removeDomain is what the terminal's domain remove runs", () => {
  const db = openDatabase(dbPath);
  removeDomain(db, "kept");
  expect(listDomains(db).map((d) => d.slug)).toEqual(["gone"]);
  db.close();
});
