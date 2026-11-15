// One keydown listener for the page. Exactly one region (outline, map, pane) has focus; keys go to it.
// Global keys (Tab, [, ?, /, Escape, Cmd-Enter) are handled here; everything else is the region's. The controls over
// the map (chrome.js: the header, its hint card, the dock, the bottom card) have no key listener of their own: this
// one offers them their keys at their place in the order below, so no key is ever taken twice.
// The keyboard is never left on the page itself: when the control that had it goes (removed or hidden by what it
// did), its region takes it back (catchFall), and focus that lands in a region by any means makes it the region.
import { app, toggleMode } from "./app.js";
import { select } from "./interactions.js";
import { REGIONS, nextRegion, isTyping, escapeRung, cheatSheet, isImeKey, PALETTE_KEY } from "./keys-model.js";
import { cycleTheme } from "./theme.js";
import { exitFull } from "./full.js";
import { dialogOpen, dialogKeydown, escapeDialog, onFocusReturn, showDialog, dialogHead, focusFirst, keyCaps } from "./dialog.js";
import { tip } from "./tip.js";
import { t } from "./i18n.js";
import { isPaletteOpen, openPalette, opensPalette, paletteKey } from "./palette.js";

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

/** The controls over the map: the keyboard on one of them is in the map's region (Tab goes on from there). */
const OVER_MAP = ".chrome.top, #dock, #cta, #board-toggle, .now-playing, .map-note";

/** The region a focused node belongs to, or null for one outside them all (a dialog, the palette, a sea's name). */
function regionOf(node) {
  if (!(node instanceof Element)) return null;
  const c = containers();
  for (const name of REGIONS) if (c[name]?.contains(node)) return name;
  return node.closest(OVER_MAP) ? "map" : null;
}

/** Whether a region's container can hold the keyboard now: on the page, drawn, and not behind a dialog. */
function rendered(name) {
  const c = containers()[name];
  return Boolean(c) && !c.hidden && !c.closest("[inert]") && c.getClientRects().length > 0;
}

/** Where the keyboard goes when what held it went away: its region, else the map (the pane closed), else the next one shown. */
function landing() {
  if (rendered(current)) return current;
  if (rendered("map")) return "map";
  return step(current, false);
}

const fallen = () => !document.activeElement || document.activeElement === document.body || document.activeElement === document.documentElement;

/**
 * Focus fell to the page itself: the control that had it was removed or hidden by what it did (Sail in, Confirm the
 * reef, Pin to board, Dismiss, the board's Undo, a pane closing). Its region's container takes it, or the map's when
 * that region is gone. A dialog, the palette and the domain menu place focus by their own rules.
 */
function catchFall() {
  if (!installed || !fallen() || dialogOpen() || isPaletteOpen() || handlers.outline?.menuOpen?.()) return;
  setRegion(landing());
}

let landWatch = null; // stops the watch of the latest landIn, if it is still waiting
const LAND_WAIT_MS = 4000; // a thread that takes longer to read leaves the keyboard on the pane itself

/**
 * Gives the keyboard to a region an action has just brought up (the dock's buttons, the bottom card's): in the pane,
 * to its answer box or its start button as soon as one is drawn and can take it, unless the keyboard moves on first.
 * `answer: false` stops at the pane itself: a pointer's press, where a phone must not raise its keyboard.
 */
export function landIn(name, { answer = true } = {}) {
  landWatch?.();
  const from = document.activeElement; // what was pressed, or the region the key came from: about to give way
  const pane = containers().pane;
  const free = () => fallen() || document.activeElement === from || document.activeElement === containers()[name];
  const attempt = () => {
    if (!free()) return true; // the keyboard went somewhere else meanwhile: it stays there
    if (!rendered(name)) return false; // not drawn yet
    if (document.activeElement !== containers()[name] && !containers()[name].contains(document.activeElement)) setRegion(name);
    return name !== "pane" || !answer || Boolean(handlers.pane?.focusAnswer?.());
  };
  if (attempt() || !pane) return;
  const watch = new MutationObserver(() => attempt() && stop());
  const timer = setTimeout(() => stop(), LAND_WAIT_MS);
  function stop() {
    watch.disconnect();
    clearTimeout(timer);
    if (landWatch === stop) landWatch = null;
  }
  landWatch = stop;
  watch.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "disabled"] });
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
    const sec = el("section", `ksec${section.here ? " here" : ""}`);
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

export function toggleSheet(open = !sheetOpen) {
  if (open === sheetOpen) return;
  sheetOpen = open;
  renderSheet();
}

/** A control the keyboard's ring is on lets go of it on Escape, like a field does: the pane's, the dock's, the bottom card's. */
const LETS_GO = ":is(#pane, #dock, #cta, .now-playing) :is(button, [role='button'])";

function escape(e) {
  if (e.target?.id === "sea-name") return; // a sea's name drops on its own Escape (seas.js); blurring it here would keep it
  if (exitFull()) { // whatever fills the window (a demo, the board's editor) comes back first
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  const target = e.target instanceof Element ? e.target : null;
  const rung = escapeRung({
    dialog: dialogOpen(), // any modal dialog, the cheat sheet among them: it steps back or closes by its own rule
    menuOpen: handlers.outline?.menuOpen?.() ?? false,
    hint: handlers.chrome?.hintPinned?.() ?? false,
    header: Boolean(target?.closest(".chrome.top")),
    turn: handlers.pane?.turning?.() ?? false,
    typing: isTyping(e.target) || Boolean(target?.closest(LETS_GO)?.matches(":focus-visible")),
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
  else if (rung === "hint") handlers.chrome?.closeHint?.();
  else if (rung === "header") setRegion("map"); // the map takes the keyboard back from the header over it
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
  handlers.chrome?.anyKey?.(); // a hint card that only hovers goes at the first key, like a tooltip
  // The command palette (palette.js) is modal for keys: while it is open every key is its own and none reaches the page.
  if (isPaletteOpen()) return paletteKey(e);
  // A modal dialog owns the keyboard (dialog.js): Tab stays inside it, ⌘↵ is its main action, and no key reaches
  // the page behind it. Escape still goes through the ladder below, where the dialog is the top rung.
  if (dialogOpen()) {
    if (sheetOpen && e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) { // the key that opened the sheet closes it
      e.preventDefault();
      toggleSheet(false);
    } else if (sheetOpen && opensPalette(e)) { // the sheet's foot names ⌘K: it works from there, in the sheet's place
      e.preventDefault();
      toggleSheet(false);
      openPalette();
    } else if (dialogKeydown(e) === "escape") escape(e);
    return;
  }
  if (!installed) return; // before the map is up (the first-run page, the hosted welcome) there are no regions to drive
  // A hidden region (the pane, closed) never keeps the keyboard, and one left on the page itself (a press on bare
  // chrome) is given back to its region: either way the map takes it before the next region does.
  if (!rendered(current) || fallen()) setRegion(landing());
  // ⌘K (Ctrl+K off a Mac) opens the command palette from anywhere on the page, a text field included; a modal dialog
  // above has already returned. An open domain menu closes first: two lists must not both be up.
  if (opensPalette(e)) {
    e.preventDefault();
    if (handlers.outline?.menuOpen?.()) handlers.outline.closeMenu?.();
    openPalette();
    return;
  }
  // The outline's domain menu owns the plain keys while it is open (outline.js: menuKey): nothing reaches the list
  // behind it, Tab changes no region, no page key fires under it. Escape still runs the ladder, whose menu rung
  // closes it. A key with ⌘, ⌃ or ⌥ goes on down this function, as a page-wide shortcut should.
  if (handlers.outline?.menuOpen?.() && !(e.metaKey || e.ctrlKey || e.altKey)) {
    if (e.key === "Escape") escape(e);
    else handlers.outline.menuKey?.(e);
    return;
  }
  if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) { // ⌘⇥ and friends stay the browser's
    if (handlers.board?.tab?.(e)) return; // the board's open editor keeps Tab among its own controls, buttons included
    if (isTyping(e.target) && e.target.closest("#board .editor")) return; // these fields keep the browser's Tab order
    e.preventDefault();
    setRegion(step(current, e.shiftKey));
    return;
  }
  if (e.key === "Escape") {
    escape(e);
    return;
  }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.altKey) { // ⌘↵, and Ctrl-Enter off a Mac (chrome-model's keyName)
    const sent = (current === "pane" ? handlers.pane?.send?.() : current === "map" ? handlers.board?.save?.() : false) || handlers.chrome?.onKey?.(e); // else the bottom card's (approve a sketch from the map)
    if (sent) {
      e.preventDefault();
      e.stopPropagation(); // the textarea's own Enter handler must not submit as well
    }
    return;
  }
  if (isTyping(e.target)) return; // the field owns its keys
  if (e.metaKey || e.ctrlKey || e.altKey) return; // browser shortcuts stay the browser's
  // The header's own keys (chrome.js): the arrows, Home and End walk its controls, and the map under it never moves.
  if (handlers.chrome?.headerKey?.(e)) {
    e.preventDefault();
    return;
  }
  // Enter and Space on anything that holds the keyboard but the region itself are that control's: they press it (a
  // button by default, a control that is not a native button by its own handler), anywhere on the page. A region's
  // own Enter (select the nearest island, open the cursor card's editor, go to the answer) is for its container.
  if ((e.key === "Enter" || e.key === " ") && ![document.body, document.documentElement, containers()[current]].includes(e.target)) return;
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
  else if (handlers.chrome?.onKey?.(e)) e.preventDefault(); // a key the region passed on: the dock's, the bottom card's, the header's (chrome.js)
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

// A pointer pressed on bare chrome (a header's words, the bottom card's question) moves focus to the page itself: that
// is the reader's doing, and the next key gives it back (onKeydown). Only focus that falls by itself is caught at once.
let pressing = false;

export function installKeys() {
  installed = true;
  for (const [name, c] of Object.entries(containers())) {
    c?.addEventListener("mousedown", () => setRegion(name));
  }
  document.getElementById("board")?.addEventListener("mousedown", () => setRegion("map")); // the loop registered the canvas; the board is the map's container only while open
  // The press's own focus change happens between these two; the click's work (which may remove its button) after both.
  document.addEventListener("mousedown", () => (pressing = true), true);
  window.addEventListener("mouseup", () => (pressing = false), true);
  // The control that had the keyboard went away. After the work that removed it, which may have focused another.
  document.addEventListener("focusout", (e) => {
    if (!pressing && !e.relatedTarget) queueMicrotask(catchFall);
  });
  // Focus moved into a region by any means (the page's own focus(), a press on a control over the map): the region follows.
  document.addEventListener("focusin", (e) => {
    const name = regionOf(e.target);
    if (!name || name === current) return;
    const prev = current;
    current = name;
    document.body.dataset.focus = name;
    handlers[prev]?.onBlur?.();
    handlers[name]?.onFocus?.();
  });
  setRegion("outline");
}
