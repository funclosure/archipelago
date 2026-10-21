import { buildNodes, buildLinks, WORLD, stripItems } from "./view-model.js";
import { createSimulation } from "./layout.js";
import { createCamera } from "./camera.js";
import { clear, drawIsland, drawStrait, NAME_FONT } from "./draw.js";
import { layoutLabels } from "./labels.js";
import { boxScale } from "./contour.js";
import { installInteractions } from "./interactions.js";
import { installCard } from "./card.js";
import { installOutline } from "./outline.js";
import { installAbout } from "./learner.js";
import { installKeys } from "./keys.js";
import { installBoard } from "./board.js";
import { installTheme } from "./theme.js";
import { openChart } from "./chart.js";
import { request } from "./transport.js";
import { installNewDomain, openNewDomain } from "./new-domain.js";
import { anotherTab, installHosted, welcomeGate } from "./hosted.js";
import { MODES, MODE_LABELS, MODE_HINTS, modeKey, storedMode, nextMode } from "./mode-model.js";

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const params = new URLSearchParams(location.search);

export const app = {
  domain: params.get("domain"),
  scale: params.get("scale"),
  snapshot: null,
  outline: null,
  nodes: [],
  links: [],
  hover: null,      // slug under the pointer
  selected: null,   // slug with the card open
  mode: "judge",    // the lens on the map and who answers in the pane; stored per domain
  connected: true,
  version: null,
  sim: createSimulation(),
  camera: createCamera(),
  size: { w: 0, h: 0, dpr: 1 },
  listeners: new Set(), // called with each new snapshot (Task 13 subscribes the card)
  placing: new Set(),        // slugs awaiting their first persisted position
  placementInFlight: false,  // a positions post is in progress (or backing off after a failure)
  placementGen: 0,           // bumped on a scale change so a stale post cannot clear the new scale's placing set
};

export async function api(path, init) {
  const res = await request(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
  return body;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  app.size = { w: window.innerWidth, h: window.innerHeight, dpr };
  canvas.width = Math.round(app.size.w * dpr);
  canvas.height = Math.round(app.size.h * dpr);
  canvas.style.width = app.size.w + "px";
  canvas.style.height = app.size.h + "px";
  app.camera.fit(app.size.w, app.size.h, insets());
  if (app.selected) frameSelection();
  else app.camera.snapHome();
}

/** Change scale (null = top level), update the URL, and refetch. */
export function setScale(slug) {
  app.scale = slug;
  app.selected = null;
  app.hover = null;
  const url = new URL(location.href);
  if (slug) url.searchParams.set("scale", slug);
  else url.searchParams.delete("scale");
  history.replaceState(null, "", url);
  app.version = null;
  return refresh();
}

/** Switches the lens and the pane's persona. Stored per domain; the map redraws from the snapshot it already has. */
export function setMode(mode) {
  const next = storedMode(mode);
  if (next === app.mode) return;
  app.mode = next;
  document.body.dataset.mode = next;
  try {
    localStorage.setItem(modeKey(app.domain), next);
  } catch {
    /* storage unavailable */
  }
  if (!app.snapshot) return;
  app.nodes = buildNodes(app.snapshot, new Map(app.nodes.map((n) => [n.slug, n])), next);
  app.links = buildLinks(app.snapshot, app.nodes, next);
  app.sim.setGraph(app.nodes, app.links, app.sim.alpha); // keep whatever placement heat there was
  renderChrome();
  for (const fn of app.listeners) fn(app.snapshot);
}

export function toggleMode() {
  setMode(nextMode(app.mode));
}

function readMode(domain) {
  try {
    return storedMode(localStorage.getItem(modeKey(domain)));
  } catch {
    return storedMode(null);
  }
}

let refreshGen = 0;
/** The newest refresh: a superseded one waits for it, so `await setScale(…)` resolves only once the new scale is on the map. */
let latestRefresh = Promise.resolve();

export function refresh() {
  const gen = ++refreshGen;
  const run = (async () => {
    const query = `domain=${encodeURIComponent(app.domain)}${app.scale ? `&scale=${encodeURIComponent(app.scale)}` : ""}`;
    let snapshot, outline;
    try {
      [snapshot, outline] = await Promise.all([api(`/api/snapshot?${query}`), api(`/api/outline?domain=${encodeURIComponent(app.domain)}`)]);
    } catch (err) {
      if (gen !== refreshGen) return latestRefresh; // superseded: the winner's outcome is the one that counts
      throw err;
    }
    if (gen !== refreshGen) return latestRefresh; // a later refresh owns the map now: resolve when it has painted
    app.outline = outline;
    applySnapshot(snapshot);
  })();
  latestRefresh = run;
  return run;
}

function samePath(a, b) {
  return a.scale.path.map((p) => p.slug).join("/") === b.scale.path.map((p) => p.slug).join("/");
}

function applySnapshot(snapshot) {
  const sameScale = app.snapshot !== null && samePath(app.snapshot, snapshot);
  const previous = sameScale ? new Map(app.nodes.map((n) => [n.slug, n])) : new Map();
  const isFirstSnapshot = app.snapshot === null;
  app.snapshot = snapshot;
  app.version = snapshot.version;
  app.nodes = buildNodes(snapshot, previous, app.mode);
  app.links = buildLinks(snapshot, app.nodes, app.mode);
  // The simulation exists only to place islands that have no stored position; placed ones are pinned.
  app.sim.setGraph(app.nodes, app.links, app.nodes.some((n) => !n.placed) ? (sameScale ? 0.5 : 1) : 0); // drafts are laid out too, never saved
  if (!sameScale) {
    app.placementGen += 1;          // a post that resolves for the old scale must not touch this set
    app.placing = new Set(unplaced().map((n) => n.slug));
  } else if (!app.placementInFlight) {
    app.placing = new Set(unplaced().map((n) => n.slug));
  }
  // A reload should still show the terminal's focus, without posting a fresh selection.
  // Only an island at this scale can be selected; a focus set elsewhere would dim the whole map with nothing to frame.
  if (isFirstSnapshot && snapshot.islands.some((i) => i.slug === snapshot.focus)) app.selected = snapshot.focus;
  renderChrome();
  for (const fn of app.listeners) fn(snapshot);
  if (!sameScale) frameSelection(); // the listeners have opened or closed the pane; refit home to the map area and frame the selection or go home
}

let polling = false;

async function poll() {
  if (polling) return; // a slow refresh must not stack another behind it
  polling = true;
  try {
    const { version } = await api(`/api/version?domain=${encodeURIComponent(app.domain)}`);
    app.connected = true;
    if (version !== app.version) await refresh();
  } catch {
    app.connected = false;
  } finally {
    polling = false;
  }
  renderStatus();
}

/** The node under a screen point, or null. */
export function hitTest(px, py) {
  const { x, y } = app.camera.toWorld(px, py);
  let best = null;
  let bestD = Infinity;
  for (const n of app.nodes) {
    if (n.draft) continue; // a draft is not an island yet: nothing to select
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < n.radius + 6 && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

/** How much of the viewport's right edge the pane covers: 0 when it is hidden or absent. */
export function paneInset() {
  const pane = document.getElementById("pane");
  // A full-width pane covers the map, so the map keeps its own framing underneath.
  return pane && !pane.hidden && pane.offsetWidth < app.size.w ? pane.offsetWidth : 0;
}

/** How much of the viewport's left edge the outline covers: 0 when it is absent. */
export function outlineInset() {
  const outline = document.getElementById("outline");
  if (!outline || outline.hidden) return 0;
  // The intended width, not the measured one: the panel animates its width, and the map should frame against where it ends up.
  const intended = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--outline-w"));
  return Number.isFinite(intended) ? intended : outline.offsetWidth;
}

/** How much of the top edge the header (breadcrumb and strip) covers. */
function topInset() {
  const chrome = document.querySelector(".chrome.top");
  return chrome && getComputedStyle(chrome).display !== "none" ? chrome.getBoundingClientRect().bottom : 0;
}

/** How much of the bottom edge the bottom card (approve, confirm, sail to) covers while it shows. */
function bottomInset() {
  const card = document.querySelector("#cta:not([hidden]) .cta-card");
  return card ? Math.max(0, app.size.h - card.getBoundingClientRect().top) + 8 : 0;
}

export function insets() {
  return { left: outlineInset(), right: paneInset(), top: topInset(), bottom: bottomInset() };
}

let lastInsets = "";
/**
 * Refits the map when what covers it changes (the bottom card comes or goes, the strip wraps): the selection stays
 * framed, and a camera still at home moves to the new home; one the reader has panned stays where it is.
 */
export function reframe() {
  const ins = insets();
  const key = `${ins.top}|${ins.bottom}`;
  if (key === lastInsets || !app.size.w) return;
  lastInsets = key;
  const wasHome = app.camera.atHome();
  app.camera.fit(app.size.w, app.size.h, ins);
  if (app.selected) frameSelection();
  else if (wasHome) app.camera.animateTo(app.camera.home, FRAME_MS);
}

const FRAME_MS = 450;

/** Frames the selected island at the centre of the map area beside the pane, or returns home. */
export function frameSelection() {
  const { w, h } = app.size;
  const ins = insets();
  app.camera.fit(w, h, ins);
  const node = app.selected ? app.nodes.find((n) => n.slug === app.selected) : null;
  if (node) app.camera.animateTo(app.camera.centreOn(node, w, h, ins, app.camera.closer()), FRAME_MS);
  else app.camera.animateTo(app.camera.home, FRAME_MS);
}

/** Nodes the page still has to place and save (no stored coordinates). Drafts are laid out but never saved. */
export function unplaced() {
  return app.nodes.filter((n) => !n.placed && !n.draft);
}

/** Persists positions for the given nodes; coordinates are clamped to the world so the server accepts them. */
export async function postPositions(nodes) {
  const positions = nodes.map((n) => {
    n.x = Math.min(WORLD - n.radius, Math.max(n.radius, n.x));
    n.y = Math.min(WORLD - n.radius, Math.max(n.radius, n.y));
    return { island: n.slug, x: n.x, y: n.y };
  });
  return api("/api/positions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: app.domain, positions }),
  });
}

/** Called once the simulation has settled while islands still await placement. */
async function persistPlacement() {
  const nodes = app.nodes.filter((n) => app.placing.has(n.slug));
  if (nodes.length === 0) {
    app.placing.clear();
    return;
  }
  const gen = app.placementGen;
  app.placementInFlight = true;
  try {
    await postPositions(nodes);
    if (gen === app.placementGen) for (const n of nodes) app.placing.delete(n.slug);
    app.placementInFlight = false;
  } catch (error) {
    console.error("placement not saved, retrying in 5s", error);
    setTimeout(() => {
      app.placementInFlight = false;
    }, 5000);
  }
}

function renderChrome() {
  renderBreadcrumb();
  renderStrip();
  renderStatus();
}

function renderBreadcrumb() {
  const nav = document.getElementById("breadcrumb");
  const s = app.snapshot;
  if (!s) return;
  const parts = [{ slug: null, name: s.domain.name }, ...s.scale.path];
  nav.replaceChildren();
  parts.forEach((p, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "›";
      nav.append(sep);
    }
    const b = document.createElement("button");
    b.className = "crumb";
    b.textContent = p.name;
    b.disabled = i === parts.length - 1;
    b.addEventListener("click", () => setScale(p.slug));
    nav.append(b);
  });
}

function stripItem({ label, value, hint, action }) {
  const el = document.createElement("div");
  el.className = "strip-item";
  const l = document.createElement("span");
  l.className = "strip-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.textContent = value;
  const h = document.createElement("div");
  h.className = "hint";
  h.textContent = hint;
  el.append(l, v, h);
  if (action === "chart") {
    // The cartographer's cell opens it at this scale; hover still shows the hint.
    el.classList.add("action");
    el.addEventListener("click", () => openChart());
  } else {
    el.addEventListener("click", () => el.classList.toggle("open")); // hover shows the hint; a click (or a tap) pins it
  }
  return el;
}

/** The two-segment lens switch that leads the strip. */
function modeSwitchEl() {
  const wrap = document.createElement("div");
  wrap.className = "mode-switch";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Lens");
  for (const m of MODES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `seg${m === app.mode ? " on" : ""}`;
    b.textContent = MODE_LABELS[m];
    b.title = `${MODE_HINTS[m]}  [m]`;
    b.setAttribute("aria-pressed", String(m === app.mode));
    b.addEventListener("click", () => setMode(m));
    wrap.append(b);
  }
  return wrap;
}

function renderStrip() {
  const strip = document.getElementById("strip");
  if (!app.snapshot) return;
  strip.replaceChildren(modeSwitchEl(), ...stripItems(app.snapshot, app.mode).map(stripItem));
}

function renderStatus() {
  const el = document.getElementById("status");
  el.textContent = app.connected ? "" : "disconnected — showing the last chart";
  el.classList.toggle("off", !app.connected);
}

const measureCtx = document.createElement("canvas").getContext("2d");
const nameWidths = new Map();
/** A name's width in box units, in the font the map draws it in; cached, since names rarely change. */
function measureName(text) {
  let w = nameWidths.get(text);
  if (w === undefined) {
    measureCtx.font = NAME_FONT;
    nameWidths.set(text, (w = measureCtx.measureText(text).width));
  }
  return w;
}

function frame(now) {
  const moving = app.sim.tick();
  if (!moving && app.placing.size > 0 && !app.placementInFlight) void persistPlacement();
  app.camera.tick(now);
  const { w, h, dpr } = app.size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clear(ctx, w, h);
  app.camera.apply(ctx, dpr);

  const focusSlug = app.selected; // dimming and the halo follow the selection; hover is its own light mark
  const near = new Set();
  if (focusSlug) {
    near.add(focusSlug);
    for (const l of app.links) {
      if (l.hidden || !l.source.island.verdict || !l.target.island.verdict) continue; // only drawn, charted channels count as near
      if (l.source.slug === focusSlug) near.add(l.target.slug);
      if (l.target.slug === focusSlug) near.add(l.source.slug);
    }
  }
  for (const l of app.links) {
    drawStrait(ctx, l, { dim: Boolean(focusSlug) && !(near.has(l.source.slug) && near.has(l.target.slug)) });
  }
  const labels = layoutLabels(app.nodes, { measure: measureName, scale: (n) => boxScale(n.radius), focus: focusSlug, hover: app.hover });
  for (const n of app.nodes) {
    drawIsland(ctx, n, { dim: Boolean(focusSlug) && !near.has(n.slug), selected: n.slug === focusSlug, hovered: n.slug === app.hover, now, label: labels.get(n.slug) });
  }
  requestAnimationFrame(frame);
}

/** Nothing to draw without the server (or, hosted, without the browser's storage): say why instead of a blank sea. */
function failedToStart(error) {
  const nav = document.getElementById("breadcrumb");
  if (error.code === "another-tab") return anotherTab(nav);
  nav.replaceChildren(error.message);
  console.error(error);
}

async function boot() {
  installNewDomain();
  installHosted();
  try {
    await welcomeGate(); // hosted only: a key, or Try without a key, before the map
  } catch (error) {
    return failedToStart(error);
  }
  if (!app.domain) {
    let domains;
    try {
      ({ domains } = await api("/api/domains"));
    } catch (error) {
      return failedToStart(error);
    }
    if (domains.length === 0) {
      // Nothing to show but the start: the page is the New domain field, with no outline and no chrome around it.
      document.body.classList.add("empty");
      openNewDomain({ first: true });
      return;
    }
    app.domain = domains[0].slug;
    const url = new URL(location.href);
    url.searchParams.set("domain", app.domain);
    history.replaceState(null, "", url);
  }
  app.mode = readMode(app.domain);
  document.body.dataset.mode = app.mode;
  app.sim.setCenter(WORLD / 2, WORLD / 2);
  resize();
  window.addEventListener("resize", resize);
  installInteractions(canvas);
  installTheme(); // first: the canvas palette and mermaid read the stamped theme's tokens
  installCard();
  installBoard();
  installOutline();
  installAbout();
  installKeys();
  const watch = new ResizeObserver(() => reframe());
  for (const id of ["cta", "strip"]) watch.observe(document.getElementById(id));
  try {
    await refresh();
  } catch (error) {
    // A link or a restored tab can name a domain this database never had (each browser keeps its own): start over.
    if (!app.snapshot && error.status === 404 && params.has("domain")) {
      location.replace(location.pathname);
      return;
    }
    app.connected = false;
    renderStatus();
    // No chart yet to fall back on: say why, as the domain list does above.
    if (!app.snapshot) failedToStart(error);
    else console.error(error);
  }
  // A domain made on the page arrives with ?chart=start: open the cartographer and let it sketch.
  if (params.get("chart") === "start") {
    const url = new URL(location.href);
    url.searchParams.delete("chart");
    history.replaceState(null, "", url);
    openChart(null, { start: true });
  }
  setInterval(poll, 2000);
  requestAnimationFrame(frame);
}

boot();
