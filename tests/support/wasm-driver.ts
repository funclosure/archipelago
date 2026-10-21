// `bun run test:wasm` preloads this: every `openDatabase` in the suite returns the WebAssembly adapter instead of
// `bun:sqlite`, so the same tests prove `sql-wasm.ts`. The CLI tests are left out: they spawn a Bun process that reads the file. Paths share one connection whose close does nothing, as the
// hosted worker does (`src/hosted/db.ts`); ":memory:" is a fresh database each time.
import { mock } from "bun:test";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { wrapWasmDatabase } from "../../src/core/sql-wasm.ts";
import { migrateDatabase } from "../../src/core/migrate.ts";
import type { Database } from "../../src/core/sql.ts";

process.env.ARCHIPELAGO_TEST_DRIVER = "wasm";
const sqlite3 = await sqlite3InitModule();
const byPath = new Map<string, Database>();

function fresh(): Database {
  const db = wrapWasmDatabase(sqlite3, new sqlite3.oo1.DB(":memory:", "c"));
  db.exec("pragma foreign_keys = on;");
  migrateDatabase(db);
  return db;
}

mock.module("../../src/core/db.ts", () => ({
  DEFAULT_DB_PATH: ":memory:",
  resolveDbPath: (override?: string) => override ?? process.env.ARCHIPELAGO_DB_PATH ?? ":memory:",
  openDatabase(override?: string): Database {
    const path = override ?? process.env.ARCHIPELAGO_DB_PATH ?? ":memory:";
    if (path === ":memory:") return fresh();
    let db = byPath.get(path);
    if (!db) byPath.set(path, (db = fresh()));
    return { ...db, close() {} };
  },
}));
