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
  for (const t of ["schema_migrations", "domains", "islands", "straits", "verdicts", "sessions", "comments", "messages", "landmarks", "view_state"]) {
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
  expect(versions).toEqual(["0001_initial", "0002_positions", "0003_threads", "0004_landmarks", "0005_harbour", "0006_asks", "0007_board"]);
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
  expect(ran).toEqual(["0002_positions", "0003_threads", "0004_landmarks", "0005_harbour", "0006_asks", "0007_board"]);

  const island = db.query<{ x: number | null; y: number | null }, []>("select x, y from islands where slug = 'caching'").get();
  expect(island).toEqual({ x: null, y: null });
  const versionAfter = db
    .query<{ version: number }, [number]>("select version from view_state where domain_id = ?")
    .get(domainId)!.version;
  expect(versionAfter).toBe(versionBefore);
});

test("0003 adds the messages table with version triggers", () => {
  const db = openDatabase(":memory:");
  db.run("insert into domains (slug, name) values ('sd', 'System Design')");
  const domainId = db.query<{ id: number }, []>("select id from domains where slug = 'sd'").get()!.id;
  db.run("insert into islands (domain_id, slug, name) values (?, 'caching', 'Caching')", [domainId]);
  const islandId = db.query<{ id: number }, []>("select id from islands where slug = 'caching'").get()!.id;
  const version = () => db.query<{ version: number }, [number]>("select version from view_state where domain_id = ?").get(domainId)!.version;
  const before = version();
  db.run("insert into messages (domain_id, island_id, role, kind, body) values (?, ?, 'you', 'text', 'hi')", [domainId, islandId]);
  expect(version()).toBe(before + 1);
  db.run("update messages set body = 'hello' where island_id = ?", [islandId]);
  expect(version()).toBe(before + 2);
  expect(() => db.run("insert into messages (domain_id, island_id, role, kind, body) values (?, ?, 'bot', 'text', 'x')", [domainId, islandId])).toThrow();
  expect(() => db.run("insert into messages (domain_id, island_id, role, kind, body) values (?, ?, 'you', 'open', 'x')", [domainId, islandId])).toThrow();
  db.run("delete from islands where id = ?", [islandId]);
  expect(db.query<{ n: number }, []>("select count(*) as n from messages").get()!.n).toBe(0);
});

test("0004 adds landmarks with insert, update, and delete version triggers", () => {
  const db = openDatabase(":memory:");
  db.run("insert into domains (slug, name) values ('sd', 'System Design')");
  const domainId = db.query<{ id: number }, []>("select id from domains where slug = 'sd'").get()!.id;
  db.run("insert into islands (domain_id, slug, name) values (?, 'caching', 'Caching')", [domainId]);
  const islandId = db.query<{ id: number }, []>("select id from islands where slug = 'caching'").get()!.id;
  const version = () => db.query<{ version: number }, [number]>("select version from view_state where domain_id = ?").get(domainId)!.version;
  const v0 = version();
  db.run("insert into landmarks (domain_id, island_id, slug, name) values (?, ?, 'a', 'A')", [domainId, islandId]);
  expect(version()).toBe(v0 + 1);
  db.run("update landmarks set name = 'A2' where slug = 'a'");
  expect(version()).toBe(v0 + 2);
  db.run("delete from landmarks where slug = 'a'");
  expect(version()).toBe(v0 + 3);
  db.run("insert into landmarks (domain_id, island_id, slug, name) values (?, ?, 'b', 'B')", [domainId, islandId]);
  expect(() => db.run("insert into landmarks (domain_id, island_id, slug, name) values (?, ?, 'b', 'B again')", [domainId, islandId])).toThrow();
});

test("0005 adds the harbour flag, one per parent", () => {
  const db = openDatabase(":memory:");
  expect(db.query<{ version: string }, []>("select version from schema_migrations").all().map((r) => r.version)).toContain("0005_harbour");
  db.run("insert into domains (slug, name) values ('sd', 'System Design')");
  const domainId = db.query<{ id: number }, []>("select id from domains where slug = 'sd'").get()!.id;
  db.run("insert into islands (domain_id, slug, name, harbour) values (?, 'a', 'A', 1)", [domainId]);
  expect(() => db.run("insert into islands (domain_id, slug, name, harbour) values (?, 'b', 'B', 1)", [domainId])).toThrow();
  db.run("insert into islands (domain_id, slug, name) values (?, 'b', 'B')", [domainId]);
  const aId = db.query<{ id: number }, []>("select id from islands where slug = 'a'").get()!.id;
  // a different parent may have its own harbour
  db.run("insert into islands (domain_id, parent_id, slug, name, harbour) values (?, ?, 'a-1', 'A1', 1)", [domainId, aId]);
  expect(db.query<{ n: number }, []>("select count(*) as n from islands where harbour = 1").get()!.n).toBe(2);
  expect(db.query<{ harbour: number }, []>("select harbour from islands where slug = 'b'").get()!.harbour).toBe(0);
});

test("0006 adds asks with insert and update version triggers", () => {
  const db = openDatabase(":memory:");
  db.run("insert into domains (slug, name) values ('sd', 'System Design')");
  const domainId = db.query<{ id: number }, []>("select id from domains where slug = 'sd'").get()!.id;
  db.run("insert into islands (domain_id, slug, name) values (?, 'caching', 'Caching')", [domainId]);
  const islandId = db.query<{ id: number }, []>("select id from islands where slug = 'caching'").get()!.id;
  const version = () => db.query<{ version: number }, [number]>("select version from view_state where domain_id = ?").get(domainId)!.version;
  const v0 = version();
  db.run("insert into asks (domain_id, island_id, question, options) values (?, ?, 'which?', '[\"a\",\"b\"]')", [domainId, islandId]);
  expect(version()).toBe(v0 + 1);
  db.run("update asks set picked = 'a' where island_id = ?", [islandId]);
  expect(version()).toBe(v0 + 2);
  expect(db.query<{ message_id: number | null }, []>("select message_id from asks").get()!.message_id).toBeNull();
});
