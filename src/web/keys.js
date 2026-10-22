// One keydown listener for the page. Exactly one region (outline, map, pane) has focus; keys go to it.
// Global keys (Tab, [, ?, /, Escape, Cmd-Enter) are handled here; everything else is the region's.
import { app, toggleMode } from "./app.js";
import { select } from "./interactions.js";
import { REGIONS, nextRegion, isTyping, escapeRung, aboutKey, cheatSheet, isImeKey } from "./keys-model.js";
import { cycleTheme } from "./theme.js";

const handlers = {}; // region name → handler
let current = "outline";
let sheetOpen = false;

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
  if (sheetOpen) renderSheet();
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderSheet() {
  const box = document.getElementById("keys");
  if (!box) return;
  box.hidden = !sheetOpen;
  box.replaceChildren();
  if (!sheetOpen) return;
  const card = el("div", "keys-card");
  card.append(el("div", "lbl", "Keys"));
  const cols = el("div", "cols");
  for (const section of cheatSheet(current, { board: handlers.board?.isOpen?.() ?? false, chart: handlers.pane?.chartOpen?.() ?? false })) {
    const col = el("div", "col");
    col.append(el("div", "sec", section.title));
    for (const [k, label] of section.keys) {
      const row = el("div", "krow");
      row.append(el("kbd", null, k), el("span", null, label));
      col.append(row);
    }
    cols.append(col);
  }
  card.append(cols);
  box.append(card);
}

function toggleSheet() {
  sheetOpen = !sheetOpen;
  renderSheet();
}

function escape(e) {
  const rung = escapeRung({
    sheetOpen,
    about: handlers.about?.isOpen?.() ?? false,
    menuOpen: handlers.outline?.menuOpen?.() ?? false,
    turn: handlers.pane?.turning?.() ?? false,
    typing: isTyping(e.target),
    editor: handlers.board?.editing?.() ?? false,
    board: handlers.board?.isOpen?.() ?? false,
    cursor: current === "outline" && (handlers.outline?.hasCursor?.() ?? false),
    chart: handlers.pane?.chartOpen?.() ?? false,
    group: handlers.map?.gathered?.() ?? false,
    sea: handlers.map?.seaSelected?.() ?? false,
    selected: Boolean(app.selected),
  });
  if (!rung) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (rung === "sheet") toggleSheet();
  else if (rung === "about") handlers.about?.close?.();
  else if (rung === "menu") handlers.outline?.closeMenu?.();
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
  if (!shown(current)) setRegion(step(current, false)); // a hidden region (e.g. the pane, poll-hidden) never keeps focus
  if (handlers.hosted?.isOpen?.()) { // the hosted build's dialogs are modal: Escape closes the ones that can close
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      handlers.hosted.close();
    } else if (!e.target?.closest?.("#hosted")) e.stopPropagation();
    return;
  }
  if (handlers.newDomain?.isOpen?.()) { // the New domain dialog is modal: Escape closes it, its field keeps its keys
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      handlers.newDomain.close();
    } else if (!e.target?.closest?.("#new-domain")) e.stopPropagation();
    return;
  }
  if (handlers.about?.isOpen?.()) { // the About you editor is modal for page keys
    const act = aboutKey({ key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, inAbout: Boolean(e.target?.closest?.("#about")) });
    if (act === "escape") escape(e);
    else if (act === "save") {
      e.preventDefault();
      e.stopPropagation();
      handlers.about.save?.();
    } else if (act === "enter") {
      e.preventDefault();
      handlers.about.focusIn?.();
    } else if (act === "block") e.stopPropagation();
    return;
  }
  if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) { // ⌘⇥ and friends stay the browser's
    if (isTyping(e.target) && e.target.closest("#board .editor, #about")) return; // these fields keep the browser's Tab order
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
  if (sheetOpen) return; // the sheet is modal for region keys
  const target = current === "map" && handlers.board?.isOpen?.() ? handlers.board : handlers[current];
  if (target?.onKey?.(e)) e.preventDefault();
}

export function installKeys() {
  window.addEventListener("keydown", onKeydown, { capture: true });
  for (const [name, c] of Object.entries(containers())) {
    c?.addEventListener("mousedown", () => setRegion(name));
  }
  document.getElementById("board")?.addEventListener("mousedown", () => setRegion("map")); // the loop registered the canvas; the board is the map's container only while open
  setRegion("outline");
}
