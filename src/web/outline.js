// The outline: the domain's tree on the left. Pure helpers first (tested), then the DOM.
import { app, setScale, frameSelection } from "./app.js";
import { select } from "./interactions.js";

export const FULL_W = 232;
export const RAIL_W = 44;

/** Whether `slug` is `node` or one of its descendants. */
function holds(node, slug) {
  if (!slug) return false;
  if (node.slug === slug) return true;
  return node.children.some((c) => holds(c, slug));
}

/** The rows to draw: each island, and the islets of islands that are expanded or hold the selection. */
export function visibleRows(islands, expanded, selected, depth = 0) {
  const rows = [];
  for (const node of islands) {
    const hasChildren = node.children.length > 0;
    const open = hasChildren && (expanded.has(node.slug) || holds(node, selected));
    rows.push({ node, depth, hasChildren, open });
    if (open) rows.push(...visibleRows(node.children, expanded, selected, depth + 1));
  }
  return rows;
}

/** The rail dash's class for a top-level island. */
export function dashClass(node, selected) {
  if (node.slug === selected) return "dash on";
  if (node.state !== "open") return "dash done";
  if (node.landmarks.unlocked > 0) return "dash lit";
  return "dash";
}

export function countNodes(islands) {
  return islands.reduce((n, i) => n + 1 + countNodes(i.children), 0);
}

export function summaryLine(outline) {
  return `${outline.charted} of ${countNodes(outline.islands)} charted · ${outline.lit} lit`;
}

// ---- DOM ----

const state = { rail: false, expanded: new Set(), menuOpen: false, domains: null };
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
  render();
  frameSelection();
}

function toggleExpanded(slug) {
  if (state.expanded.has(slug)) state.expanded.delete(slug);
  else state.expanded.add(slug);
  save();
  render();
}

function listEl(outline) {
  const ul = el("ul", "list");
  for (const row of visibleRows(outline.islands, state.expanded, app.selected)) {
    const li = el("li");
    const r = el("div", `row${row.node.slug === app.selected ? " on" : ""}${row.depth ? " islet" : ""}`);
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
    peek.addEventListener("mouseleave", hidePeek);
    document.body.append(peek);
  }
  peek.hidden = false;
  peek.replaceChildren(listEl(app.outline));
}

function hidePeek() {
  if (peek) peek.hidden = true;
}

async function toggleMenu() {
  state.menuOpen = !state.menuOpen;
  if (state.menuOpen && !state.domains) {
    try {
      const res = await fetch("/api/domains");
      state.domains = (await res.json()).domains;
    } catch {
      state.domains = [];
    }
  }
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
    const d = el("div", dashClass(node, app.selected));
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
  hint.append(el("kbd", null, "["), " outline");
  ft.append(hint, el("span", null, `${countNodes(outline.islands)} islands`));
  frag.append(ft);
  root.replaceChildren(frag);
  if (peek && !peek.hidden) peek.replaceChildren(listEl(outline));
}

export function installOutline() {
  root = document.getElementById("outline");
  load();
  document.documentElement.style.setProperty("--outline-w", `${state.rail ? RAIL_W : FULL_W}px`);
  root.addEventListener("mouseenter", () => showPeek());
  window.addEventListener("keydown", (e) => {
    if (e.key !== "[") return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    e.preventDefault();
    toggleRail();
  });
  app.listeners.add(() => render());
  render();
}
