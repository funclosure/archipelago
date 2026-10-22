import { buildNodes, buildLinks, WORLD, stripItems } from "./view-model.js";
import { createSimulation } from "./layout.js";
import { createCamera } from "./camera.js";
import { clear, drawIsland, drawStrait, drawSeaWater, drawSeaName, drawMarquee, NAME_FONT } from "./draw.js";
import { seaMembers, lettering, letteringBox, stippleDots, SEA_FONT } from "./sea-model.js";
import { placeRemoveButton } from "./seas.js";
import { layoutLabels } from "./labels.js";
import { emptyGroup, pruneGroup } from "./group-model.js";
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
import { MODES, MODE_LABELS, MODE_ROLES, MODE_HINTS, modeKey, storedMode, nextMode } from "./mode-model.js";

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
  seas: [],                  // the reader's names on the water at this scale: { id, name, x, y }
  selectedSea: null,         // id of the sea whose name is selected (dashed box, Delete removes it)
  hoverSea: null,
  heldSeas: new Set(),       // ids of seas being dragged or saved: a snapshot meanwhile keeps their local positions
  group: emptyGroup(),       // islands and seas gathered by shift-click or a shift-drag box: one drag moves them all
  marquee: null,             // the box a shift-drag is drawing, in world units: { x0, y0, x1, y1 }
  seaSets: new Map(),        // id → this frame's lettering, for hit-testing
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
  fitHome(insets());
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
  const held = new Map(app.seas.filter((s) => app.heldSeas.has(s.id)).map((s) => [s.id, s]));
  app.seas = (snapshot.seas ?? []).map((s) => (held.has(s.id) ? { ...s, x: held.get(s.id).x, y: held.get(s.id).y } : { ...s }));
  if (!app.seas.some((s) => s.id === app.selectedSea)) app.selectedSea = null;
  app.group = sameScale ? pruneGroup(app.group, app.nodes, app.seas) : emptyGroup();
  app.links = buildLinks(snapshot, app.nodes, app.mode);
  // The simulation exists only to place islands that have no stored position; placed ones are pinned.
  // New islands gather around the reader's arrangement, not around a fixed point of the sea.
  const anchored = app.nodes.filter((n) => n.placed);
  if (anchored.length) app.sim.setCenter(anchored.reduce((s, n) => s + n.x, 0) / anchored.length, anchored.reduce((s, n) => s + n.y, 0) / anchored.length);
  else app.sim.setCenter(WORLD / 2, WORLD / 2);
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
/** The sea whose name is under a screen point, or null. Islands are hit-tested first: they sit above the water. */
export function seaAt(px, py) {
  const w = app.camera.toWorld(px, py);
  for (let i = app.seas.length - 1; i >= 0; i--) {
    const s = app.seas[i];
    const set = app.seaSets.get(s.id);
    if (!set) continue;
    const b = letteringBox(s, set);
    if (w.x > b.x0 && w.x < b.x1 && w.y > b.y0 && w.y < b.y1) return s;
  }
  return null;
}

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
  fitHome(ins);
  if (app.selected) frameSelection();
  else if (wasHome) app.camera.animateTo(app.camera.home, FRAME_MS);
}

const FRAME_MS = 450;

/**
 * What home frames: every island at this scale (drafts too) with room for its lamps and its name, so the map
 * fills the window around the reader's own arrangement. Null with no islands: home is a fresh 1000-unit scale.
 */
export function homeBounds() {
  if (app.nodes.length === 0) return null;
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const s of app.seas) {
    const box = app.seaSets.has(s.id) ? letteringBox(s, app.seaSets.get(s.id)) : { x0: s.x, x1: s.x, y0: s.y, y1: s.y };
    b.x0 = Math.min(b.x0, box.x0);
    b.x1 = Math.max(b.x1, box.x1);
    b.y0 = Math.min(b.y0, box.y0);
    b.y1 = Math.max(b.y1, box.y1);
  }
  for (const n of app.nodes) {
    b.x0 = Math.min(b.x0, n.x - n.radius * 2.8); // a name can sit beside the coast
    b.x1 = Math.max(b.x1, n.x + n.radius * 2.8);
    b.y0 = Math.min(b.y0, n.y - n.radius * 1.6);
    b.y1 = Math.max(b.y1, n.y + n.radius * 2.9);
  }
  return b;
}

function fitHome(ins) {
  return app.camera.fit(app.size.w, app.size.h, ins, homeBounds());
}

/** Frames the selected island at the centre of the map area beside the pane, or returns home. */
export function frameSelection() {
  const { w, h } = app.size;
  const ins = insets();
  fitHome(ins);
  const node = app.selected ? app.nodes.find((n) => n.slug === app.selected) : null;
  if (node) app.camera.animateTo(app.camera.centreOn(node, w, h, ins, app.camera.closer()), FRAME_MS);
  else app.camera.animateTo(app.camera.home, FRAME_MS);
}

/** Nodes the page still has to place and save (no stored coordinates). Drafts are laid out but never saved. */
export function unplaced() {
  return app.nodes.filter((n) => !n.placed && !n.draft);
}

/** Persists positions for the given nodes. The sea has no edge: any finite spot is the reader's to choose. */
export async function postPositions(nodes) {
  const positions = nodes.map((n) => ({ island: n.slug, x: n.x, y: n.y }));
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
  v.className = "strip-value";
  v.textContent = value;
  v.title = value; // a long value is cut to one line; the full text is here
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

/**
 * The mode switch beside the domain's name: who you talk to in the pane, each with what it does ("asks and
 * grades", "explains, no grades") on the same line, and a hint card saying what the map shows in that mode.
 */
function modeSwitchEl() {
  const cell = document.createElement("div");
  cell.className = "strip-item mode-cell";
  const label = document.createElement("span");
  label.className = "strip-label";
  label.textContent = "Talk to";
  const wrap = document.createElement("div");
  wrap.className = "mode-switch";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Talk to the Keeper or the mentor");
  for (const m of MODES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `seg ${m}${m === app.mode ? " on" : ""}`;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = MODE_LABELS[m];
    const role = document.createElement("span");
    role.className = "role";
    role.textContent = MODE_ROLES[m];
    b.append(name, role);
    b.title = `${MODE_HINTS[m]}  [m]`;
    b.setAttribute("aria-pressed", String(m === app.mode));
    b.addEventListener("click", () => setMode(m));
    wrap.append(b);
  }
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = `${MODE_HINTS[app.mode]} Press m to switch.`;
  cell.append(label, wrap, hint);
  return cell;
}

function renderStrip() {
  const strip = document.getElementById("strip");
  if (!app.snapshot) return;
  strip.replaceChildren(...stripItems(app.snapshot, app.mode).map(stripItem));
  document.getElementById("mode").replaceChildren(modeSwitchEl());
}

function renderStatus() {
  const el = document.getElementById("status");
  el.textContent = app.connected ? "" : "disconnected — showing the last chart";
  el.classList.toggle("off", !app.connected);
}

const measureCtx = document.createElement("canvas").getContext("2d");
const seaCharWidths = new Map();
/** A character's width in a sea's lettering at `font` world units; cached. */
function measureSeaChar(font) {
  return (ch) => {
    const key = `${font}|${ch}`;
    let w = seaCharWidths.get(key);
    if (w === undefined) {
      measureCtx.font = `${font}px Georgia, 'Times New Roman', serif`;
      seaCharWidths.set(key, (w = measureCtx.measureText(ch).width));
    }
    return w;
  };
}
const stippleCache = new Map(); // sea id → { key, dots }: the dots move only when the sea or an island does
function seaDots(sea, members, radius) {
  const key = `${sea.x},${sea.y}|${radius}|${app.nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`).join(";")}|${members.map((m) => m.slug).join(",")}`;
  const hit = stippleCache.get(sea.id);
  if (hit && hit.key === key) return hit.dots;
  const dots = stippleDots(sea, members, app.nodes, radius);
  stippleCache.set(sea.id, { key, dots });
  return dots;
}

/** The reader's seas, under everything else: stippled water first, then the names. */
function drawSeas(radius) {
  const members = seaMembers(app.seas, app.nodes);
  app.seaSets = new Map();
  for (const s of app.seas) {
    const m = members.get(s.id) ?? [];
    const set = lettering(s.name, m, radius, measureSeaChar(SEA_FONT * radius));
    app.seaSets.set(s.id, set);
    drawSeaWater(ctx, seaDots(s, m, radius), radius);
  }
  for (const s of app.seas) drawSeaName(ctx, s, app.seaSets.get(s.id), { selected: s.id === app.selectedSea || app.group.seas.has(s.id), hover: s.id === app.hoverSea });
  const chosen = app.seas.find((s) => s.id === app.selectedSea);
  placeRemoveButton(chosen ? letteringBox(chosen, app.seaSets.get(chosen.id)) : null);
}
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

let laying = false; // the simulation was placing islands on the last frame
function frame(now) {
  const moving = app.sim.tick();
  // New islands have found their places: if the reader has not moved the map since, home grows to take them in.
  if (laying && !moving && !app.selected && app.camera.atHome()) {
    fitHome(insets());
    app.camera.animateTo(app.camera.home, FRAME_MS);
  }
  laying = moving;
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
  drawSeas(app.nodes[0]?.radius ?? 62);
  for (const l of app.links) {
    drawStrait(ctx, l, { dim: Boolean(focusSlug) && !(near.has(l.source.slug) && near.has(l.target.slug)) });
  }
  const labels = layoutLabels(app.nodes, { measure: measureName, scale: (n) => boxScale(n.radius), focus: focusSlug, hover: app.hover });
  for (const n of app.nodes) {
    drawIsland(ctx, n, { dim: Boolean(focusSlug) && !near.has(n.slug), selected: n.slug === focusSlug, gathered: app.group.islands.has(n.slug), hovered: n.slug === app.hover, now, label: labels.get(n.slug) });
  }
  if (app.marquee) drawMarquee(ctx, app.marquee, app.camera.state.scale);
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
