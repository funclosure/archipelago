// What only the hosted build shows: the welcome screen (a key, Try without a key, or an import), Your key, export
// and import of the database, and the hand-over when another tab holds the database. The worker keeps the keys,
// one per provider (`src/hosted/settings.ts`); this page sends a key once and reads back only its last four characters.
import { request, release } from "./transport.js";
import { registerRegion } from "./keys.js";
import { t } from "./i18n.js";

export const isHosted = () => globalThis.ARCHIPELAGO_HOSTED === true;

/** `open`: null, "welcome" (no way out but a choice), "key" (Your key), "import" (the replace warning), "elsewhere". */
const state = { open: null, view: null, provider: null, key: "", model: null, remember: true, saving: false, error: null, file: null };
let root = null;
let started = null; // resolves the welcome gate

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, className = "btn") {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

async function call(path, init) {
  const res = await request(path, init);
  if (res.ok) return res;
  const body = await res.json().catch(() => ({}));
  throw new Error(body.error || res.statusText);
}

// A settings write may change the model the personas answer on: the panes re-read it on this event.
const post = (path, body) =>
  call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .finally(() => document.dispatchEvent(new Event("settings")));

/** Ask the browser not to clear this site's storage under pressure. Chrome decides on its own; Firefox may ask. */
function persist() {
  void navigator.storage?.persist?.().catch(() => {});
}

export function installHosted() {
  root = document.getElementById("hosted");
  registerRegion("hosted", { isOpen: () => state.open !== null, close: () => state.open !== "welcome" && state.open !== "elsewhere" && close() });
  // A tab that asks to take over gets the database: this one lets its worker go and says where Archipelago went.
  if (isHosted() && typeof BroadcastChannel === "function") {
    new BroadcastChannel("archipelago").addEventListener("message", (event) => {
      if (event.data !== "takeover") return;
      release(t("hosted.movedReason"));
      open("elsewhere");
    });
  }
}

/**
 * Before the map: resolves at once when a key is set or the reader chose Try without a key; otherwise shows the
 * welcome screen and resolves when they choose. Locally there is nothing to ask.
 */
export async function welcomeGate() {
  if (!isHosted()) return;
  root ??= document.getElementById("hosted");
  state.view = await (await call("/hosted/settings")).json();
  if (state.view.key || state.view.stub) return;
  open("welcome");
  await new Promise((resolve) => (started = resolve));
}

export function openYourKey() {
  void call("/hosted/settings")
    .then((r) => r.json())
    .then((view) => {
      state.view = view;
      open("key");
    })
    .catch((error) => alert(error.message));
}

function open(kind) {
  Object.assign(state, { open: kind, key: "", provider: state.view?.provider ?? null, model: state.view?.model ?? null, remember: state.view?.remember ?? true, saving: false, error: null });
  render();
  root.querySelector("input")?.focus();
}

function close() {
  state.open = null;
  render();
}

/** The provider the form shows: the one picked there, else the saved one. */
const providerNow = () => state.view?.providers?.find((p) => p.id === state.provider) ?? state.view?.providers?.[0];

/** Picking a provider shows its own key hint and the model last picked for it. */
function pickProvider(id) {
  const p = state.view.providers.find((x) => x.id === id);
  Object.assign(state, { provider: id, key: "", model: state.view.models?.[id] ?? p.models[0]?.id ?? "", error: null });
  render();
  root.querySelector('input[type="password"]')?.focus();
}

async function saveKey({ stub = false } = {}) {
  if (state.saving) return;
  const patch = { provider: state.provider, model: state.model, remember: state.remember };
  if (stub) patch.stub = true;
  else if (state.key.trim()) patch.apiKey = state.key.trim();
  else if (!state.view?.keyHints?.[state.provider]) {
    state.error = t("hosted.pasteKey");
    return render();
  }
  state.saving = true;
  state.error = null;
  render();
  try {
    state.view = await post("/hosted/settings", patch);
    persist();
    close();
    started?.();
    started = null;
  } catch (error) {
    state.saving = false;
    state.error = error.message;
    render();
  }
}

async function forgetKey() {
  try {
    state.view = await post("/hosted/settings", { provider: state.provider, apiKey: null, stub: true });
    close();
  } catch (error) {
    state.error = error.message;
    render();
  }
}

/** Downloads the whole database as archipelago-YYYY-MM-DD.sqlite: the file the local tool opens too. */
export async function exportDatabase() {
  try {
    const res = await call("/hosted/export");
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "archipelago.sqlite";
    const url = URL.createObjectURL(await res.blob());
    const a = el("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (error) {
    alert(t("hosted.exportFailed", { message: error.message }));
  }
}

/** Picks a .sqlite file, then asks before it replaces everything in this browser. */
export function importDatabase() {
  const input = el("input");
  input.type = "file";
  input.accept = ".sqlite,.db,application/vnd.sqlite3,application/x-sqlite3";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const from = state.open === "welcome" ? "welcome" : null;
    Object.assign(state, { open: "import", file, from, saving: false, error: null });
    render();
  });
  input.click();
}

async function replaceWith(file) {
  state.saving = true;
  state.error = null;
  render();
  try {
    await call("/hosted/import", { method: "POST", headers: { "content-type": "application/vnd.sqlite3" }, body: await file.arrayBuffer() });
    // An imported chart needs no key to look at: the stub answers until one is set.
    if (!state.view?.key) await post("/hosted/settings", { stub: true });
    persist();
    location.replace(location.pathname);
  } catch (error) {
    state.saving = false;
    state.error = error.message;
    render();
  }
}

/** Shown in place of the map when another tab holds the database: one button moves it here. */
export function anotherTab(nav) {
  const take = el("button", "crumb start", t("hosted.useItHere"));
  take.type = "button";
  take.addEventListener("click", () => {
    take.disabled = true;
    new BroadcastChannel("archipelago").postMessage("takeover");
    setTimeout(() => location.reload(), 400); // the other tab's worker ends at once; its lock goes with it
  });
  nav.replaceChildren(t("hosted.openElsewhere"), take);
}

function render() {
  if (!root) return;
  root.hidden = state.open === null;
  root.classList.toggle("welcome", state.open === "welcome" || state.open === "elsewhere"); // nothing behind it yet, or nothing to use
  root.replaceChildren();
  if (state.open === null) return;
  const card = el("div", "hosted-card");
  if (state.open === "welcome" || state.open === "key") renderKey(card);
  else if (state.open === "import") renderImport(card);
  else if (state.open === "elsewhere") {
    card.append(el("div", "lbl", "Archipelago"), el("p", "help", t("hosted.movedHelp")));
    card.append(row(button(t("hosted.reload"), () => location.reload())));
  }
  if (state.error) card.append(el("p", "error", state.error));
  root.append(card);
}

function row(...children) {
  const r = el("div", "row");
  r.append(...children);
  return r;
}

function renderKey(card) {
  const welcome = state.open === "welcome";
  const provider = providerNow();
  const keyHint = state.view?.keyHints?.[provider?.id];
  card.append(el("div", "lbl", welcome ? "Archipelago" : t("hosted.yourKey")));
  if (welcome) card.append(el("p", "lede", t("hosted.lede")));
  const form = el("form", "fields");

  const providers = el("div", "providers");
  providers.setAttribute("role", "radiogroup");
  providers.setAttribute("aria-label", t("hosted.providerLabel"));
  for (const p of state.view?.providers ?? []) {
    const label = el("label", "provider");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "provider";
    radio.checked = p.id === provider?.id;
    radio.disabled = state.saving;
    radio.addEventListener("change", () => pickProvider(p.id));
    label.append(radio, p.name);
    if (state.view.keyHints?.[p.id]) label.append(el("span", "has-key", "•"));
    providers.append(label);
  }
  form.append(providers);

  const field = el("input");
  field.type = "password";
  field.autocomplete = "off";
  field.spellcheck = false;
  field.placeholder = keyHint ? t("hosted.keySet", { hint: keyHint }) : provider?.placeholder ?? "";
  field.value = state.key;
  field.disabled = state.saving;
  field.setAttribute("aria-label", t("hosted.keyLabel", { provider: provider?.name ?? "" }));
  field.addEventListener("input", () => (state.key = field.value));
  form.append(field);

  const models = el("div", "models");
  const radios = [];
  let other = null;
  const preset = (provider?.models ?? []).some((m) => m.id === state.model);
  for (const m of provider?.models ?? []) {
    const label = el("label", "model");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "model";
    radio.checked = state.model === m.id;
    radio.addEventListener("change", () => {
      state.model = m.id;
      if (other) other.value = "";
    });
    radios.push(radio);
    label.append(radio, el("span", "name", m.name), el("span", "note", t(`hosted.${m.note}`)));
    models.append(label);
  }
  // A provider that serves any model takes its id here; typing one unpicks the listed ones.
  if (provider?.custom) {
    other = el("input", "model-id");
    other.type = "text";
    other.autocomplete = "off";
    other.spellcheck = false;
    other.placeholder = t("hosted.modelOther", { provider: provider.name });
    other.setAttribute("aria-label", other.placeholder);
    other.value = preset ? "" : state.model ?? "";
    other.disabled = state.saving;
    other.addEventListener("input", () => {
      const id = other.value.trim();
      state.model = id || provider.models[0].id;
      for (const radio of radios) radio.checked = !id && radio === radios[0];
    });
    models.append(other);
  }
  form.append(models);

  const remember = el("label", "remember");
  const box = el("input");
  box.type = "checkbox";
  box.checked = state.remember;
  box.addEventListener("change", () => (state.remember = box.checked));
  remember.append(box, ` ${t("hosted.remember")}`);
  form.append(remember);

  const actions = row(button(state.saving ? t("hosted.saving") : welcome ? t("hosted.start") : t("hosted.save"), () => void saveKey()));
  actions.firstChild.type = "submit";
  actions.firstChild.disabled = state.saving;
  if (welcome) actions.append(button(t("hosted.tryWithout"), () => void saveKey({ stub: true }), "btn ghost"));
  else {
    if (keyHint) actions.append(button(t("hosted.forgetKey"), () => void forgetKey(), "btn ghost"));
    actions.append(button(t("hosted.cancel"), close, "btn ghost"));
  }
  form.append(actions);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void saveKey();
  });
  card.append(form);
  if (welcome && provider) {
    const get = el("p", "help");
    const link = el("a", null, new URL(provider.keysUrl).host);
    link.href = provider.keysUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const [before, after = ""] = t("hosted.noKey").split("{link}");
    get.append(before, link, after);
    card.append(get, row(button(t("hosted.importDatabase"), importDatabase, "btn link")));
  }
  if (provider) {
    const notice = el("p", "help");
    const [before, after = ""] = t("hosted.notice", { host: "{host}" }).split("{host}");
    notice.append(before, el("code", null, provider.host), after);
    card.append(notice);
  }
  if (!welcome) card.append(el("p", "help", t("hosted.stubHelp")));
}

function renderImport(card) {
  card.append(el("div", "lbl", t("hosted.importTitle")));
  card.append(el("p", "help", t("hosted.importHelp", { file: state.file.name })));
  const actions = row(button(state.saving ? t("hosted.importing") : t("hosted.replace"), () => void replaceWith(state.file)));
  actions.firstChild.disabled = state.saving;
  if (state.from !== "welcome") actions.append(button(t("hosted.exportFirst"), () => void exportDatabase(), "btn ghost"));
  actions.append(button(t("hosted.cancel"), () => (state.from === "welcome" ? open("welcome") : close()), "btn ghost"));
  card.append(actions);
}
