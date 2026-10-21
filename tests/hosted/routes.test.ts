// The hosted build's own routes and the pure parts behind them: the key and model, and the database file out and in.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { MIGRATIONS } from "../../src/core/migrations/index.ts";
import { exportName, migrationsError, prepareImport } from "../../src/hosted/backup.ts";
import { DATABASE_TYPE, handleHostedRequest, type HostedDeps } from "../../src/hosted/routes.ts";
import { createSettings, HOSTED_DEFAULT_MODEL, type Settings, type SettingsStore } from "../../src/hosted/settings.ts";

const KEY = "sk-ant-api03-abcdefghijklmnop";

function memoryStore(saved: Partial<Settings> | null = null) {
  const store = { saved, read: async () => store.saved, write: async (s: Settings | null) => void (store.saved = s && { ...s }) };
  return store satisfies SettingsStore;
}

const post = (path: string, body: unknown) =>
  new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (path: string) => new Request(`http://127.0.0.1${path}`);

function deps(store: SettingsStore = memoryStore(), extra: Partial<HostedDeps> = {}): HostedDeps {
  return {
    settings: createSettings(store),
    exportDatabase: () => new Uint8Array([1, 2, 3]),
    importDatabase: async () => {},
    ...extra,
  };
}

test("a fresh browser has no key, Sonnet 5.5, and asks to be remembered", async () => {
  const view = await (await handleHostedRequest(get("/hosted/settings"), deps())).json();
  expect(view).toMatchObject({ key: false, keyHint: null, model: HOSTED_DEFAULT_MODEL, remember: true, stub: false });
  expect(HOSTED_DEFAULT_MODEL).toBe("claude-sonnet-5-5");
  expect(view.models.map((m: any) => m.id)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
});

test("a key is stored when remembered, shown only as its last four characters, and never comes back whole", async () => {
  const store = memoryStore();
  const d = deps(store);
  const res = await handleHostedRequest(post("/hosted/settings", { apiKey: `  ${KEY} `, model: "claude-opus-5-5" }), d);
  const view = await res.json();
  expect(view).toMatchObject({ key: true, keyHint: "…mnop", model: "claude-opus-5-5", stub: false });
  expect(JSON.stringify(view)).not.toContain(KEY);
  expect(store.saved?.apiKey).toBe(KEY);
  expect((await d.settings.get()).apiKey).toBe(KEY);
});

test("remember off keeps the key in memory only, and erases what was stored", async () => {
  const store = memoryStore({ apiKey: KEY, model: HOSTED_DEFAULT_MODEL });
  const d = deps(store);
  expect((await d.settings.get()).apiKey).toBe(KEY); // read back from the store
  await handleHostedRequest(post("/hosted/settings", { remember: false }), d);
  expect(store.saved).toBeNull();
  expect((await d.settings.get()).apiKey).toBe(KEY);
});

test("forgetting the key goes back to Try without a key; a new key leaves it", async () => {
  const d = deps(memoryStore({ apiKey: KEY }));
  const forgot = await (await handleHostedRequest(post("/hosted/settings", { apiKey: null, stub: true }), d)).json();
  expect(forgot).toMatchObject({ key: false, stub: true });
  const keyed = await (await handleHostedRequest(post("/hosted/settings", { apiKey: KEY }), d)).json();
  expect(keyed).toMatchObject({ key: true, stub: false });
});

test("a key that is not one, or a model that is not offered, is a 400 with the sentence to show", async () => {
  const bad = await handleHostedRequest(post("/hosted/settings", { apiKey: "hello" }), deps());
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toContain("sk-ant-");
  const model = await handleHostedRequest(post("/hosted/settings", { model: "gpt-5" }), deps());
  expect(model.status).toBe(400);
  expect((await model.json()).error).toBe("Pick one of Sonnet 5.5 or Opus 5.5.");
});

test("without IndexedDB the settings live in memory", async () => {
  const d = deps({ read: () => Promise.reject(new Error("no idb")), write: () => Promise.reject(new Error("no idb")) });
  const view = await (await handleHostedRequest(post("/hosted/settings", { apiKey: KEY }), d)).json();
  expect(view.key).toBe(true);
});

test("export answers the database bytes as a dated download", async () => {
  const res = await handleHostedRequest(get("/hosted/export"), deps());
  expect(res.headers.get("content-type")).toBe(DATABASE_TYPE);
  expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="archipelago-\d{4}-\d{2}-\d{2}\.sqlite"$/);
  expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
  expect(exportName(new Date(2026, 0, 5))).toBe("archipelago-2026-01-05.sqlite");
});

test("import passes the bytes on; its refusal is a 400", async () => {
  let got: Uint8Array | null = null;
  const ok = deps(memoryStore(), { importDatabase: async (b) => void (got = b) });
  const req = new Request("http://127.0.0.1/hosted/import", { method: "POST", body: new Uint8Array([9, 8, 7]) });
  expect((await handleHostedRequest(req, ok)).status).toBe(200);
  expect([...got!]).toEqual([9, 8, 7]);
  const { ArchipelagoError } = await import("../../src/core/errors.ts");
  const no = deps(memoryStore(), { importDatabase: async () => { throw new ArchipelagoError("not ours"); } });
  const refused = await handleHostedRequest(new Request("http://127.0.0.1/hosted/import", { method: "POST", body: "x" }), no);
  expect(refused.status).toBe(400);
  expect((await refused.json()).error).toBe("not ours");
});

test("an unknown hosted path is a 404", async () => {
  expect((await handleHostedRequest(get("/hosted/nothing"), deps())).status).toBe(404);
});

test("prepareImport takes a database the local tool wrote in WAL mode and marks it for the rollback journal", () => {
  const path = join(tmpdir(), `archipelago-wal-${process.pid}-${Date.now()}.sqlite`);
  const db = openDatabase(path); // WAL, as ~/.archipelago keeps it
  db.close();
  const bytes = new Uint8Array(readFileSync(path));
  expect([bytes[18], bytes[19]]).toEqual([2, 2]);
  const prepared = prepareImport(bytes);
  if ("error" in prepared) throw new Error(prepared.error);
  expect([prepared.bytes[18], prepared.bytes[19]]).toEqual([1, 1]);
  expect(bytes[18]).toBe(2); // the input is left alone
  expect(prepareImport(new TextEncoder().encode("hello"))).toEqual({ error: expect.stringContaining("not an Archipelago database") });
});

test("migrationsError refuses a database from a newer build and one that is not ours", () => {
  const known = MIGRATIONS.map((m) => m.version);
  expect(migrationsError(known.slice(0, 3), known)).toBeNull(); // older: migrated up after the import
  expect(migrationsError([...known, "9999_future"], known)).toContain("newer Archipelago");
  expect(migrationsError([], known)).toContain("not one of Archipelago's");
});
