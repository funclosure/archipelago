// The board: the island's whiteboard over the map area. Cards both sides write. board-model.js holds the pure parts;
// this module owns #board, #board-toggle, the editor with its live preview, and the board's key handler.
import { app, api } from "./app.js";
import { renderMarkdown, diagramElement } from "./markdown.js";
import { codeElement, fillCode } from "./code.js";
import { LANGS } from "./code-model.js";
import { registerRegion, setRegion, region } from "./keys.js";
import { startAdd, startEdit, canSave, writeOf, moveCard, keepCursor, authorLabel, bylineOf, kindLabel, hintCard, withoutRemoving, KIND_KEYS, PLAIN } from "./board-model.js";
import { isFull, setFull } from "./full.js";
import { demoElement } from "./demo.js";
import { syncPins } from "./pin.js";
import { keyedChildren, patchChildren } from "./keep.js";
import { t } from "./i18n.js";

const PREVIEW_MS = 500;
const board = document.getElementById("board");
const toggle = document.getElementById("board-toggle");
const scrim = document.getElementById("board-scrim");
/** Set once the reader opens a board or waves the first-card hint away: per browser, a convenience only. */
const SEEN = "board:seen";

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
  removing: null,   // { id, kind, timer }: a card taken off the board, deleted for good when its undo runs out
};
const UNDO_MS = 7000;
let loadGen = 0;
let drawGen = 0;       // bumped when every card must be drawn again (a theme change)
let previewTimer = 0;
let previewSeq = 0;
let editorNode = null;   // the editor element, kept across renders so typing is never interrupted
let editorFor = null;    // the state.editor object editorNode was built for
let editorStatus = null; // the status span inside editorNode
let editorFocus = null;  // focuses the right field of the open editor

function seen() {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN, "1");
  } catch {}
  hint?.remove();
  hint = null;
  toggle.classList.remove("beckon");
}

let hint = null; // the first-card hint above the toggle, while it shows

/** The first time a persona pins a card, a callout over the toggle says so; it goes for good once the board opens. */
function renderHint(island) {
  const card = island && !state.open ? hintCard(state.cards, seen()) : null;
  toggle.classList.toggle("beckon", Boolean(card));
  if (!card) {
    hint?.remove();
    hint = null;
    return;
  }
  if (!hint) {
    hint = el("div", "board-hint");
    hint.setAttribute("role", "status");
    document.body.append(hint);
  }
  const author = authorLabel(card.author);
  const text = button("", () => setOpen(true), "say");
  if (matchMedia("(hover: none)").matches) text.textContent = t("board.hintTouch", { author });
  else {
    // The sentence is one key; the key's own name sits in it as the toggle's chip.
    const [before, after] = t("board.hint", { author, key: "\u0000" }).split("\u0000");
    text.replaceChildren(before, el("kbd", null, "b"), after);
  }
  const dismiss = button("×", markSeen, "dismiss");
  dismiss.setAttribute("aria-label", t("board.hintDismiss"));
  dismiss.title = t("board.hintDismiss");
  hint.replaceChildren(text, dismiss);
}

/** How many cards the selected island's board holds. */
export function boardCount() {
  return shownCards().length;
}

export function closeBoard() {
  setOpen(false);
}

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

const post = (write, island = state.slug) =>
  api("/api/board", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: app.domain, island, ...write }),
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
    syncPins();
    document.dispatchEvent(new CustomEvent("board", { detail: {} })); // the cards changed
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
    void flushRemove(); // the undo belonged to the board being left
    state.slug = slug;
    state.cards = [];
    state.loaded = false;
    state.cursor = null;
    state.editor = null;
    state.version = null;
    state.loadError = null;
    if (!slug && state.open) {
      state.open = false;
      document.dispatchEvent(new CustomEvent("board", { detail: { open: false } }));
      if (region() === "map") queueMicrotask(() => setRegion("map")); // after render() hides #board, so the map canvas takes focus
    }
  }
  if (slug && state.version !== app.version) void load(slug);
  render();
}

function setOpen(open) {
  if (open && !state.slug) return;
  if (open) markSeen();
  const was = state.open;
  state.open = open;
  if (was !== open) document.dispatchEvent(new CustomEvent("board", { detail: { open } }));
  if (!open) {
    state.editor = null;
    clearTimeout(previewTimer);
    void flushRemove();
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
  setStatus(t("board.saving"));
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

/** Opens the board; `latest` puts the cursor on the card changed most recently and brings it into view. */
export function openBoard({ latest = false } = {}) {
  if (latest && state.cards.length) state.cursor = state.cards.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a)).id;
  setOpen(true);
  if (latest) requestAnimationFrame(scrollCursorIntoView);
}

/** Pins a fence from a persona's reply as the reader's card, then refetches. For card.js's pin buttons. */
export async function pinFromReply({ kind, body, lang = null, from }) {
  const slug = state.slug;
  if (!slug) throw new Error(t("board.noIsland"));
  const write = { op: "add", kind, body, from };
  if (kind === "code") write.lang = lang;
  await post(write);
  if (state.slug === slug) await load(slug);
}

/** Whether a card with exactly this body is already on the selected island's board. */
export function isPinned(body) {
  return state.cards.some((c) => c.body === body);
}

/** Deletes for good the card waiting out its undo, if there is one. */
async function flushRemove() {
  const gone = state.removing;
  if (!gone) return;
  clearTimeout(gone.timer);
  state.removing = null;
  try {
    await post({ op: "remove", id: gone.id }, gone.slug);
  } catch (error) {
    if (state.slug === gone.slug) state.loadError = error.message;
  }
  if (state.slug === gone.slug) await load(gone.slug);
  else render();
}

/** Takes a card off the board. It is deleted when the undo runs out, on the next remove, or when the board closes. */
async function remove(id) {
  const card = state.cards.find((c) => c.id === id);
  if (!card) return;
  await flushRemove();
  if (state.editor && state.editor.id === id) state.editor = null;
  if (state.cursor === id) state.cursor = null;
  state.removing = { id, kind: card.kind, slug: state.slug, timer: setTimeout(() => void flushRemove(), UNDO_MS) };
  render();
}

function undoRemove() {
  if (!state.removing) return;
  clearTimeout(state.removing.timer);
  state.cursor = state.removing.id;
  state.removing = null;
  render();
}

/** The cards on show: all of them but the one waiting out its undo. */
const shownCards = () => withoutRemoving(state.cards, state.removing?.slug === state.slug ? state.removing.id : null);

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
  if (kind === "demo") return demoElement(body);
  const div = el("div", "note-body");
  div.append(renderMarkdown(body));
  return div;
}

function cardEl(card) {
  const box = el("article", `card${card.id === state.cursor ? " cur" : ""}`);
  box.dataset.id = String(card.id);
  const cap = el("div", "cap");
  cap.append(el("span", "kind", kindLabel(card.kind) + (card.lang ? ` · ${card.lang}` : "")));
  if (card.title) cap.append(el("span", "title", card.title)); // the Keeper may name a card; the reader never has to
  cap.append(el("span", `who ${card.forkedFrom ?? card.author}`, bylineOf(card)));
  const acts = el("span", "acts");
  acts.append(button(t("board.edit"), () => edit(card)), button(t("board.remove"), () => void remove(card.id)));
  cap.append(acts);
  box.append(cap, bodyEl(card.kind, card.body, card.lang));
  box.addEventListener("mousedown", () => {
    state.cursor = card.id;
    paintCursor();
  });
  return box;
}

const PLACEHOLDER = {
  diagram: t("board.placeholderDiagram"),
  note: t("board.placeholderNote"),
  code: t("board.placeholderCode"),
  demo: t("board.placeholderDemo"),
};
const GROW_MIN = 160;   // px, the writing surface never shrinks below this
const GROW_MAX = 0.6;   // of the viewport, then it scrolls

/** Sizes a textarea to its content between the bounds, so the writing surface grows with the note instead of scrolling early. */
function grow(ta) {
  ta.style.height = "auto";
  const max = Math.round(window.innerHeight * GROW_MAX);
  ta.style.height = `${Math.min(max, Math.max(GROW_MIN, ta.scrollHeight))}px`;
  ta.style.overflowY = ta.scrollHeight > max ? "auto" : "hidden";
}

/** The language picker for a code card, in the editor's head. */
function langSelect(ed, onChange) {
  const sel = document.createElement("select");
  sel.dataset.field = "lang";
  sel.setAttribute("aria-label", t("board.language"));
  for (const l of [...LANGS, PLAIN]) {
    const o = document.createElement("option");
    o.value = l;
    o.textContent = l;
    o.selected = l === ed.lang;
    sel.append(o);
  }
  sel.addEventListener("change", () => {
    ed.lang = sel.value;
    onChange();
  });
  return sel;
}

/** A two-way segmented switch (Write | Preview); `onPick(name)` runs on change. `labels` says each name on the page. */
function tabs(names, current, onPick, labels = {}) {
  const box = el("div", "tabs");
  box.setAttribute("role", "tablist");
  const buttons = names.map((name) => {
    const b = button(labels[name] ?? name, () => {
      if (b.getAttribute("aria-selected") === "true") return;
      for (const other of buttons) other.setAttribute("aria-selected", String(other === b));
      onPick(name);
    }, "tab");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(name === current));
    return b;
  });
  box.append(...buttons);
  return box;
}

/**
 * A live code block: a transparent textarea over a highlighted mirror with the same metrics, so the reader
 * types into coloured code. The mirror repaints once per input frame and follows the textarea's scroll.
 */
function liveCode(ed, onInput, { lang = () => (ed.lang === PLAIN ? "text" : ed.lang), kind = "code" } = {}) {
  const wrap = el("div", "live");
  const pre = document.createElement("pre");
  pre.setAttribute("aria-hidden", "true");
  const code = document.createElement("code");
  pre.append(code);
  const ta = document.createElement("textarea");
  ta.value = ed.body;
  ta.placeholder = PLACEHOLDER[kind];
  ta.spellcheck = false;
  ta.wrap = "off";
  ta.dataset.field = "body";
  ta.setAttribute("aria-label", kindLabel(kind));
  wrap.append(pre, ta);
  let frame = 0;
  const follow = () => {
    pre.scrollLeft = ta.scrollLeft;
    pre.scrollTop = ta.scrollTop;
  };
  const paint = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const text = ta.value;
      // a trailing newline would collapse in the mirror and leave the caret's line unpainted
      fillCode(code, lang(), text.endsWith("\n") ? `${text} ` : text, false);
      grow(ta);
      follow();
    });
  };
  ta.addEventListener("input", () => {
    ed.body = ta.value;
    onInput();
    paint();
  });
  ta.addEventListener("scroll", follow);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) { // two spaces, like the Keeper's fences; Shift-Tab still leaves
      e.preventDefault();
      ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  paint();
  return { wrap, ta, paint };
}

/** Renders a note or diagram body into `preview`; a diagram that does not parse shows its error in `err` and keeps the last render. */
function renderPreview(ed, preview, err) {
  const seq = ++previewSeq;
  if (!ed.body.trim()) {
    preview.replaceChildren(el("div", "empty", t("board.nothingToPreview")));
    return;
  }
  if (ed.kind === "diagram" && window.mermaid) {
    window.mermaid
      .parse(ed.body)
      .then(() => {
        if (seq !== previewSeq || state.editor !== ed) return;
        err.hidden = true;
        preview.replaceChildren(bodyEl("diagram", ed.body, null, { cache: false }));
      })
      .catch((e) => {
        if (seq !== previewSeq || state.editor !== ed) return;
        err.textContent = String(e && e.message ? e.message : e).split("\n").slice(0, 3).join("\n");
        err.hidden = false;
      });
    return;
  }
  preview.replaceChildren(bodyEl(ed.kind, ed.body, null, { cache: false }));
}

/**
 * The editor: a head (kind, language for code, Write | Preview for notes and diagrams), a body, and a foot with the
 * actions. Notes and diagrams are written in a plain surface that grows with the text; Preview renders it in place.
 */
function editorEl(ed) {
  const box = el("section", `editor ${ed.kind}`);
  box.tabIndex = -1;
  box.setAttribute("aria-label", t(ed.id === null ? "board.ariaNew" : "board.ariaEdit", { kind: kindLabel(ed.kind) }));
  const head = el("div", "ehead");
  head.append(el("span", "kind", ed.id === null ? t("board.newKind", { kind: kindLabel(ed.kind) }) : kindLabel(ed.kind)));
  const body = el("div", "ebody");
  const foot = el("div", "efoot");
  const save = button(t("board.save"), () => void saveEditor(), "primary");
  foot.append(save, button(t("board.cancel"), cancelEditor));
  if (ed.id !== null) foot.append(button(t("board.remove"), () => void remove(ed.id), "danger"));
  const hint = el("span", "hint");
  hint.append(el("kbd", null, "⌘↵"), t("board.hintSave"), el("kbd", null, "esc"), t("board.hintCancel"));
  const status = el("span", "status");
  foot.append(hint, status);
  const updateSave = () => {
    save.disabled = !canSave(ed) || state.saving;
  };

  if (ed.kind === "demo") {
    // Code on one side, the demo running on the other: it starts over a beat after the typing stops.
    const preview = el("div", "preview");
    let shown = null;
    const run = () => {
      if (shown === ed.body || state.editor !== ed) return;
      shown = ed.body;
      preview.replaceChildren(ed.body.trim() ? demoElement(ed.body, { preview: true }) : el("div", "empty", t("board.nothingToPreview")));
    };
    const live = liveCode(ed, () => {
      updateSave();
      clearTimeout(previewTimer);
      previewTimer = setTimeout(run, PREVIEW_MS);
    }, { lang: () => "html", kind: "demo" });
    const split = el("div", "split");
    split.append(live.wrap, preview);
    const full = button("", () => setFull(box, !isFull(box), drawFull));
    const drawFull = () => {
      full.textContent = t(isFull(box) ? "board.exitFull" : "board.full");
      full.setAttribute("aria-pressed", String(isFull(box)));
      live.paint(); // the writing surface is sized for the room it has now
    };
    drawFull();
    head.append(el("span", "spacer"), full);
    body.append(split);
    editorFocus = () => live.ta.focus();
    run();
  } else if (ed.kind === "code") {
    const live = liveCode(ed, updateSave);
    head.append(el("span", "spacer"), langSelect(ed, live.paint));
    body.append(live.wrap);
    editorFocus = () => live.ta.focus();
  } else {
    const ta = document.createElement("textarea");
    ta.className = "write";
    ta.value = ed.body;
    ta.placeholder = PLACEHOLDER[ed.kind];
    ta.spellcheck = ed.kind === "note";
    ta.dataset.field = "body";
    ta.setAttribute("aria-label", kindLabel(ed.kind));
    const preview = el("div", "preview");
    preview.hidden = true;
    const err = el("div", "err");
    err.hidden = true;
    const checkDiagram = () => {
      // while writing, only the error line updates; the drawing waits for Preview
      if (ed.kind !== "diagram" || !window.mermaid) return;
      const seq = ++previewSeq;
      if (!ed.body.trim()) {
        err.hidden = true;
        return;
      }
      window.mermaid.parse(ed.body).then(() => {
        if (seq === previewSeq) err.hidden = true;
      }).catch((e) => {
        if (seq !== previewSeq) return;
        err.textContent = String(e && e.message ? e.message : e).split("\n").slice(0, 3).join("\n");
        err.hidden = false;
      });
    };
    ta.addEventListener("input", () => {
      ed.body = ta.value;
      updateSave();
      grow(ta);
      clearTimeout(previewTimer);
      previewTimer = setTimeout(checkDiagram, PREVIEW_MS);
    });
    const pick = (name) => {
      const showing = name === "Preview";
      ta.hidden = showing;
      preview.hidden = !showing;
      if (showing) {
        renderPreview(ed, preview, err);
        box.focus({ preventScroll: true }); // Escape now cancels the editor instead of blurring a field
      } else {
        ta.focus();
        grow(ta);
      }
    };
    head.append(el("span", "spacer"), tabs(["Write", "Preview"], "Write", pick, { Write: t("board.write"), Preview: t("board.preview") }));
    body.append(ta, preview, err);
    editorFocus = () => {
      ta.focus();
      grow(ta);
    };
    requestAnimationFrame(() => grow(ta));
    checkDiagram();
  }
  box.append(head, body, foot);
  updateSave();
  editorStatus = status;
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

/** A 12px cross drawn with two strokes, in the button's colour. */
function closeIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ["M2 2 L10 10", "M10 2 L2 10"]) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "1.5");
    p.setAttribute("stroke-linecap", "round");
    svg.append(p);
  }
  return svg;
}

/** The way back: a × at the head's right end; the peeked map and the scrim say where it leads. */
function close() {
  const b = button("", () => setOpen(false), "close");
  b.append(closeIcon());
  b.title = t("board.backTitle");
  b.setAttribute("aria-label", t("board.back"));
  return b;
}

let hideTimer = 0;
const SLIDE_MS = 200; // a touch over the .18s transition

/** Shows or hides the sheet and its scrim with the slide: unhide, then next frame add `in`; on close, hide after the slide. */
function setVisible(show) {
  clearTimeout(hideTimer);
  if (show) {
    if (board.hidden) {
      board.hidden = false;
      scrim.hidden = false;
      void board.offsetHeight; // commit the hidden position so the slide starts from it
    }
    board.classList.add("in");
    scrim.classList.add("in");
    return;
  }
  if (board.hidden) return;
  board.classList.remove("in");
  scrim.classList.remove("in");
  hideTimer = setTimeout(() => {
    board.hidden = true;
    scrim.hidden = true;
    board.replaceChildren();
  }, SLIDE_MS);
}

function headEl(island) {
  const head = el("div", "head");
  // The adds are one group: when the title leaves no room, they wrap to a second row together, and the × stays top right.
  const adds = el("span", "adds");
  adds.append(...["diagram", "note", "code", "demo"].map((kind) => button(t("board.addKind", { kind: kindLabel(kind) }), () => add(kind))));
  head.append(el("span", "name", island.name), el("span", "count", t("board.cards", { n: shownCards().length })), adds, close());
  return head;
}

/** The column's children. A card keeps its element until the card changes, so a demo on it keeps running. */
function columnEntries() {
  const out = [];
  if (state.loadError) out.push({ build: () => el("div", "err-line", state.loadError) });
  if (state.editor && state.editor.id === null) out.push({ build: currentEditor });
  if (state.removing?.slug === state.slug) {
    const gone = state.removing;
    out.push({
      build: () => {
        const bar = el("div", "undo");
        bar.setAttribute("role", "status");
        bar.append(el("span", null, t("board.removed", { kind: kindLabel(gone.kind) })), button(t("board.undo"), undoRemove));
        return bar;
      },
    });
  }
  const cards = shownCards();
  if (state.loaded && cards.length === 0 && !state.editor) out.push({ build: () => el("div", "empty", t("board.empty")) });
  for (const card of cards) {
    if (state.editor && state.editor.id === card.id) out.push({ build: currentEditor });
    else out.push({ key: card.id, sig: JSON.stringify([drawGen, card]), build: () => cardEl(card) });
  }
  return out;
}

function render() {
  const island = app.snapshot && state.slug ? app.snapshot.islands.find((i) => i.slug === state.slug) ?? null : null;
  toggle.hidden = !island || state.open;
  if (island) toggle.replaceChildren(el("span", null, t("board.toggle", { n: shownCards().length })), el("kbd", null, "b"));
  renderHint(island);
  const show = Boolean(island) && state.open;
  if (!show) {
    setVisible(false);
    editorNode = null;
    editorFor = null;
    editorStatus = null;
    return;
  }
  const active = document.activeElement;
  const keep = editorNode && editorNode.contains(active) ? active : null;
  const column = board.querySelector(":scope > .column") ?? el("div", "column");
  const scrollTop = column.scrollTop;
  setVisible(true);
  patchChildren(board, [headEl(island), column]); // the column stays on the page, and so do its unchanged cards
  keyedChildren(column, columnEntries());
  paintCursor();
  if (!state.editor) {
    editorNode = null;
    editorFor = null;
    editorStatus = null;
  }
  column.scrollTop = scrollTop;
  if (keep && keep.isConnected) keep.focus({ preventScroll: true });
}

export function installBoard() {
  app.listeners.add(sync);
  document.addEventListener("theme", () => {
    drawGen++; // cards are rebuilt; the diagram cache was cleared
    render();
  });
  toggle.addEventListener("click", () => setOpen(true));
  scrim.addEventListener("click", () => setOpen(false)); // clicking the peeked map goes back to it
  registerRegion("board", {
    isOpen: () => boardOpen(),
    editing: () => Boolean(state.editor),
    toggle: () => setOpen(!state.open),
    close: () => setOpen(false),
    cancelEditor,
    save: () => (state.editor ? (void saveEditor(), true) : false),
    onKey(e) {
      if (state.editor) return false; // the fields own their keys; Escape and ⌘↵ are handled by keys.js
      const moved = moveCard(shownCards().map((c) => c.id), state.cursor, e.key);
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
