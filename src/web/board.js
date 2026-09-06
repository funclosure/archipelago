// The board: the island's whiteboard over the map area. Cards both sides write. board-model.js holds the pure parts;
// this module owns #board, #board-toggle, the editor with its live preview, and the board's key handler.
import { app, api } from "./app.js";
import { renderMarkdown, diagramElement } from "./markdown.js";
import { codeElement } from "./code.js";
import { LANGS } from "./code-model.js";
import { registerRegion, setRegion, region } from "./keys.js";
import { startAdd, startEdit, canSave, writeOf, moveCard, keepCursor, KIND_KEYS, PLAIN } from "./board-model.js";

const PREVIEW_MS = 500;
const board = document.getElementById("board");
const toggle = document.getElementById("board-toggle");

const state = {
  slug: null,       // the island the cards belong to
  cards: [],
  loaded: false,
  version: null,    // snapshot version the cards were fetched at; null forces a refetch
  open: false,
  editor: null,     // see startAdd / startEdit in board-model.js
  cursor: null,     // card id under the keyboard cursor
  saving: false,
  loadError: null,
};
let loadGen = 0;
let previewTimer = 0;
let previewSeq = 0;
let editorNode = null;   // the editor element, kept across renders so typing is never interrupted
let editorFor = null;    // the state.editor object editorNode was built for
let editorStatus = null; // the status span inside editorNode
let editorFocus = null;  // focuses the right field of the open editor

export function boardOpen() {
  return state.open && Boolean(state.slug);
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, className = "") {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

const post = (write) =>
  api("/api/board", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: app.domain, island: state.slug, ...write }),
  });

async function load(slug) {
  const gen = ++loadGen;
  const version = app.version;
  try {
    const { cards } = await api(`/api/board?domain=${encodeURIComponent(app.domain)}&island=${encodeURIComponent(slug)}`);
    if (gen !== loadGen || state.slug !== slug) return;
    state.cards = cards;
    if (state.editor && state.editor.id !== null && !cards.some((c) => c.id === state.editor.id)) state.editor = null;
    state.loaded = true;
    state.loadError = null;
    state.version = version;
    state.cursor = keepCursor(cards.map((c) => c.id), state.cursor);
  } catch (error) {
    if (gen !== loadGen) return;
    state.loadError = error.message;
  }
  render();
}

/** Runs on every snapshot and selection change: follows the selected island and refetches when the version moved. */
function sync() {
  const slug = app.selected;
  if (slug !== state.slug) {
    state.slug = slug;
    state.cards = [];
    state.loaded = false;
    state.cursor = null;
    state.editor = null;
    state.version = null;
    state.loadError = null;
    if (!slug) state.open = false;
  }
  if (slug && state.version !== app.version) void load(slug);
  render();
}

function setOpen(open) {
  if (open && !state.slug) return;
  state.open = open;
  if (!open) {
    state.editor = null;
    clearTimeout(previewTimer);
  }
  render();
  // the board lives in the map's slot; keys.js resolves the map container to #board while it is open
  if (open || region() === "map") setRegion("map");
}

function add(kind) {
  state.editor = startAdd(kind);
  render();
  editorFocus?.();
}

function edit(card) {
  state.editor = startEdit(card);
  state.cursor = card.id;
  render();
  editorFocus?.();
}

function cancelEditor() {
  if (!state.editor) return false;
  state.editor = null;
  clearTimeout(previewTimer);
  render();
  board.focus({ preventScroll: true });
  return true;
}

async function saveEditor() {
  const ed = state.editor;
  if (!ed || !canSave(ed) || state.saving) return false;
  state.saving = true;
  setStatus("saving…");
  try {
    const result = await post(writeOf(ed));
    state.saving = false;
    if (state.editor !== ed) return true; // cancelled or replaced while saving
    state.editor = null;
    state.cursor = result.card.id;
    await load(state.slug);
    board.focus({ preventScroll: true });
  } catch (error) {
    state.saving = false;
    if (state.editor !== ed) return true; // cancelled or replaced while saving
    setStatus(error.message, true);
  }
  return true;
}

async function remove(id) {
  try {
    await post({ op: "remove", id });
    if (state.editor && state.editor.id === id) state.editor = null;
    await load(state.slug);
  } catch (error) {
    state.loadError = error.message;
    render();
  }
}

function setStatus(text, bad = false) {
  if (!editorStatus) return;
  editorStatus.textContent = text;
  editorStatus.classList.toggle("bad", bad);
}

function paintCursor() {
  for (const c of board.querySelectorAll(".card")) c.classList.toggle("cur", Number(c.dataset.id) === state.cursor);
}

function scrollCursorIntoView() {
  board.querySelector(".card.cur")?.scrollIntoView({ block: "nearest" });
}

function bodyEl(kind, body, lang, { cache = true } = {}) {
  if (kind === "diagram") return diagramElement(body, { cache });
  if (kind === "code") return codeElement(lang ?? "text", body, true);
  const div = el("div", "note-body");
  div.append(renderMarkdown(body));
  return div;
}

function cardEl(card) {
  const box = el("article", `card${card.id === state.cursor ? " cur" : ""}`);
  box.dataset.id = String(card.id);
  const cap = el("div", "cap");
  cap.append(
    el("span", "kind", card.kind + (card.lang ? ` · ${card.lang}` : "")),
    el("span", "title", card.title),
    el("span", "who", card.author === "judge" ? "the Keeper" : "you"),
  );
  const acts = el("span", "acts");
  acts.append(button("edit", () => edit(card)), button("remove", () => void remove(card.id)));
  cap.append(acts);
  box.append(cap, bodyEl(card.kind, card.body, card.lang));
  box.addEventListener("mousedown", () => {
    state.cursor = card.id;
    paintCursor();
  });
  return box;
}

const PLACEHOLDER = {
  diagram: "flowchart TB\n  app[App] --> cache[Cache]\n  cache --> db[(Database)]",
  note: "A claim, a definition, a list: markdown.",
  code: "Three to twelve lines is plenty.",
};

function renderPreview(ed, preview, err) {
  const seq = ++previewSeq;
  err.hidden = true;
  if (!ed.body.trim()) {
    preview.replaceChildren(el("div", "empty", "preview"));
    return;
  }
  if (ed.kind === "diagram" && window.mermaid) {
    window.mermaid
      .parse(ed.body)
      .then(() => {
        if (seq !== previewSeq || state.editor !== ed) return;
        preview.replaceChildren(bodyEl("diagram", ed.body, null, { cache: false }));
      })
      .catch((e) => {
        if (seq !== previewSeq || state.editor !== ed) return;
        err.textContent = String(e && e.message ? e.message : e).split("\n").slice(0, 3).join("\n");
        err.hidden = false; // the last good render stays in the preview
      });
    return;
  }
  preview.replaceChildren(bodyEl(ed.kind, ed.body, ed.lang === PLAIN ? null : ed.lang, { cache: false }));
}

function editorEl(ed) {
  const box = el("div", "editor");
  const fields = el("div", "fields");
  const title = document.createElement("input");
  title.type = "text";
  title.className = "title";
  title.placeholder = "title";
  title.value = ed.title;
  title.dataset.field = "title";
  fields.append(title);
  let lang = null;
  if (ed.kind === "code") {
    lang = document.createElement("select");
    lang.dataset.field = "lang";
    for (const l of [...LANGS, PLAIN]) {
      const o = document.createElement("option");
      o.value = l;
      o.textContent = l;
      o.selected = l === ed.lang;
      lang.append(o);
    }
    fields.append(lang);
  }
  const ta = document.createElement("textarea");
  ta.value = ed.body;
  ta.placeholder = PLACEHOLDER[ed.kind];
  ta.spellcheck = false;
  ta.dataset.field = "body";
  const err = el("div", "err");
  err.hidden = true;
  fields.append(ta, err);
  const preview = el("div", "preview");
  const row = el("div", "row");
  const save = button("save", () => void saveEditor(), "primary");
  row.append(save, button("cancel", cancelEditor));
  if (ed.id !== null) row.append(button("remove", () => void remove(ed.id), "danger"));
  const status = el("span", "status");
  row.append(status);
  box.append(fields, preview, row);

  const updateSave = () => {
    save.disabled = !canSave(ed) || state.saving;
  };
  const schedulePreview = () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => renderPreview(ed, preview, err), PREVIEW_MS);
  };
  title.addEventListener("input", () => {
    ed.title = title.value;
    updateSave();
  });
  lang?.addEventListener("change", () => {
    ed.lang = lang.value;
    schedulePreview();
  });
  ta.addEventListener("input", () => {
    ed.body = ta.value;
    updateSave();
    schedulePreview();
  });
  updateSave();
  renderPreview(ed, preview, err);
  editorStatus = status;
  editorFocus = () => (ed.title ? ta : title).focus();
  return box;
}

/** The editor element for the current editor, built once per editor session. */
function currentEditor() {
  if (editorFor !== state.editor || !editorNode) {
    editorNode = editorEl(state.editor);
    editorFor = state.editor;
  }
  return editorNode;
}

function headEl(island) {
  const head = el("div", "head");
  head.append(el("span", "name", island.name), el("span", "count", `${state.cards.length} ${state.cards.length === 1 ? "card" : "cards"}`), el("span", "spacer"));
  head.append(button("+ diagram", () => add("diagram")), button("+ note", () => add("note")), button("+ code", () => add("code")), button("map", () => setOpen(false)));
  return head;
}

function columnEl() {
  const col = el("div", "column");
  if (state.loadError) col.append(el("div", "err-line", state.loadError));
  if (state.editor && state.editor.id === null) col.append(currentEditor());
  if (state.loaded && state.cards.length === 0 && !state.editor) {
    col.append(el("div", "empty", "Nothing pinned yet. The Keeper pins what you keep pointing at; you can add a diagram, a note, or code."));
  }
  for (const card of state.cards) col.append(state.editor && state.editor.id === card.id ? currentEditor() : cardEl(card));
  return col;
}

function render() {
  const island = app.snapshot && state.slug ? app.snapshot.islands.find((i) => i.slug === state.slug) ?? null : null;
  toggle.hidden = !island || state.open;
  if (island) toggle.replaceChildren(el("span", null, `board · ${state.cards.length}`), el("kbd", null, "b"));
  const show = Boolean(island) && state.open;
  if (!show) {
    board.hidden = true;
    board.replaceChildren();
    editorNode = null;
    editorFor = null;
    return;
  }
  const active = document.activeElement;
  const keep = editorNode && editorNode.contains(active) ? active : null;
  const scrollTop = board.querySelector(".column")?.scrollTop ?? 0;
  board.hidden = false;
  board.replaceChildren(headEl(island), columnEl());
  if (!state.editor) {
    editorNode = null;
    editorFor = null;
    editorStatus = null;
  }
  board.querySelector(".column").scrollTop = scrollTop;
  if (keep && keep.isConnected) keep.focus({ preventScroll: true });
}

export function installBoard() {
  app.listeners.add(sync);
  toggle.addEventListener("click", () => setOpen(true));
  registerRegion("board", {
    isOpen: () => boardOpen(),
    editing: () => Boolean(state.editor),
    toggle: () => setOpen(!state.open),
    close: () => setOpen(false),
    cancelEditor,
    save: () => (state.editor ? (void saveEditor(), true) : false),
    onKey(e) {
      if (state.editor) return false; // the fields own their keys; Escape and ⌘↵ are handled by keys.js
      const moved = moveCard(state.cards.map((c) => c.id), state.cursor, e.key);
      if (moved !== null) {
        state.cursor = moved;
        paintCursor();
        scrollCursorIntoView();
        return true;
      }
      if (Object.hasOwn(KIND_KEYS, e.key)) {
        add(KIND_KEYS[e.key]);
        return true;
      }
      switch (e.key) {
        case "Enter": {
          const card = state.cards.find((c) => c.id === state.cursor);
          if (!card) return false;
          edit(card);
          return true;
        }
        case "x":
          if (state.cursor === null) return false;
          void remove(state.cursor);
          return true;
        default:
          return false;
      }
    },
  });
  render();
}
