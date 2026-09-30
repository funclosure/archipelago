import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrateDatabase } from "./migrate.ts";

export const DEFAULT_DB_PATH = ".archipelago/archipelago.sqlite";

export function resolveDbPath(override?: string): string {
  const path = override ?? process.env.ARCHIPELAGO_DB_PATH ?? DEFAULT_DB_PATH;
  return path === ":memory:" ? path : resolve(process.cwd(), path);
}

/** Opens (creating if needed) the database, enables foreign keys, and applies migrations. */
export function openDatabase(override?: string): Database {
  const path = resolveDbPath(override);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("pragma foreign_keys = on;");
  // The CLI and the server write the same file; wait for the other writer rather than fail with "database is locked".
  db.exec("pragma busy_timeout = 5000;");
  if (path !== ":memory:") db.exec("pragma journal_mode = wal;");
  migrateDatabase(db);
  return db;
}
