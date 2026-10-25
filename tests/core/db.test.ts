import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { openDatabase, resolveDbPath } from "../../src/core/db.ts";
import { migrateDatabase } from "../../src/core/migrate.ts";
import { MIGRATIONS } from "../../src/core/migrations/index.ts";

/** Under `bun run test:wasm` these check the Bun file setup in db.ts, which the hosted build does not use. */
const BUN_ONLY = process.env.ARCHIPELAGO_TEST_DRIVER === "wasm";

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

test.skipIf(BUN_ONLY)("the default database lives under the home directory, not the working directory", () => {
  const saved = process.env.ARCHIPELAGO_DB_PATH;
  delete process.env.ARCHIPELAGO_DB_PATH;
  try {
    expect(resolveDbPath()).toBe(join(homedir(), ".archipelago", "archipelago.sqlite"));
  } finally {
    if (saved !== undefined) process.env.ARCHIPELAGO_DB_PATH = saved;
  }
  expect(resolveDbPath("rel/x.sqlite")).toBe(join(process.cwd(), "rel/x.sqlite"));
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
  expect(versions).toEqual(["0001_initial", "0002_positions", "0003_threads", "0004_landmarks", "0005_harbour", "0006_asks", "0007_board", "0008_mentor", "0009_cartographer", "0010_angle", "0011_description", "0012_seas", "0013_suggested_seas", "0014_language", "0015_landmark_terms", "0016_message_model", "0017_loose_ends"]);
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
  expect(ran).toEqual(["0002_positions", "0003_threads", "0004_landmarks", "0005_harbour", "0006_asks", "0007_board", "0008_mentor", "0009_cartographer", "0010_angle", "0011_description", "0012_seas", "0013_suggested_seas", "0014_language", "0015_landmark_terms", "0016_message_model", "0017_loose_ends"]);

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

test.skipIf(BUN_ONLY)("every connection waits on a busy database instead of failing at once", () => {
  const db = openDatabase(":memory:");
  expect(db.query<{ timeout: number }, []>("pragma busy_timeout").get()!.timeout).toBe(5000);
  db.close();
});

test("a migration another connection applied first is skipped, not run twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "archipelago-mig-"));
  const path = join(dir, "t.sqlite");
  try {
    const a = openDatabase(path);
    const b = openDatabase(path);
    // b's pass sees everything applied by a and runs nothing
    expect(migrateDatabase(b)).toEqual([]);
    a.close();
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("0008 rebuilds messages and board cards in place: ids, links, and authors survive; every message lands in the judge thread", () => {
  const db = new Database(":memory:");
  db.exec("pragma foreign_keys = on");
  db.exec("create table schema_migrations (version text primary key, applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')))");
  const dir = new URL("../../src/core/migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0008").sort()) {
    db.exec(readFileSync(new URL(file, dir), "utf8"));
    db.run("insert into schema_migrations (version) values (?)", [file.replace(/\.sql$/, "")]);
  }
  db.run("insert into domains (slug, name) values ('sd', 'System Design')");
  db.run("insert into islands (domain_id, slug, name) values (1, 'caching', 'Caching')");
  for (const body of ["Explain caching.", "hot data close", "landmark lit: Hit ratio", "gone"]) {
    db.run("insert into messages (domain_id, island_id, role, kind, body) values (1, 1, 'judge', 'text', ?)", [body]);
  }
  db.run("delete from messages where body = 'gone'"); // the id sequence now runs ahead of the largest id
  db.run(
    "insert into landmarks (domain_id, island_id, slug, name, unlocked_at, evidence, message_id) values (1, 1, 'hit-ratio', 'Hit ratio', '2026-09-01T00:00:00.000Z', 'hot data close', 2)",
  );
  db.run("insert into asks (domain_id, island_id, message_id, question, options) values (1, 1, 1, 'which?', '[\"a\",\"b\"]')");
  db.run("insert into board_cards (domain_id, island_id, kind, title, body, author) values (1, 1, 'note', 'Claim', 'hot data close', 'you')");
  const version = () => db.query<{ version: number }, []>("select version from view_state").get()!.version;
  const before = version();

  expect(migrateDatabase(db)).toEqual(["0008_mentor", "0009_cartographer", "0010_angle", "0011_description", "0012_seas", "0013_suggested_seas", "0014_language", "0015_landmark_terms", "0016_message_model", "0017_loose_ends"]);

  expect(db.query("select id, role, mode from messages order by id").all()).toEqual([
    { id: 1, role: "judge", mode: "judge" }, { id: 2, role: "judge", mode: "judge" }, { id: 3, role: "judge", mode: "judge" },
  ]);
  expect(db.query("select message_id as m from landmarks").get()).toEqual({ m: 2 });
  expect(db.query("select message_id as m from asks").get()).toEqual({ m: 1 });
  expect(db.query("select author, title from board_cards").get()).toEqual({ author: "you", title: "Claim" });
  expect(db.query<{ n: number }, []>("select count(*) as n from learner").get()!.n).toBe(1);
  expect(version()).toBe(before); // a rebuild is not a write anyone made
  expect(db.query("pragma foreign_keys").get()).toEqual({ foreign_keys: 1 }); // restored after the rebuild
  expect(db.query("pragma foreign_key_check").all()).toEqual([]);

  // the sequence carried over: a new message never reuses the deleted id 4
  const fresh = db
    .query<{ id: number }, []>("insert into messages (domain_id, island_id, role, kind, body, mode) values (1, 1, 'mentor', 'text', 'hi', 'mentor') returning id")
    .get()!;
  expect(fresh.id).toBe(5);
  expect(version()).toBe(before + 1); // messages_ai is back
  expect(() => db.run("insert into messages (domain_id, island_id, role, kind, body) values (1, 1, 'bot', 'text', 'x')")).toThrow();
  expect(() => db.run("insert into messages (domain_id, island_id, role, kind, body, mode) values (1, 1, 'you', 'text', 'x', 'chat')")).toThrow();
  db.run("insert into board_cards (domain_id, island_id, kind, title, body, author) values (1, 1, 'note', 'Analogy', 'a pantry', 'mentor')");
  expect(() => db.run("insert into board_cards (domain_id, island_id, kind, title, body, author) values (1, 1, 'note', 't', 'b', 'bot')")).toThrow();
  // the cascades still point at the rebuilt table
  db.run("delete from messages where id = 1");
  expect(db.query<{ n: number }, []>("select count(*) as n from asks").get()!.n).toBe(0);
  db.run("delete from messages where id = 2");
  expect(db.query("select message_id as m from landmarks").get()).toEqual({ m: null });
});

test("0008's learner is one row, and updating it bumps every domain's version", () => {
  const db = openDatabase(":memory:");
  db.run("insert into domains (slug, name) values ('a', 'A'), ('b', 'B')");
  const versions = () => db.query<{ version: number }, []>("select version from view_state order by domain_id").all().map((r) => r.version);
  expect(versions()).toEqual([0, 0]);
  expect(db.query("select note from learner").all()).toEqual([{ note: "" }]);
  db.run("update learner set note = 'iOS engineer'");
  expect(versions()).toEqual([1, 1]);
  expect(() => db.run("insert into learner (id) values (2)")).toThrow();
});

test("0009 rebuilds messages in place: ids, islands, and modes survive; only the cartographer may have no island", () => {
  const db = new Database(":memory:");
  db.exec("pragma foreign_keys = on");
  db.exec("create table schema_migrations (version text primary key, applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')))");
  const dir = new URL("../../src/core/migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0009").sort()) {
    db.exec("pragma foreign_keys = off");
    db.exec(readFileSync(new URL(file, dir), "utf8"));
    db.exec("pragma foreign_keys = on");
    db.run("insert into schema_migrations (version) values (?)", [file.replace(/\.sql$/, "")]);
  }
  db.run("insert into domains (slug, name) values ('sd', 'System Design')");
  db.run("insert into islands (domain_id, slug, name) values (1, 'caching', 'Caching')");
  db.run("insert into messages (domain_id, island_id, role, kind, body, mode) values (1, 1, 'judge', 'text', 'q', 'judge')");
  db.run("insert into messages (domain_id, island_id, role, kind, body, mode) values (1, 1, 'mentor', 'text', 'm', 'mentor')");
  db.run("insert into asks (domain_id, island_id, message_id, question, options) values (1, 1, 2, 'which?', '[\"a\",\"b\"]')");

  expect(migrateDatabase(db)).toEqual(["0009_cartographer", "0010_angle", "0011_description", "0012_seas", "0013_suggested_seas", "0014_language", "0015_landmark_terms", "0016_message_model", "0017_loose_ends"]);

  expect(db.query("select id, island_id as islandId, role, mode from messages order by id").all()).toEqual([
    { id: 1, islandId: 1, role: "judge", mode: "judge" }, { id: 2, islandId: 1, role: "mentor", mode: "mentor" },
  ]);
  expect(db.query<{ message_id: number }, []>("select message_id from asks").get()!.message_id).toBe(2);
  db.run("insert into messages (domain_id, island_id, role, kind, body, mode) values (1, null, 'cartographer', 'text', 'top', 'cartographer')");
  expect(() => db.run("insert into messages (domain_id, island_id, role, kind, body, mode) values (1, null, 'judge', 'text', 'x', 'judge')")).toThrow();
  expect(db.query("pragma foreign_key_check").all()).toEqual([]);
  const version = () => db.query<{ version: number }, []>("select version from view_state").get()!.version;
  const before = version();
  db.run("insert into sketches (domain_id, body) values (1, '{}')");
  expect(version()).toBe(before + 1);
});

test("the migrations list names every .sql file in the folder, in order", () => {
  const files = readdirSync(new URL("../../src/core/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  expect(MIGRATIONS.map((m) => `${m.version}.sql`)).toEqual(files);
});
