import { buildNodes, buildLinks } from "./view-model.js";
import { createSimulation } from "./layout.js";
import { createCamera } from "./camera.js";
import { clear, drawIsland, drawStrait } from "./draw.js";
import { installInteractions } from "./interactions.js";
import { installCard } from "./card.js";

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const params = new URLSearchParams(location.search);

export const app = {
  domain: params.get("domain"),
  scale: params.get("scale"),
  snapshot: null,
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
  app.sim.setCenter(app.size.w / 2, app.size.h / 2);
  app.sim.reheat(0.3);
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
  applySnapshot(await api(`/api/snapshot?${query}`));
}

function samePath(a, b) {
  return a.scale.path.map((p) => p.slug).join("/") === b.scale.path.map((p) => p.slug).join("/");
}

function applySnapshot(snapshot) {
  const sameScale = app.snapshot !== null && samePath(app.snapshot, snapshot);
  const previous = sameScale ? new Map(app.nodes.map((n) => [n.slug, n])) : new Map();
  app.snapshot = snapshot;
  app.version = snapshot.version;
  app.nodes = buildNodes(snapshot, app.size.w, app.size.h, previous);
  app.links = buildLinks(snapshot, app.nodes);
  app.sim.setGraph(app.nodes, app.links, sameScale ? 0.25 : 1);
  if (!sameScale) app.camera.animateTo({ x: 0, y: 0, scale: 1 }, 400);
  renderChrome();
  for (const fn of app.listeners) fn(snapshot);
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
  strip.replaceChildren(
    stripItem("Nearest open water", open.length ? open.join(" · ") : "none at this scale"),
    stripItem("Reefs", reefs.length ? reefs.join(" · ") : "none charted"),
  );
  if (s.unreadComments) strip.append(stripItem("Unread", `${s.unreadComments} for Claude`));
}

function renderStatus() {
  const el = document.getElementById("status");
  el.textContent = app.connected ? "" : "disconnected — showing the last chart";
  el.classList.toggle("off", !app.connected);
}

function frame(now) {
  app.sim.tick();
  app.camera.tick(now);
  const { w, h, dpr } = app.size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clear(ctx, w, h);
  app.camera.apply(ctx, dpr);

  const focusSlug = app.hover || app.selected;
  const near = new Set();
  if (focusSlug) {
    near.add(focusSlug);
    for (const l of app.links) {
      if (l.source.slug === focusSlug) near.add(l.target.slug);
      if (l.target.slug === focusSlug) near.add(l.source.slug);
    }
  }
  for (const l of app.links) {
    drawStrait(ctx, l, { dim: Boolean(focusSlug) && !(near.has(l.source.slug) && near.has(l.target.slug)) });
  }
  for (const n of app.nodes) {
    drawIsland(ctx, n, { dim: Boolean(focusSlug) && !near.has(n.slug), spotlight: n.slug === focusSlug, now });
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
  resize();
  window.addEventListener("resize", resize);
  installInteractions(canvas);
  installCard();
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
