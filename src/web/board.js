// The board: the island's whiteboard over the map area. Cards both sides write. board-model.js holds the pure parts;
// this module owns #board, #board-toggle, the editor with its live preview, and the board's key handler.
// Every button here is one of the family's (`.btn` with a size and a variant, styles.css): nothing styles a bare
// <button> by its place on the board.
import { app, api } from "./app.js";
import { renderMarkdown, diagramElement } from "./markdown.js";
import { codeElement, fillCode, copyButton, canCopy } from "./code.js";
import { LANGS } from "./code-model.js";
import { registerRegion, setRegion, region } from "./keys.js";
import { startAdd, startEdit, canSave, writeOf, moveCard, keepCursor, authorLabel, bylineOf, kindLabel, kindName, keyOfKind, hintCard, withoutRemoving, stepCard, afterMove, tabWrap, originOf, isDirty, draftKey, CARD_KINDS, KIND_KEYS, PLAIN } from "./board-model.js";
import { isFull, setFull } from "./full.js";
import { demoElement, demoTools } from "./demo.js";
import { syncPins } from "./pin.js";
import { keyedChildren, patchChildren } from "./keep.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
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
  removing: null,   // { id, kind, title, slug, timer }: a card taken off the board, deleted for good when its undo runs out
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
let editorOrigin = null; // what the open editor started from (originOf): the saved card, or an empty new one
let editorRestored = false; // the open editor began from a draft kept when it last closed without a decision
let editorConfirm = null;   // { show(), hide(), showing() }: the "discard changes?" line of the open editor
/** Unsaved words of editors that closed without a decision (the board closed, another island, another card): by draftKey. */
const drafts = new Map();

const dirty = () => Boolean(state.editor && editorOrigin && isDirty(state.editor, editorOrigin));

/** Keeps the open editor's unsaved words before something other than save or cancel closes it. */
function stash(slug = state.slug) {
  if (slug && dirty()) drafts.set(draftKey(slug, state.editor), originOf(state.editor));
}

/** Opens `editor`, with the draft kept for it if there is one. */
function begin(editor) {
  stash(); // an editor already open gives way without losing its words
  editorOrigin = originOf(editor);
  const key = draftKey(state.slug, editor);
  const draft = drafts.get(key);
  drafts.delete(key);
  editorRestored = Boolean(draft);
  if (draft) Object.assign(editor, draft);
  state.editor = editor;
}

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
  hintFor = null;
  toggle.classList.remove("beckon");
}

let hint = null;    // the first-card hint above the toggle, while it shows
let hintFor = null; // what it says, so a snapshot that changes nothing leaves its buttons alone

/** The first time a persona pins a card, a callout over the toggle says so; it goes for good once the board opens. */
function renderHint(island) {
  const card = island && !state.open ? hintCard(state.cards, seen()) : null;
  toggle.classList.toggle("beckon", Boolean(card));
  if (!card) {
    hint?.remove();
    hint = null;
    hintFor = null;
    return;
  }
  if (!hint) {
    hint = el("div", "board-hint");
    hint.setAttribute("role", "status");
    document.body.append(hint);
  }
  if (hintFor === card.author) return;
  hintFor = card.author;
  const author = authorLabel(card.author);
  const text = button("", () => setOpen(true), "say");
  if (matchMedia("(hover: none)").matches) text.textContent = t("board.hintTouch", { author });
  else {
    // The sentence is one key; the key's own name sits in it as the toggle's chip.
    const [before, after] = t("board.hint", { author, key: "\u0000" }).split("\u0000");
    text.replaceChildren(before, el("kbd", null, "b"), after);
  }
  const dismiss = button("", markSeen, "btn sm quiet icon dismiss");
  dismiss.append(icon("close", { size: 12 }));
  tip(dismiss, t("board.hintDismiss"));
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

/** A button of the family: `className` is its recipe (`btn sm quiet`, `btn md ghost`, …). */
function button(label, onClick, className = "") {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** A square button of one glyph; its tip names it and, if it has one, its key. */
function iconButton(name, label, onClick, className, keys) {
  const b = button("", onClick, `btn icon ${className}`);
  b.append(icon(name, { size: 14 }));
  tip(b, label, keys);
  return b;
}

/** A line of text cut to its box says the rest when the pointer rests on it, and only then. */
function tipWhenCut(node, text) {
  node.addEventListener("pointerover", () => {
    if (node.scrollWidth > node.clientWidth) tip(node, text);
    else delete node.dataset.tip;
  });
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
    stash(state.slug);
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
    stash();
    state.editor = null;
    clearTimeout(previewTimer);
    void flushRemove();
  }
  render();
  // the board lives in the map's slot; keys.js resolves the map container to #board while it is open
  if (open || region() === "map") setRegion("map");
}

function add(kind) {
  begin(startAdd(kind));
  render();
  editorFocus?.();
}

function edit(card) {
  begin(startEdit(card));
  state.cursor = card.id;
  render();
  editorFocus?.();
}

/** Cancel: with unsaved changes it asks once (Escape there goes back to editing, so mashing Escape loses nothing). */
function cancelEditor({ sure = false } = {}) {
  if (!state.editor) return false;
  if (editorConfirm?.showing()) {
    if (!sure) {
      editorConfirm.hide();
      editorFocus?.();
      return true;
    }
  } else if (!sure && dirty() && editorConfirm) {
    editorConfirm.show();
    return true;
  }
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
  state.removing = { id, kind: card.kind, title: card.title ?? null, slug: state.slug, timer: setTimeout(() => void flushRemove(), UNDO_MS) };
  render();
  // The Undo line stands where the card stood; a tall card gone may have left that place above the fold.
  board.querySelector(".column > .undo")?.scrollIntoView({ block: "nearest" });
}

/** Moves a card one place up or down: at once on the page, then on the server. */
async function step(id, dir) {
  const moved = stepCard(shownCards(), id, dir);
  if (!moved) return false;
  state.cards = afterMove(state.cards, id, moved.write.before); // the card waiting out its undo keeps a row, the one the server will give it
  state.cursor = id;
  render();
  scrollCursorIntoView();
  try {
    await post(moved.write);
  } catch (error) {
    state.loadError = error.message;
  }
  await load(state.slug);
  return true;
}

function undoRemove() {
  if (!state.removing) return;
  clearTimeout(state.removing.timer);
  state.cursor = state.removing.id;
  state.removing = null;
  render();
  scrollCursorIntoView();
}

/** The card waiting out its undo on the board on show, or null. */
const removingHere = () => (state.removing?.slug === state.slug ? state.removing : null);

/** The cards on show: all of them but the one waiting out its undo. */
const shownCards = () => withoutRemoving(state.cards, removingHere()?.id ?? null);

function setStatus(text, bad = false) {
  if (!editorStatus) return;
  editorStatus.textContent = text;
  editorStatus.classList.toggle("bad", bad);
}

function paintCursor() {
  for (const c of board.querySelectorAll(".card")) c.classList.toggle("cur", Number(c.dataset.id) === state.cursor);
}

/** The first card cannot go up, the last cannot go down: set on the cards as they stand, kept elements included. */
function paintMoves() {
  const cards = [...board.querySelectorAll(".column > .card")];
  cards.forEach((c, i) => {
    const up = c.querySelector(":scope > .cap .move.up");
    const down = c.querySelector(":scope > .cap .move.down");
    if (up) up.disabled = i === 0;
    if (down) down.disabled = i === cards.length - 1;
  });
}

function scrollCursorIntoView() {
  board.querySelector(".card.cur")?.scrollIntoView({ block: "nearest" });
}

/** A card's body by kind. `card`: on a card the block drops what the card's own caption already says. */
function bodyEl(kind, body, lang, { cache = true, card = false } = {}) {
  if (kind === "diagram") return diagramElement(body, { cache });
  if (kind === "code") return codeElement(lang ?? "text", body, true, { cap: !card });
  if (kind === "demo") return demoElement(body, { foldable: !card });
  const div = el("div", "note-body");
  div.append(renderMarkdown(body));
  return div;
}

/**
 * A card: one caption row (kind, title, who) over its body. Its controls sit at the row's end and show when the
 * pointer is on the card, when the keyboard is in it, or when it is the cursor's card (always, on a touch screen):
 * the block's own tools first (a demo's Reset, Code and Full screen; Copy for code), then the card's (move, edit,
 * remove). They are laid over the row's end, so showing them moves nothing.
 */
function cardEl(card) {
  const box = el("article", `card${card.id === state.cursor ? " cur" : ""}`);
  box.dataset.id = String(card.id);
  box.dataset.kind = card.kind;
  const body = bodyEl(card.kind, card.body, card.lang, { card: true });
  const cap = el("div", "cap");
  cap.append(el("span", "kind", kindLabel(card.kind) + (card.lang ? ` · ${card.lang}` : "")));
  if (card.title) { // the Keeper may name a card; the reader never has to
    const title = el("span", "title", card.title);
    tipWhenCut(title, card.title);
    cap.append(title);
  }
  cap.append(el("span", `who ${card.forkedFrom ?? card.author}`, bylineOf(card)));
  const ctl = el("span", "ctl");
  const tools = el("span", "tools");
  if (card.kind === "demo") tools.append(...demoTools(body));
  else if (card.kind === "code" && canCopy()) tools.append(copyButton(card.body));
  const acts = el("span", "acts");
  // Which arrow is live depends on where the card stands, which changes without the card changing: paintMoves sets it.
  acts.append(
    iconButton("arrow-up", t("board.moveUp"), () => void step(card.id, -1), "sm quiet move up", "⇧K"),
    iconButton("arrow-down", t("board.moveDown"), () => void step(card.id, 1), "sm quiet move down", "⇧J"),
    iconButton("pencil", t("board.edit"), () => edit(card), "sm quiet edit", "↵"),
    iconButton("trash", t("board.remove"), () => void remove(card.id), "sm quiet remove", "x"),
  );
  if (tools.childElementCount) ctl.append(tools);
  ctl.append(acts);
  cap.append(ctl);
  box.append(cap, body);
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
const GROW_MIN = 160;      // px, the writing surface never shrinks below this
const GROW_MAX = 0.6;      // of the viewport, then it scrolls
const GROW_STACKED = 0.36; // a demo's code while the running demo is under it, not beside it: both stay in view

/** Sizes a textarea to its content between the bounds, so the writing surface grows with the note instead of scrolling early. */
function grow(ta, share = GROW_MAX) {
  ta.style.height = "auto";
  const max = Math.round(window.innerHeight * share);
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

/** A two-way segmented switch (Write | Preview), the family's `.segs`; `onPick(name)` runs on change. `labels` says each name on the page. */
function tabs(names, current, onPick, labels = {}) {
  const box = el("div", "segs tabs");
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
 * `share()` is how much of the window's height it may take before it scrolls.
 */
function liveCode(ed, onInput, { lang = () => (ed.lang === PLAIN ? "text" : ed.lang), kind = "code", share = () => GROW_MAX } = {}) {
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
      grow(ta, share());
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

/** A diagram's parse error as the editor shows it: the first lines, which carry the source line and the caret under the fault. */
const parseError = (e) => String(e && e.message ? e.message : e).split("\n").slice(0, 3).join("\n");

/** Renders a note or diagram body into `preview`; a diagram that does not parse shows its error in `err` and keeps the last render. */
function renderPreview(ed, preview, err) {
  const seq = ++previewSeq;
  if (!ed.body.trim()) {
    preview.replaceChildren(el("div", "nothing", t("board.nothingToPreview")));
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
        err.textContent = parseError(e);
        err.hidden = false;
      });
    return;
  }
  preview.replaceChildren(bodyEl(ed.kind, ed.body, null, { cache: false }));
}

/**
 * The editor: a head (kind, the card's title if it has one, language for code, Write | Preview for notes and
 * diagrams), a body, and a foot with the actions and their keys. Notes and diagrams are written in a plain surface
 * that grows with the text; Preview renders it in place. Save is the editor's one filled button.
 */
function editorEl(ed) {
  const box = el("section", `editor ${ed.kind}`);
  box.tabIndex = -1;
  box.setAttribute("aria-label", t(ed.id === null ? "board.ariaNew" : "board.ariaEdit", { kind: kindLabel(ed.kind) }));
  const head = el("div", "ehead");
  head.append(el("span", "kind", ed.id === null ? t("board.newKind", { kind: kindLabel(ed.kind) }) : kindLabel(ed.kind)));
  const title = ed.id === null ? null : state.cards.find((c) => c.id === ed.id)?.title;
  if (title) head.append(el("span", "title", title)); // the card being edited keeps its name over the editor
  const body = el("div", "ebody");
  const foot = el("div", "efoot");
  const save = button("", () => void saveEditor(), "btn md save");
  save.append(t("board.save"), el("kbd", null, "⌘↵"));
  const cancel = button("", cancelEditor, "btn md ghost");
  cancel.append(t("board.cancel"), el("kbd", null, "Esc"));
  const status = el("span", "status");
  foot.append(save, cancel, status);
  if (ed.id !== null) foot.append(button(t("board.remove"), () => void remove(ed.id), "btn md quiet danger remove"));
  // Cancel with unsaved changes asks here first. Discard takes the focus: Enter discards, Escape goes back to editing.
  const confirm = el("div", "confirm");
  confirm.hidden = true;
  confirm.setAttribute("role", "alertdialog");
  const discard = button(t("board.discard"), () => cancelEditor({ sure: true }), "btn md danger");
  confirm.append(el("span", null, t("board.discardAsk")), discard, button(t("board.keepEditing"), () => cancelEditor(), "btn md ghost"));
  editorConfirm = {
    show() {
      confirm.hidden = false;
      foot.hidden = true;
      discard.focus();
    },
    hide() {
      confirm.hidden = true;
      foot.hidden = false;
    },
    showing: () => !confirm.hidden,
  };
  // An editor that opens on words kept from last time says so, and offers the saved card back.
  const restored = el("div", "restored");
  restored.hidden = !editorRestored;
  if (editorRestored) {
    restored.append(el("span", null, t("board.restored")), button(t("board.discardRestored"), () => {
      const fresh = { ...ed, ...editorOrigin };
      editorOrigin = originOf(fresh);
      editorRestored = false;
      state.editor = fresh;
      render();
      editorFocus?.();
    }, "btn sm ghost"));
  }
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
      preview.replaceChildren(ed.body.trim() ? demoElement(ed.body, { preview: true }) : el("div", "nothing", t("board.nothingToPreview")));
    };
    const split = el("div", "split");
    // Stacked (a narrow board), the code takes less of the window so the demo under it stays in view.
    const beside = () => getComputedStyle(split).flexDirection === "row";
    const live = liveCode(ed, () => {
      updateSave();
      clearTimeout(previewTimer);
      previewTimer = setTimeout(run, PREVIEW_MS);
    }, { lang: () => "html", kind: "demo", share: () => (beside() ? GROW_MAX : GROW_STACKED) });
    split.append(live.wrap, preview);
    const full = button("", () => setFull(box, !isFull(box), drawFull), "btn sm quiet");
    const drawFull = () => {
      const on = isFull(box);
      full.classList.toggle("icon", !on); // filling the window, the way back is said in words
      full.replaceChildren(icon(on ? "collapse" : "expand", { size: 14 }), ...(on ? [t("board.exitFull")] : []));
      full.setAttribute("aria-label", t(on ? "board.exitFull" : "board.full"));
      full.setAttribute("aria-pressed", String(on));
      tip(full, t(on ? "board.exitFull" : "board.full"), on ? "Esc" : undefined);
      live.paint(); // the writing surface is sized for the room it has now
    };
    drawFull();
    head.append(el("span", "spacer"), full);
    body.append(split);
    let first = ed.id !== null && !editorRestored; // a saved demo opens at its first line, not its last
    editorFocus = () => {
      live.ta.focus();
      if (!first) return;
      first = false;
      live.ta.setSelectionRange(0, 0);
      requestAnimationFrame(() => {
        live.ta.scrollTop = 0; // after the first paint has sized it
      });
    };
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
        err.textContent = parseError(e);
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
  box.append(head, restored, body, foot, confirm);
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

/** Tab in the open editor moves among its own controls and comes round again; Escape is the way out. */
function editorTab(e) {
  if (!state.editor || !editorNode || !editorNode.contains(e.target)) return false;
  const stops = [...editorNode.querySelectorAll("button, textarea, select")].filter((n) => !n.disabled && n.getClientRects().length > 0);
  const to = tabWrap(stops.length, stops.indexOf(e.target), e.shiftKey);
  if (to !== null) {
    e.preventDefault();
    stops[to].focus();
  }
  return true; // otherwise the browser's own order is right (and a code field keeps Tab for two spaces)
}

let hideTimer = 0;
const SLIDE_MS = 200; // a touch over the sheet's --t-med transition

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

/** One add button: the kind, and its key where a key can be pressed. */
function addButton(kind, className, { chip = false } = {}) {
  const b = button("", () => add(kind), className);
  b.dataset.kind = kind;
  const key = keyOfKind(kind);
  if (chip) b.append(kindName(kind), el("kbd", null, key));
  else {
    b.append(icon("plus", { size: 12 }), kindName(kind));
    tip(b, t("board.newKind", { kind: kindLabel(kind) }), key);
  }
  return b;
}

let headNode = null; // the sheet's head, kept until what it says changes: a snapshot never takes a button from under the pointer
let headSig = "";

/** The sheet's head, one row: the island, how many cards, the four adds (each tip names its key), and the way back. */
function headEl(island) {
  const n = shownCards().length;
  const sig = JSON.stringify([island.name, n]);
  if (headNode && headSig === sig) return headNode;
  const head = el("div", "head");
  const name = el("span", "name", island.name);
  tipWhenCut(name, island.name);
  const adds = el("span", "adds");
  adds.append(...CARD_KINDS.map((kind) => addButton(kind, "btn md ghost")));
  // The way back: a × at the head's end; the peeked map and the scrim say where it leads.
  const close = iconButton("close", t("board.back"), () => setOpen(false), "md quiet close", "Esc");
  head.append(name, el("span", "count", t("board.cards", { n })), adds, close);
  headNode = head;
  headSig = sig;
  return head;
}

/** What each kind is for, in a few words: the empty board's rows. */
const ABOUT = { diagram: "board.aboutDiagram", note: "board.aboutNote", code: "board.aboutCode", demo: "board.aboutDemo" };

/** An empty board says what a board is for and offers the four kinds, each with what it is and its key. */
function emptyEl() {
  const box = el("div", "empty");
  box.append(el("h3", null, t("board.emptyTitle")), el("p", null, t("board.empty")));
  const kinds = el("div", "kinds");
  for (const kind of CARD_KINDS) {
    const row = button("", () => add(kind), "mi");
    row.dataset.kind = kind;
    // The key's cap sits at the row's end. (Not the menu's `.keys` span: that class is also the cheat sheet's root.)
    row.append(icon("plus", { size: 14 }), el("span", "nm", kindName(kind)), el("span", "grow", t(ABOUT[kind])), el("kbd", null, keyOfKind(kind)));
    kinds.append(row);
  }
  box.append(kinds);
  return box;
}

/** A removed card's line, where the card stood, until its undo runs out. */
function undoEl(gone) {
  const bar = el("div", "undo");
  bar.setAttribute("role", "status");
  const undo = button("", undoRemove, "btn sm ghost");
  undo.append(t("board.undo"), el("kbd", null, "u"));
  bar.append(el("span", "said", gone.title ? t("board.removedTitled", { title: gone.title }) : t("board.removed", { kind: kindLabel(gone.kind) })), undo);
  return bar;
}

/** The column's children. A card keeps its element until the card changes, so a demo on it keeps running. */
function columnEntries() {
  const out = [];
  if (state.loadError) out.push({ build: () => el("div", "err-line", state.loadError) });
  if (state.editor && state.editor.id === null) out.push({ build: currentEditor });
  const gone = removingHere();
  if (state.loaded && shownCards().length === 0 && !state.editor && !gone) out.push({ key: "empty", sig: String(drawGen), build: emptyEl });
  for (const card of state.cards) {
    if (gone && gone.id === card.id) out.push({ key: "undo", sig: String(gone.id), build: () => undoEl(gone) }); // in the card's own row
    else if (state.editor && state.editor.id === card.id) out.push({ build: currentEditor });
    else out.push({ key: card.id, sig: JSON.stringify([drawGen, card]), build: () => cardEl(card) });
  }
  return out;
}

let toggleSig = null;

function render() {
  const island = app.snapshot && state.slug ? app.snapshot.islands.find((i) => i.slug === state.slug) ?? null : null;
  toggle.hidden = !island || state.open;
  if (island) {
    const n = shownCards().length;
    if (toggleSig !== n) {
      toggleSig = n;
      toggle.replaceChildren(icon("board", { size: 14 }), el("span", null, t("board.toggle", { n })), el("kbd", null, "b"));
    }
  }
  renderHint(island);
  const show = Boolean(island) && state.open;
  if (!show) {
    setVisible(false);
    editorNode = null;
    editorFor = null;
    editorStatus = null;
    editorConfirm = null;
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
  paintMoves();
  board.classList.toggle("editing", Boolean(state.editor)); // one lamp ring at a time: the editor's
  if (!state.editor) {
    editorNode = null;
    editorFor = null;
    editorStatus = null;
    editorConfirm = null;
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
    tab: editorTab,
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
        case "J":
        case "K":
          if (state.cursor === null) return false;
          void step(state.cursor, e.key === "J" ? 1 : -1);
          return true;
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
        case "u": // the card just removed comes back, while its Undo line stands
          if (!removingHere()) return false;
          undoRemove();
          return true;
        default:
          return false;
      }
    },
  });
  render();
}
