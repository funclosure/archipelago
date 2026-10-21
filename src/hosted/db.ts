// The hosted build's `src/core/db.ts`: the worker opens one connection at start (`useDatabase`) and every
// `openDatabase` returns it with a close that does nothing, so `withDb` in the routes and tools stays as it is.
import type { Database } from "../core/sql.ts";

let current: Database | null = null;

export function useDatabase(db: Database | null): void {
  current = db;
}

export function openDatabase(): Database {
  if (!current) throw new Error("the database is not open yet");
  return { ...current, close() {} };
}
