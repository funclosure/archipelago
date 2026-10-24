/// <reference lib="webworker" />
// The hosted build's server: SQLite in the origin's private file system, the judge on the reader's API key (or the
// stub, for Try without a key), and the same API routes as `archipelago serve`, answering the page's transport
// (`src/web/transport.js`) over postMessage. Its own routes (`routes.ts`) hold the key and move the database file.
import sqlite3InitModule, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { ArchipelagoError } from "../core/errors.ts";
import { migrateDatabase } from "../core/migrate.ts";
import { MIGRATIONS } from "../core/migrations/index.ts";
import type { Database } from "../core/sql.ts";
import { wrapWasmDatabase } from "../core/sql-wasm.ts";
import { JUDGE_TURN_TIMEOUT_MS, type ApiContext } from "../server/api-routes.ts";
import { createApiRunner } from "../server/judge/api.ts";
import type { JudgeRunner } from "../server/judge/runner.ts";
import { stubRunner } from "../server/judge/stub.ts";
import { runTool } from "../server/judge/tools.ts";
import { migrationsError, prepareImport } from "./backup.ts";
import { useDatabase } from "./db.ts";
import { createHandler, type PageMessage } from "./handler.ts";
import { handleHostedRequest } from "./routes.ts";
import { createSettings, indexedDbStore } from "./settings.ts";

const FILE = "/archipelago.sqlite";
/** Where an import is opened and checked before it replaces FILE. */
const INCOMING = "/incoming.sqlite";
/** What every request answers when the database would not open: the usual cause is a private window. */
const STORAGE_FAILED =
  "This browser would not open Archipelago's storage. Another Archipelago tab may still hold it: close every other one, then reload. Private windows block it too: use a normal window in Chrome, Edge, Firefox, or Safari 17 or later.";
const ANOTHER_TAB = "Archipelago is open in another tab or window.";

/** The database file is one writer's at a time: this lock says whose, and is held for the worker's life. */
const LOCK = "archipelago-db";
/** How long to wait for the lock: the page this one replaced (a reload, a new domain) lets go within this. */
const LOCK_WAIT_MS = 5_000;

/** An error whose message is already the sentence the reader should see; `code` lets the page act on it. */
class Plain extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

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
    if (Date.now() > deadline) throw new Plain(ANOTHER_TAB, "another-tab");
    await new Promise((done) => setTimeout(done, 200));
  }
}

const settings = createSettings(indexedDbStore());

/** The reader's key answers on the API; without one, the stub. One client per key and model. */
let api: { key: string; model: string; run: JudgeRunner } | null = null;
const runner: JudgeRunner = async (turn) => {
  const { apiKey, model } = await settings.get();
  if (!apiKey) return stubRunner(turn);
  if (!api || api.key !== apiKey || api.model !== model) {
    const toolbox = { context: (persona, deps) => persona.buildContext(deps), run: runTool } satisfies Parameters<typeof createApiRunner>[0]["toolbox"];
    api = { key: apiKey, model, run: createApiRunner({ toolbox, apiKey, model, hosted: true }) };
  }
  return api.run(turn);
};

/** The model the next turn runs on: the one picked under Your key, none without a key (the stub). */
const model = async () => {
  const { apiKey, model } = await settings.get();
  return apiKey ? model : null;
};

type Pool = Awaited<ReturnType<Sqlite3Static["installOpfsSAHPoolVfs"]>>;
let sqlite3: Sqlite3Static;
let pool: Pool;
let db: Database | null = null;

function open(): void {
  db = wrapWasmDatabase(sqlite3, new pool.OpfsSAHPoolDb(FILE));
  db.exec("pragma foreign_keys = on;");
  migrateDatabase(db);
  useDatabase(db);
}

async function start(): Promise<ApiContext> {
  await takeLock();
  sqlite3 = await sqlite3InitModule();
  pool = await sqlite3.installOpfsSAHPoolVfs({ name: "archipelago" });
  open();
  return { runner, turnTimeoutMs: JUDGE_TURN_TIMEOUT_MS, model };
}

/** The migrations a candidate file has applied, read from a scratch copy so FILE is untouched until it passes. */
async function versionsOf(bytes: Uint8Array): Promise<string[]> {
  await pool.importDb(INCOMING, bytes);
  const candidate = new pool.OpfsSAHPoolDb(INCOMING);
  try {
    return candidate.selectValues("select version from schema_migrations") as string[];
  } catch {
    return []; // no schema_migrations: not one of ours
  } finally {
    candidate.close();
    pool.unlink(INCOMING);
  }
}

async function importDatabase(raw: Uint8Array): Promise<void> {
  const prepared = prepareImport(raw);
  if ("error" in prepared) throw new ArchipelagoError(prepared.error);
  const refused = migrationsError(await versionsOf(prepared.bytes), MIGRATIONS.map((m) => m.version));
  if (refused) throw new ArchipelagoError(refused);
  useDatabase(null);
  db?.close();
  db = null;
  await pool.importDb(FILE, prepared.bytes);
  open(); // migrates an older export up to this build
}

const ready = start().catch((error) => {
  if (error instanceof Plain) throw error; // the page says it; nothing went wrong
  console.error("archipelago: the database did not open", error);
  throw new Error(STORAGE_FAILED);
});
ready.catch(() => {}); // each request reports it; this keeps the rejection from also landing as unhandled

const scope = self as unknown as DedicatedWorkerGlobalScope;
const onMessage = createHandler(
  () => ready,
  (message, transfer) => scope.postMessage(message, transfer ?? []),
  (req) => handleHostedRequest(req, { settings, exportDatabase: () => pool.exportFile(FILE), importDatabase }),
);
scope.addEventListener("message", (event: MessageEvent<PageMessage>) => void onMessage(event.data));
