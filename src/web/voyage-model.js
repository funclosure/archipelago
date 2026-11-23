// A voyage: when the reader follows a "Sail to", a boat crosses from where they stand to the island they sail to,
// and the camera goes with it. Pure: the route through open water, how long the crossing takes, where the boat is
// at a moment, and the camera's way from one framing to the other. app.js runs it and draw.js draws it.
// Islands here are { x, y, r } in world units (r is the island's map radius, the coast's); what a route keeps clear
// of is islands and boxes { x0, y0, x1, y1 } (the names on the map).

/** Where the boat leaves and lands, in island radii from the centre: just outside the selection ring (1.55), clear of the lamps' rays. */
export const SHORE = 1.75;
/** How far a route keeps from every other island's centre, in its radii: clear of its lamps and their rays. */
export const CLEAR = 1.45;
/** With nowhere to leave from, the boat comes in from open sea, this many radii out from the island it lands at. */
export const OFFSHORE = 3.4;
/** The bows a route may take, as a share of the crossing: a straight line first, then wider each way, as far as it must to stay in open water. */
const BOWS = [0.08, 0.2, 0.34, 0.5, 0.7];
/** Samples along a route: enough for the wake to look drawn, few enough to walk every frame. */
const SAMPLES = 48;

/** The crossing's length in ms, from the route's length on screen: brisk for a neighbour, never a wait for a far one. */
export const SAIL_MS = { min: 1200, max: 2000, base: 800, perPx: 0.8 };
/** The camera sets off this long after the boat, so the boat is seen to leave, and settles this long after it lands. */
export const CAMERA_LAG = 140;
/** After landing the boat rests this long, then fades over FADE_MS; its wake fades over WAKE_MS from the landing. */
export const HOLD_MS = 260;
export const FADE_MS = 420;
export const WAKE_MS = 760;
/** The boat appears over this long as it pushes off. */
export const LAUNCH_MS = 160;
/** At the crossing's middle the camera draws back far enough to show the whole route, within this margin of the area (each side). */
const MARGIN = 0.1;

const clamp01 = (t) => Math.max(0, Math.min(1, t));
/** The boat's pace: it gathers way and slows to land. */
export const sailEase = (t) => 0.5 - Math.cos(Math.PI * clamp01(t)) / 2;
/** The camera's: a little firmer at both ends, as the map's other glides. */
export const cameraEase = (t) => {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
};

/** How far a point lies outside a box; negative inside it, by the distance to its nearest edge. */
function outside(x, y, b) {
  const dx = Math.max(b.x0 - x, 0, x - b.x1);
  const dy = Math.max(b.y0 - y, 0, y - b.y1);
  if (dx || dy) return Math.hypot(dx, dy);
  return -Math.min(x - b.x0, b.x1 - x, y - b.y0, b.y1 - y);
}

/** The least room a polyline leaves round `others` (past each island's CLEAR reach, outside each box); Infinity with none. */
function clearance(pts, others) {
  let least = Infinity;
  for (const o of others) {
    if ("x0" in o) {
      for (const [x, y] of pts) least = Math.min(least, outside(x, y, o));
      continue;
    }
    const reach = o.r * CLEAR;
    for (const [x, y] of pts) least = Math.min(least, Math.hypot(x - o.x, y - o.y) - reach);
  }
  return least;
}

/** A quadratic from `a` round `c` to `b`, sampled. */
function quadratic(a, c, b, n = SAMPLES) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const v = 1 - u;
    pts.push([v * v * a.x + 2 * v * u * c.x + u * u * b.x, v * v * a.y + 2 * v * u * c.y + u * u * b.y]);
  }
  return pts;
}

/** A point `dist` from `p` toward `q`. */
function toward(p, q, dist) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: p.x + (dx / d) * dist, y: p.y + (dy / d) * dist };
}

/** One candidate route bowed by `bow` (a share of the crossing, signed): leaving and landing on the shores that face its curve. */
function bowed(from, to, bow) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  const c = { x: (from.x + to.x) / 2 - (dy / d) * bow * d, y: (from.y + to.y) / 2 + (dx / d) * bow * d };
  const a = toward(from, c, from.r * SHORE);
  const b = toward(to, c, to.r * SHORE);
  return quadratic(a, c, b);
}

/**
 * The boat's route from `from` to `to` through open water: a shallow curve, as a channel is drawn on a chart,
 * bowed only as far as it must be to keep clear of every island and box in `others`, trying the side `side` (±1) first.
 * When no bow clears them all (a crowded map), the one that keeps furthest from them. `from.r` may be 0: a point
 * in open sea. Returns the sampled points, their running lengths, the total, and which way the boat faces
 * (1 sailing right, -1 left), kept for the whole crossing so it never flips mid-way.
 */
export function voyageRoute(from, to, others = [], side = 1) {
  let best = null;
  for (const share of BOWS) {
    for (const sign of [side, -side]) {
      const pts = bowed(from, to, share * sign);
      const room = clearance(pts, others);
      if (room >= 0) return measured(pts);
      if (!best || room > best.room) best = { pts, room };
    }
  }
  return measured(best.pts);
}

function measured(pts) {
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const first = pts[0];
  const last = pts.at(-1);
  return { pts, len, total: len.at(-1), dir: last[0] >= first[0] ? 1 : -1 };
}

/** The point `dist` along a route (clamped to it). */
export function pointAt(route, dist) {
  const { pts, len, total } = route;
  const d = Math.max(0, Math.min(total, dist));
  let i = 1;
  while (i < len.length - 1 && len[i] < d) i++;
  const span = len[i] - len[i - 1] || 1;
  const u = (d - len[i - 1]) / span;
  return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u };
}

/** The route's points up to `dist` along it, ending exactly there: the wake behind the boat. */
export function wakeTo(route, dist) {
  const d = Math.max(0, Math.min(route.total, dist));
  const out = [];
  for (let i = 0; i < route.pts.length && route.len[i] < d; i++) out.push(route.pts[i]);
  const end = pointAt(route, d);
  out.push([end.x, end.y]);
  return out;
}

/**
 * Where a boat with nowhere to leave from comes in: open sea OFFSHORE radii out from `to`, on the side away from
 * the middle of the `islands` (from outside the archipelago), turned a little at a time until it lies clear of
 * every island. Straight up from the foot of the map when `to` is the middle itself.
 */
export function offshorePoint(to, islands = [], boxes = []) {
  const others = [...islands.filter((o) => o.x !== to.x || o.y !== to.y), ...boxes];
  let mx = 0;
  let my = 0;
  for (const o of islands) {
    mx += o.x;
    my += o.y;
  }
  const n = islands.length || 1;
  let angle = Math.atan2(to.y - my / n, to.x - mx / n);
  if (Math.hypot(to.x - mx / n, to.y - my / n) < to.r * 0.5) angle = Math.PI * 0.75; // from the lower left
  const out = to.r * OFFSHORE;
  for (let i = 0; i < 18; i++) {
    const turn = (Math.ceil(i / 2) * (i % 2 ? 1 : -1) * Math.PI) / 9; // 0, +20°, -20°, +40°, …
    const p = { x: to.x + Math.cos(angle + turn) * out, y: to.y + Math.sin(angle + turn) * out };
    if (clearance([[p.x, p.y]], others) >= 0) return p;
  }
  return { x: to.x + Math.cos(angle) * out, y: to.y + Math.sin(angle) * out };
}

/** How long the crossing takes for a route `px` long on screen. */
export function sailMs(px) {
  return Math.round(Math.max(SAIL_MS.min, Math.min(SAIL_MS.max, SAIL_MS.base + px * SAIL_MS.perPx)));
}

/**
 * Where a voyage that set off at `start` and sails for `ms` stands at `now`: how far along the boat is (`boat`,
 * 0..1 of the route), how far the camera is on its way (`camera`, 0..1), how visible the boat and its wake are,
 * and whether it is over.
 */
export function voyageAt({ start, ms }, now) {
  const e = Math.max(0, now - start);
  const boat = sailEase(e / ms);
  const camera = cameraEase((e - CAMERA_LAG) / ms);
  const landed = e - ms;
  const shown = clamp01(e / LAUNCH_MS) * (1 - clamp01((landed - HOLD_MS) / FADE_MS));
  const wake = 1 - clamp01(landed / WAKE_MS);
  return { boat, camera, boatAlpha: shown, wakeAlpha: wake, done: landed >= Math.max(HOLD_MS + FADE_MS, WAKE_MS, CAMERA_LAG) };
}

/** Everything the camera needs to see on the way: the route and both islands with their lamps. */
export function voyageBounds(route, from, to) {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const take = (x, y, r = 0) => {
    b.x0 = Math.min(b.x0, x - r);
    b.x1 = Math.max(b.x1, x + r);
    b.y0 = Math.min(b.y0, y - r);
    b.y1 = Math.max(b.y1, y + r);
  };
  for (const [x, y] of route.pts) take(x, y);
  take(from.x, from.y, from.r * CLEAR);
  take(to.x, to.y, to.r * CLEAR);
  return b;
}

/** The scale at which `bounds` fit an area `w` × `h` px with the margin. */
export function fitScale(bounds, w, h) {
  const bw = Math.max(1, bounds.x1 - bounds.x0);
  const bh = Math.max(1, bounds.y1 - bounds.y0);
  return Math.min(w / bw, h / bh) * (1 - 2 * MARGIN);
}

/**
 * The camera at `c` (0..1) of its way from framing `f0` at scale `s0` to `f1` at `s1`: the point at the area's
 * centre moves straight across while the scale changes evenly in proportion, and when the route would not fit
 * the area at the crossing's middle (`fit`, from `fitScale`), the camera draws back to it there and comes in again.
 */
export function cameraAt(c, { f0, s0, f1, s1, fit }) {
  const even = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * c);
  const middle = Math.sqrt(s0 * s1);
  const back = fit < middle ? (fit / middle) ** Math.sin(Math.PI * c) : 1;
  return { focus: { x: f0.x + (f1.x - f0.x) * c, y: f0.y + (f1.y - f0.y) * c }, scale: even * back };
}

// ---- the way back ----

/** How many crossings the way back remembers. */
export const TRAIL_MAX = 8;

/**
 * The way back: the crossings the reader made by "Sail to", oldest first, each `{ from: { slug, scale }, to }` (the
 * island left and the slug of the one landed on). `sailed` adds one; `trailAfter` keeps the trail while the reader
 * stands where its last crossing landed (or on no island at all, the pane closed) and drops it when they pick an
 * island any other way, since they are then charting their own course; `wayBack` is where the way back leads from
 * `selected`, or null. Going back takes the last crossing off (`trail.slice(0, -1)`), so A → B → C leads back to B,
 * then to A.
 */
export function sailed(trail, from, to) {
  return [...trail, { from, to }].slice(-TRAIL_MAX);
}

export function trailAfter(trail, selected) {
  if (selected === null || trail.length === 0) return trail;
  return trail.at(-1).to === selected ? trail : [];
}

export function wayBack(trail, selected) {
  const last = trail.at(-1);
  return last && selected !== null && last.to === selected ? last.from : null;
}

/** An island anywhere in the outline's tree (`GET /api/outline`'s `islands`), by slug: `{ slug, name, scale, … }`, or null. */
export function islandIn(tree, slug) {
  for (const node of tree ?? []) {
    if (node.slug === slug) return node;
    const inner = islandIn(node.children, slug);
    if (inner) return inner;
  }
  return null;
}
