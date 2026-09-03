import { test, expect } from "bun:test";
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
