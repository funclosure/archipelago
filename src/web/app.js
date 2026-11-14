import { buildNodes, buildLinks, WORLD, stripItems, dockItems } from "./view-model.js";
import { createSimulation } from "./layout.js";
import { createCamera } from "./camera.js";
import {
  clear, drawIsland, drawIslandName, drawShoreWater, drawStrait, drawSeaWater, drawSeaName, drawMarquee, drawPress, drawSketching,
  drawGraticule, drawRose, drawVignette, stipplePaths, isAnimating, NAME_FONT,
} from "./draw.js";
import { seaMembers, lettering, letteringBox, stippleDots, seaSpot, SEA_FONT } from "./sea-model.js";
import { placeRemoveButton, saveSeaPosition, seaEditing } from "./seas.js";
import { draftSeas } from "./chart-model.js";
import { layoutLabels, labelRect } from "./labels.js";
import { emptyGroup, pruneGroup } from "./group-model.js";
import { LONG_PRESS_MS } from "./gesture-model.js";
import { boxScale, COAST, LAMP_R, STAR, WATER } from "./contour.js";
import { graticule, roseSpot, headerFade, positionSum, differs } from "./furniture-model.js";
import { installInteractions } from "./interactions.js";
import { installCard } from "./card.js";
import { installOutline } from "./outline.js";
import { installAbout } from "./learner.js";
import { installImages } from "./images.js";
import { installKeys } from "./keys.js";
import { installBoard } from "./board.js";
import { installTheme } from "./theme.js";
import { openChart, openGuide, chartWorkingHere } from "./chart.js";
import { thinkingLine } from "./progress-model.js";
import { language, t } from "./i18n.js";
import { request } from "./transport.js";
import { installNewDomain, openNewDomain } from "./new-domain.js";
import { anotherTab, installHosted, welcomeGate } from "./hosted.js";
import { modeKey, storedMode, nextMode } from "./mode-model.js";
import { installLaunch } from "./launch.js";
import { installPlaces } from "./places.js";
import "./tip.js"; // tooltips listen at the document; a control only carries data-tip

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
  press: null,               // a finger held on the map: { x, y (world), start }; a ring fills until it counts as a long-press
  marquee: null,             // the box a shift-drag is drawing, in world units: { x0, y0, x1, y1 }
  seaSets: new Map(),        // id → each placed sea's lettering as last laid out, for hit-testing
  covered: { left: 0, right: 0, top: 0, bottom: 0, words: 0 }, // what covers the map's edges, as `insets()` last read it: the frame loop never reads the DOM
  rose: null,                // where the compass rose stands at this scale ({ x, y, r } in world units), or null; paper themes draw it
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
  redraw(); // sizing a canvas clears it
  roseDue = true; // home is another shape now: the rose finds its water again
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
  if (!sameScale) {
    app.rose = null;
    roseDue = true;
    // A restored tab starts from the real home, not from the empty sea the camera was fitted to before any island arrived.
    if (isFirstSnapshot) {
      fitHome({ ...insets(), right: 0 });
      app.camera.snapHome();
    }
    frameSelection(); // the listeners have opened or closed the pane; refit home to the map area and frame the selection or go home
  }
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

/** An island is its coast and the lamps round it: a press anywhere inside the lamps' ring is a press on the island. */
const HIT = (LAMP_R + 8) / COAST;

export function hitTest(px, py) {
  const { x, y } = app.camera.toWorld(px, py);
  let best = null;
  let bestD = Infinity;
  for (const n of app.nodes) {
    if (n.draft) continue; // a draft is not an island yet: nothing to select
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < n.radius * HIT && d < bestD) {
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

/** How far right the header's words reach: past that, the band under the header's height is open water. */
function headerWords() {
  const stack = document.querySelector(".chrome.top .chrome-stack");
  return stack ? stack.getBoundingClientRect().right : 0;
}

/** How much of the bottom edge the bottom card (approve, confirm, sail to) covers while it shows. */
function bottomInset() {
  const card = document.querySelector("#cta:not([hidden]) .cta-card");
  if (card) return Math.max(0, app.size.h - card.getBoundingClientRect().top) + 8;
  const places = document.getElementById("places"); // a phone's bar; display: none anywhere else
  return places ? places.offsetHeight : 0;
}

/**
 * What covers the map's edges: the outline (left), the pane (right), the header (top), the bottom card or a phone's
 * bar (bottom). Reads the DOM, so it is called when one of them may have changed, never per frame: the frame loop
 * draws from the copy kept in `app.covered`.
 */
export function insets() {
  const top = topInset();
  app.covered = { left: outlineInset(), right: paneInset(), top, bottom: bottomInset(), words: top ? headerWords() : 0 };
  return app.covered;
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
  else if (wasHome) glide(app.camera.home);
}

const FRAME_MS = 320;
const stillMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
/** Moves the camera to a framing: a short glide, or at once under reduced motion (it is the largest motion on the page). */
function glide(target) {
  app.camera.animateTo(target, stillMotion?.matches ? 0 : FRAME_MS);
}

/** How far an island's marks reach from its centre, in radii: its lamps with their glow, and the water-lining to its sides. */
const REACH_UP = (LAMP_R + STAR.glow) / COAST;
const REACH_SIDE = WATER.rx / COAST;

/**
 * What home frames: every island at this scale (drafts too) with its lamps and its name where the layout puts it,
 * and every sea's lettering, so the map fills the window around the reader's own arrangement and nothing of it
 * lies under the header. Null with no islands: home is a fresh 1000-unit scale.
 */
export function homeBounds() {
  if (app.nodes.length === 0) return null;
  const { boxes, drafts } = layout();
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const take = (r) => {
    b.x0 = Math.min(b.x0, r.x0);
    b.x1 = Math.max(b.x1, r.x1);
    b.y0 = Math.min(b.y0, r.y0);
    b.y1 = Math.max(b.y1, r.y1);
  };
  const lettered = letteringRects({ boxes, drafts });
  for (const box of lettered) take(box);
  const labels = restLabels(lettered);
  for (const n of app.nodes) {
    take({ x0: n.x - n.radius * REACH_SIDE, x1: n.x + n.radius * REACH_SIDE, y0: n.y - n.radius * REACH_UP, y1: n.y + n.radius * REACH_UP });
    const label = labels.get(n.slug);
    if (label && !label.hidden) take(labelRect(n, boxScale(n.radius), label));
  }
  return b;
}

/**
 * Fits home to the map area between `ins`, and returns the scale home would have with the pane shut: what the
 * select zoom steps in from and what the zoom's limits are measured from, since home beside an open pane is far smaller.
 */
function fitHome(ins) {
  const { w, h } = app.size;
  const bounds = homeBounds();
  const open = app.camera.framing(w, h, { ...ins, right: 0 }, bounds).scale;
  app.camera.fit(w, h, ins, bounds);
  app.camera.zoomFrom(open);
  return open;
}

/** How far the selected island's marks reach to the side and down to the foot of a three-line name, in radii. */
const SELECT_HALF_W = 1.9;
const SELECT_HALF_H = 2.9;

/**
 * Frames the selected island at the centre of the map area beside the pane, or returns home. The zoom steps in
 * from home as it is with the pane shut (a step in from the small home beside the pane would be no zoom at all),
 * and never so far that the island, its lamps and its name no longer fit the area: the selection stays whole and
 * clear of the header on a short or narrow window too.
 */
export function frameSelection() {
  const { w, h } = app.size;
  const ins = insets();
  const open = fitHome(ins);
  const node = app.selected ? app.nodes.find((n) => n.slug === app.selected) : null;
  if (!node) return glide(app.camera.home);
  const aw = Math.max(1, w - ins.left - ins.right);
  const ah = Math.max(1, h - ins.top - ins.bottom);
  const whole = 0.94 * Math.min(aw / (2 * SELECT_HALF_W * node.radius), ah / (2 * SELECT_HALF_H * node.radius));
  glide(app.camera.centreOn(node, w, h, ins, Math.min(app.camera.closer(open), whole)));
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
  el.addEventListener("click", () => el.classList.toggle("open")); // hover shows the hint; a click (or a tap) pins it
  return el;
}

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

/** One of the dock's buttons: an icon, and on hover or focus what it opens, in a line that slides out to its left. */
function dockItem({ action, label, pending }) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `dock-item ${action}${pending ? " pending" : ""}`;
  b.setAttribute("aria-label", label);
  const l = document.createElement("span");
  l.className = "dock-label";
  l.textContent = label;
  b.append(l, dockIcon(action));
  b.addEventListener("click", () => (action === "guide" ? openGuide() : openChart()));
  return b;
}

function renderStrip() {
  const strip = document.getElementById("strip");
  if (!app.snapshot) return;
  strip.replaceChildren(...stripItems(app.snapshot, app.mode).map(stripItem));
  document.getElementById("dock")?.replaceChildren(...dockItems(app.snapshot).map(dockItem));
}

function renderStatus() {
  const el = document.getElementById("status");
  el.textContent = app.connected ? "" : t("app.disconnected");
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

/**
 * The still parts of the map: which sea holds which islands, each sea's lettering, its box and its stippled water,
 * the pending sketch's sea names, and where every island's name sits. Laid out again only when what they are made
 * from changes (an island or a sea moves, a snapshot arrives, the selection or the pointer moves on), never per frame.
 */
let scene = { key: null, seasKey: null, radius: 62, placed: [], sets: new Map(), boxes: new Map(), water: new Map(), drafts: [], labels: new Map() };
function layout() {
  const seasKey = [app.nodes, app.seas, app.snapshot, positionSum(app.nodes, app.seas)];
  const key = [...seasKey, app.selected, app.hover];
  if (!differs(key, scene.key)) return scene;
  const radius = app.nodes[0]?.radius ?? 62;
  let { placed, sets, boxes, water, drafts } = scene;
  if (differs(seasKey, scene.seasKey)) {
    const members = seaMembers(app.seas, app.nodes);
    const measure = measureSeaChar(SEA_FONT * radius);
    placed = app.seas.filter((s) => s.x !== null);
    sets = new Map();
    boxes = new Map();
    water = new Map();
    for (const s of placed) {
      const m = members.get(s.id) ?? [];
      const set = lettering(s.name, m, radius, measure);
      sets.set(s.id, set);
      boxes.set(s.id, letteringBox(s, set));
      water.set(s.id, stipplePaths(stippleDots(s, m, app.nodes, radius), radius));
    }
    // The pending sketch's seas: each name over the draft islands it groups, with no water until approved.
    drafts = [];
    for (const d of draftSeas(app.snapshot)) {
      const m = app.nodes.filter((n) => d.islands.includes(n.slug));
      if (!m.length) continue;
      const set = lettering(d.name, m, radius, measure);
      drafts.push({ at: seaSpot(m, app.nodes, radius, set.total / 2), set });
    }
  }
  const avoid = letteringRects({ boxes, drafts });
  const labels = layoutLabels(app.nodes, { measure: measureName, scale: (n) => boxScale(n.radius), focus: app.selected, hover: app.hover, avoid });
  scene = { key, seasKey, radius, placed, sets, boxes, water, drafts, labels };
  app.seaSets = sets;
  return scene;
}

/** The box of every sea's lettering on the map, the pending sketch's too: what an island's name keeps off. */
function letteringRects({ boxes, drafts }) {
  return [...boxes.values(), ...drafts.map((d) => letteringBox(d.at, d.set))];
}

/** The names as they sit with nothing selected or hovered: what home and the rose are measured against, so neither shifts under the pointer. */
function restLabels(lettered) {
  return layoutLabels(app.nodes, { measure: measureName, scale: (n) => boxScale(n.radius), avoid: lettered });
}

/**
 * The reader's seas, under everything else: stippled water first, then the names. With an island selected the
 * seas step back with the islands around it (`dim`), and a name sliding under the header's words fades out.
 */
function drawSeas({ placed, sets, boxes, water, drafts }, dim) {
  const cam = app.camera.state;
  const { top, left, words } = app.covered;
  for (const s of placed) drawSeaWater(ctx, water.get(s.id), dim);
  for (const s of placed) {
    const box = boxes.get(s.id);
    const underWords = box.x0 * cam.scale + cam.x < words + 48 && box.x1 * cam.scale + cam.x > left;
    const fade = underWords ? headerFade(top, box.y0 * cam.scale + cam.y, (box.y1 - box.y0) * cam.scale) : 1;
    drawSeaName(ctx, s, sets.get(s.id), { selected: s.id === app.selectedSea || app.group.seas.has(s.id), hover: s.id === app.hoverSea, dim, fade });
  }
  for (const d of drafts) drawSeaName(ctx, d.at, d.set, { draft: true });
  placeRemoveButton(app.selectedSea !== null && boxes.has(app.selectedSea) ? boxes.get(app.selectedSea) : null);
}

const placingSeas = new Set(); // ids of suggested seas whose position is being posted

/**
 * A suggested sea (approved from a sketch) has no position: once the islands it groups are placed and saved, the
 * page sets its name over them, and from then on it is the reader's like any other.
 */
function placeSuggestedSeas(radius) {
  for (const s of app.seas) {
    if (s.x !== null || placingSeas.has(s.id)) continue;
    const m = app.nodes.filter((n) => !n.draft && s.anchor?.includes(n.slug));
    if (!m.length || m.some((n) => !n.placed)) continue;
    const spot = seaSpot(m, app.nodes, radius, lettering(s.name, m, radius, measureSeaChar(SEA_FONT * radius)).total / 2);
    placingSeas.add(s.id);
    void saveSeaPosition({ id: s.id, ...spot }).finally(() => placingSeas.delete(s.id));
  }
}

/** The compass rose's radius: in island radii, kept within these screen px at home so it reads on a phone and stays modest on a wide window. */
const ROSE_R = 0.82;
const ROSE_PX = { min: 28, max: 58 };
const ROSE_EDGE = 20; // the rose keeps this far from the map area's edges, in screen px at home
const DOCK = { w: 84, h: 136 }; // the corner of the map area the dock keeps, in screen px
let roseDue = false; // the rose has no place yet at this scale, or home has changed shape under it

/**
 * Finds the compass rose its water: once a visit to a scale, when the islands have settled, in what home shows
 * with the pane shut, clear of every island, name and sea and of the dock's corner. It is part of the sheet from
 * then on: dragging an island never moves it (land simply covers it), and a crowded map goes without.
 */
function placeRose() {
  roseDue = false;
  const { w, h } = app.size;
  const radius = app.nodes[0]?.radius ?? 62;
  const ins = { ...app.covered, right: 0 };
  const home = app.camera.framing(w, h, ins, homeBounds());
  const world = (x, y) => ({ x: (x - home.x) / home.scale, y: (y - home.y) / home.scale });
  // The bottom card covers the middle of the map's foot, not its corners: the rose may stand beside it.
  const card = document.querySelector("#cta:not([hidden]) .cta-card")?.getBoundingClientRect();
  const foot = card ? (document.getElementById("places")?.offsetHeight ?? 0) : ins.bottom;
  // With nothing charted yet the rose stands in the corner of the fresh scale itself, which home shows whole
  // whether or not the cartographer's pane is open; else in what home shows of the map.
  const empty = app.nodes.length === 0;
  const a = empty ? { x: 0, y: 0 } : world(ins.left + ROSE_EDGE, ins.top + ROSE_EDGE);
  const z = empty ? { x: WORLD, y: WORLD } : world(w - ROSE_EDGE, h - foot - ROSE_EDGE);
  const rects = letteringRects(layout());
  const labels = restLabels(rects);
  for (const n of app.nodes) {
    const label = labels.get(n.slug);
    if (label && !label.hidden) rects.push(labelRect(n, boxScale(n.radius), label));
  }
  const dock = world(w - DOCK.w, h - foot - DOCK.h);
  rects.push({ x0: dock.x, y0: dock.y, x1: z.x, y1: z.y });
  if (card) {
    const c0 = world(card.left - ROSE_EDGE, card.top - ROSE_EDGE);
    const c1 = world(card.right + ROSE_EDGE, card.bottom);
    rects.push({ x0: c0.x, y0: c0.y, x1: c1.x, y1: c1.y });
  }
  app.rose = roseSpot({
    frame: { x0: a.x, y0: a.y, x1: z.x, y1: z.y },
    r: Math.min(ROSE_PX.max, Math.max(ROSE_PX.min, radius * ROSE_R * home.scale)) / home.scale,
    discs: app.nodes.map((n) => ({ x: n.x, y: n.y, r: n.radius * REACH_SIDE })),
    rects,
  });
}

let drawn = null;  // what the last frame was drawn from
let stale = true;  // something a frame cannot see has changed (the palette, the canvas was sized): draw anyway
let lively = false; // the last frame was mid-animation: one more is drawn after it, so the map rests on the end state

/** Asks for a frame although nothing the frame loop watches has changed. */
export function redraw() {
  stale = true;
}

/** The tool in flight while the cartographer works on this scale with nothing on it yet (null while it thinks); else undefined. */
function sketchingTool() {
  return app.nodes.length === 0 && app.snapshot ? chartWorkingHere() : undefined;
}

let laying = false; // the simulation was placing islands on the last frame
let layingFrames = 0; // how many frames it has been placing them for
const REFIT_EVERY = 24; // while it does, home is fitted again this often (frames)
/**
 * One turn of the loop. The map is redrawn only when something it shows has changed or is in motion: a still map
 * costs a handful of comparisons a frame and no drawing at all.
 */
function frame(now) {
  requestAnimationFrame(frame);
  const moving = app.sim.tick();
  const following = !app.selected && app.camera.atHome(); // the reader has not moved the map: home may move under it
  // New islands have found their places: if the reader has not moved the map since, home grows to take them in.
  if (laying && !moving) {
    roseDue = true;
    if (following) {
      fitHome(insets());
      glide(app.camera.home);
    }
  }
  // And while they are still finding them, home keeps up, so none drifts under the header on its way.
  layingFrames = moving ? layingFrames + 1 : 0;
  if (moving && following && layingFrames % REFIT_EVERY === 0 && !stillMotion?.matches) {
    fitHome(app.covered);
    glide(app.camera.home);
  }
  laying = moving;
  if (!moving && app.placing.size > 0 && !app.placementInFlight) void persistPlacement();
  if (!moving && app.placing.size === 0 && !app.placementInFlight) placeSuggestedSeas(app.nodes[0]?.radius ?? 62);
  if (roseDue && !moving && app.placing.size === 0 && app.snapshot) placeRose();
  const gliding = app.camera.tick(now);
  const tool = sketchingTool();
  const still = Boolean(stillMotion?.matches);
  const motion = moving || gliding || app.press !== null || (tool !== undefined && !still) || app.nodes.some((n) => isAnimating(n, now));
  const cam = app.camera.state;
  const c = app.covered;
  const from = [
    cam.x, cam.y, cam.scale, app.size.w, app.size.h, app.size.dpr, c.left, c.right, c.top, c.bottom, c.words,
    app.nodes, app.seas, app.snapshot, positionSum(app.nodes, app.seas), app.selected, app.hover, app.hoverSea, app.selectedSea,
    app.group, app.marquee, app.rose, tool, seaEditing(),
  ];
  if (!motion && !lively && !stale && !differs(from, drawn)) return;
  lively = motion;
  stale = false;
  drawn = from;
  draw(now, tool);
}

/** Draws the whole map: the sheet and its furniture, the seas, the islands' water-lining, straits, islands, names, then what lies over them. */
function draw(now, tool) {
  const { w, h, dpr } = app.size;
  const cam = app.camera.state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clear(ctx, w, h);
  app.camera.apply(ctx, dpr);
  const view = { x0: -cam.x / cam.scale, y0: -cam.y / cam.scale, x1: (w - cam.x) / cam.scale, y1: (h - cam.y) / cam.scale };
  drawGraticule(ctx, graticule(view, cam.scale), view, cam.scale);
  drawRose(ctx, app.rose, cam.scale);

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
  const dim = (n) => Boolean(focusSlug) && !near.has(n.slug);
  const hair = (n) => 1 / (cam.scale * boxScale(n.radius)); // one screen pixel in the island's box units
  const sc = layout();
  drawSeas(sc, Boolean(focusSlug));
  for (const n of app.nodes) drawShoreWater(ctx, n, { dim: dim(n), hair: hair(n) });
  for (const l of app.links) drawStrait(ctx, l, { dim: Boolean(focusSlug) && !(near.has(l.source.slug) && near.has(l.target.slug)), scale: cam.scale });
  for (const n of app.nodes) {
    drawIsland(ctx, n, { dim: dim(n), selected: n.slug === focusSlug, gathered: app.group.islands.has(n.slug), hovered: n.slug === app.hover, now, hair: hair(n) });
  }
  for (const n of app.nodes) drawIslandName(ctx, n, { lifted: n.slug === focusSlug || n.slug === app.hover, dim: dim(n), label: sc.labels.get(n.slug) });
  if (app.marquee) drawMarquee(ctx, app.marquee, cam.scale);
  if (app.press) drawPress(ctx, app.press, cam.scale, Math.min(1, (now - app.press.start) / LONG_PRESS_MS));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // screen px from here: what stays put however the map is panned
  if (tool !== undefined) drawSketchingHere(now, tool);
  drawVignette(ctx, w, h, app.covered);
}

/**
 * While the cartographer works on a scale with nothing on it yet, the middle of the map says so: coasts tracing
 * themselves, the scale's name, and the step in flight. The sketch's drafts take its place when the turn ends.
 */
function drawSketchingHere(now, tool) {
  const { left, right, top, bottom } = app.covered;
  const at = { x: left + (app.size.w - left - right) / 2, y: top + (app.size.h - top - bottom) / 2 - 40 };
  const name = app.snapshot.scale.path.at(-1)?.name ?? app.snapshot.domain.name;
  drawSketching(ctx, at, now, { title: t("app.sketching", { name }), step: thinkingLine("cartographer", tool || null), still: Boolean(stillMotion?.matches) });
}

/** Nothing to draw without the server (or, hosted, without the browser's storage): say why instead of a blank sea. */
function failedToStart(error) {
  const nav = document.getElementById("breadcrumb");
  if (error.code === "another-tab") return anotherTab(nav);
  nav.replaceChildren(error.message);
  console.error(error);
}

/** index.html is static: its labels take the page's language here. The head script already stamped `lang`. */
function labelStatics() {
  document.documentElement.lang = language();
  const labels = { map: "app.mapLabel", outline: "app.outlineLabel", breadcrumb: "app.scaleLabel", board: "app.boardLabel", about: "app.aboutLabel", "new-domain": "app.newDomainLabel" };
  for (const [id, key] of Object.entries(labels)) document.getElementById(id)?.setAttribute("aria-label", t(key));
}

/** Tells the server which language the page is in, so the personas write in it. Once a load, after the first snapshot. */
async function syncLanguage() {
  try {
    const learner = await api("/api/learner");
    if (learner.language === language()) return;
    await api("/api/learner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: language() }) });
  } catch (error) {
    console.error(error);
  }
}

/** The shared map a link asked for (`?map=<slug>`), taken off the address so a reload does not ask again. */
function sharedMap() {
  const slug = params.get("map");
  if (!slug) return null;
  const url = new URL(location.href);
  url.searchParams.delete("map");
  history.replaceState(null, "", url);
  return slug;
}

async function boot() {
  labelStatics();
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
      openNewDomain({ first: true, map: sharedMap() });
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
  // What a frame cannot see has changed: the palette, a font arriving, a canvas the browser emptied while the tab was away.
  document.addEventListener("theme", redraw);
  document.fonts?.addEventListener?.("loadingdone", redraw);
  document.addEventListener("visibilitychange", () => document.hidden || redraw());
  window.addEventListener("pageshow", redraw);
  canvas.addEventListener("contextrestored", redraw);
  installCard();
  installBoard();
  installOutline();
  installAbout();
  installImages();
  installKeys();
  installLaunch();
  installPlaces(); // after the pane and the board: it reads what they show
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
  if (app.snapshot) void syncLanguage();
  // A domain made on the page arrives with ?chart=start: open the cartographer and let it sketch.
  if (params.get("chart") === "start") {
    const url = new URL(location.href);
    url.searchParams.delete("chart");
    history.replaceState(null, "", url);
    openChart(null, { start: true });
  }
  // A link from the gallery page (/?map=<slug>): New domain opens on the shared maps with that one picked out.
  const shared = sharedMap();
  if (shared) openNewDomain({ map: shared });
  setInterval(poll, 2000);
  requestAnimationFrame(frame);
}

boot();
