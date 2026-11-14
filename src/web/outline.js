// The outline: the domain's tree on the left, its rail and peek, and the domain menu. The pure parts live in
// outline-model.js (tested); this is the DOM.
import { app, api, setScale, frameSelection } from "./app.js";
import { select } from "./interactions.js";
import { RAIL_W, outlineWidth, visibleRows, collapsible, dashClass, summaryLine, rowMarks, rowTip, cursorStart, menuGroups, menuStep } from "./outline-model.js";
import { registerRegion, setRegion } from "./keys.js";
import { moveCursor } from "./keys-model.js";
import { keyedChildren } from "./keep.js";
import { THEMES } from "./theme-model.js";
import { applyTheme, cycleTheme, endPreview, savedTheme } from "./theme.js";
import { openAbout } from "./learner.js";
import { exportDatabase, importDatabase, isHosted, openYourKey } from "./hosted.js";
import { openDomainEdit, openNewDomain } from "./new-domain.js";
import { openImagesSheet } from "./images.js";
import { mapFileName } from "./map-model.js";
import { request } from "./transport.js";
import { LANGUAGES, language, setLanguage, t } from "./i18n.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { toastError } from "./toast.js";
import { openPalette } from "./palette.js"; // a cycle (the palette imports actions from here): each side uses the other only inside handlers
import { paletteKeys } from "./palette-model.js";

// app.js imports installOutline from here and this file imports app: fine, because nothing below reads app or select at module evaluation.

// ---- state ----

// `sub` is the list open under its row in the menu ("theme" | "language" | null); `menuFocus` is the key of the menu
// row the keyboard is on; `domains` is the last list of domains the server gave (kept between openings, so the menu
// opens at once); `cursor` is the slug the keyboard's cursor is on, null whenever the keyboard is not driving the list.
const state = { rail: false, width: outlineWidth(null), expanded: new Set(), menuOpen: false, sub: null, menuFocus: null, domains: null, cursor: null };
let root = null;
let parts = null; // the outline's standing parts, built once: only what changes inside them is drawn again
let peek = null;
let peekBy = null; // who opened the peek, "pointer" or "keys": the other one leaving does not close it
let peekTimer = 0;
let hot = null; // the slug of the dash under the pointer: its row in the peek is lit
let lastSelected = null;
let askedDomains = false;

/** How long the pointer rests on the rail's dashes before the peek opens, so crossing the rail shows nothing. */
const PEEK_MS = 120;

// Whether the reader's last move was a key. The cursor's ring is the keyboard's place: it is never painted at page
// load or for a pointer, and a press anywhere takes it away. Registered as the module loads, so it runs before the
// page's key listener (keys.js) hands a Tab to onFocus.
let keyboard = false;
window.addEventListener("keydown", (e) => {
  if (e.isTrusted && !e.metaKey && !e.ctrlKey && !e.altKey && !["Shift", "Meta", "Control", "Alt"].includes(e.key)) keyboard = true;
}, true);
window.addEventListener("pointerdown", () => {
  keyboard = false;
  if (!root) return;
  if (state.cursor !== null) {
    state.cursor = null;
    applyCursor();
  }
  if (peekBy === "keys") hidePeek();
}, true);

/** Downloads the open domain as a map file (GET /api/map). */
export async function exportMap() {
  try {
    const file = await api(`/api/map?domain=${encodeURIComponent(app.domain)}`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2) + "\n"], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = mapFileName(file.slug ?? app.domain);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (error) {
    toastError(error, t("outline.exportMap"));
  }
}

function storageKey() {
  return `outline:${app.domain}`;
}

/** A phone has no rail: the outline is the Islands place, the whole screen or not there (places.js). */
const NARROW = "(max-width: 720px)";

/** The open outline's width is the reader's, per browser like the pane's (not per domain). */
const WIDTH_KEY = "outline-w";

function applyWidth() {
  document.documentElement.style.setProperty("--outline-w", `${state.rail ? RAIL_W : state.width}px`);
}

function load() {
  state.rail = false;
  try {
    state.width = outlineWidth(localStorage.getItem(WIDTH_KEY));
  } catch {
    /* storage unavailable */
  }
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.rail = Boolean(saved.rail) && !matchMedia(NARROW).matches; // a phone shows the whole list or none of it
    state.expanded = new Set(Array.isArray(saved.expanded) ? saved.expanded : []);
  } catch {
    /* no storage, or a bad value: start fresh */
  }
}

function save() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ rail: state.rail, expanded: [...state.expanded] }));
  } catch {
    /* storage unavailable */
  }
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, className) {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** A tip on something in a column of rows goes above it: below, it would lie over the row the pointer moves to next. */
function tipAbove(node, text) {
  tip(node, text);
  node.dataset.tipSide = "top";
}

/** Selects an island; if it lives at another scale, the map changes scale first. */
async function go(node) {
  if (node.scale !== app.scale) await setScale(node.scale);
  await select(node.slug);
}

export function toggleRail() {
  state.rail = !state.rail;
  applyWidth();
  hidePeek();
  save();
  render(); // a cursor on an islet falls back to a top-level island when the rail collapses (keepCursor)
  frameSelection(); // frames against the intended width (outlineInset reads --outline-w), so the map settles where the panel will
}

function toggleExpanded(slug) {
  if (state.expanded.has(slug)) state.expanded.delete(slug);
  else state.expanded.add(slug);
  save();
  render();
}

// ---- the list ----

/** One row. Only the aside's copy carries ids: the peek is a duplicate and must not repeat them. */
function rowEl(row, marks, on, ids) {
  const { node } = row;
  const li = el("li");
  li.setAttribute("role", "presentation");
  const r = el("div", `row${on ? " on" : ""}${row.depth ? " islet" : ""}`);
  if (ids) r.id = `row-${node.slug}`;
  r.dataset.slug = node.slug;
  r.setAttribute("role", "option");
  r.setAttribute("aria-selected", String(on));
  r.style.setProperty("--depth", String(row.depth));
  const tw = button("", () => toggleExpanded(node.slug), `tw${row.hasChildren ? "" : " none"}`);
  if (row.hasChildren) {
    if (ids) tw.dataset.f = `tw:${node.slug}`;
    tw.append(icon(row.open ? "chevron-down" : "chevron-right", { size: 12 }));
    tw.setAttribute("aria-expanded", String(row.open));
    tw.setAttribute("aria-label", t(row.open ? "outline.hideIslets" : "outline.showIslets", { name: node.name }));
  }
  r.append(tw, el("span", marks.dot), el("span", `name${marks.open ? " open" : ""}`, node.name));
  if (node.harbour) {
    const anchor = el("span", "anchor");
    anchor.append(icon("anchor", { size: 12 }));
    tipAbove(anchor, t("outline.harbour"));
    r.append(anchor);
  }
  if (marks.count) r.append(el("span", "n", marks.count)); // an untouched island shows no count: open water is not a score
  r.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest(".tw")) return; // the twisty folds and unfolds; it sails nowhere
    void go(node);
  });
  li.append(r);
  return li;
}

/**
 * Draws the rows into a list that stays on the page. A row whose content has not changed keeps its element
 * (keep.js), so a snapshot arriving mid-press loses no click, a hover does not flicker, and focus stays where it is.
 * The cursor is painted afterwards (applyCursor), so it is no part of a row's signature.
 */
function drawList(ul, outline, ids) {
  const rows = visibleRows(outline.islands, state.expanded, app.selected);
  ul.classList.toggle("flat", !rows.some((r) => r.hasChildren)); // nothing here has islets: no gutter for a twisty
  keyedChildren(ul, rows.map((row) => {
    const marks = rowMarks(row.node, app.mode); // the outline follows the map's lens
    const on = row.node.slug === app.selected;
    return {
      key: row.node.slug,
      sig: JSON.stringify([row.depth, row.hasChildren, row.open, on, marks, row.node.name, row.node.harbour, row.node.scale]),
      build: () => rowEl(row, marks, on, ids),
    };
  }));
  // Each row's tip says what its dot and count mean, and leads with the whole name where the row cuts it. Whether
  // it does is a matter of width, so it is read off the page: every row first, then every tip (one layout, not one a row).
  const cut = [...ul.children].map((li) => {
    const name = li.querySelector(".name");
    return name.scrollWidth > name.clientWidth;
  });
  [...ul.children].forEach((li, i) => {
    const text = rowTip(rows[i].node, app.mode, cut[i]);
    if (li.firstChild.dataset.tip !== text) tipAbove(li.firstChild, text);
  });
}

function drawRail(outline) {
  keyedChildren(parts.dashes, outline.islands.map((node) => {
    const cls = dashClass(node, app.selected, app.mode);
    return {
      key: node.slug,
      sig: JSON.stringify([cls, node.name, node.scale]),
      build: () => {
        const d = el("div", cls);
        d.id = `dash-${node.slug}`;
        d.dataset.slug = node.slug;
        d.setAttribute("role", "option");
        d.setAttribute("aria-label", node.name);
        d.addEventListener("click", () => void go(node));
        return d;
      },
    };
  }));
}

// ---- the peek: the list as a card beside the rail ----

function showPeek(by) {
  clearTimeout(peekTimer);
  peekTimer = 0;
  if (!state.rail || !app.outline) return;
  if (!peek) {
    peek = el("div", "peek pop arrive"); // the entrance plays each time `hidden` comes off, never on a redraw of its rows
    peek.id = "peek";
    const ul = el("ul", "list");
    ul.setAttribute("role", "presentation");
    peek.append(ul);
    peek.addEventListener("mouseenter", () => markHot(null)); // its own rows answer the pointer from here
    peek.addEventListener("mousedown", (e) => {
      e.preventDefault(); // the peek is the outline's, though it stands outside it: a press here keeps the keyboard with the outline
      setRegion("outline");
    });
    peek.addEventListener("mouseleave", (e) => { if (peekBy === "pointer" && !(e.relatedTarget && root.contains(e.relatedTarget))) hidePeek(); });
    document.body.append(peek);
  }
  peek.hidden = false;
  peekBy = by;
  drawList(peek.firstChild, app.outline, false);
  applyCursor();
  markHot(hot);
}

function hidePeek() {
  clearTimeout(peekTimer);
  peekTimer = 0;
  if (peek) peek.hidden = true;
  peekBy = null;
}

/** The pointer on the rail: the peek opens from the dashes after a rest, and the dash under the pointer names its row. */
function onRailPointer(e) {
  if (!state.rail) return;
  const target = e.target instanceof Element ? e.target : null;
  const overDashes = Boolean(target?.closest(".dashes"));
  if (overDashes && (!peek || peek.hidden) && !peekTimer) peekTimer = setTimeout(() => showPeek("pointer"), PEEK_MS);
  if (!overDashes && peekTimer) {
    clearTimeout(peekTimer);
    peekTimer = 0;
  }
  markHot(target?.closest(".dash")?.dataset.slug ?? null);
}

/** Lights the peek's row for the dash under the pointer, so a dash can be told from its neighbours. */
function markHot(slug) {
  hot = slug;
  if (peek) for (const r of peek.querySelectorAll(".row")) r.classList.toggle("hot", r.dataset.slug === slug);
}

// ---- the domain menu ----

function knownDomains() {
  return state.domains ?? [{ slug: app.domain, name: app.outline?.domain.name ?? app.domain }];
}

/** Reads the domain list. The menu never waits for it: it opens with what is known and takes the rest as it arrives. */
async function loadDomains() {
  try {
    const res = await request("/api/domains");
    const domains = (await res.json()).domains;
    if (!Array.isArray(domains) || JSON.stringify(domains) === JSON.stringify(state.domains)) return;
    state.domains = domains;
    if (state.menuOpen) render();
  } catch {
    /* the menu keeps the domains it knows */
  }
}

function menuNode() {
  return parts?.head.querySelector(":scope > .menu") ?? null;
}

/** A press outside the open menu closes it and does nothing else: the map, a row or a button under it never sees it. */
function onOutside(e) {
  if (e.target instanceof Element && e.target.closest("#outline .menu, #outline .ws")) return;
  e.preventDefault(); // no mousedown follows, so no region changes hands and no text is selected
  e.stopPropagation();
  // The click that ends this press is swallowed too. The listener is taken away once the press is over, whether or
  // not a click came of it (a press that turned into a drag fires none), so it can never eat a later click.
  const eat = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  const done = () => setTimeout(() => {
    document.removeEventListener("click", eat, true);
    document.removeEventListener("pointerup", done, true);
    document.removeEventListener("pointercancel", done, true);
    if (!state.menuOpen && !root.contains(document.activeElement)) root.focus({ preventScroll: true }); // the press may have moved focus to what it landed on
  }, 0);
  document.addEventListener("click", eat, true);
  document.addEventListener("pointerup", done, true);
  document.addEventListener("pointercancel", done, true);
  closeMenu();
}

function setSub(sub) {
  if (state.sub === "theme" && sub !== "theme") endPreview(); // a theme tried and not picked does not stay
  state.sub = sub;
}

function openMenu() {
  if (state.menuOpen || !app.outline) return;
  state.menuOpen = true;
  state.sub = null;
  state.menuFocus = `domain:${app.domain}`;
  hidePeek(); // in the rail the menu opens where the peek stands
  document.addEventListener("pointerdown", onOutside, true);
  render(); // at once, with the domains already known
  void loadDomains();
}

/** Closes the menu and gives the keyboard back to the outline. */
function closeMenu() {
  if (!state.menuOpen) return;
  document.removeEventListener("pointerdown", onOutside, true);
  setSub(null);
  state.menuOpen = false;
  state.menuFocus = null;
  render();
  root.focus({ preventScroll: true });
}

function toggleMenu() {
  if (state.menuOpen) closeMenu();
  else openMenu();
}

/** Opens another domain: the page loads again on it, at its top scale. Also the command palette's way in. */
export function switchDomain(slug) {
  const url = new URL(location.href);
  url.searchParams.set("domain", slug);
  url.searchParams.delete("scale");
  location.href = url.toString();
}

/** A pick stores the language, tells the server (the personas reply in it), and reloads, since every word on the page was drawn in the old one. */
export async function chooseLanguage(id) {
  setLanguage(id);
  try {
    await api("/api/learner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: id }) });
  } catch {
    // the page still switches; the personas keep the old language until the next pick
  }
  location.reload();
}

/** What each command row is: its icon, its words, its key, its tip, and what a pick does. outline-model.js says which rows there are. */
const COMMANDS = {
  new: { icon: "plus", label: "outline.newDomain", keys: "n", cls: "new", run: () => { closeMenu(); openNewDomain(); } },
  // The open domain as one file to share: its structure, with nothing the reader said.
  export: { icon: "share", label: "outline.exportMap", hint: "outline.exportMapHint", run: () => { closeMenu(); void exportMap(); } },
  // The images in this domain's conversations: how much they take, and removing old ones.
  images: { icon: "image", label: "outline.images", hint: "outline.imagesHint", run: () => { closeMenu(); openImagesSheet(); } },
  // The same dialog as the pencil on the current domain's row: this row is its way in by keyboard and on a phone.
  edit: { icon: "pencil", label: "outline.edit", hint: "outline.editHint", run: () => { closeMenu(); void openDomainEdit(app.domain); } },
  about: { icon: "user", label: "outline.about", run: () => { closeMenu(); void openAbout(); } },
  key: { icon: "key", label: "outline.yourKey", run: () => { closeMenu(); openYourKey(); } },
  // Everything saves in this browser as it happens; these two move a copy in and out of it.
  backup: { icon: "download", label: "outline.backup", hint: "outline.backupHint", run: () => { closeMenu(); void exportDatabase(); } },
  restore: { icon: "upload", label: "outline.restore", hint: "outline.restoreHint", run: () => { closeMenu(); importDatabase(); } },
};
/** The two rows that open a list under themselves. `t` changes the theme from anywhere, so the Theme row names it. */
const LISTS = { theme: { icon: "theme", label: "outline.theme", keys: "t" }, language: { icon: "globe", label: "outline.language" } };
const GROUP_LABELS = { domains: "outline.groupDomains", domain: "outline.groupDomain", appearance: "outline.groupAppearance", you: "outline.groupYou" };

/** One menu row: icon, words, then at the right its value, a check when it is the chosen one, its key, a chevron when it opens a list. */
function miEl(k, { cls, iconName, label, desc, value, radio = false, on = false, keys, opens = false, open = false, hint, lang, run }) {
  const b = button("", run, cls ? `mi ${cls}` : "mi");
  b.dataset.k = k;
  b.dataset.f = `mi:${k}`;
  b.tabIndex = -1; // the arrows move through the menu; Tab stays out of it
  b.setAttribute("role", radio ? "menuitemradio" : "menuitem");
  if (radio) b.setAttribute("aria-checked", String(on));
  if (opens) b.setAttribute("aria-expanded", String(open));
  if (lang) b.lang = lang;
  if (iconName) b.append(icon(iconName));
  const words = el("span", "grow");
  if (desc) {
    words.classList.add("two");
    words.append(el("span", "nm", label), el("span", "desc", desc));
  } else words.textContent = label;
  b.append(words);
  if (value) b.append(el("span", "cur", value));
  if (on) b.append(icon("check"));
  if (keys) {
    const caps = el("span", "keys");
    caps.append(el("kbd", null, keys));
    b.append(caps);
  }
  if (opens) b.append(icon(open ? "chevron-down" : "chevron-right", { size: 12 }));
  if (hint) {
    tipAbove(b, hint);
    b.setAttribute("aria-description", hint); // a screen reader hears what the tip shows
  }
  return b;
}

function domainEl(row) {
  const item = miEl(row.k, { iconName: "map", label: row.name, desc: row.desc, radio: true, on: row.on, run: () => (row.on ? closeMenu() : switchDomain(row.slug)) });
  if (!row.on) return item;
  // The current domain's row carries its edit button, shown on hover or focus (always on a touch screen).
  const wrap = el("div", "mi-row");
  const edit = button("", () => { closeMenu(); void openDomainEdit(row.slug); }, "ib edit btn quiet icon sm");
  edit.tabIndex = -1;
  edit.setAttribute("aria-label", t("outline.editNamed", { name: row.name }));
  edit.append(icon("pencil", { size: 14 }));
  tipAbove(edit, t("outline.editDomain"));
  wrap.append(item, edit);
  return wrap;
}

/** A row of the list under Theme or Language. Hovering or focusing a theme wears it on the whole page; a click keeps it. */
function choiceEl(row) {
  if (row.parent === "theme") {
    const item = miEl(row.k, { cls: "mi-sub", label: row.name, radio: true, on: row.on, run: () => { applyTheme(row.id); closeMenu(); } });
    const preview = () => applyTheme(row.id, { persist: false });
    item.addEventListener("mouseenter", preview);
    item.addEventListener("focus", preview);
    return item;
  }
  return miEl(row.k, { cls: "mi-sub", label: row.name, radio: true, on: row.on, lang: row.id, run: () => void chooseLanguage(row.id) });
}

/** The list under Theme or Language. Leaving the themes (pointer or keyboard) goes back to the stored theme. */
function choicesEl(id) {
  const list = el("div", "themes");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", t(LISTS[id].label));
  list.dataset.sub = id;
  if (id === "theme") {
    list.addEventListener("mouseleave", () => endPreview());
    list.addEventListener("focusout", (e) => { if (!list.contains(e.relatedTarget)) endPreview(); });
  }
  return list;
}

function menuEl() {
  const menu = el("div", "menu arrive"); // the entrance plays as the element joins the page; it stays while the menu is open, so no redraw replays it
  menu.addEventListener("animationend", () => menu.classList.remove("arrive"), { once: true });
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", t("outline.menu"));
  menu.addEventListener("focusin", (e) => {
    const k = e.target instanceof Element ? e.target.closest(".mi")?.dataset.k : null;
    if (k) state.menuFocus = k; // a click moves the keyboard's place too
  });
  return menu;
}

function currentGroups() {
  return menuGroups({ domains: knownDomains(), current: app.domain, hosted: isHosted(), sub: state.sub, themes: THEMES, theme: savedTheme(), languages: LANGUAGES, language: language() });
}

const sigOf = (row) => JSON.stringify(row);

/** Draws the open menu. Groups, labels and unchanged rows keep their elements; only what changed is built again. */
function drawMenu(menu) {
  const groups = currentGroups();
  keyedChildren(menu, groups.flatMap((g, i) => [
    ...(i ? [{ key: `sep:${g.id}`, sig: "", build: () => { const sep = el("div", "sep"); sep.setAttribute("role", "separator"); return sep; } }] : []),
    { key: g.id, sig: "", build: () => {
      const grp = el("div", "grp");
      grp.dataset.g = g.id;
      grp.setAttribute("role", "group");
      grp.setAttribute("aria-label", t(GROUP_LABELS[g.id]));
      return grp;
    } },
  ]));
  for (const g of groups) {
    const grp = menu.querySelector(`:scope > [data-g="${g.id}"]`);
    const label = { key: "ml", sig: "", build: () => { const ml = el("div", "ml", t(GROUP_LABELS[g.id])); ml.setAttribute("aria-hidden", "true"); return ml; } };
    if (g.id === "domains") {
      // The domains scroll in their own box once there are many, so the commands under them stay in reach.
      keyedChildren(grp, [label, { key: "list", sig: "", build: () => el("div", "domains") }, commandEntry(g.rows.at(-1))]);
      const list = grp.querySelector(":scope > .domains");
      keyedChildren(list, g.rows.slice(0, -1).map((row) => ({ key: row.k, sig: sigOf(row), build: () => domainEl(row) })));
      for (const item of list.querySelectorAll(".mi")) { // a name the row cuts short is whole in its tip
        const words = item.querySelector(".grow:not(.two)");
        if (!words) continue;
        if (words.scrollWidth > words.clientWidth) tipAbove(item, words.textContent);
        else delete item.dataset.tip;
      }
      continue;
    }
    const entries = [label];
    for (const row of g.rows) {
      if (row.parent) continue; // drawn inside its list, below
      if (!(row.k in LISTS)) {
        entries.push(commandEntry(row));
        continue;
      }
      const spec = LISTS[row.k];
      entries.push({ key: row.k, sig: sigOf(row), build: () => miEl(row.k, { cls: "theme-row", iconName: spec.icon, label: t(spec.label), value: row.value, keys: spec.keys, opens: true, open: row.open, run: () => {
        setSub(state.sub === row.k ? null : row.k);
        state.menuFocus = row.k;
        render();
      } }) });
      if (row.open) entries.push({ key: `list:${row.k}`, sig: "", build: () => choicesEl(row.k) });
    }
    keyedChildren(grp, entries);
    for (const id of Object.keys(LISTS)) {
      const list = grp.querySelector(`:scope > .themes[data-sub="${id}"]`);
      if (list) keyedChildren(list, g.rows.filter((row) => row.parent === id).map((row) => ({ key: row.k, sig: sigOf(row), build: () => choiceEl(row) })));
    }
  }
}

function commandEntry(row) {
  const spec = COMMANDS[row.k];
  return { key: row.k, sig: "", build: () => miEl(row.k, { cls: spec.cls, iconName: spec.icon, label: t(spec.label), keys: spec.keys, hint: spec.hint ? t(spec.hint) : undefined, run: spec.run }) };
}

/** Puts the keyboard on the menu row it belongs on, after a draw or a move. */
function focusMenuRow() {
  const menu = menuNode();
  if (!menu) return;
  const row = (state.menuFocus ? menu.querySelector(`[data-k="${CSS.escape(state.menuFocus)}"]`) : null) ?? menu.querySelector(".mi");
  if (row && document.activeElement !== row) row.focus(); // focus also scrolls it into view inside the menu
}

/**
 * A key while the menu is open (keys.js sends every key but Escape here, and nothing else gets it): the arrows, j / k,
 * Home and End walk the rows, Right and Left open and close the list under Theme or Language, Enter and Space are the
 * focused row's own click, Tab stays put, and the keys the rows name (n, t) and the one that opened the menu (d) work.
 */
function menuKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return; // browser shortcuts stay the browser's
  const menu = menuNode();
  if (!menu) return;
  if (e.key === "Enter" || e.key === " ") {
    if (menu.contains(document.activeElement)) return; // the row's own click
    e.preventDefault();
    focusMenuRow(); // focus had fallen out of the menu: bring it back rather than act on a row nobody sees focused
    return;
  }
  e.preventDefault(); // nothing reaches the list behind, and an arrow never scrolls the page
  if (e.key === "d") return closeMenu();
  if (e.key === "n") return COMMANDS.new.run();
  if (e.key === "t") {
    cycleTheme();
    render(); // the Theme row names the new one
    return;
  }
  const step = menuStep(currentGroups(), state.menuFocus, e.key);
  if (!step) return; // Tab, a letter: swallowed
  if ("sub" in step) setSub(step.sub);
  state.menuFocus = step.focus;
  if ("sub" in step) render();
  else focusMenuRow();
}

// ---- the head, the foot, the grip ----

function drawHead(outline) {
  const open = state.menuOpen;
  keyedChildren(parts.head, [
    { key: "ws", sig: JSON.stringify([outline.domain.name, open]), build: () => {
      const ws = button("", toggleMenu, "ws");
      ws.dataset.f = "ws";
      ws.setAttribute("aria-haspopup", "menu");
      ws.setAttribute("aria-expanded", String(open));
      ws.setAttribute("aria-keyshortcuts", "d");
      ws.append(el("span", "name", outline.domain.name), icon("chevron-down", { size: 12 }));
      if (!open) tip(ws, t("outline.menu"), "d"); // no tip over its own open menu
      return ws;
    } },
    { key: "sp", sig: "", build: () => el("span", "sp") },
    // The command palette's way in for a pointer or a finger; its key opens it from anywhere.
    { key: "find", sig: "", build: () => {
      const find = button("", () => openPalette(), "ib find btn quiet icon md");
      find.dataset.f = "find";
      find.setAttribute("aria-keyshortcuts", paletteKeys() === "⌘K" ? "Meta+K" : "Control+K");
      find.append(icon("search"));
      tip(find, t("outline.find"), paletteKeys());
      return find;
    } },
    { key: "tog", sig: String(state.rail), build: () => {
      const tog = button("", toggleRail, "ib btn quiet icon md");
      tog.dataset.f = "tog";
      tog.setAttribute("aria-keyshortcuts", "[");
      tog.append(icon("sidebar"));
      tip(tog, t(state.rail ? "outline.expand" : "outline.collapse"), "[");
      return tog;
    } },
    ...(open ? [{ key: "menu", sig: "", build: menuEl }] : []),
  ]);
  if (open) drawMenu(menuNode());
}

/** The foot: the two keys worth knowing first, each a button that does what its key does. */
function footEl() {
  const ft = el("div", "ft");
  const hint = (f, key, words, run) => {
    const b = button("", run, "btn quiet sm");
    b.dataset.f = f;
    b.setAttribute("aria-keyshortcuts", key);
    b.append(el("kbd", null, key), el("span", null, words));
    return b;
  };
  ft.append(
    hint("ft:rail", "[", t("outline.footCollapse"), toggleRail),
    // The cheat sheet is keys.js's and opens on `?`: the button presses that key, so the sheet keeps one way in.
    hint("ft:keys", "?", t("outline.footKeys"), () => root.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true }))),
  );
  return ft;
}

/** The grip on the outline's right edge: drag to widen or narrow it, double-click for the width it started at. */
function gripEl() {
  const grip = el("div", "grip");
  grip.title = t("outline.resize"); // the one native tooltip here: it shows at the pointer, anywhere along the edge, where tip() would sit at the window's foot
  grip.addEventListener("dblclick", () => {
    state.width = outlineWidth(null);
    try {
      localStorage.removeItem(WIDTH_KEY);
    } catch {
      /* storage unavailable */
    }
    applyWidth();
    frameSelection();
  });
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    document.body.classList.add("outline-resizing");
    let moved = false;
    const move = (ev) => {
      moved = true;
      state.width = outlineWidth(ev.clientX);
      applyWidth();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("outline-resizing");
      if (!moved) return;
      try {
        localStorage.setItem(WIDTH_KEY, String(state.width));
      } catch {
        /* storage unavailable */
      }
      frameSelection();
      render(); // a wider or narrower list cuts other names: the rows' tips follow
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  return grip;
}

/** The standing parts, built once. */
function build() {
  const list = el("ul", "list");
  list.setAttribute("role", "presentation"); // the aside is the listbox; it holds focus and aria-activedescendant
  list.addEventListener("scroll", () => list.classList.toggle("scrolled", list.scrollTop > 0), { passive: true }); // a hairline once rows have gone up under the caption
  return { head: el("div", "oh"), sum: el("div", "sum"), list, dashes: el("div", "dashes"), foot: footEl(), grip: gripEl() };
}

// ---- drawing ----

/** What inside the outline has focus, as the key it can be found by again (`data-f`); null when nothing in it has. */
function heldFocus() {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || a === root || !root.contains(a)) return null;
  return a.dataset.f ?? "";
}

/**
 * Draws the outline. Its parts stand; each takes only what changed (the rows and the menu's rows through keep.js),
 * so a snapshot that changes nothing here touches nothing, and one that does leaves the rest alone. Whatever had
 * focus has it afterwards: the same element when it was kept, the one built in its place when it was not.
 */
function render() {
  if (!root) return;
  const outline = app.outline;
  root.classList.toggle("rail", state.rail);
  if (!outline) {
    root.replaceChildren();
    root.removeAttribute("aria-activedescendant"); // the rows it named are gone
    return;
  }
  const held = heldFocus();
  if (parts.head.parentNode !== root) root.replaceChildren(parts.head, parts.sum, parts.list, parts.dashes, parts.foot, parts.grip);
  keepCursor();
  drawHead(outline);
  const summary = summaryLine(outline, app.mode);
  if (parts.sum.textContent !== summary) parts.sum.textContent = summary;
  drawList(parts.list, outline, true);
  drawRail(outline);
  if (peek && !peek.hidden) {
    drawList(peek.firstChild, outline, false);
    markHot(hot); // a row built again takes its light back
  }
  applyCursor(); // the aside's aria-activedescendant follows the rows
  if (state.menuOpen) focusMenuRow();
  else if (held !== null && !root.contains(document.activeElement)) {
    const again = held ? root.querySelector(`[data-f="${CSS.escape(held)}"]`) : null;
    (again ?? root).focus({ preventScroll: true });
  }
}

// ---- the keyboard's cursor ----

/** The rows the cursor moves over: the list when expanded, the top-level dashes when railed. */
function cursorRows() {
  if (!app.outline) return [];
  if (state.rail) return app.outline.islands.map((node) => ({ node, depth: 0, hasChildren: false, open: false }));
  return visibleRows(app.outline.islands, state.expanded, app.selected);
}

/** Where the cursor starts when the keyboard arrives without a key that moves it: the selection, else the harbour, else the first row. */
function seedCursor() {
  const rows = cursorRows();
  if (rows.some((r) => r.node.slug === state.cursor)) return;
  const pick = rows.find((r) => r.node.slug === app.selected) ?? rows.find((r) => r.node.harbour) ?? rows[0];
  state.cursor = pick ? pick.node.slug : null;
}

/** A cursor whose row has gone (its parent folded, the rail took the islets) moves to a row that is there. */
function keepCursor() {
  if (state.cursor === null || cursorRows().some((r) => r.node.slug === state.cursor)) return;
  state.cursor = null;
  seedCursor();
}

/** Paints the cursor onto the rows already on screen; no rebuild. */
function applyCursor() {
  if (!root) return;
  const boxes = peek ? [root, peek] : [root];
  for (const box of boxes) for (const n of box.querySelectorAll(".row.cur, .dash.cur")) n.classList.remove("cur");
  if (state.cursor) {
    const sel = `[data-slug="${CSS.escape(state.cursor)}"]`;
    for (const box of boxes) for (const n of box.querySelectorAll(sel)) n.classList.add("cur");
    root.setAttribute("aria-activedescendant", `${state.rail ? "dash" : "row"}-${state.cursor}`); // the aside holds focus, so the aside carries it
  } else root.removeAttribute("aria-activedescendant");
}

/** Shows the moved cursor: scrolled into view, and in the rail named by the peek, since a dash says nothing. */
function showCursor() {
  if (state.rail) showPeek(peekBy ?? "keys");
  applyCursor();
  const row = root.querySelector(".row.cur, .dash.cur");
  if (row) row.scrollIntoView({ block: "nearest" });
}

/** Moves the cursor to the nearest shallower row above it. Returns whether it moved. */
function ascend() {
  const rows = cursorRows();
  const i = rows.findIndex((r) => r.node.slug === state.cursor);
  if (i < 0) return false;
  for (let j = i - 1; j >= 0; j--) {
    if (rows[j].depth >= rows[i].depth) continue;
    state.cursor = rows[j].node.slug;
    showCursor();
    return true;
  }
  return false; // a top-level row: Left has nowhere to go
}

const MOVES = new Set(["ArrowDown", "ArrowUp", "j", "k", "Home", "End", "ArrowRight", "ArrowLeft"]);

const outlineHandler = {
  onKey(e) {
    if ((e.key === "Enter" || e.key === " ") && e.target instanceof HTMLButtonElement) return false; // a focused control's own key, not the list's
    if (e.key === "n") {
      openNewDomain();
      return true;
    }
    if (e.key === "d") {
      openMenu();
      return true;
    }
    const rows = cursorRows();
    if (e.key === "Enter") {
      const row = rows.find((r) => r.node.slug === state.cursor);
      if (!row) return false; // no cursor on screen: Enter acts on nothing
      if (peekBy === "keys") hidePeek();
      void go(row.node);
      return true;
    }
    if (!MOVES.has(e.key)) return false;
    if (state.cursor === null) {
      // The first key that moves the cursor also brings it: from the selected row when there is one, else onto the harbour.
      const start = cursorStart(rows, app.selected, e.key);
      if (!start) return false;
      state.cursor = start.cursor;
      if (!start.apply) {
        showCursor();
        return true;
      }
    }
    const move = moveCursor(rows, state.cursor, e.key);
    if (move?.toggle) {
      // Left on a parent kept open by the selection would flip `expanded` with no visible change: ascend instead.
      if (e.key === "ArrowLeft" && !collapsible(app.outline.islands, state.expanded, app.selected, move.toggle)) return ascend() || (showCursor(), true);
      toggleExpanded(move.toggle); // a redraw, but from a key press: nothing is under the pointer
      return true;
    }
    if (move) state.cursor = move.cursor;
    showCursor(); // also when the key had nowhere to go: the cursor it brought still shows
    return true;
  },
  onFocus() {
    if (!keyboard) return; // a click brought the region here: no ring for a pointer
    seedCursor();
    applyCursor();
  },
  onBlur() {
    if (peekBy === "keys") hidePeek();
  },
  menuOpen: () => state.menuOpen,
  menuKey,
  closeMenu,
  hasCursor: () => state.cursor !== null,
  clearCursor() {
    state.cursor = null; // Escape's next rung is deselect
    applyCursor();
    if (peekBy === "keys") hidePeek();
  },
  toggleRail,
};

export function installOutline() {
  root = document.getElementById("outline");
  parts = build();
  load();
  registerRegion("outline", outlineHandler);
  applyWidth();
  // The width glides when the rail folds or the grip is double-clicked; once it has settled the rows know which names they cut.
  root.addEventListener("transitionend", (e) => { if (e.target === root && e.propertyName === "width") render(); });
  // A pointer's click on a control here does its work and leaves the keyboard with the outline itself: a key pressed
  // afterwards drives the list, and no focus ring appears on the control last clicked. Enter or Space on a focused
  // control (a click with no pointer) keeps its focus, and the open menu keeps its own.
  root.addEventListener("click", (e) => {
    if (e.detail === 0 || state.menuOpen) return;
    const a = document.activeElement;
    if (a !== root && (a === document.body || root.contains(a))) root.focus({ preventScroll: true });
  });
  root.addEventListener("mouseover", onRailPointer);
  root.addEventListener("mouseleave", (e) => {
    if (peek && e.relatedTarget && peek.contains(e.relatedTarget)) return; // on to the peek itself
    markHot(null);
    if (peekBy !== "keys") hidePeek();
  });
  app.listeners.add(() => {
    // A pick made elsewhere (the map, a pointer card) carries the cursor along, so two rows never look chosen.
    if (app.selected !== lastSelected) {
      lastSelected = app.selected;
      if (state.cursor !== null && app.selected) state.cursor = app.selected;
    }
    if (app.outline && !askedDomains) { // once, so the first opening of the menu already lists every domain
      askedDomains = true;
      void loadDomains();
    }
    render();
  });
  render();
}
