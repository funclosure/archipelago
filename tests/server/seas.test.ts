// Seas: the reader's names on the water, per scale. Only the reader writes them (POST /api/seas, the CLI); the
// snapshot carries them, and the cartographer reads them with the islands nearest each name.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland, updateIsland } from "../../src/core/repositories/islandRepository.ts";
import { addSea, listSeas } from "../../src/core/repositories/seaRepository.ts";
import { islandRadius, seaMembers, REACH } from "../../src/core/seas.ts";
import { startServer } from "../../src/server/index.ts";
import { buildChartContext, renderChartContext } from "../../src/server/judge/chart.ts";
import { personaFor } from "../../src/server/judge/persona.ts";
// @ts-ignore: the page's plain JS modules, to check the two sides agree
import { seaMembers as webSeaMembers, REACH as WEB_REACH } from "../../src/web/sea-model.js";
// @ts-ignore
import { islandRadius as webIslandRadius } from "../../src/web/view-model.js";

let dir: string;
let dbPath: string;
let server: ReturnType<typeof startServer>;
let base: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-seas-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>map</title>");
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const d = upsertDomain(db, { slug: "rn", name: "React Native" });
  for (const [slug, x, y] of [["hooks", 100, 100], ["state", 200, 120], ["runtime", 900, 900]] as const) {
    upsertIsland(db, { domainId: d.id, slug, name: slug });
    updateIsland(db, d.id, slug, { x, y });
  }
  upsertIsland(db, { domainId: d.id, slug: "inner", name: "Inner", parentId: null });
  db.close();
  server = startServer({ port: 0, dbPath, staticRoot: dir, stub: true });
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const post = async (body: unknown) => {
  const res = await fetch(base + "/api/seas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const snapshot = async (scale?: string) => (await (await fetch(`${base}/api/snapshot?domain=rn${scale ? `&scale=${scale}` : ""}`)).json()) as any;

test("a sea is added, renamed, moved, and removed; each write bumps the version and shows in the snapshot", async () => {
  const v0 = (await snapshot()).version;
  const made = await post({ domain: "rn", op: "add", name: "  The React side ", x: 150, y: 20 });
  expect(made.status).toBe(200);
  expect(made.json.sea).toMatchObject({ name: "The React side", x: 150, y: 20, parentIslandId: null });
  expect(made.json.version).toBeGreaterThan(v0);
  const id = made.json.sea.id;
  expect((await snapshot()).seas).toEqual([{ id, name: "The React side", x: 150, y: 20 }]);
  expect((await post({ domain: "rn", op: "update", id, name: "React" })).json.sea).toMatchObject({ name: "React", x: 150, y: 20 });
  expect((await post({ domain: "rn", op: "update", id, x: -3000, y: 40 })).json.sea).toMatchObject({ name: "React", x: -3000, y: 40 }); // no edge
  expect((await post({ domain: "rn", op: "remove", id })).json.sea).toBeNull();
  expect((await snapshot()).seas).toEqual([]);
});

test("bad writes are refused with a sentence: no name, too long, a lone coordinate, an unknown sea or scale", async () => {
  expect((await post({ domain: "rn", op: "add", name: "  ", x: 0, y: 0 })).json.error).toContain("a sea needs a name");
  expect((await post({ domain: "rn", op: "add", name: "x".repeat(41), x: 0, y: 0 })).status).toBe(400);
  expect((await post({ domain: "rn", op: "add", name: "two\nlines", x: 0, y: 0 })).status).toBe(400);
  const id = (await post({ domain: "rn", op: "add", name: "Sea", x: 0, y: 0 })).json.sea.id;
  expect((await post({ domain: "rn", op: "update", id, x: 5 })).json.error).toContain("both x and y");
  expect((await post({ domain: "rn", op: "update", id: 999, name: "Nope" })).status).toBe(404);
  expect((await post({ domain: "rn", op: "add", island: "nowhere", name: "Sea", x: 0, y: 0 })).status).toBe(404);
});

test("seas belong to one scale: the top's are not the islets' of an island", async () => {
  await post({ domain: "rn", op: "add", name: "Top sea", x: 0, y: 0 });
  await post({ domain: "rn", op: "add", island: "inner", name: "Inner sea", x: 0, y: 0 });
  expect((await snapshot()).seas.map((s: any) => s.name)).toEqual(["Top sea"]);
  expect((await snapshot("inner")).seas.map((s: any) => s.name)).toEqual(["Inner sea"]);
});

test("the cartographer reads each sea with the islands nearest its name, and no persona has a tool for seas", async () => {
  await post({ domain: "rn", op: "add", name: "The React side", x: 150, y: 60 });
  await post({ domain: "rn", op: "add", name: "Far water", x: 5000, y: 5000 });
  const db = openDatabase(dbPath);
  const text = renderChartContext(buildChartContext(db, "rn"));
  db.close();
  expect(text).toContain(`- "The React side": hooks, state`);
  expect(text).toContain(`- "Far water": no islands near it yet`);
  for (const mode of ["judge", "mentor", "cartographer"] as const) {
    expect(personaFor(mode).toolNames.some((t: string) => t.includes("sea"))).toBe(false);
  }
});

test("the server's membership rule is the page's: same reach, same radius, same answer", () => {
  expect(REACH).toBe(WEB_REACH);
  for (const n of [1, 3, 10, 40]) expect(islandRadius(n)).toBe(webIslandRadius(n));
  const islands = [{ slug: "a", x: 0, y: 0 }, { slug: "b", x: 300, y: 0 }, { slug: "c", x: 1400, y: 0 }];
  const seas = [{ id: 1, x: 50, y: 0 }, { id: 2, x: 280, y: 0 }];
  const radius = islandRadius(islands.length);
  const web = webSeaMembers(seas, islands.map((i) => ({ ...i, radius })));
  const core = seaMembers(seas, islands);
  for (const s of seas) expect(core.get(s.id)).toEqual(web.get(s.id).map((n: any) => n.slug));
  expect(core.get(1)).toEqual(["a"]);
  expect(core.get(2)).toEqual(["b"]);
});

test("removing an island's scale removes its seas", () => {
  const db = openDatabase(dbPath);
  const d = upsertDomain(db, { slug: "rn", name: "React Native" });
  const inner = upsertIsland(db, { domainId: d.id, slug: "inner", name: "Inner" });
  addSea(db, { domainId: d.id, parentIslandId: inner.id, name: "Gone soon", x: 0, y: 0 });
  db.run("delete from islands where id = ?", [inner.id]);
  expect(listSeas(db, d.id, inner.id)).toEqual([]);
  db.close();
});
