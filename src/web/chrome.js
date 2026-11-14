// The chrome over the map that is not a pane: the header (breadcrumb, status pill, the lens switch, the strip of
// info cells and the one hint card they share), the dock at the bottom right, and what the map area says before
// there is a chart to draw (that it is being read, or why it could not be, with a way to try again).
//
// Everything here is patched, never rebuilt: a crumb, a cell or a dock button keeps its element while what it is
// drawn from stays the same (keep.js), so a snapshot that changes nothing touches nothing, and focus, a label under
// the pointer and an open hint all outlive the page's two-second poll.
import { app, setScale, setMode, paneInset, outlineInset, reframe } from "./app.js";
import { stripItems, dockItems } from "./view-model.js";
import { MODES, MODE_LABELS } from "./mode-model.js";
import { keyedChildren } from "./keep.js";
import { select } from "./interactions.js";
import { openChart, openGuide } from "./chart.js";
import { boardOpen } from "./board.js";
import { ctaKeys, pressCtaKey } from "./cta.js";
import { registerRegion, region, setRegion } from "./keys.js";
import { isTyping } from "./keys-model.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { failureKind } from "./toast-model.js";
import { statusKey, failureKey, hintPlace, dockLane, roveTo, keyName, chromeTarget, HINT_DELAY_MS } from "./chrome-model.js";
import { t } from "./i18n.js";

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};

/**
 * Runs a patch of `root`'s children and, if it replaced the control the keyboard was on, focuses the one that took
 * its place (the same `data-at`); with none, focus goes back to the map instead of falling to the body.
 */
function keepFocus(root, patch) {
  const had = root.contains(document.activeElement) ? document.activeElement : null;
  patch();
  if (!had || had.isConnected) return;
  const next = had.dataset.at ? root.querySelector(`[data-at="${CSS.escape(had.dataset.at)}"]`) : null;
  (next ?? document.getElementById("map"))?.focus({ preventScroll: true });
}

// ---- the breadcrumb ----

function crumbEl(part, here) {
  if (here) {
    // Where the reader is: a name, not a button. Its tip is its whole name, only while the header has cut it short.
    const name = el("span", "crumb here", part.name);
    name.setAttribute("aria-current", "location");
    name.addEventListener("pointerover", () => {
      if (name.scrollWidth > name.clientWidth) tip(name, part.name);
      else delete name.dataset.tip;
    });
    return name;
  }
  const b = el("button", "crumb", part.name);
  b.type = "button";
  b.dataset.at = `crumb:${part.slug ?? ""}`;
  tip(b, t("app.crumbUp", { name: part.name }));
  b.addEventListener("click", () => void setScale(part.slug));
  return b;
}

function renderBreadcrumb() {
  const nav = document.getElementById("breadcrumb");
  const s = app.snapshot;
  const parts = [{ slug: null, name: s.domain.name }, ...s.scale.path];
  const entries = [];
  parts.forEach((part, i) => {
    const here = i === parts.length - 1;
    if (i > 0) {
      entries.push({
        key: `sep:${i}`,
        sig: "",
        build: () => {
          const sep = el("span", "sep");
          sep.setAttribute("aria-hidden", "true");
          sep.append(icon("chevron-right", { size: 12 }));
          return sep;
        },
      });
    }
    entries.push({ key: `crumb:${i}`, sig: JSON.stringify([part.slug, part.name, here]), build: () => crumbEl(part, here) });
  });
  keepFocus(nav, () => keyedChildren(nav, entries));
}

// ---- the lens on the bare map ----

const LENS_TIPS = { judge: "app.lensKeeper", mentor: "app.lensMentor" };

/**
 * Keeper | Mentor at the header's right end, where an island's pane has its own: the two stand in the same corner of
 * the window and never together, so this one steps aside while an island is open.
 */
function renderLens() {
  const box = document.getElementById("lens");
  if (!box || !app.snapshot) return;
  if (!box.firstChild) {
    for (const mode of MODES) {
      const b = el("button", `seg ${mode}`, MODE_LABELS[mode]);
      b.type = "button";
      b.dataset.mode = mode;
      b.dataset.at = `lens:${mode}`;
      tip(b, t(LENS_TIPS[mode]), "m");
      b.addEventListener("click", () => setMode(mode));
      box.append(b);
    }
  }
  for (const b of box.children) b.setAttribute("aria-pressed", String(b.dataset.mode === app.mode));
  // Away while an island's pane shows its own, and on a scale with no islands, where there is nothing to look at through a lens.
  const away = app.snapshot.islands.length === 0 || app.snapshot.islands.some((i) => i.slug === app.selected);
  if (box.hidden !== away) {
    if (away && box.contains(document.activeElement)) document.getElementById("map")?.focus({ preventScroll: true });
    box.hidden = away;
  }
}

// ---- the status pill ----

/** What the header says about the connection: nothing while it holds, and never that a chart is shown when none is. */
export function renderStatus() {
  const pill = document.getElementById("status");
  if (!pill) return;
  const key = statusKey({ connected: app.connected, hasChart: Boolean(app.snapshot) });
  const text = key ? t(key) : "";
  if (pill.textContent !== text) pill.textContent = text;
}

// ---- the strip, and the one hint card its cells share ----

const hint = { key: null, pinned: false, timer: 0, closedAt: 0, box: null, still: null };
const STILL_PX = 4; // a pointer within this of where it pressed has not moved
let cells = new Map(); // key → the item each cell on the page was drawn from
let lit = null; // the island name under the pointer or the keyboard, while it lights its island on the map

const cellOf = (key) => document.querySelector(`#strip .strip-item[data-key="${CSS.escape(key)}"]`);

function light(link, on) {
  if (on) {
    lit = link;
    app.hover = link.dataset.slug;
  } else if (lit === link) {
    lit = null;
    if (app.hover === link.dataset.slug) app.hover = null;
  }
}

/** An island's name in a cell: pressing it opens that island, and resting on it lights the island on the map. */
function linkEl(item, part) {
  const a = el("a", "strip-link", part.name);
  a.setAttribute("role", "button");
  a.tabIndex = 0;
  a.dataset.slug = part.slug;
  a.dataset.at = `link:${item.key}:${part.slug}`;
  a.addEventListener("click", (e) => {
    closeHint();
    // The pane opens and the strip moves under a pointer that has not moved: no cell that lands there may take that for a rest.
    hint.still = { x: e.clientX, y: e.clientY };
    void select(part.slug);
  });
  a.addEventListener("pointerenter", () => light(a, true));
  a.addEventListener("pointerleave", () => light(a, false));
  a.addEventListener("focus", () => light(a, true));
  a.addEventListener("blur", () => light(a, false));
  return a;
}

function cellEl(item) {
  const cell = el("div", `strip-item${item.empty ? " none" : ""}${item.parts?.length > 1 ? " list" : ""}`);
  cell.dataset.key = item.key;
  // The label is the cell's button: it opens the hint card that explains the cell. A press anywhere else in the
  // cell does the same, except on an island's name, which goes to the island.
  const label = el("button", "strip-label", item.label);
  label.type = "button";
  label.dataset.at = `cell:${item.key}`;
  label.setAttribute("aria-expanded", "false");
  const value = el("span", "strip-value");
  if (item.parts) {
    item.parts.forEach((part, i) => {
      if (i > 0) value.append(" · ");
      value.append(part.slug ? linkEl(item, part) : part.name);
    });
  } else value.textContent = item.value;
  cell.append(label, value);
  cell.addEventListener("click", (e) => {
    if (!e.target.closest(".strip-link")) toggleHint(item.key);
  });
  cell.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    if (hint.still && Math.hypot(e.clientX - hint.still.x, e.clientY - hint.still.y) < STILL_PX) return; // the cell came to the pointer
    hint.still = null;
    restOn(item.key);
  });
  cell.addEventListener("pointerleave", () => leave(item.key));
  cell.addEventListener("focusout", (e) => {
    if (hint.key === item.key && cell.isConnected && !cell.contains(e.relatedTarget)) closeHint(); // the keyboard moved on
  });
  return cell;
}

function hintBox() {
  if (hint.box) return hint.box;
  const box = el("div", "pop strip-hint");
  box.id = "strip-hint";
  box.setAttribute("role", "tooltip");
  box.hidden = true;
  document.body.append(box);
  return (hint.box = box);
}

/** The map area in viewport px: what the outline and the pane leave. The hint card never leaves it. */
const mapArea = () => ({ left: outlineInset(), right: window.innerWidth - paneInset() });

/** Draws the open hint under its cell. `arrive` plays its entrance: only when no card was showing a moment ago. */
function drawHint(arrive = false) {
  const item = cells.get(hint.key);
  const cell = hint.key === null ? null : cellOf(hint.key);
  if (!item || !cell || cell.offsetParent === null) return closeHint();
  const box = hintBox();
  const value = cell.querySelector(".strip-value");
  const parts = [];
  if (value.scrollWidth > value.clientWidth + 1) parts.push(el("div", "full", item.value)); // a value the header cut short is here in full
  parts.push(el("div", "why", item.hint));
  box.replaceChildren(...parts);
  box.classList.toggle("pinned", hint.pinned);
  box.hidden = false;
  box.style.width = "";
  const place = hintPlace(cell.getBoundingClientRect(), { width: box.offsetWidth }, mapArea());
  box.style.left = `${place.left}px`;
  box.style.top = `${place.top}px`;
  box.style.width = `${place.width}px`;
  if (arrive) {
    box.classList.remove("arrive");
    void box.offsetWidth; // the entrance plays again for a card that was away
    box.classList.add("arrive");
  }
  for (const label of document.querySelectorAll("#strip .strip-label")) {
    const open = label.parentElement === cell;
    label.setAttribute("aria-expanded", String(open));
    if (open) label.setAttribute("aria-describedby", box.id);
    else label.removeAttribute("aria-describedby");
  }
}

function openHint(key, pinned) {
  clearTimeout(hint.timer);
  const arrive = hint.key === null;
  hint.key = key;
  hint.pinned = pinned;
  drawHint(arrive);
}

function closeHint() {
  clearTimeout(hint.timer);
  if (hint.key === null) return;
  hint.key = null;
  hint.pinned = false;
  hint.closedAt = performance.now();
  if (hint.box) {
    hint.box.hidden = true;
    hint.box.classList.remove("pinned", "arrive");
  }
  for (const label of document.querySelectorAll("#strip .strip-label")) {
    label.setAttribute("aria-expanded", "false");
    label.removeAttribute("aria-describedby");
  }
}

/** The pointer rests on a cell: its card shows after a beat (at once when one was just showing), unless one is pinned. */
function restOn(key) {
  if (hint.pinned) return;
  clearTimeout(hint.timer);
  if (hint.key !== null || performance.now() - hint.closedAt < 300) openHint(key, false);
  else hint.timer = setTimeout(() => openHint(key, false), HINT_DELAY_MS);
}

function leave(key) {
  clearTimeout(hint.timer);
  if (!hint.pinned && hint.key === key) closeHint();
}

/** A press on a cell pins its card (one at a time), and a second press lets it go. */
function toggleHint(key) {
  if (hint.pinned && hint.key === key) closeHint();
  else openHint(key, true);
}

function renderStrip() {
  const strip = document.getElementById("strip");
  const items = stripItems(app.snapshot, app.mode);
  cells = new Map(items.map((it) => [it.key, it]));
  keepFocus(strip, () => keyedChildren(strip, items.map((it) => ({ key: it.key, sig: JSON.stringify(it), build: () => cellEl(it) }))));
  // A cell that lists islands may narrow to its label and no further: the stylesheet takes that width from here.
  for (const cell of strip.querySelectorAll(".strip-item.list")) {
    const w = `${Math.ceil(cell.firstChild.getBoundingClientRect().width)}px`;
    if (cell.style.getPropertyValue("--label-w") !== w) cell.style.setProperty("--label-w", w);
  }
  if (lit && !lit.isConnected) light(lit, false); // the name that lit an island was redrawn away
  if (hint.key !== null) drawHint(); // its cell may be a new element, or gone
}

// ---- the dock ----

/** A dock icon, as SVG nodes (never markup): the mentor's compass needle, or the cartographer's dashed coast and pen. */
function dockIcon(action) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "dock-icon");
  svg.setAttribute("aria-hidden", "true");
  const add = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
  };
  if (action === "guide") {
    add("circle", { cx: 12, cy: 12, r: 9.5, class: "line" });
    add("path", { d: "M12 4.5 L14.4 12 L12 19.5 L9.6 12 Z", class: "line" });
    add("path", { d: "M12 4.5 L14.4 12 L9.6 12 Z", class: "solid" });
  } else {
    add("path", { d: "M5 15.5c-1.6-3.2.2-8 4.6-9 3.2-.7 5.6.6 6.4 2.7", class: "line dash" });
    add("path", { d: "M5 15.5c1.4 2.6 4.6 3.7 7.6 2.8", class: "line dash" });
    add("path", { d: "M13.5 18.5 L20 12 L21.5 13.5 L15 20 L13 20.5 Z", class: "line" });
  }
  return svg;
}

/**
 * One of the dock's buttons: an icon, and on hover or focus what it opens and the key that opens it, in a line that
 * slides out to its left. The line is the button's tooltip, so it carries the key the way a tooltip does.
 */
function dockItem({ action, label, pending, key }) {
  const b = el("button", `dock-item ${action}${pending ? " pending" : ""}`);
  b.type = "button";
  b.dataset.at = `dock:${action}`;
  b.dataset.key = key;
  b.setAttribute("aria-label", label);
  b.setAttribute("aria-keyshortcuts", key);
  const line = el("span", "dock-label");
  line.append(el("span", "words", label), el("kbd", null, key));
  b.append(line, dockIcon(action));
  b.addEventListener("click", () => (action === "guide" ? openGuide() : openChart()));
  return b;
}

function renderDock() {
  const dock = document.getElementById("dock");
  if (!dock) return;
  keepFocus(dock, () => keyedChildren(dock, dockItems(app.snapshot).map((it) => ({ key: it.action, sig: JSON.stringify(it), build: () => dockItem(it) }))));
}

/** Draws the header and the dock from the snapshot the page holds. Only what changed is touched. */
export function renderChrome() {
  if (!app.snapshot) return;
  clearNote(); // there is a chart now: nothing stands in its place
  renderBreadcrumb();
  renderLens();
  renderStrip();
  renderDock();
  renderStatus();
}

// ---- before there is a chart: reading it, or why it could not be read ----

let note = null;

function noteBox() {
  if (!note) {
    note = el("div", "map-note");
    note.hidden = true;
    document.getElementById("map").after(note);
  }
  return note;
}

export function clearNote() {
  if (!note || note.hidden) return;
  note.hidden = true;
  note.replaceChildren();
}

/** A quiet line where the map will be, while its first chart is on the way. It shows after a beat, so a quick read shows nothing. */
export function showReading() {
  const box = noteBox();
  box.className = "map-note reading";
  box.setAttribute("role", "status");
  box.replaceChildren(el("p", null, t("app.reading")));
  box.hidden = false;
}

/**
 * The first read failed: say so in plain words where the map would be, with a button that tries again.
 * `retrying` adds that the page keeps trying by itself, which only the caller knows to be true.
 */
export function showFailure(error, retry, { retrying = false } = {}) {
  const kind = failureKind(error);
  const box = noteBox();
  box.className = "map-note failed";
  box.setAttribute("role", "alert");
  const again = el("button", "btn", t("app.tryAgain"));
  again.type = "button";
  again.addEventListener("click", async () => {
    again.disabled = true;
    try {
      await retry();
    } finally {
      again.disabled = false;
    }
  });
  const why = el("p", null, t(failureKey(kind), { error: String(error?.message ?? error) }));
  box.replaceChildren(el("h2", null, t("app.cantOpen")), why, ...(retrying ? [el("p", "quiet", t("app.keepsTrying"))] : []), again);
  box.hidden = false;
}

// ---- keys ----

/** Every control in the header the keyboard can stand on, in the order it walks them: the path, the strip, then the lens at the far end. */
const headerStops = () =>
  ["#breadcrumb", "#strip", "#lens"]
    .flatMap((part) => [...document.querySelectorAll(`.chrome.top ${part} :is(button, [role='button'])`)])
    .filter((n) => !n.disabled && n.offsetParent !== null);

/** Puts the keyboard in the header (the map stays the region in focus); the arrows walk it from there. */
function focusHeader() {
  const stops = headerStops();
  if (!stops.length) return false;
  setRegion("map");
  stops[0].focus({ preventScroll: true });
  return true;
}

/** The keys of the controls over the map, offered to the page's key handler once the region in focus has passed on them. */
function chromeKey(e) {
  if (isTyping(e.target)) return false; // ⌘↵ in a field is that field's
  const dock = [...document.querySelectorAll("#dock .dock-item")].filter((b) => b.offsetParent !== null).map((b) => b.dataset.key);
  const target = chromeTarget(keyName(e), { cta: ctaKeys(), dock, board: boardOpen(), region: region(), header: headerStops().length > 0 });
  if (!target) return false;
  if (target.where === "cta") return pressCtaKey(target.key);
  if (target.where === "dock") {
    document.querySelector(`#dock .dock-item[data-key="${CSS.escape(target.key)}"]`)?.click();
    return true;
  }
  return focusHeader();
}

const CONTROLS = ".chrome.top :is(button, [role='button']), #dock button, #cta button, .now-playing button, .map-note button";

/**
 * Keys that belong to a control over the map before they belong to the page: this listener is on the window ahead
 * of keys.js's. Escape lets a pinned hint go, or takes the keyboard out of the header; the arrows walk the header;
 * and Enter or Space on a focused control presses it, where the map would otherwise take Enter for itself.
 */
function onKeydown(e) {
  if (e.isComposing || e.keyCode === 229) return;
  const inHeader = e.target instanceof Element && Boolean(e.target.closest(".chrome.top"));
  const take = () => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  if (hint.key !== null && !hint.pinned) closeHint(); // a card that only hovers goes at the first key, like a tooltip
  if (e.key === "Escape") {
    if (hint.key !== null) {
      take(); // a pinned card is the first thing Escape lets go
      closeHint();
    } else if (inHeader) {
      take(); // then the header gives the keyboard back to the map
      setRegion("map");
      document.getElementById("map")?.focus({ preventScroll: true });
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (inHeader) {
    const stops = headerStops();
    const next = roveTo(stops.length, stops.indexOf(e.target.closest("button, [role='button']")), e.key);
    if (next !== null) {
      take();
      stops[next]?.focus({ preventScroll: true });
      return;
    }
  }
  if (e.key === "Enter" || e.key === " ") {
    const control = e.target instanceof Element ? e.target.closest(CONTROLS) : null;
    if (!control) return;
    e.stopImmediatePropagation(); // the press is the control's own
    if (control.tagName !== "BUTTON") {
      e.preventDefault(); // a name in the strip is not a native button: press it here
      control.click();
    }
  }
}

/** Once, before keys.js installs its own listener: the header's keys, the hint card's manners, and what follows a change of selection. */
export function installChrome() {
  window.addEventListener("keydown", onKeydown, { capture: true });
  registerRegion("chrome", { onKey: chromeKey });
  // A press anywhere but a cell or the card lets a pinned hint go.
  document.addEventListener("pointerdown", (e) => {
    if (hint.key !== null && !(e.target instanceof Element && e.target.closest(".strip-item, .strip-hint"))) closeHint();
  }, true);
  document.addEventListener("pointermove", (e) => {
    if (hint.still && Math.hypot(e.clientX - hint.still.x, e.clientY - hint.still.y) >= STILL_PX) hint.still = null; // it moved: hover means hover again
  }, { passive: true });
  const strip = document.getElementById("strip");
  strip.addEventListener("scroll", () => hint.key !== null && drawHint(), { passive: true }); // a phone's strip scrolls sideways
  new ResizeObserver(() => hint.key !== null && drawHint()).observe(strip); // the strip wrapped, or the pane changed its room
  window.addEventListener("resize", () => closeHint());
  // A dock label slides out only as far as the bottom card leaves it room: measured as the pointer or the keyboard arrives.
  const dock = document.getElementById("dock");
  const lane = () => {
    const card = document.querySelector("#cta:not([hidden]) .cta-card")?.getBoundingClientRect();
    dock.style.setProperty("--dock-lane", `${dockLane(dock.getBoundingClientRect().right, card && card.width > 0 ? card.right : null)}px`);
  };
  dock.addEventListener("pointerover", lane);
  dock.addEventListener("focusin", lane);
  // A selection changes what the header shows without a new snapshot: the lens steps aside for an island's pane.
  app.listeners.add(() => renderLens());
  // The now-playing bar came or went: the bottom card moved over it, so the map's bottom inset did too.
  document.addEventListener("voice", () => reframe());
}
