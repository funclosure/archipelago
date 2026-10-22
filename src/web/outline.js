// The outline: the domain's tree on the left. Pure helpers first (tested), then the DOM.
import { app, setScale, frameSelection } from "./app.js";
import { select } from "./interactions.js";
import { FULL_W, RAIL_W, visibleRows, collapsible, dashClass, countNodes, summaryLine, rowMarks } from "./outline-model.js";
import { registerRegion, region } from "./keys.js";
import { moveCursor } from "./keys-model.js";
import { THEMES } from "./theme-model.js";
import { applyTheme, endPreview, savedTheme } from "./theme.js";
import { openAbout } from "./learner.js";
import { exportDatabase, importDatabase, isHosted, openYourKey } from "./hosted.js";
import { openDomainEdit, openNewDomain } from "./new-domain.js";
import { request } from "./transport.js";

// app.js imports installOutline from here and this file imports app: fine, because nothing below reads app or select at module evaluation.

// ---- DOM ----

const state = { rail: false, expanded: new Set(), menuOpen: false, themesOpen: false, domains: null, cursor: null, cursorCleared: false };
let root = null;
let peek = null;

function storageKey() {
  return `outline:${app.domain}`;
}

/** A phone's first visit starts with the outline as a rail: expanded, it would cover half the map. */
const NARROW = "(max-width: 720px)";

function load() {
  state.rail = matchMedia(NARROW).matches;
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.rail = Boolean(saved.rail);
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

/** Selects an island; if it lives at another scale, the map changes scale first. */
async function go(node) {
  if (node.scale !== app.scale) await setScale(node.scale);
  await select(node.slug);
}

function toggleRail() {
  state.rail = !state.rail;
  document.documentElement.style.setProperty("--outline-w", `${state.rail ? RAIL_W : FULL_W}px`);
  hidePeek();
  save();
  state.cursorCleared = false;
  seedCursor(); // a cursor on an islet falls back to a top-level island when the rail collapses
  render();
  frameSelection(); // frames against the intended width (outlineInset reads --outline-w), so the map settles where the panel will
}

function toggleExpanded(slug) {
  if (state.expanded.has(slug)) state.expanded.delete(slug);
  else state.expanded.add(slug);
  save();
  render();
}

/** The row list. Only the aside's copy carries ids: the peek is a duplicate and must not repeat them. */
function listEl(outline, { ids = true } = {}) {
  const ul = el("ul", "list");
  ul.setAttribute("role", "presentation"); // the aside is the listbox; it holds focus and aria-activedescendant
  for (const row of visibleRows(outline.islands, state.expanded, app.selected)) {
    const li = el("li");
    li.setAttribute("role", "presentation");
    const r = el("div", `row${row.node.slug === app.selected ? " on" : ""}${row.depth ? " islet" : ""}${row.node.slug === state.cursor ? " cur" : ""}`);
    if (ids) r.id = `row-${row.node.slug}`;
    r.dataset.slug = row.node.slug;
    r.setAttribute("role", "option");
    r.style.paddingLeft = `${6 + row.depth * 20}px`;
    const tw = button(row.open ? "▾" : "▸", (e) => {
      e.stopPropagation();
      toggleExpanded(row.node.slug);
    }, `tw${row.hasChildren ? "" : " none"}`);
    r.append(tw);
    const marks = rowMarks(row.node, app.mode); // the outline follows the map's lens
    r.append(el("span", marks.dot));
    r.append(el("span", `name${marks.open ? " open" : ""}`, row.node.name));
    if (row.node.harbour) r.append(el("span", "anchor", "⚓︎"));
    r.append(el("span", "n", marks.count));
    r.addEventListener("click", () => void go(row.node));
    li.append(r);
    ul.append(li);
  }
  return ul;
}

function showPeek() {
  if (!state.rail || !app.outline) return;
  if (!peek) {
    peek = el("div", "peek");
    peek.id = "peek";
    peek.addEventListener("mouseleave", (e) => { if (!(e.relatedTarget && root.contains(e.relatedTarget))) hidePeek(); });
    document.body.append(peek);
  }
  peek.hidden = false;
  peek.replaceChildren(listEl(app.outline, { ids: false }));
}

function hidePeek() {
  if (peek) peek.hidden = true;
}

function closeMenu() {
  if (state.themesOpen) endPreview(); // a theme hovered and not picked does not stay
  state.menuOpen = false;
  state.themesOpen = false;
  state.domains = null;
  render();
}

async function toggleMenu() {
  state.menuOpen = !state.menuOpen;
  state.themesOpen = false;
  if (!state.menuOpen) {
    state.domains = null;
    render();
    return;
  }
  if (!state.domains) {
    try {
      const res = await request("/api/domains");
      state.domains = (await res.json()).domains;
    } catch {
      state.domains = [];
    }
  }
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  render();
}

/** A pencil: the current domain's edit button. */
function pencilIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.6 12.5 2.5 13.5l1-3.1z M9.8 3.7l2.5 2.5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.4");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-linecap", "round");
  svg.append(path);
  return svg;
}

/** A sidebar icon: a panel with its left column filled while the outline is a rail, hollow while it is open. */
function panelIcon(rail) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const frame = document.createElementNS(NS, "rect");
  frame.setAttribute("x", "1.5"); frame.setAttribute("y", "2.5"); frame.setAttribute("width", "13"); frame.setAttribute("height", "11");
  frame.setAttribute("rx", "2"); frame.setAttribute("fill", "none"); frame.setAttribute("stroke", "currentColor"); frame.setAttribute("stroke-width", "1.2");
  svg.append(frame);
  if (rail) {
    const fill = document.createElementNS(NS, "rect");
    fill.setAttribute("x", "1.5"); fill.setAttribute("y", "2.5"); fill.setAttribute("width", "4.5"); fill.setAttribute("height", "11");
    fill.setAttribute("rx", "1.5"); fill.setAttribute("fill", "currentColor");
    svg.append(fill);
  } else {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", "6"); line.setAttribute("y1", "2.5"); line.setAttribute("x2", "6"); line.setAttribute("y2", "13.5");
    line.setAttribute("stroke", "currentColor"); line.setAttribute("stroke-width", "1.2");
    svg.append(line);
  }
  return svg;
}

function headerEl(outline) {
  const head = el("div", "oh");
  const ws = button("", toggleMenu, "ws");
  ws.append(el("span", "name", outline.domain.name), el("span", "chev", "▾"));
  ws.title = "switch domain";
  head.append(ws, el("span", "sp"));
  const tog = button("", toggleRail, "ib");
  tog.append(panelIcon(state.rail));
  tog.title = state.rail ? "expand the outline  [" : "collapse to a rail  [";
  tog.setAttribute("aria-label", tog.title.trim());
  head.append(tog);
  if (state.menuOpen && state.domains) {
    const menu = el("div", "menu");
    for (const d of state.domains) {
      const item = button(d.name, () => {
        const url = new URL(location.href);
        url.searchParams.set("domain", d.slug);
        url.searchParams.delete("scale");
        location.href = url.toString();
      }, `mi${d.slug === app.domain ? " on" : ""}`);
      if (d.slug !== app.domain) {
        menu.append(item);
        continue;
      }
      // The current domain's row carries its edit button, shown on hover or focus (always on a touch screen).
      const row = el("div", "mi-row");
      const edit = button("", () => { closeMenu(); void openDomainEdit(d.slug); }, "ib edit");
      edit.title = "Edit domain";
      edit.setAttribute("aria-label", `Edit ${d.name}`);
      edit.append(pencilIcon());
      row.append(item, edit);
      menu.append(row);
    }
    menu.append(button("New domain…", () => { closeMenu(); openNewDomain(); }, "mi new"));
    // Theme: one row naming the chosen theme; a click opens the list under it. Hovering a theme previews it on the
    // whole page; leaving the list (or closing the menu) goes back; a click keeps it and closes the menu.
    const cur = savedTheme();
    const themeRow = button("", (e) => {
      e.stopPropagation(); // the menu's outside-click listener must not close it
      state.themesOpen = !state.themesOpen;
      render();
    }, `mi theme-row${state.themesOpen ? " open" : ""}`);
    themeRow.setAttribute("aria-expanded", String(state.themesOpen));
    themeRow.append(el("span", null, "Theme"), el("span", "cur", THEMES.find((t) => t.id === cur)?.name ?? ""), el("span", "chev", state.themesOpen ? "▾" : "▸"));
    menu.append(el("div", "sep"), themeRow);
    if (state.themesOpen) {
      const list = el("div", "themes");
      for (const t of THEMES) {
        const item = button(t.name, () => { applyTheme(t.id); closeMenu(); }, `mi sub${t.id === cur ? " on" : ""}`);
        item.setAttribute("aria-current", String(t.id === cur));
        const preview = () => applyTheme(t.id, { persist: false });
        item.addEventListener("mouseenter", preview);
        item.addEventListener("focus", preview);
        list.append(item);
      }
      list.addEventListener("mouseleave", () => endPreview());
      list.addEventListener("focusout", (e) => { if (!list.contains(e.relatedTarget)) endPreview(); });
      menu.append(list);
    }
    menu.append(el("div", "sep"));
    menu.append(button("About you", () => { closeMenu(); void openAbout(); }, "mi"));
    if (isHosted()) {
      menu.append(button("Your key", () => { closeMenu(); openYourKey(); }, "mi"));
      // Everything saves in this browser as it happens; these two move a copy in and out of it.
      const backup = button("Download a backup", () => { closeMenu(); void exportDatabase(); }, "mi");
      backup.title = "Your charts save in this browser as you go. This downloads a copy of all of them as one .sqlite file.";
      const restore = button("Restore a backup…", () => { closeMenu(); importDatabase(); }, "mi");
      restore.title = "Replaces everything in this browser with the charts in a backup file.";
      menu.append(backup, restore);
    }
    head.append(menu);
  }
  return head;
}

function railEl(outline) {
  const dashes = el("div", "dashes");
  for (const node of outline.islands) {
    const d = el("div", `${dashClass(node, app.selected, app.mode)}${node.slug === state.cursor ? " cur" : ""}`);
    d.dataset.slug = node.slug;
    d.title = node.name;
    d.addEventListener("click", () => void go(node));
    dashes.append(d);
  }
  return dashes;
}

function render() {
  if (!root) return;
  const outline = app.outline;
  root.classList.toggle("rail", state.rail);
  if (!outline) {
    root.replaceChildren();
    root.removeAttribute("aria-activedescendant"); // the rows it named are gone
    return;
  }
  if (state.cursor === null && !state.cursorCleared && region() === "outline") seedCursor();
  const frag = document.createDocumentFragment();
  frag.append(headerEl(outline));
  frag.append(el("div", "sum", summaryLine(outline, app.mode)));
  frag.append(el("div", "sec", "Islands"));
  frag.append(listEl(outline));
  frag.append(railEl(outline));
  const ft = el("div", "ft");
  const hint = el("span");
  hint.append(el("kbd", null, "["), " outline · ", el("kbd", null, "?"), " keys");
  ft.append(hint, el("span", null, `${countNodes(outline.islands)} islands`));
  frag.append(ft);
  const top = root.querySelector(".list")?.scrollTop ?? 0;
  root.replaceChildren(frag);
  const list = root.querySelector(".list");
  if (list) list.scrollTop = top;
  if (peek && !peek.hidden) peek.replaceChildren(listEl(outline, { ids: false }));
  applyCursor(); // the rows are new; the aside's aria-activedescendant follows them
}

/** The rows the cursor moves over: the list when expanded, the top-level dashes when railed. */
function cursorRows() {
  if (!app.outline) return [];
  if (state.rail) return app.outline.islands.map((node) => ({ node, depth: 0, hasChildren: false, open: false }));
  return visibleRows(app.outline.islands, state.expanded, app.selected);
}

function seedCursor() {
  const rows = cursorRows();
  if (rows.some((r) => r.node.slug === state.cursor)) return;
  const pick = rows.find((r) => r.node.slug === app.selected) ?? rows.find((r) => r.node.harbour) ?? rows[0];
  state.cursor = pick ? pick.node.slug : null;
}

/** Paints the cursor onto the rows already on screen; no rebuild. */
function applyCursor() {
  if (!root) return;
  const boxes = peek ? [root, peek] : [root];
  for (const box of boxes) for (const n of box.querySelectorAll(".row.cur, .dash.cur")) n.classList.remove("cur");
  if (state.cursor) {
    const sel = `[data-slug="${CSS.escape(state.cursor)}"]`;
    for (const box of boxes) for (const n of box.querySelectorAll(sel)) n.classList.add("cur");
    root.setAttribute("aria-activedescendant", `row-${state.cursor}`); // the aside holds focus, so the aside carries it
  } else root.removeAttribute("aria-activedescendant");
}

/** Moves the cursor to the nearest shallower row above it. Returns whether it moved. */
function ascend() {
  const rows = cursorRows();
  const i = rows.findIndex((r) => r.node.slug === state.cursor);
  if (i < 0) return false;
  for (let j = i - 1; j >= 0; j--) {
    if (rows[j].depth >= rows[i].depth) continue;
    state.cursor = rows[j].node.slug;
    applyCursor();
    scrollCursorIntoView();
    return true;
  }
  return false; // a top-level row: Left has nowhere to go
}

function scrollCursorIntoView() {
  const row = root.querySelector(".row.cur, .dash.cur");
  if (row) row.scrollIntoView({ block: "nearest" });
}

const outlineHandler = {
  onKey(e) {
    if (e.key === "n") {
      openNewDomain();
      return true;
    }
    if (e.key === "Enter") {
      const row = cursorRows().find((r) => r.node.slug === state.cursor);
      if (!row) return false;
      void go(row.node);
      return true;
    }
    const move = moveCursor(cursorRows(), state.cursor, e.key);
    if (!move) return false;
    if (move.toggle) {
      // Left on a parent kept open by the selection would flip `expanded` with no visible change: ascend instead.
      if (e.key === "ArrowLeft" && !collapsible(app.outline.islands, state.expanded, app.selected, move.toggle)) return ascend();
      toggleExpanded(move.toggle); // a rebuild, but from a key press: nothing is under the pointer
    } else {
      state.cursor = move.cursor;
      applyCursor();
      scrollCursorIntoView();
    }
    return true;
  },
  onFocus() {
    state.cursorCleared = false;
    seedCursor();
    applyCursor();
  },
  menuOpen: () => state.menuOpen,
  closeMenu,
  hasCursor: () => state.cursor !== null,
  clearCursor() {
    state.cursor = null;
    state.cursorCleared = true; // Escape's next rung is deselect: render must not seed the cursor back
    applyCursor();
  },
  toggleRail,
};

export function installOutline() {
  root = document.getElementById("outline");
  load();
  registerRegion("outline", outlineHandler);
  document.documentElement.style.setProperty("--outline-w", `${state.rail ? RAIL_W : FULL_W}px`);
  root.addEventListener("mouseenter", () => showPeek());
  root.addEventListener("mouseleave", (e) => { if (!(peek && e.relatedTarget && peek.contains(e.relatedTarget))) hidePeek(); });
  app.listeners.add(() => render());
  render();
}
