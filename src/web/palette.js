// The command palette: ⌘K (Ctrl+K off a Mac) opens one field over the page; typing finds an island anywhere in the
// domain or an action anywhere in the app, and Enter does it. Each row names the action's own key, so the palette also
// teaches the keys. This file gathers the commands from the modules that own them (it never copies what they do) and
// draws the element; what is listed, in what order, and where the highlight goes are palette-model.js's (pure).
import { app, setScale, setMode, toggleMode, frameSelection } from "./app.js";
import { select } from "./interactions.js";
import { region, setRegion, toggleSheet } from "./keys.js";
import { boardOpen, closeBoard, openBoard } from "./board.js";
import { openNote, sailCloser } from "./card.js";
import { isChartOpen, openChart, openGuide } from "./chart.js";
import { chooseLanguage, exportMap, switchDomain, toggleRail } from "./outline.js";
import { openDomainEdit, openNewDomain } from "./new-domain.js";
import { openImagesSheet } from "./images.js";
import { openAbout } from "./learner.js";
import { exportDatabase, importDatabase, isHosted, openYourKey } from "./hosted.js";
import { applyTheme, cycleTheme, endPreview, savedTheme } from "./theme.js";
import { THEMES } from "./theme-model.js";
import { MODE_ROLES, nextMode } from "./mode-model.js";
import { dockItems, startIsland } from "./view-model.js";
import { seaMembers } from "./sea-model.js";
import { LANGUAGES, language, t } from "./i18n.js";
import { request } from "./transport.js";
import { icon } from "./icons.js";
import { tipKeys } from "./tip-model.js";
import { toastError } from "./toast.js";
import { flatIslands, isPaletteKey, islandCommand, keysShown, markRuns, moveActive, nearbyIslands, paletteSections, shortcut } from "./palette-model.js";

/** A phone has no rail and no keys foot (the same width places.js and the outline switch at). */
const NARROW = "(max-width: 720px)";
const QUERY_SHOWN = 40; // how much of a query the "nothing matches" line repeats

const state = {
  open: false,
  query: "",
  active: 0,       // index into view.rows of the highlighted row
  view: null,      // what is drawn: { sections, rows } from paletteSections
  where: null,     // the region the reader opened it from, for the keys a row may show
  sig: "",         // what the list was drawn from, so a snapshot that changes nothing redraws nothing
  previewing: false, // a theme row is highlighted and the page wears that theme for now
};
let root = null;
let field = null;
let list = null;
let status = null;
let returnTo = null;   // where focus goes back to: { el, region }
let pointer = null;    // where the pointer was last seen, so only a pointer that moves takes the highlight
let pressing = false;  // a press is down on a row: the list is not rebuilt under it, or its click would be lost
let stale = false;     // a redraw was held back while pressing
let composing = false; // the field is mid-composition (an input method): the list waits for the word
let domains = null;    // the other domains, read each time the palette opens (kept between openings)
let watching = false;
/** Which sea each island lies in, per scale ("" at the top), as the map last showed that scale. */
const seaNames = new Map();

export const isPaletteOpen = () => state.open;
/** Whether a key press is the one that opens the palette. */
export const opensPalette = (e) => isPaletteKey(e);

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

// ---- the commands ----

const lensIcon = (mode) => (mode === "mentor" ? "compass" : "lamp");

/** Selects an island anywhere in the domain, in the lens the reader is in: the map changes scale first when it lies elsewhere. */
async function sailToIsland(entry) {
  if (entry.scale !== (app.scale ?? null)) await setScale(entry.scale);
  await select(entry.slug);
}

const START_TRIES = 40; // how often, 50 ms apart, the pane is asked for the start button after a lens change

/**
 * Starts the selected island's first turn with a persona: its lens first, then the briefing's own start button once
 * the pane has drawn it (the thread is read after a lens change). If that lens turns out to hold a conversation
 * already, its answer box is there instead and nothing more is done.
 */
async function startWith(mode) {
  if (app.mode !== mode) setMode(mode);
  const pane = document.getElementById("pane");
  for (let i = 0; i < START_TRIES; i++) {
    const start = pane.querySelector("#landfall:not(:disabled)");
    if (start) return start.click();
    if (pane.querySelector("#answer:not(:disabled)")) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Notes which sea each island at the map's scale lies in (the nearest name within reach, as the map draws it). */
function noteSeas() {
  if (!app.snapshot) return;
  const names = new Map();
  for (const s of app.seas) if (s.x === null && s.anchor) for (const slug of s.anchor) names.set(slug, s.name); // suggested, not placed yet
  for (const [id, members] of seaMembers(app.seas, app.nodes.filter((n) => !n.draft))) {
    const sea = app.seas.find((s) => s.id === id);
    for (const n of members) names.set(n.slug, sea.name);
  }
  seaNames.set(app.scale ?? "", names);
}

/** Every command that applies right now, in the order the palette lists them, with each group's label. */
function gather() {
  const s = app.snapshot;
  const island = s && app.selected ? s.islands.find((i) => i.slug === app.selected) ?? null : null;
  // Where the reader was: a region's own keys (n, l, 0) are shown only on rows opened from that region.
  const where = boardOpen() ? "board" : region() === "pane" && isChartOpen() ? "chart" : region();
  const out = [];
  const add = (group, command) => out.push({ group, ...command });
  const pane = document.getElementById("pane");

  // ---- on the selected island, or on the map when there is none ----
  if (island) {
    // The first turn here: with the persona whose briefing is showing (its button's own words beside it), and with
    // the other one while nobody has said anything on this island, so its briefing is sure to be next.
    const start = pane?.querySelector("#landfall:not(:disabled)");
    const starts = [...(start ? [app.mode] : []), ...((island.messages ?? 0) === 0 ? [nextMode(app.mode)] : [])];
    for (const mode of starts) {
      const here = mode === app.mode;
      add("here", {
        id: `start:${mode}`, name: t(mode === "mentor" ? "palette.startMentor" : "palette.startKeeper"), detail: here ? start.textContent : null, keywords: t("palette.kwStart"),
        icon: lensIcon(mode), keys: here ? shortcut("pane", "landfall") : null, where: "pane", run: () => startWith(mode),
      });
    }
    if (pane?.querySelector("#answer:not(:disabled)")) {
      add("here", {
        id: "answer", name: t("palette.answer"), keywords: t("palette.kwAnswer"), icon: "enter", keys: shortcut("everywhere", "answer"),
        run: () => {
          setRegion("pane");
          pane.querySelector("#answer")?.focus();
        },
      });
    }
    const boardKey = shortcut("everywhere", "boardKey");
    if (boardOpen()) add("here", { id: "board", name: t("palette.closeBoard"), icon: "board", keys: boardKey, run: () => closeBoard() });
    else add("here", { id: "board", name: t("palette.openBoard"), icon: "board", keys: boardKey, run: () => openBoard() });
    if (island.hasChildren) add("here", { id: "sail-in", name: t("palette.sailIn"), detail: t("palette.sailInDetail", { n: island.children.total }), icon: "arrow-right", run: () => setScale(island.slug) });
    else add("here", { id: "sail-closer", name: t("palette.sailCloser"), detail: t("palette.sailCloserDetail"), icon: "arrow-right", run: () => sailCloser(island) });
    add("here", { id: "note", name: t("palette.note"), icon: "pencil", keys: shortcut("pane", "note"), where: "pane", run: () => openNote() });
  } else if (!isChartOpen()) {
    // A scale nobody has talked about yet: where to begin, with either persona (the map's own card offers the same).
    const begin = startIsland(s);
    for (const mode of begin ? ["mentor", "judge"] : []) {
      add("here", {
        id: `begin:${mode}`, name: t("palette.beginAt", { name: begin.name }), detail: t(mode === "mentor" ? "palette.beginMentor" : "palette.beginKeeper"), keywords: t("palette.kwStart"),
        icon: lensIcon(mode), run: () => {
          setMode(mode);
          return select(begin.slug);
        },
      });
    }
  }
  const other = nextMode(app.mode);
  add("here", {
    id: "lens", name: t(other === "mentor" ? "palette.lensMentor" : "palette.lensKeeper"), detail: MODE_ROLES[other], keywords: t("palette.kwLens"),
    icon: lensIcon(other), keys: shortcut("everywhere", "mode"), run: () => toggleMode(),
  });

  // ---- islands: the nearest first, then every other one in the outline's order (listed once something is typed) ----
  noteSeas();
  const flat = flatIslands(app.outline?.islands);
  const positions = new Map(app.nodes.filter((n) => !n.draft).map((n) => [n.slug, { x: n.x, y: n.y }]));
  const near = nearbyIslands(flat, { selected: app.selected, harbour: s?.harbour ?? null, scale: app.scale ?? null, positions });
  const bySlug = new Map(flat.map((e) => [e.slug, e]));
  const islandRow = (entry, isNear) => ({
    ...islandCommand(entry, { lens: app.mode, sea: seaNames.get(entry.scale ?? "")?.get(entry.slug) ?? null, near: isNear }),
    run: () => sailToIsland(entry),
  });
  for (const slug of near) out.push(islandRow(bySlug.get(slug), true));
  for (const entry of flat) if (!near.includes(entry.slug)) out.push(islandRow(entry, false));

  // ---- go to ----
  add("go", {
    id: "home", name: t("palette.home"), detail: t(app.selected ? "palette.homeSelected" : "palette.homeAll"), keywords: t("palette.kwHome"),
    icon: "expand", keys: shortcut("map", "home"), where: "map", run: () => frameSelection(),
  });
  const path = s?.scale.path ?? [];
  if (path.length) {
    const up = path.at(-2) ?? null;
    add("go", { id: "sail-out", name: t("palette.sailOut", { name: up?.name ?? s.domain.name }), keywords: t("palette.kwSailOut"), icon: "arrow-up", run: () => setScale(up?.slug ?? null) });
  }
  for (const item of s ? dockItems(s) : []) {
    if (item.action === "guide") add("go", { id: "guide", name: item.label, keywords: t("palette.kwGuide"), icon: "compass", keys: shortcut("map", "guideKey"), where: "map", run: () => openGuide() });
    else add("go", { id: "chart", name: item.label, keywords: t("palette.kwChart"), icon: "pen", keys: shortcut("map", "cartographerKey"), where: "map", run: () => openChart() });
  }
  if (!matchMedia(NARROW).matches) {
    const railed = document.getElementById("outline")?.classList.contains("rail");
    add("go", { id: "outline", name: t(railed ? "palette.expandOutline" : "palette.collapseOutline"), keywords: t("palette.kwOutline"), icon: "sidebar", keys: shortcut("everywhere", "outlineKey"), run: () => toggleRail() });
  }
  add("go", { id: "shortcuts", name: t("palette.shortcuts"), keywords: t("palette.kwShortcuts"), icon: "keyboard", keys: shortcut("everywhere", "keys"), run: () => toggleSheet() });

  // ---- domains ----
  for (const d of domains ?? []) {
    if (d.slug !== app.domain) add("domains", { id: `domain:${d.slug}`, name: d.name, detail: t("palette.switchDomain"), keywords: t("palette.kwDomain"), icon: "map", run: () => switchDomain(d.slug) });
  }
  add("domains", { id: "new-domain", name: t("palette.newDomain"), keywords: t("palette.kwDomain"), icon: "plus", keys: shortcut("outline", "newDomain"), where: "outline", run: () => openNewDomain() });
  add("domains", { id: "edit-domain", name: t("palette.editDomain"), detail: t("palette.editDomainDetail"), keywords: t("palette.kwDomain"), icon: "pencil", run: () => openDomainEdit(app.domain) });
  add("domains", { id: "export-map", name: t("palette.exportMap"), detail: t("palette.exportMapDetail"), keywords: t("palette.kwExport"), icon: "share", run: () => exportMap() });
  add("domains", { id: "images", name: t("palette.images"), detail: t("palette.imagesDetail"), icon: "image", run: () => openImagesSheet() });

  // ---- appearance: highlighting a theme wears it for now, as hovering one in the domain menu does ----
  add("appearance", { id: "next-theme", name: t("palette.nextTheme"), keywords: t("palette.kwTheme"), icon: "theme", keys: shortcut("everywhere", "theme"), run: () => cycleTheme() });
  const saved = savedTheme();
  for (const th of THEMES) {
    add("appearance", { id: `theme:${th.id}`, name: th.name, detail: t("palette.theme"), keywords: t("palette.kwTheme"), icon: "theme", current: th.id === saved, theme: th.id, run: () => applyTheme(th.id) });
  }
  for (const l of LANGUAGES) {
    add("appearance", { id: `language:${l.id}`, name: l.name, detail: t("palette.language"), keywords: t("palette.kwLanguage"), icon: "globe", current: l.id === language(), lang: l.id, run: () => chooseLanguage(l.id) });
  }

  // ---- you ----
  add("you", { id: "about", name: t("palette.about"), detail: t("palette.aboutDetail"), keywords: t("palette.kwAbout"), icon: "user", run: () => openAbout() });
  if (isHosted()) {
    add("you", { id: "your-key", name: t("palette.yourKey"), detail: t("palette.yourKeyDetail"), keywords: t("palette.kwKey"), icon: "key", run: () => openYourKey() });
    add("you", { id: "backup", name: t("palette.backup"), keywords: t("palette.kwBackup"), icon: "download", run: () => exportDatabase() });
    add("you", { id: "restore", name: t("palette.restore"), keywords: t("palette.kwBackup"), icon: "upload", run: () => importDatabase() });
  }

  const typed = state.query.trim() !== "";
  const labels = {
    here: island ? island.name : t("palette.groupMap"),
    islands: t(typed ? "palette.groupIslands" : "palette.groupNearby"),
    go: t("palette.groupGo"),
    domains: t("palette.groupDomains"),
    appearance: t("palette.groupAppearance"),
    you: t("palette.groupYou"),
  };
  // The tree may not have arrived yet: the actions are all there, and a quiet line stands where the islands will be.
  // Once it has, and before anything is typed, the same line says how many more a name would find.
  const more = flat.length - near.length;
  const notes = { islands: !app.outline ? t("palette.islandsLoading") : !typed && more > 0 ? t("palette.moreIslands", { n: more }) : null };
  return { commands: out, where, labels, notes };
}

// ---- drawing ----

/** A name with its matched letters marked, as text nodes and <mark>s. */
function marked(parent, text, ranges) {
  for (const run of markRuns(text, ranges)) parent.append(run.hit ? el("mark", null, run.text) : run.text);
}

function rowEl(row, index) {
  const c = row.command;
  const r = el("div", "mi");
  r.id = `palette-option-${index}`;
  r.dataset.index = String(index);
  r.setAttribute("role", "option");
  r.setAttribute("aria-selected", "false");
  if (c.dot) {
    const box = el("span", "ic palette-dot"); // the island's state, drawn as the outline draws it
    box.append(el("span", c.dot));
    r.append(box);
  } else r.append(icon(c.icon));
  const name = el("span", "grow");
  if (c.lang) name.lang = c.lang;
  marked(name, c.name, row.name);
  r.append(name);
  if (c.detail) {
    const detail = el("span", "detail");
    marked(detail, c.detail, row.detail);
    r.append(detail);
  }
  if (c.current) {
    const cur = el("span", "cur");
    cur.append(icon("check", { size: 14, label: t("palette.current") }));
    r.append(cur);
  }
  const keys = keysShown(c, state.where);
  if (keys) {
    const caps = el("span", "keys");
    for (const k of tipKeys(keys)) caps.append(el("kbd", null, k));
    r.append(caps);
  }
  return r;
}

/** Everything the list is drawn from, as one string: equal strings draw the same list. */
function signature(view, where) {
  return JSON.stringify([where, view.sections.map((s) => [s.label, s.note, s.rows.map((r) => [r.command.id, r.command.name, r.command.detail ?? "", r.command.dot ?? r.command.icon, Boolean(r.command.current), r.name, r.detail])])]);
}

/**
 * Draws the list for the query. `keep` is for a redraw the reader did not ask for (a snapshot, the domains arriving):
 * the highlight stays on its command and the list where it was scrolled, and nothing is rebuilt if nothing changed.
 */
function draw({ keep = false } = {}) {
  if (keep && pressing) {
    stale = true;
    return;
  }
  stale = false;
  const { commands, where, labels, notes } = gather();
  const view = paletteSections(commands, state.query, { labels, notes });
  const sig = signature(view, where);
  if (keep && sig === state.sig) {
    state.view = view; // the same rows, with this moment's actions behind them
    return;
  }
  const activeId = keep ? state.view?.rows[state.active]?.command.id : null;
  const top = keep ? list.scrollTop : 0;
  Object.assign(state, { view, where, sig });
  const frag = document.createDocumentFragment();
  let index = 0;
  for (const section of view.sections) {
    const group = el("div", "palette-group");
    group.setAttribute("role", "group");
    const label = el("div", "ml", section.label);
    label.id = `palette-group-${section.group}`;
    group.setAttribute("aria-labelledby", label.id);
    group.append(label);
    for (const row of section.rows) group.append(rowEl(row, index++));
    if (section.note) group.append(el("div", "palette-note", section.note));
    frag.append(group);
  }
  list.replaceChildren(frag);
  list.scrollTop = top;
  const empty = view.sections.length === 0;
  list.hidden = empty;
  status.hidden = !empty;
  field.setAttribute("aria-expanded", String(!empty));
  const said = state.query.trim();
  status.textContent = empty ? t("palette.empty", { query: said.length > QUERY_SHOWN ? `${said.slice(0, QUERY_SHOWN)}…` : said }) : "";
  const kept = activeId ? view.rows.findIndex((r) => r.command.id === activeId) : -1;
  setActive(kept >= 0 ? kept : 0);
}

function optionEl(index) {
  return document.getElementById(`palette-option-${index}`);
}

/** Moves the highlight. A theme's row is worn while it is highlighted; any other row puts the stored theme back. */
function setActive(index, { reveal = false } = {}) {
  for (const on of list.querySelectorAll(".mi.on")) {
    on.classList.remove("on");
    on.setAttribute("aria-selected", "false");
  }
  state.active = index;
  const row = optionEl(index);
  if (row) {
    row.classList.add("on");
    row.setAttribute("aria-selected", "true");
    field.setAttribute("aria-activedescendant", row.id);
    if (reveal) {
      // The first row of a group brings its label along, so the label is never left just out of view above it.
      if (row.previousElementSibling?.classList.contains("ml")) row.previousElementSibling.scrollIntoView({ block: "nearest" });
      row.scrollIntoView({ block: "nearest" });
    }
  } else field.removeAttribute("aria-activedescendant");
  const theme = state.view?.rows[index]?.command.theme ?? null;
  if (theme) {
    applyTheme(theme, { persist: false });
    state.previewing = true;
  } else if (state.previewing) {
    endPreview();
    state.previewing = false;
  }
}

/** Closes the palette, then does what the row says. A failure is said in a toast, by the action's own name. */
async function run(row) {
  if (!row) return;
  const c = row.command;
  closePalette({ keepTheme: Boolean(c.theme) }); // a picked theme is already worn: no flash back to the old one
  try {
    await c.run();
  } catch (error) {
    toastError(error, c.name.replace(/…$/u, "")); // "Edit this domain failed", not "Edit this domain… failed"
  }
}

// ---- the element ----

function build() {
  root = el("div", "palette");
  root.id = "palette";
  root.hidden = true;
  root.setAttribute("popover", "manual"); // the top layer: above a demo or an editor that fills the window (full.js)
  const card = el("div", "dialog-card palette-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", t("palette.label"));

  const head = el("div", "palette-head");
  field = el("input", "palette-field");
  field.type = "text";
  field.placeholder = t("palette.placeholder");
  field.setAttribute("aria-label", t("palette.placeholder"));
  field.setAttribute("role", "combobox");
  field.setAttribute("aria-expanded", "true");
  field.setAttribute("aria-controls", "palette-list");
  field.setAttribute("aria-autocomplete", "list");
  field.autocomplete = "off";
  field.spellcheck = false;
  field.setAttribute("autocapitalize", "off");
  field.setAttribute("autocorrect", "off");
  field.setAttribute("enterkeyhint", "go");
  head.append(icon("search"), field);

  list = el("div", "menu palette-list");
  list.id = "palette-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("palette.results"));
  status = el("div", "palette-empty");
  status.setAttribute("role", "status");
  status.hidden = true;

  const foot = el("div", "palette-foot");
  const hint = (keys, label) => {
    const span = el("span");
    span.append(...keys.map((k) => el("kbd", null, k)), label);
    return span;
  };
  foot.append(hint(["↑", "↓"], t("palette.hintMove")), hint(["↵"], t("palette.hintRun")), hint(["Esc"], t("palette.hintClose")));

  card.append(head, list, status, foot);
  root.append(el("div", "palette-scrim"), card);
  document.body.append(root);

  // A press outside the card closes it; a press inside never takes the caret out of the field.
  root.addEventListener("pointerdown", (e) => {
    if (card.contains(e.target)) return;
    e.preventDefault();
    closePalette();
  });
  card.addEventListener("mousedown", (e) => {
    if (e.target !== field) e.preventDefault();
  });
  field.addEventListener("compositionstart", () => {
    composing = true;
  });
  field.addEventListener("compositionend", () => {
    composing = false;
    typed();
  });
  field.addEventListener("input", () => {
    if (!composing) typed(); // half a composed word (Zhuyin symbols, Pinyin letters) would only find noise
  });
  // The pointer takes the highlight only when it moves: a list that scrolls under a still pointer sends the same
  // place again (or, the first time, a place never seen), and the highlight stays with the keys.
  root.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const was = pointer;
    pointer = { x: e.clientX, y: e.clientY };
    if (!was || (was.x === pointer.x && was.y === pointer.y)) return;
    const row = e.target.closest?.('[role="option"]');
    if (!row || !list.contains(row)) return;
    const index = Number(row.dataset.index);
    if (index !== state.active) setActive(index);
  });
  list.addEventListener("pointerdown", () => {
    pressing = true;
  });
  const released = () => {
    if (!pressing) return;
    pressing = false;
    if (stale && state.open) setTimeout(() => state.open && draw({ keep: true }), 0); // after the click this release makes
  };
  window.addEventListener("pointerup", released);
  window.addEventListener("pointercancel", released);
  list.addEventListener("click", (e) => {
    const row = e.target.closest?.('[role="option"]');
    if (row && list.contains(row)) void run(state.view.rows[Number(row.dataset.index)]);
  });
  window.visualViewport?.addEventListener("resize", fit);
  window.visualViewport?.addEventListener("scroll", fit);
}

/** A phone's keyboard covers the bottom of the window without resizing it: the palette keeps to the part that can be seen. */
function fit() {
  if (!state.open || !window.visualViewport) return;
  root.style.top = `${Math.round(visualViewport.offsetTop)}px`;
  root.style.height = `${Math.round(visualViewport.height)}px`;
}

function typed() {
  state.query = field.value;
  draw();
}

/** The other domains, for the Domains group. Read through `request`, so the hosted build asks its worker. */
async function loadDomains() {
  try {
    const res = await request("/api/domains");
    if (!res.ok) throw new Error(res.statusText);
    domains = (await res.json()).domains ?? [];
  } catch {
    domains ??= []; // the group still offers New domain… and the rest
  }
  if (state.open) draw({ keep: true });
}

/** A new snapshot: the seas at this scale are noted, and an open palette shows what changed without losing its place. */
function onSnapshot() {
  noteSeas();
  if (state.open) draw({ keep: true });
}

/** Subscribes to the page's snapshots, once. */
function watch() {
  if (watching) return;
  try {
    app.listeners.add(onSnapshot);
    watching = true;
  } catch {
    // app.js is still starting: the first opening asks again
  }
}
// app.js imports this module before its own body has run, so `app` cannot be read yet: ask once the modules have loaded.
queueMicrotask(watch);

/** Opens the palette over whatever the reader is doing; focus comes back there when it closes. */
export function openPalette() {
  if (state.open) return;
  if (!root) build();
  watch();
  const focused = document.activeElement;
  returnTo = { el: focused instanceof HTMLElement && focused !== document.body ? focused : null, region: region() };
  Object.assign(state, { open: true, query: "", active: 0, view: null, sig: "", previewing: false });
  pointer = null;
  pressing = false;
  composing = false;
  field.value = "";
  root.hidden = false;
  try {
    root.showPopover();
  } catch {
    // no popovers in this browser: it stays in the page, above the dialogs by its z-index
  }
  fit();
  root.classList.add("arrive"); // the entrance plays for this opening only; the list is rebuilt on every keystroke inside it
  draw();
  field.focus({ preventScroll: true });
  void loadDomains();
}

/** Closes the palette and gives focus back. A theme only being previewed goes back to the stored one. */
export function closePalette({ keepTheme = false } = {}) {
  if (!state.open) return;
  state.open = false;
  if (state.previewing && !keepTheme) endPreview();
  state.previewing = false;
  root.classList.remove("arrive");
  try {
    root.hidePopover();
  } catch {
    // never shown as a popover
  }
  root.hidden = true;
  list.replaceChildren();
  const { el: was, region: from } = returnTo ?? {};
  returnTo = null;
  // The control that had focus, or the one that took its place in a redraw meanwhile (the answer box keeps its id).
  const target = was?.isConnected ? was : was?.id ? document.getElementById(was.id) : null;
  target?.focus({ preventScroll: true });
  if (!target || document.activeElement !== target) setRegion(from);
}

/**
 * A key press while the palette is open (keys.js sends every one here and does nothing else with it): the palette is
 * modal, so no other listener sees the key. Moving, running and closing are handled; anything else is typing.
 */
export function paletteKey(e) {
  e.stopPropagation();
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
  const ctrl = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
  if (isPaletteKey(e) || (e.key === "Escape" && plain)) {
    e.preventDefault();
    closePalette();
    return;
  }
  const rows = state.view?.rows ?? [];
  if (plain || ctrl) {
    const first = optionEl(0);
    const page = first ? Math.max(1, Math.floor(list.clientHeight / first.offsetHeight) - 1) : 1;
    const to = moveActive(state.active, rows.length, e.key, { page, ctrl });
    const moving = ctrl ? /^[np]$/i.test(e.key) : ["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(e.key);
    if (moving) {
      e.preventDefault(); // with nothing to move over, the caret still stays where it is
      if (to !== null) setActive(to, { reveal: true });
      return;
    }
  }
  if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    void run(rows[state.active]);
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault(); // Tab does not leave: there is one field and its list
    return;
  }
  if (document.activeElement !== field) field.focus({ preventScroll: true }); // a letter typed after focus strayed still lands in the field
}
