// The hosted build's own settings: which provider answers, the reader's key and model for each, and whether they
// chose to try without a key. Kept in the worker, in IndexedDB when the reader asks to be remembered and in memory
// otherwise; never in the SQLite database, so an export never carries a key. The page reads back hints, never a key.

type Model = { id: string; name: string; /** a key in the page's `hosted` strings */ note: string };

/**
 * The providers a reader can bring a key for. Claude answers on the Messages API; the others on the OpenAI-style
 * chat API (`judge/openai.ts`), whose endpoints all answer a browser. `custom` lets the reader name any model the
 * provider serves; each host is also in the build's CSP (`connect-src`).
 */
export const PROVIDERS = [
  {
    id: "anthropic",
    name: "Claude",
    host: "api.anthropic.com",
    keysUrl: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-…",
    custom: false,
    models: [
      { id: "claude-sonnet-5-5", name: "Sonnet 5.5", note: "noteSonnet" },
      { id: "claude-opus-5-5", name: "Opus 5.5", note: "noteOpus" },
    ],
  },
  {
    id: "gemini",
    name: "Gemini",
    host: "generativelanguage.googleapis.com",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keysUrl: "https://aistudio.google.com/apikey",
    placeholder: "AQ…",
    custom: true,
    models: [
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", note: "noteFlash" },
      { id: "gemini-4-argon", name: "Gemini 4 Argon", note: "noteArgon" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    host: "openrouter.ai",
    baseUrl: "https://openrouter.ai/api/v1",
    keysUrl: "https://openrouter.ai/keys",
    placeholder: "sk-or-…",
    custom: true,
    models: [
      { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash", note: "noteFlash" },
      { id: "anthropic/claude-sonnet-5.5", name: "Sonnet 5.5", note: "noteSonnetRouted" },
    ],
  },
] as const satisfies readonly { id: string; name: string; host: string; baseUrl?: string; keysUrl: string; placeholder: string; custom: boolean; models: readonly Model[] }[];

export type ProviderId = (typeof PROVIDERS)[number]["id"];
export type Provider = (typeof PROVIDERS)[number];
export const HOSTED_DEFAULT_PROVIDER: ProviderId = "anthropic";
export const HOSTED_DEFAULT_MODEL = PROVIDERS[0].models[0].id;

export const providerOf = (id: string): Provider | undefined => PROVIDERS.find((p) => p.id === id);

export type Settings = {
  provider: ProviderId;
  /** One key per provider, so switching back finds the key still there. */
  keys: Partial<Record<ProviderId, string>>;
  /** The model picked for each provider; its first model when none was. */
  models: Partial<Record<ProviderId, string>>;
  /** The keys (and models) are kept on this device across visits. */
  remember: boolean;
  /** The reader chose Try without a key: the stub answers until a key is set. */
  stub: boolean;
};

/** What answers right now: the chosen provider, its key (null: the stub answers), and its model. */
export function activeOf(settings: Settings): { provider: Provider; apiKey: string | null; model: string } {
  const provider = providerOf(settings.provider) ?? PROVIDERS[0];
  return { provider, apiKey: settings.keys[provider.id] ?? null, model: settings.models[provider.id] ?? provider.models[0].id };
}

/** What the page sees: each key's last four characters, never a key. */
export type SettingsView = {
  provider: ProviderId;
  model: string;
  remember: boolean;
  stub: boolean;
  /** The chosen provider has a key. */
  key: boolean;
  keyHint: string | null;
  keyHints: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  providers: typeof PROVIDERS;
};

/** `apiKey` and `model` are the patch's provider's (else the current one's). A null key forgets it. */
export type SettingsPatch = { provider?: string; apiKey?: string | null; model?: string; remember?: boolean; stub?: boolean };

/** Where remembered settings live: IndexedDB in the worker, a plain object in tests. */
export type SettingsStore = {
  read(): Promise<Partial<Settings> | null>;
  write(settings: Settings | null): Promise<void>;
};

const FRESH: Settings = { provider: HOSTED_DEFAULT_PROVIDER, keys: {}, models: {}, remember: true, stub: false };

const hint = (key: string) => `…${key.slice(-4)}`;

export function viewOf(settings: Settings): SettingsView {
  const { provider, apiKey, model } = activeOf(settings);
  const keyHints = Object.fromEntries(Object.entries(settings.keys).flatMap(([id, key]) => (key ? [[id, hint(key)]] : [])));
  return {
    provider: provider.id,
    model,
    remember: settings.remember,
    stub: settings.stub,
    key: Boolean(apiKey),
    keyHint: apiKey ? hint(apiKey) : null,
    keyHints,
    models: settings.models,
    providers: PROVIDERS,
  };
}

/** A record saved before there were providers held one Anthropic key and its model. */
function fromSaved(saved: Partial<Settings> & { apiKey?: string | null; model?: string }): Settings {
  const { apiKey, model, ...rest } = saved;
  const settings: Settings = { ...FRESH, ...rest, keys: { ...rest.keys }, models: { ...rest.models }, remember: true };
  if (apiKey) settings.keys.anthropic ??= apiKey;
  if (model) settings.models.anthropic ??= model;
  if (!providerOf(settings.provider)) settings.provider = HOSTED_DEFAULT_PROVIDER;
  return settings;
}

const KEY_SHAPES: Record<ProviderId, RegExp> = {
  anthropic: /^sk-ant-[\w-]{8,}$/,
  gemini: /^[\w.-]{20,}$/, // Google has changed the shape before: anything long, with no spaces
  openrouter: /^sk-or-[\w-]{8,}$/,
};
/** A model id a provider could serve: `vendor/model`, a version, a `:variant`. */
const MODEL_ID = /^[\w.:/@-]{1,120}$/;

/** Checks a patch against the settings it lands on. Returns the sentence to show, or null. */
export function patchError(patch: SettingsPatch, current: Settings = FRESH): string | null {
  const provider = providerOf(patch.provider ?? current.provider);
  if (!provider) return `Pick one of ${PROVIDERS.map((p) => p.name).join(", ")}.`;
  if (typeof patch.apiKey === "string" && !KEY_SHAPES[provider.id].test(patch.apiKey.trim())) {
    if (provider.id === "anthropic") return "That does not look like an Anthropic API key. Keys start with sk-ant-.";
    if (provider.id === "openrouter") return "That does not look like an OpenRouter key. Keys start with sk-or-.";
    return `That does not look like a ${provider.name} API key.`;
  }
  if (patch.model !== undefined) {
    const model = patch.model.trim();
    const offered = provider.models.some((m) => m.id === model);
    if (!offered && !provider.custom) return `Pick one of ${provider.models.map((m) => m.name).join(" or ")}.`;
    if (!offered && !MODEL_ID.test(model)) return `Name a model ${provider.name} serves, as its model list writes it.`;
  }
  return null;
}

export function createSettings(store: SettingsStore) {
  let current: Settings = { ...FRESH };
  const loaded = store.read().then(
    (saved) => {
      if (saved) current = fromSaved(saved);
    },
    () => {}, // no IndexedDB (a private window): the settings live in memory
  );

  return {
    async get(): Promise<Settings> {
      await loaded;
      return current;
    },
    /** Applies a checked patch. Remember off erases what was stored; on stores it again. */
    async update(patch: SettingsPatch): Promise<Settings> {
      await loaded;
      const provider = (providerOf(patch.provider ?? current.provider) ?? PROVIDERS[0]).id;
      const keys = { ...current.keys };
      if (patch.apiKey === null) delete keys[provider];
      else if (patch.apiKey !== undefined) keys[provider] = patch.apiKey.trim();
      const models = { ...current.models };
      if (patch.model !== undefined) models[provider] = patch.model.trim();
      current = { provider, keys, models, remember: patch.remember ?? current.remember, stub: patch.stub ?? current.stub };
      if (keys[provider]) current.stub = patch.stub ?? false; // a key replaces Try without a key
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
