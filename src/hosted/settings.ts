// The hosted build's own settings: the reader's API key, the model, and whether they chose to try without a key.
// Kept in the worker, in IndexedDB when the reader asks to be remembered and in memory otherwise; never in the
// SQLite database, so an export never carries the key. The page reads back a hint of the key, never the key.

export const MODELS = [
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", note: "the default: quick, and much cheaper per turn" },
  { id: "claude-opus-5-5", name: "Opus 5.5", note: "the deepest judge, at several times the cost" },
] as const;
export const HOSTED_DEFAULT_MODEL = MODELS[0].id;

export type Settings = {
  apiKey: string | null;
  model: string;
  /** The key (and model) are kept on this device across visits. */
  remember: boolean;
  /** The reader chose Try without a key: the stub answers until a key is set. */
  stub: boolean;
};

/** What the page sees: the key's last four characters, never the key. */
export type SettingsView = Omit<Settings, "apiKey"> & { key: boolean; keyHint: string | null; models: typeof MODELS };

export type SettingsPatch = { apiKey?: string | null; model?: string; remember?: boolean; stub?: boolean };

/** Where remembered settings live: IndexedDB in the worker, a plain object in tests. */
export type SettingsStore = {
  read(): Promise<Partial<Settings> | null>;
  write(settings: Settings | null): Promise<void>;
};

const FRESH: Settings = { apiKey: null, model: HOSTED_DEFAULT_MODEL, remember: true, stub: false };

export function viewOf(settings: Settings): SettingsView {
  const { apiKey, ...rest } = settings;
  return { ...rest, key: Boolean(apiKey), keyHint: apiKey ? `…${apiKey.slice(-4)}` : null, models: MODELS };
}

/** Checks a patch: a key must look like one, a model must be one of MODELS. Returns the sentence to show, or null. */
export function patchError(patch: SettingsPatch): string | null {
  if (typeof patch.apiKey === "string" && !/^sk-ant-[\w-]{8,}$/.test(patch.apiKey.trim())) {
    return "That does not look like an Anthropic API key. Keys start with sk-ant-.";
  }
  if (patch.model !== undefined && !MODELS.some((m) => m.id === patch.model)) return `Pick one of ${MODELS.map((m) => m.name).join(" or ")}.`;
  return null;
}

export function createSettings(store: SettingsStore) {
  let current: Settings = { ...FRESH };
  const loaded = store.read().then(
    (saved) => {
      if (saved) current = { ...FRESH, ...saved, remember: true };
    },
    () => {}, // no IndexedDB (a private window): the settings live in memory
  );

  return {
    async get(): Promise<Settings> {
      await loaded;
      return current;
    },
    /** Applies a checked patch. A null key forgets it. Remember off erases what was stored; on stores it again. */
    async update(patch: SettingsPatch): Promise<Settings> {
      await loaded;
      const apiKey = patch.apiKey === undefined ? current.apiKey : patch.apiKey === null ? null : patch.apiKey.trim();
      current = { ...current, ...patch, apiKey };
      if (apiKey) current.stub = patch.stub ?? false; // a key replaces Try without a key
      await store.write(current.remember ? current : null).catch(() => {});
      return current;
    },
  };
}

/** The worker's store: one record in one IndexedDB object store. */
export function indexedDbStore(name = "archipelago-settings"): SettingsStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("settings");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = (mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest) =>
    open().then(
      (db) =>
        new Promise<unknown>((resolve, reject) => {
          const req = act(db.transaction("settings", mode).objectStore("settings"));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }).finally(() => db.close()),
    );
  return {
    read: () => run("readonly", (s) => s.get("current")).then((v) => (v as Partial<Settings>) ?? null),
    write: (settings) => run("readwrite", (s) => (settings ? s.put(settings, "current") : s.delete("current"))).then(() => {}),
  };
}
