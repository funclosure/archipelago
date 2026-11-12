// The map file from the terminal: `map export` and `map import`, on a real database file.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait } from "../../src/core/repositories/straitRepository.ts";

const ROOT = resolve(import.meta.dir, "../..");
let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-map-"));
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const d = upsertDomain(db, { slug: "caching", name: "Caching" });
  const a = upsertIsland(db, { domainId: d.id, slug: "eviction", name: "Eviction", sortOrder: 1 });
  const b = upsertIsland(db, { domainId: d.id, slug: "warming", name: "Warming", sortOrder: 2 });
  upsertStrait(db, { domainId: d.id, fromIslandId: a.id, toIslandId: b.id });
  db.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const FILE = { archipelago: 1, name: "Caching", slug: "caching", islands: [{ slug: "eviction", name: "Eviction" }, { slug: "warming", name: "Warming" }], straits: [{ from: "eviction", to: "warming" }] };
function cli(args: string[], stdin?: string) {
  const proc = Bun.spawnSync(["bun", "src/cli/index.ts", ...args], { cwd: ROOT, env: { ...process.env, ARCHIPELAGO_DB_PATH: dbPath }, stdin: stdin ? new TextEncoder().encode(stdin) : "ignore" });
  return { code: proc.exitCode, json: JSON.parse(proc.stdout.toString().trim() || "null") };
}

test("the terminal exports a map to a file or to its output, and imports one from a file or stdin", () => {
  expect(cli(["map", "export", "--domain", "caching", "--json"])).toEqual({ code: 0, json: FILE });
  const out = join(dir, "caching.json");
  expect(cli(["map", "export", "--domain", "caching", "--out", out, "--json"])).toEqual({ code: 0, json: { out, islands: 2 } });
  expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(FILE);
  expect(cli(["map", "export", "--domain", "caching", "--out", out, "--json"]).code).toBe(1);
  expect(cli(["map", "import", "--file", out, "--json"])).toEqual({ code: 0, json: { domain: { slug: "caching-2", name: "Caching" }, islands: 2, straits: 1, seas: 0 } });
  expect(cli(["map", "import", "--file", "-", "--json"], JSON.stringify({ ...FILE, slug: "other", name: "Other" })).json.domain).toEqual({ slug: "other", name: "Other" });
  const bad = cli(["map", "import", "--file", "-", "--json"], "not json");
  expect([bad.code, bad.json.error]).toEqual([1, "not a map file: it is not JSON"]);
});
