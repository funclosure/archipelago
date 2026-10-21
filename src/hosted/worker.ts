/// <reference lib="webworker" />
// The hosted build's server: SQLite in the origin's private file system, the stub judge, and the same API
// routes as `archipelago serve`, answering the page's transport (`src/web/transport.js`) over postMessage.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { migrateDatabase } from "../core/migrate.ts";
import { wrapWasmDatabase } from "../core/sql-wasm.ts";
import { JUDGE_TURN_TIMEOUT_MS, type ApiContext } from "../server/api-routes.ts";
import { stubRunner } from "../server/judge/stub.ts";
import { useDatabase } from "./db.ts";
import { createHandler, type PageMessage } from "./handler.ts";

const FILE = "/archipelago.sqlite";
/** What every request answers when the database would not open: the usual cause is a private window. */
const STORAGE_FAILED =
  "This browser would not open Archipelago's storage. Private windows block it: use a normal window in Chrome, Edge, Firefox, or Safari 17 or later.";

async function start(): Promise<ApiContext> {
  const sqlite3 = await sqlite3InitModule();
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "archipelago" });
  const db = wrapWasmDatabase(sqlite3, new pool.OpfsSAHPoolDb(FILE));
  db.exec("pragma foreign_keys = on;");
  migrateDatabase(db);
  useDatabase(db);
  return { runner: stubRunner, turnTimeoutMs: JUDGE_TURN_TIMEOUT_MS };
}

const ready = start().catch((error) => {
  console.error("archipelago: the database did not open", error);
  throw new Error(STORAGE_FAILED);
});
ready.catch(() => {}); // each request reports it; this keeps the rejection from also landing as unhandled

const scope = self as unknown as DedicatedWorkerGlobalScope;
const onMessage = createHandler(() => ready, (message) => scope.postMessage(message));
scope.addEventListener("message", (event: MessageEvent<PageMessage>) => void onMessage(event.data));
