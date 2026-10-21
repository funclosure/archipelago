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
  "This browser would not open Archipelago's storage. Another Archipelago tab may still hold it: close every other one, then reload. Private windows block it too: use a normal window in Chrome, Edge, Firefox, or Safari 17 or later.";
const ANOTHER_TAB = "Archipelago is open in another tab or window. Close it, then reload this page.";

/** The database file is one writer's at a time: this lock says whose, and is held for the worker's life. */
const LOCK = "archipelago-db";
/** How long to wait for the lock: the page this one replaced (a reload, a new domain) lets go within this. */
const LOCK_WAIT_MS = 5_000;

/** An error whose message is already the sentence the reader should see. */
class Plain extends Error {}

async function takeLock(): Promise<void> {
  if (!navigator.locks) return;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const held = await new Promise<boolean>((resolve) => {
      void navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
        resolve(lock !== null);
        return lock ? new Promise<void>(() => {}) : undefined; // never settles: released when the worker ends
      });
    });
    if (held) return;
    if (Date.now() > deadline) throw new Plain(ANOTHER_TAB);
    await new Promise((done) => setTimeout(done, 200));
  }
}

async function start(): Promise<ApiContext> {
  await takeLock();
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
  throw error instanceof Plain ? error : new Error(STORAGE_FAILED);
});
ready.catch(() => {}); // each request reports it; this keeps the rejection from also landing as unhandled

const scope = self as unknown as DedicatedWorkerGlobalScope;
const onMessage = createHandler(() => ready, (message) => scope.postMessage(message));
scope.addEventListener("message", (event: MessageEvent<PageMessage>) => void onMessage(event.data));
