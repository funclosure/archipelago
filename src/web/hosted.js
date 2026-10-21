// What only the hosted build shows: the welcome screen (a key, Try without a key, or an import), Your key, export
// and import of the database, and the hand-over when another tab holds the database. The worker keeps the key
// (`src/hosted/settings.ts`); this page sends it once and reads back only its last four characters.
import { request, release } from "./transport.js";
import { registerRegion } from "./keys.js";

export const isHosted = () => globalThis.ARCHIPELAGO_HOSTED === true;

const NOTICE = [
  "Your key stays in this browser and is sent only to api.anthropic.com.",
  "Each turn is billed to your key; a long session on Opus can cost a few dollars.",
  "Your charts are stored in this browser only; export them from the domain menu to keep a copy.",
];

/** `open`: null, "welcome" (no way out but a choice), "key" (Your key), "import" (the replace warning), "elsewhere". */
const state = { open: null, view: null, key: "", model: null, remember: true, saving: false, error: null, file: null };
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

const post = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

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
      release("Archipelago moved to another tab");
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
  Object.assign(state, { open: kind, key: "", model: state.view?.model ?? null, remember: state.view?.remember ?? true, saving: false, error: null });
  render();
  root.querySelector("input")?.focus();
}

function close() {
  state.open = null;
  render();
}

async function saveKey({ stub = false } = {}) {
  if (state.saving) return;
  const patch = { model: state.model, remember: state.remember };
  if (stub) patch.stub = true;
  else if (state.key.trim()) patch.apiKey = state.key.trim();
  else if (!state.view?.key) {
    state.error = "Paste your API key, or choose Try without a key.";
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
    state.view = await post("/hosted/settings", { apiKey: null, stub: true });
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
    alert(`Export failed: ${error.message}`);
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
  const take = el("button", "crumb start", "Use it here");
  take.type = "button";
  take.addEventListener("click", () => {
    take.disabled = true;
    new BroadcastChannel("archipelago").postMessage("takeover");
    setTimeout(() => location.reload(), 400); // the other tab's worker ends at once; its lock goes with it
  });
  nav.replaceChildren("Archipelago is open in another tab or window. ", take);
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
    card.append(el("div", "lbl", "Archipelago"), el("p", "help", "Archipelago moved to another tab. Reload here to bring it back."));
    card.append(row(button("Reload", () => location.reload())));
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
  card.append(el("div", "lbl", welcome ? "Archipelago" : "Your key"));
  if (welcome) card.append(el("p", "lede", "Chart what you know about a subject as islands on a map. Claude sketches the islands, then asks you about each one and marks how solid your answers are."));
  const form = el("form", "fields");
  const field = el("input");
  field.type = "password";
  field.autocomplete = "off";
  field.spellcheck = false;
  field.placeholder = state.view?.keyHint ? `Key set (${state.view.keyHint}): paste a new one to replace it` : "sk-ant-…";
  field.value = state.key;
  field.disabled = state.saving;
  field.setAttribute("aria-label", "Anthropic API key");
  field.addEventListener("input", () => (state.key = field.value));
  form.append(field);

  const models = el("div", "models");
  for (const m of state.view?.models ?? []) {
    const label = el("label", "model");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "model";
    radio.checked = state.model === m.id;
    radio.addEventListener("change", () => (state.model = m.id));
    label.append(radio, el("span", "name", m.name), el("span", "note", m.note));
    models.append(label);
  }
  form.append(models);

  const remember = el("label", "remember");
  const box = el("input");
  box.type = "checkbox";
  box.checked = state.remember;
  box.addEventListener("change", () => (state.remember = box.checked));
  remember.append(box, " Remember on this device");
  form.append(remember);

  const actions = row(button(state.saving ? "Saving…" : welcome ? "Start" : "Save", () => void saveKey()));
  actions.firstChild.type = "submit";
  actions.firstChild.disabled = state.saving;
  if (welcome) actions.append(button("Try without a key", () => void saveKey({ stub: true }), "btn ghost"));
  else {
    if (state.view?.key) actions.append(button("Forget key", () => void forgetKey(), "btn ghost"));
    actions.append(button("Cancel", close, "btn ghost"));
  }
  form.append(actions);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void saveKey();
  });
  card.append(form);
  if (welcome) {
    const get = el("p", "help");
    const console_ = el("a", null, "console.anthropic.com");
    console_.href = "https://console.anthropic.com/settings/keys";
    console_.target = "_blank";
    console_.rel = "noopener noreferrer";
    get.append("No key yet? Make one at ", console_, ", or try it first without one.");
    card.append(get, row(button("Import a database…", importDatabase, "btn link")));
  }
  const notice = el("p", "help");
  notice.append(...NOTICE.join(" ").split(/(api\.anthropic\.com)/).map((part) => (part === "api.anthropic.com" ? el("code", null, part) : part)));
  card.append(notice);
  if (!welcome) card.append(el("p", "help", "Try without a key answers with a scripted stand-in, so you can see how a turn goes. Forget key goes back to it."));
}

function renderImport(card) {
  card.append(el("div", "lbl", "Import a database"));
  card.append(el("p", "help", `${state.file.name} will replace every domain in this browser. Nothing is merged. Export first to keep what is here.`));
  const actions = row(button(state.saving ? "Importing…" : "Replace", () => void replaceWith(state.file)));
  actions.firstChild.disabled = state.saving;
  if (state.from !== "welcome") actions.append(button("Export first", () => void exportDatabase(), "btn ghost"));
  actions.append(button("Cancel", () => (state.from === "welcome" ? open("welcome") : close()), "btn ghost"));
  card.append(actions);
}
