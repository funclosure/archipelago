// The outline: the domain's tree on the left. Pure helpers first (tested), then the DOM.
import { app, setScale, frameSelection } from "./app.js";
import { select } from "./interactions.js";
import { FULL_W, RAIL_W, visibleRows, dashClass, countNodes, summaryLine } from "./outline-model.js";
import { registerRegion, region } from "./keys.js";
import { moveCursor } from "./keys-model.js";

// app.js imports installOutline from here and this file imports app: fine, because nothing below reads app or select at module evaluation.

// ---- DOM ----

const state = { rail: false, expanded: new Set(), menuOpen: false, domains: null, cursor: null };
let root = null;
let peek = null;

function storageKey() {
  return `outline:${app.domain}`;
}

function load() {
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

function listEl(outline) {
  const ul = el("ul", "list");
  ul.setAttribute("role", "listbox");
  if (state.cursor) ul.setAttribute("aria-activedescendant", `row-${state.cursor}`);
  for (const row of visibleRows(outline.islands, state.expanded, app.selected)) {
    const li = el("li");
    const r = el("div", `row${row.node.slug === app.selected ? " on" : ""}${row.depth ? " islet" : ""}${row.node.slug === state.cursor ? " cur" : ""}`);
    r.id = `row-${row.node.slug}`;
    r.setAttribute("role", "option");
    r.style.paddingLeft = `${6 + row.depth * 20}px`;
    const tw = button(row.open ? "▾" : "▸", (e) => {
      e.stopPropagation();
      toggleExpanded(row.node.slug);
    }, `tw${row.hasChildren ? "" : " none"}`);
    r.append(tw);
    const lit = row.node.landmarks.unlocked;
    r.append(el("span", `dot ${row.node.state}${row.node.state === "open" && lit ? " lit" : ""}`));
    r.append(el("span", `name${row.node.state === "open" ? " open" : ""}`, row.node.name));
    if (row.node.harbour) r.append(el("span", "anchor", "⚓︎"));
    r.append(el("span", "n", `${lit}/${row.node.landmarks.total}`));
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
  peek.replaceChildren(listEl(app.outline));
}

function hidePeek() {
  if (peek) peek.hidden = true;
}

function closeMenu() {
  state.menuOpen = false;
  state.domains = null;
  render();
}

async function toggleMenu() {
  state.menuOpen = !state.menuOpen;
  if (!state.menuOpen) {
    state.domains = null;
    render();
    return;
  }
  if (!state.domains) {
    try {
      const res = await fetch("/api/domains");
      state.domains = (await res.json()).domains;
    } catch {
      state.domains = [];
    }
  }
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  render();
}

function headerEl(outline) {
  const head = el("div", "oh");
  const ws = button("", toggleMenu, "ws");
  ws.append(el("span", "name", outline.domain.name), el("span", "chev", "▾"));
  ws.title = "switch domain";
  head.append(ws, el("span", "sp"));
  const tog = button(state.rail ? "»" : "«", toggleRail, "ib");
  tog.title = state.rail ? "expand the outline  [" : "collapse to a rail  [";
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
      menu.append(item);
    }
    head.append(menu);
  }
  return head;
}

function railEl(outline) {
  const dashes = el("div", "dashes");
  for (const node of outline.islands) {
    const d = el("div", `${dashClass(node, app.selected)}${node.slug === state.cursor ? " cur" : ""}`);
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
    return;
  }
  const frag = document.createDocumentFragment();
  frag.append(headerEl(outline));
  frag.append(el("div", "sum", summaryLine(outline)));
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
  if (peek && !peek.hidden) peek.replaceChildren(listEl(outline));
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
  for (const r of root.querySelectorAll(".row.cur, .dash.cur")) r.classList.remove("cur");
  const list = root.querySelector(".list");
  if (state.cursor) {
    root.querySelector(`#row-${CSS.escape(state.cursor)}`)?.classList.add("cur");
    root.querySelector(`.dash[data-slug="${CSS.escape(state.cursor)}"]`)?.classList.add("cur");
    list?.setAttribute("aria-activedescendant", `row-${state.cursor}`);
  } else list?.removeAttribute("aria-activedescendant");
}

function scrollCursorIntoView() {
  const row = root.querySelector(".row.cur");
  if (row) row.scrollIntoView({ block: "nearest" });
}

const outlineHandler = {
  onKey(e) {
    if (e.key === "Enter") {
      if (state.cursor === null) seedCursor(); // a cold Enter selects the seeded row
      const row = cursorRows().find((r) => r.node.slug === state.cursor);
      if (!row) return false;
      void go(row.node);
      return true;
    }
    const move = moveCursor(cursorRows(), state.cursor, e.key);
    if (!move) return false;
    if (move.toggle) toggleExpanded(move.toggle); // a rebuild, but from a key press: nothing is under the pointer
    else {
      state.cursor = move.cursor;
      applyCursor();
      scrollCursorIntoView();
    }
    return true;
  },
  onFocus() {
    seedCursor();
    applyCursor();
  },
  menuOpen: () => state.menuOpen,
  closeMenu,
  hasCursor: () => state.cursor !== null,
  clearCursor() {
    state.cursor = null;
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
