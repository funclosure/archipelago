import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { openDatabase } from "../../src/core/db.ts";
import { migrateDatabase } from "../../src/core/migrate.ts";

test("openDatabase creates the schema", () => {
  const db = openDatabase(":memory:");
  const tables = db
    .query<{ name: string }, []>("select name from sqlite_master where type = 'table' order by name")
    .all()
    .map((r) => r.name);
  for (const t of ["schema_migrations", "domains", "islands", "straits", "verdicts", "sessions", "comments", "view_state"]) {
    expect(tables).toContain(t);
  }
});

test("migrations are idempotent", () => {
  const db = openDatabase(":memory:");
  expect(migrateDatabase(db)).toEqual([]);
});

test("inserting a domain creates its view_state row at version 0", () => {
  const db = openDatabase(":memory:");
  db.run("insert into domains (slug, name) values ('sd', 'System Design')");
  const row = db.query<{ version: number }, []>("select version from view_state").get();
  expect(row).toEqual({ version: 0 });
});

test("foreign keys are enforced", () => {
  const db = openDatabase(":memory:");
  expect(() => db.run("insert into islands (domain_id, slug, name) values (99, 'x', 'X')")).toThrow();
});

test("0002 adds nullable island positions", () => {
  const db = openDatabase(":memory:");
  const cols = db
    .query<{ name: string }, []>("select name from pragma_table_info('islands')")
    .all()
    .map((r) => r.name);
  expect(cols).toContain("x");
  expect(cols).toContain("y");
  const versions = db.query<{ version: string }, []>("select version from schema_migrations order by version").all().map((r) => r.version);
  expect(versions).toEqual(["0001_initial", "0002_positions"]);
});

test("0002 upgrades a database created with 0001 only", () => {
  const db = new Database(":memory:");
  db.exec("pragma foreign_keys = on");
  const sql = readFileSync(new URL("../../src/core/migrations/0001_initial.sql", import.meta.url), "utf8");
  db.exec(sql);
  db.exec(
    "create table schema_migrations (version text primary key, applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  );
  db.run("insert into schema_migrations (version) values ('0001_initial')");
  db.run("insert into domains (slug, name) values ('sd', 'System Design')");
  const domainId = db.query<{ id: number }, []>("select id from domains where slug = 'sd'").get()!.id;
  db.run("insert into islands (domain_id, slug, name) values (?, 'caching', 'Caching')", [domainId]);
  const versionBefore = db
    .query<{ version: number }, [number]>("select version from view_state where domain_id = ?")
    .get(domainId)!.version;

  const ran = migrateDatabase(db);
  expect(ran).toEqual(["0002_positions"]);

  const island = db.query<{ x: number | null; y: number | null }, []>("select x, y from islands where slug = 'caching'").get();
  expect(island).toEqual({ x: null, y: null });
  const versionAfter = db
    .query<{ version: number }, [number]>("select version from view_state where domain_id = ?")
    .get(domainId)!.version;
  expect(versionAfter).toBe(versionBefore);
});
