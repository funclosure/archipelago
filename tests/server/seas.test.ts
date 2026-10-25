// Seas: names on the water, per scale. The reader writes them (POST /api/seas, the CLI) or approves them in a sketch; the
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
  expect((await snapshot()).seas).toEqual([{ id, name: "The React side", x: 150, y: 20, anchor: null }]);
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

// ---- suggested seas: proposed in a sketch, written unplaced on approval, placed by the page ----
import { proposeSketch, approveSketch } from "../../src/core/repositories/sketchRepository.ts";
import { updateSea } from "../../src/core/repositories/seaRepository.ts";
// @ts-ignore
import { seaSpot } from "../../src/web/sea-model.js";
// @ts-ignore
import { buildLinks, seaTethers, ACROSS, RIFT, TETHER } from "../../src/web/view-model.js";
// @ts-ignore
import { createSimulation } from "../../src/web/layout.js";
// @ts-ignore
import { sketchRows, sketchSummary } from "../../src/web/chart-model.js";

test("a sketch's seas are checked: islands at the scale, one sea each, names not taken", () => {
  const db = openDatabase(dbPath);
  const d = upsertDomain(db, { slug: "rn", name: "React Native" });
  addSea(db, { domainId: d.id, parentIslandId: null, name: "The React side", x: 0, y: 0 });
  const propose = (seas: unknown) => () => proposeSketch(db, d.id, null, { seas });
  expect(propose([{ name: "Far", islands: ["nowhere"] }])).toThrow(/"nowhere" is not an island/);
  expect(propose([{ name: "A", islands: ["hooks"] }, { name: "B", islands: ["hooks", "state"] }])).toThrow(/already in another sea/);
  expect(propose([{ name: "the react side", islands: ["hooks"] }])).toThrow(/already/);
  expect(propose([{ name: "Twice", islands: ["hooks"] }, { name: "twice", islands: ["state"] }])).toThrow(/already/);
  expect(proposeSketch(db, d.id, null, { seas: [{ name: "Near", islands: ["hooks", "state"] }] }).body.seas).toHaveLength(1);
  db.close();
});

test("approving writes each suggested sea unplaced over its islands; placing it makes it an ordinary sea", async () => {
  const db = openDatabase(dbPath);
  const d = upsertDomain(db, { slug: "rn", name: "React Native" });
  const sketch = proposeSketch(db, d.id, null, { seas: [{ name: "Near", islands: ["hooks", "state"] }] });
  expect(approveSketch(db, d.id, sketch.id).seas).toBe(1);
  const [sea] = listSeas(db, d.id, null);
  expect(sea).toMatchObject({ name: "Near", x: null, y: null, anchor: ["hooks", "state"] });
  // before it is placed, the cartographer still sees which islands it groups
  expect(renderChartContext(buildChartContext(db, "rn"))).toContain(`- "Near": hooks, state`);
  db.close();
  expect((await snapshot()).seas).toEqual([{ id: sea!.id, name: "Near", x: null, y: null, anchor: ["hooks", "state"] }]);
  const placed = (await post({ op: "update", domain: "rn", id: sea!.id, x: 150, y: 0 })).json.sea;
  expect(placed).toMatchObject({ x: 150, y: 0, anchor: null });
});

test("a renamed suggested sea keeps its islands until it is placed", () => {
  const db = openDatabase(dbPath);
  const d = upsertDomain(db, { slug: "rn", name: "React Native" });
  const sea = addSea(db, { domainId: d.id, parentIslandId: null, name: "Near", anchor: ["hooks"] });
  expect(updateSea(db, d.id, sea.id, { name: "Close" })).toMatchObject({ name: "Close", x: null, anchor: ["hooks"] });
  db.close();
});

test("the terminal adds a sea over islands, and refuses islands from another scale", async () => {
  expect((await post({ op: "add", domain: "rn", name: "Near", islands: ["hooks", "state"] })).json.sea).toMatchObject({ x: null, anchor: ["hooks", "state"] });
  const res = await fetch(base + "/api/seas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "add", domain: "rn", name: "Bad", islands: ["ghost"] }) });
  expect(res.status).toBe(400);
  const both = await fetch(base + "/api/seas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "add", domain: "rn", name: "Bad", x: 1, y: 1, islands: ["hooks"] }) });
  expect(both.status).toBe(400);
});

test("membership: an unplaced suggested sea holds its anchor and claims no water, on both sides", () => {
  const islands = [{ slug: "a", x: 0, y: 0 }, { slug: "b", x: 100, y: 0 }];
  const seas = [{ id: 1, x: null, y: null, anchor: ["b"] }, { id: 2, x: 10, y: 0, anchor: null }];
  expect(seaMembers(seas, islands).get(1)).toEqual(["b"]);
  expect(seaMembers(seas, islands).get(2)).toEqual(["a", "b"]);
  const web = webSeaMembers(seas, islands.map((i) => ({ ...i, radius: 60 })));
  expect(web.get(2).map((n: any) => n.slug)).toEqual(["a", "b"]);
});

test("the page sets a suggested name in clear water near its islands, off every coast and island name", () => {
  const r = 60;
  const isles = [{ x: 0, y: 100 }, { x: 400, y: 100 }, { x: 200, y: 100 }];
  const half = 150;
  const spot = seaSpot(isles, isles, r, half);
  // the name's box clears every coast and every island name
  for (const n of isles) {
    const clearOf = (y: number, reach: number) => Math.abs(n.x - spot.x) > half + reach || Math.abs(y - spot.y) > reach;
    expect(clearOf(n.y, r)).toBe(true);
    expect(clearOf(n.y + r * 1.55, r * 0.5)).toBe(true);
  }
  expect(Math.abs(spot.x - 200)).toBeLessThan(400); // and still over its own group
  expect(spot.y).toBeGreaterThanOrEqual(100 - 2.5 * r);
  expect(spot.y).toBeLessThanOrEqual(100 + 2.5 * r);
});

test("a suggested sea's islands are tethered while they are laid out, and the card lists the seas", () => {
  const bySlug = new Map(["a", "b", "c"].map((slug) => [slug, { slug }]));
  const snap = { sketch: { body: { islands: [], straits: [], updates: [], seas: [{ name: "S", islands: ["a", "b", "c"] }] } }, seas: [{ id: 9, x: 1, y: 1, anchor: null }] };
  const tethers = seaTethers(snap, bySlug);
  expect(tethers).toHaveLength(3);
  expect(tethers.every((t: any) => t.hidden && t.weight === TETHER)).toBe(true);
  const body = { islands: [], straits: [], updates: [], seas: [{ name: "Near", islands: ["hooks", "state"] }] };
  expect(sketchSummary(body)).toBe("1 sea");
  expect(sketchRows(body, [{ slug: "hooks", name: "Hooks" }, { slug: "state", name: "State" }]).seas).toEqual([{ name: "Near", islands: "Hooks · State" }]);
});

test("islands of different suggested seas push apart while laid out; a strait between them pulls weakly", () => {
  const node = (slug: string, x: number, y: number) => ({ slug, x, y, vx: 0, vy: 0, mass: 1, radius: 62, placed: false, pinned: false });
  const nodes = [node("a", 0, 0), node("b", 40, 30), node("c", 80, -20), node("d", 20, 60)];
  const snap = { straits: [{ from: "b", to: "c" }], sketch: { body: { islands: [], straits: [], updates: [], seas: [{ name: "S", islands: ["a", "b"] }, { name: "T", islands: ["c", "d"] }] } }, seas: [] };
  const links = buildLinks(snap, nodes);
  expect(links.find((l: any) => l.strait)!.weight).toBe(ACROSS);
  expect(links.filter((l: any) => l.rift).map((l: any) => l.source.slug + l.target.slug).sort()).toEqual(["ac", "ad", "bc", "bd"]);
  expect(links.every((l: any) => !l.rift || (l.hidden && l.weight === RIFT))).toBe(true);
  const sim = createSimulation();
  sim.setGraph(nodes, links, 1);
  for (let i = 0; i < 2000 && sim.tick(); i++);
  const mid = (xs: typeof nodes) => ({ x: (xs[0]!.x + xs[1]!.x) / 2, y: (xs[0]!.y + xs[1]!.y) / 2 });
  const [s, t] = [mid([nodes[0]!, nodes[1]!]), mid([nodes[2]!, nodes[3]!])];
  const within = Math.max(Math.hypot(nodes[0]!.x - nodes[1]!.x, nodes[0]!.y - nodes[1]!.y), Math.hypot(nodes[2]!.x - nodes[3]!.x, nodes[2]!.y - nodes[3]!.y));
  expect(Math.hypot(s.x - t.x, s.y - t.y)).toBeGreaterThan(within * 1.5);
  // placed islands are the reader's: no rift touches them
  nodes[0]!.placed = true;
  expect(buildLinks(snap, nodes).filter((l: any) => l.rift)).toHaveLength(2);
});
