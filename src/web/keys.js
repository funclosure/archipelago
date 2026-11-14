// One keydown listener for the page. Exactly one region (outline, map, pane) has focus; keys go to it.
// Global keys (Tab, [, ?, /, Escape, Cmd-Enter) are handled here; everything else is the region's.
import { app, toggleMode } from "./app.js";
import { select } from "./interactions.js";
import { REGIONS, nextRegion, isTyping, escapeRung, cheatSheet, isImeKey, PALETTE_KEY } from "./keys-model.js";
import { cycleTheme } from "./theme.js";
import { exitFull } from "./full.js";
import { dialogOpen, dialogKeydown, escapeDialog, onFocusReturn, showDialog, dialogHead, focusFirst, keyCaps } from "./dialog.js";
import { tip } from "./tip.js";
import { t } from "./i18n.js";

const handlers = {}; // region name → handler
let current = "outline";
let sheetOpen = false;
let installed = false; // the regions exist (installKeys ran): before that only a dialog has keys

const containers = () => ({
  outline: document.getElementById("outline"),
  map: (handlers.board?.isOpen?.() ? document.getElementById("board") : null) ?? document.getElementById("map"),
  pane: document.getElementById("pane"),
});

export function registerRegion(name, handler) {
  handlers[name] = handler;
}

export function region() {
  return current;
}

/** Moves focus to a region: stamps the body, moves DOM focus, tells the regions. */
export function setRegion(name) {
  if (!REGIONS.includes(name)) return;
  const c = containers()[name];
  const holds = Boolean(c) && (document.activeElement === c || c.contains(document.activeElement));
  if (name === current && holds) return; // a click inside the focused region changes nothing
  const prev = current;
  current = name;
  document.body.dataset.focus = name;
  if (c && document.activeElement !== c && !(c.contains(document.activeElement) && isTyping(document.activeElement))) c.focus({ preventScroll: true });
  if (prev !== name) {
    handlers[prev]?.onBlur?.();
    handlers[name]?.onFocus?.();
  }
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The cheat sheet, a dialog like the others (dialog.js): the page's map of keys. Every section of where the page is
 * now, each row what a key does and its caps; the section of the region that has the keyboard is named in the lamp.
 * Its foot names the command palette's key. The rows come from KEY_SECTIONS in keys-model.js.
 */
function renderSheet() {
  const box = document.getElementById("keys");
  if (!box) return;
  box.hidden = !sheetOpen;
  showDialog(box, sheetOpen, { close: () => toggleSheet(false) });
  box.replaceChildren();
  if (!sheetOpen) return;
  const card = el("div", "dialog-card lg keys-card");
  card.tabIndex = -1; // a dialog that is only read: the card takes focus, not its close button
  card.append(dialogHead(t("keys.title"), () => toggleSheet(false), { title: true, id: "keys-title" }));
  box.setAttribute("aria-labelledby", "keys-title");
  const cols = el("div", "cols");
  for (const section of cheatSheet(current, { board: handlers.board?.isOpen?.() ?? false, chart: handlers.pane?.chartOpen?.() ?? false })) {
    const sec = el("section", `sec${section.here ? " here" : ""}`);
    const name = el("h3", "eyebrow", section.title);
    if (section.here) tip(name, t("keys.here"));
    sec.append(name);
    const list = el("ul", "klist");
    for (const row of section.rows) {
      const item = el("li", "krow");
      const caps = el("span", row.gesture ? "caps gesture" : "caps", row.gesture ?? undefined);
      for (const chord of row.keys) {
        const group = el("span", "chord");
        for (const cap of chord) group.append(el("kbd", null, cap));
        caps.append(group);
      }
      item.append(el("span", "what", row.label), caps);
      list.append(item);
    }
    sec.append(list);
    cols.append(sec);
  }
  const foot = el("div", "keys-foot");
  foot.append(keyCaps(PALETTE_KEY), el("span", null, t("keys.palette")));
  card.append(cols, foot);
  box.append(card);
  focusFirst(box);
}

function toggleSheet(open = !sheetOpen) {
  if (open === sheetOpen) return;
  sheetOpen = open;
  renderSheet();
}

/** A strip hint a click pinned open (app.js toggles `.open` on its cell): Escape and a press elsewhere fold it. */
const pinnedHints = () => [...document.querySelectorAll(".strip-item.open")];
function foldHints(except = null) {
  for (const cell of pinnedHints()) if (!except || !cell.contains(except)) cell.classList.remove("open");
}

function escape(e) {
  if (exitFull()) { // whatever fills the window (a demo, the board's editor) comes back first
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  const rung = escapeRung({
    dialog: dialogOpen(), // any modal dialog, the cheat sheet among them: it steps back or closes by its own rule
    menuOpen: handlers.outline?.menuOpen?.() ?? false,
    hint: pinnedHints().length > 0,
    turn: handlers.pane?.turning?.() ?? false,
    typing: isTyping(e.target),
    editor: handlers.board?.editing?.() ?? false,
    board: handlers.board?.isOpen?.() ?? false,
    loose: handlers.pane?.looseOpen?.() ?? false,
    cursor: current === "outline" && (handlers.outline?.hasCursor?.() ?? false),
    chart: handlers.pane?.chartOpen?.() ?? false,
    group: handlers.map?.gathered?.() ?? false,
    sea: handlers.map?.seaSelected?.() ?? false,
    selected: Boolean(app.selected),
  });
  if (!rung) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (rung === "dialog") escapeDialog();
  else if (rung === "menu") handlers.outline?.closeMenu?.();
  else if (rung === "hint") foldHints();
  else if (rung === "loose") handlers.pane?.closeLoose?.();
  else if (rung === "stop") handlers.pane?.stop?.();
  else if (rung === "blur") {
    e.target.blur();
    containers()[current]?.focus({ preventScroll: true });
  } else if (rung === "editor") handlers.board?.cancelEditor?.();
  else if (rung === "board") handlers.board?.close?.();
  else if (rung === "cursor") handlers.outline?.clearCursor?.();
  else if (rung === "chart") {
    handlers.pane?.closeChart?.();
    if (current === "pane") setRegion("map");
  }
  else if (rung === "group") handlers.map?.clearGroup?.();
  else if (rung === "sea") handlers.map?.clearSea?.();
  else if (rung === "deselect") {
    void select(null);
    if (current === "pane") setRegion("map");
  }
}

const shown = (name) => {
  const c = containers()[name];
  return Boolean(c) && !c.hidden;
};

/** The next region that is on the page, skipping any that are hidden. */
function step(from, back) {
  let n = nextRegion(from, back);
  for (let i = 1; i < REGIONS.length && !shown(n); i++) n = nextRegion(n, back);
  return n;
}

function onKeydown(e) {
  if (isImeKey(e)) return; // the input method owns this key: picking or dismissing a candidate is not a page key
  // A modal dialog owns the keyboard (dialog.js): Tab stays inside it, ⌘↵ is its main action, and no key reaches
  // the page behind it. Escape still goes through the ladder below, where the dialog is the top rung.
  if (dialogOpen()) {
    if (sheetOpen && e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) { // the key that opened the sheet closes it
      e.preventDefault();
      toggleSheet(false);
    } else if (dialogKeydown(e) === "escape") escape(e);
    return;
  }
  if (!installed) return; // before the map is up (the first-run page, the hosted welcome) there are no regions to drive
  if (!shown(current)) setRegion(step(current, false)); // a hidden region (e.g. the pane, poll-hidden) never keeps focus
  if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) { // ⌘⇥ and friends stay the browser's
    if (isTyping(e.target) && e.target.closest("#board .editor")) return; // these fields keep the browser's Tab order
    e.preventDefault();
    setRegion(step(current, e.shiftKey));
    return;
  }
  if (e.key === "Escape") {
    escape(e);
    return;
  }
  if (e.key === "Enter" && e.metaKey) {
    const sent = current === "pane" ? handlers.pane?.send?.() : current === "map" ? handlers.board?.save?.() : false;
    if (sent) {
      e.preventDefault();
      e.stopPropagation(); // the textarea's own Enter handler must not submit as well
    }
    return;
  }
  if (isTyping(e.target)) return; // the field owns its keys
  if (e.metaKey || e.ctrlKey || e.altKey) return; // browser shortcuts stay the browser's
  if (e.key === "?") {
    e.preventDefault();
    toggleSheet();
    return;
  }
  if (e.key === "[") {
    e.preventDefault();
    handlers.outline?.toggleRail?.();
    return;
  }
  if (e.key === "b") {
    e.preventDefault();
    if (app.selected) handlers.board?.toggle?.();
    return;
  }
  if (e.key === "t") {
    e.preventDefault();
    cycleTheme();
    return;
  }
  if (e.key === "m") {
    e.preventDefault();
    toggleMode();
    return;
  }
  if (e.key === "/") {
    e.preventDefault();
    if (!shown("pane")) return;
    setRegion("pane");
    handlers.pane?.focusAnswer?.();
    return;
  }
  const target = current === "map" && handlers.board?.isOpen?.() ? handlers.board : handlers[current];
  if (target?.onKey?.(e)) e.preventDefault();
}

// The page's one keydown listener, live from the first import: a dialog can open before the map is up (the hosted
// welcome) and must have its keys. Region keys wait for installKeys.
if (typeof window !== "undefined") window.addEventListener("keydown", onKeydown, { capture: true });

// A dialog that closes gives the keyboard back to what opened it; when that is gone, to its region (dialog.js).
onFocusReturn((name) => {
  if (!installed) return;
  if (REGIONS.includes(name) && shown(name)) setRegion(name);
  const c = containers()[current];
  if (c && !c.contains(document.activeElement)) c.focus({ preventScroll: true });
});

export function installKeys() {
  installed = true;
  for (const [name, c] of Object.entries(containers())) {
    c?.addEventListener("mousedown", () => setRegion(name));
  }
  document.getElementById("board")?.addEventListener("mousedown", () => setRegion("map")); // the loop registered the canvas; the board is the map's container only while open
  // A pinned strip hint folds on a press anywhere but its own cell (the cell's click toggles it).
  document.addEventListener("pointerdown", (e) => foldHints(e.target instanceof Node ? e.target : null), true);
  setRegion("outline");
}
