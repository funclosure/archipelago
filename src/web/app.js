import { buildNodes, buildLinks, WORLD } from "./view-model.js";
import { createSimulation } from "./layout.js";
import { createCamera } from "./camera.js";
import { clear, drawIsland, drawStrait } from "./draw.js";
import { installInteractions } from "./interactions.js";
import { installCard } from "./card.js";
import { installOutline } from "./outline.js";
import { installKeys } from "./keys.js";
import { installBoard } from "./board.js";

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
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
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

export async function refresh() {
  const query = `domain=${encodeURIComponent(app.domain)}${app.scale ? `&scale=${encodeURIComponent(app.scale)}` : ""}`;
  const [snapshot, outline] = await Promise.all([api(`/api/snapshot?${query}`), api(`/api/outline?domain=${encodeURIComponent(app.domain)}`)]);
  app.outline = outline;
  applySnapshot(snapshot);
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
  app.nodes = buildNodes(snapshot, previous);
  app.links = buildLinks(snapshot, app.nodes);
  // The simulation exists only to place islands that have no stored position; placed ones are pinned.
  app.sim.setGraph(app.nodes, app.links, unplaced().length ? (sameScale ? 0.5 : 1) : 0);
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

async function poll() {
  try {
    const { version } = await api(`/api/version?domain=${encodeURIComponent(app.domain)}`);
    app.connected = true;
    if (version !== app.version) await refresh();
  } catch {
    app.connected = false;
  }
  renderStatus();
}

/** The node under a screen point, or null. */
export function hitTest(px, py) {
  const { x, y } = app.camera.toWorld(px, py);
  let best = null;
  let bestD = Infinity;
  for (const n of app.nodes) {
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

export function insets() {
  return { left: outlineInset(), right: paneInset() };
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

/** Nodes the page still has to place (no stored coordinates). */
export function unplaced() {
  return app.nodes.filter((n) => !n.placed);
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

function stripItem(label, value) {
  const el = document.createElement("div");
  el.className = "strip-item";
  const l = document.createElement("span");
  l.className = "strip-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.textContent = value;
  el.append(l, v);
  return el;
}

function renderStrip() {
  const strip = document.getElementById("strip");
  const s = app.snapshot;
  if (!s) return;
  const nameOf = (slug) => s.islands.find((i) => i.slug === slug)?.name ?? slug;
  const open = s.nearestOpenWater.slice(0, 4).map(nameOf);
  const reefs = s.reefs.map((r) => (r.startsWith("island:") ? nameOf(r.slice(7)) : r.replace("strait:", "strait ")));
  const items = [];
  if (s.harbour) {
    const h = s.islands.find((i) => i.slug === s.harbour);
    items.push(stripItem(h && h.verdict ? "Home port" : "Set out from", nameOf(s.harbour)));
  }
  items.push(
    stripItem("Nearest open water", open.length ? open.join(" · ") : "none at this scale"),
    stripItem("Reefs", reefs.length ? reefs.join(" · ") : "none charted"),
  );
  if (s.unreadComments) items.push(stripItem("Unread", `${s.unreadComments} for Claude`));
  strip.replaceChildren(...items);
}

function renderStatus() {
  const el = document.getElementById("status");
  el.textContent = app.connected ? "" : "disconnected — showing the last chart";
  el.classList.toggle("off", !app.connected);
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
      if (!l.source.island.verdict || !l.target.island.verdict) continue; // only charted channels count as near
      if (l.source.slug === focusSlug) near.add(l.target.slug);
      if (l.target.slug === focusSlug) near.add(l.source.slug);
    }
  }
  for (const l of app.links) {
    drawStrait(ctx, l, { dim: Boolean(focusSlug) && !(near.has(l.source.slug) && near.has(l.target.slug)) });
  }
  for (const n of app.nodes) {
    drawIsland(ctx, n, { dim: Boolean(focusSlug) && !near.has(n.slug), selected: n.slug === focusSlug, hovered: n.slug === app.hover, now });
  }
  requestAnimationFrame(frame);
}

async function boot() {
  if (!app.domain) {
    const { domains } = await api("/api/domains");
    if (domains.length === 0) {
      document.getElementById("breadcrumb").textContent = "No domains yet — run: archipelago domain add --slug <slug> --name <name>";
      return;
    }
    app.domain = domains[0].slug;
    const url = new URL(location.href);
    url.searchParams.set("domain", app.domain);
    history.replaceState(null, "", url);
  }
  app.sim.setCenter(WORLD / 2, WORLD / 2);
  resize();
  window.addEventListener("resize", resize);
  installInteractions(canvas);
  installCard();
  installBoard();
  installOutline();
  installKeys();
  try {
    await refresh();
  } catch (error) {
    app.connected = false;
    renderStatus();
    console.error(error);
  }
  setInterval(poll, 2000);
  requestAnimationFrame(frame);
}

boot();
