// Contour geometry: pure, in box units (a 200 × 200 box centred at 100,100). No canvas here; draw.js turns these into marks.
// Everything seeded is memoised per seed: an island's shape never changes, so a frame only reads it.
import { seededRandom } from "./view-model.js";

export const BOX = 200;
export const CENTRE = 100;
export const COAST = 62;
/** The lamps' mean distance from the centre. Each lamp sits LAMP_OFF outside the coast where it is (`lampPoint`). */
export const LAMP_R = 74;
export const LAMP_OFF = LAMP_R - COAST;
/** The shore shelf of a charted island: the coast's own shape, this much larger. */
export const SHELF = 1.1;
export const SOUNDING_R = 50;
export const RING_STEP = 14;
/** The ring a parent's islets sit on, and how large each is drawn. */
export const ROLLUP_R = 27;
export const ROLLUP_MARK = 6.5;
export const ROLLUP_MAX = 8;
export const SNOW_R = 6;
/** The selection and hover rings: clear of a lit lamp's rays (LAMP_R + 12.5 where the coast is widest, about 92). */
export const HALO_R = 96;
/** How far from the centre the harbour's anchor sits (its angle is `anchorAngle`). */
export const ANCHOR_R = 80;
export const NAME_Y = 204;
export const HATCH_PITCH = 9;
export const POINTS = 60; // divisible by 4, 5, and 6, so 4–6 landmarks get equal arcs on whole points
export const LEVEL = { open: 0, sandbar: 1, settled: 2, mountainous: 3, reef: 1 };
/** The lit lamp, a starburst: its core, where the rays start, and their tips (long on the compass points, short between). */
export const STAR = { core: 4.1, from: 6.6, long: 13, short: 9.6, ray: 1.7, glow: 23 };
/** A dark lamp's socket, and the quieter ring an explored landmark gets in the mentor's lens. */
export const SOCKET_R = 2.6;
export const EXPLORED = { ring: 5.2, core: 2.1, glow: 13 };

/** World units per box unit for an island whose shared map radius is `radius`. */
export function boxScale(radius) {
  return radius / COAST;
}

const wobbles = new Map();
/**
 * The coast's shape for a seed: a function of the angle that returns the radius as a share of the nominal one
 * (within ±10 %). Three low harmonics with seeded phases, so the same island has the same shape at every radius.
 */
export function wobble(seed) {
  let w = wobbles.get(seed);
  if (!w) {
    const rnd = seededRandom(seed);
    const p1 = rnd() * Math.PI * 2;
    const p2 = rnd() * Math.PI * 2;
    const p3 = rnd() * Math.PI * 2;
    w = (a) => 1 + 0.05 * Math.sin(3 * a + p1) + 0.03 * Math.sin(5 * a + p2) + 0.02 * Math.sin(7 * a + p3);
    wobbles.set(seed, w);
  }
  return w;
}

const rings = new Map();
/**
 * A wobbly ring of `n` points at `radius`, from 12 o'clock clockwise, in the island's own shape (`wobble`).
 * Memoised: the array is shared, so a caller never changes it.
 */
export function ringPoints(seed, radius, n = POINTS) {
  const key = `${seed}|${radius}|${n}`;
  let pts = rings.get(key);
  if (pts) return pts;
  const w = wobble(seed);
  pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const r = radius * w(a);
    pts.push({ x: CENTRE + Math.cos(a) * r, y: CENTRE + Math.sin(a) * r, a });
  }
  if (rings.size > 4000) rings.clear(); // a long session across many domains: start over rather than grow
  rings.set(key, pts);
  return pts;
}

/** The circle cut into `total` equal arcs from 12 o'clock clockwise: [{ from, to, mid }] in radians. */
export function arcRanges(total) {
  const out = [];
  for (let k = 0; k < total; k++) {
    const from = -Math.PI / 2 + (k / total) * Math.PI * 2;
    const to = -Math.PI / 2 + ((k + 1) / total) * Math.PI * 2;
    out.push({ from, to, mid: (from + to) / 2 });
  }
  return out;
}

/** Point-index ranges [i0, i1] of each arc on a ring of `n` points; i1 may equal n (wraps to point 0). */
export function arcIndices(total, n = POINTS) {
  const out = [];
  for (let k = 0; k < total; k++) out.push({ i0: Math.round((k * n) / total), i1: Math.round(((k + 1) * n) / total) });
  return out;
}

/** The point at `radius` on angle `a` from the centre. */
export function polar(a, radius) {
  return { x: CENTRE + Math.cos(a) * radius, y: CENTRE + Math.sin(a) * radius };
}

/** Where a landmark's lamp stands: on angle `a`, LAMP_OFF outside this island's coast, so the lamps follow the shore. */
export function lampPoint(seed, a) {
  return polar(a, COAST * wobble(seed)(a) + LAMP_OFF);
}

/**
 * The angle of the harbour's anchor: the join between two landmarks' arcs that lies nearest 6 o'clock (the left one
 * of a tie), so the anchor never sits under a lamp. With no landmarks, 6 o'clock.
 */
export function anchorAngle(total) {
  const down = Math.PI / 2;
  if (!total) return down;
  let best = down;
  let bestD = Infinity;
  for (let k = 0; k < total; k++) {
    const a = -Math.PI / 2 + (k / total) * Math.PI * 2;
    const d = Math.abs(Math.atan2(Math.sin(a - down), Math.cos(a - down)));
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && Math.cos(a) < Math.cos(best))) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/** Length of the polyline through pts[i0..i1]; an index equal to pts.length wraps to pts[0]. */
export function polylineLength(pts, i0, i1) {
  let len = 0;
  for (let i = i0; i < i1; i++) {
    const p = pts[i % pts.length];
    const q = pts[(i + 1) % pts.length];
    len += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return len;
}

const ROLLUP_ORDER = ["mountainous", "settled", "sandbar", "reef", "open"];

/**
 * A parent's islets as marks, one each: `[{ state, x, y }]` in box units, in the order of ROLLUP_ORDER, evenly
 * round a small ring from 12 o'clock (a single islet sits at the centre). Past ROLLUP_MAX islets the marks are
 * shared out in proportion, each state that has an islet keeping at least one. A count of islets, never a share
 * of the island.
 */
export function rollupMarks(byState, max = ROLLUP_MAX) {
  const counts = ROLLUP_ORDER.map((state) => ({ state, n: byState[state] || 0 })).filter((c) => c.n > 0);
  const total = counts.reduce((n, c) => n + c.n, 0);
  if (!total) return [];
  let shares = counts.map((c) => c.n);
  if (total > max) {
    const exact = counts.map((c) => (c.n / total) * max);
    shares = exact.map((e) => Math.max(1, Math.floor(e)));
    // hand out what is left to the largest remainders; take back from the largest shares if the floors of 1 overran
    const byRemainder = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r);
    let left = max - shares.reduce((a, b) => a + b, 0);
    for (let k = 0; left > 0; k++, left--) shares[byRemainder[k % byRemainder.length].i] += 1;
    while (left < 0) {
      const i = shares.indexOf(Math.max(...shares));
      shares[i] -= 1;
      left += 1;
    }
  }
  const states = counts.flatMap((c, i) => Array.from({ length: shares[i] }, () => c.state));
  if (states.length === 1) return [{ state: states[0], x: CENTRE, y: CENTRE }];
  return states.map((state, i) => ({ state, ...polar(-Math.PI / 2 + (i / states.length) * Math.PI * 2, ROLLUP_R) }));
}

/** 45° lines covering the box, `pitch` apart measured perpendicular to the lines. The caller clips to the coast. */
export function hatchLines(pitch = HATCH_PITCH) {
  const out = [];
  const step = pitch * Math.SQRT2; // spacing along the y axis for a perpendicular pitch
  for (let c = -BOX; c <= BOX; c += step) out.push({ x1: 0, y1: c, x2: BOX, y2: BOX + c });
  return out;
}

/** The water-lining round a charted island reaches this far from its centre, sideways and up or down. */
export const WATER = { rx: 108, ry: 90, pitch: 4.2, inner: 56 };

const shores = new Map();
/**
 * The engraving of a charted island's shore, per seed:
 * - `water`: level water-lining, rows of strokes `[x0, x1, y]` inside the WATER ellipse, ragged at their outer
 *   ends, split round the land (they start under the shelf, which the island draws over them);
 * - `hachures`: short strokes `[x1, y1, x2, y2]` just inside the coast, each leaning the same way, following its shape.
 */
export function shoreMarks(seed) {
  let m = shores.get(seed);
  if (m) return m;
  const rnd = seededRandom((seed ^ 0x9e3779b9) >>> 0);
  const water = [];
  const { rx, ry, pitch, inner } = WATER;
  for (let dy = -ry + pitch / 2; dy < ry; dy += pitch) {
    const reach = rx * Math.sqrt(1 - (dy * dy) / (ry * ry));
    const left = reach * (0.6 + rnd() * 0.4);
    const right = reach * (0.6 + rnd() * 0.4);
    const gap = Math.abs(dy) < inner ? Math.sqrt(inner * inner - dy * dy) : 0;
    const y = CENTRE + dy;
    if (!gap) water.push([CENTRE - left, CENTRE + right, y]);
    else {
      if (left > gap + 6) water.push([CENTRE - left, CENTRE - gap, y]);
      if (right > gap + 6) water.push([CENTRE + gap, CENTRE + right, y]);
    }
  }
  const w = wobble(seed);
  const hachures = [];
  const N = 64;
  for (let j = 0; j < N; j++) {
    const a = (j / N) * Math.PI * 2 + rnd() * 0.05;
    const b = a + 0.1;
    const r0 = COAST * w(a) * 0.965;
    const r1 = COAST * w(b) * (0.85 + rnd() * 0.07);
    hachures.push([CENTRE + Math.cos(a) * r0, CENTRE + Math.sin(a) * r0, CENTRE + Math.cos(b) * r1, CENTRE + Math.sin(b) * r1]);
  }
  m = { water, hachures };
  if (shores.size > 2000) shores.clear();
  shores.set(seed, m);
  return m;
}

const hills = new Map();
/** Hill hachures round a mountain's summit, per seed: strokes `[x1, y1, x2, y2]` running down from the snow line. */
export function hillMarks(seed) {
  let m = hills.get(seed);
  if (m) return m;
  const rnd = seededRandom((seed ^ 0x51ed270b) >>> 0);
  m = [];
  const N = 18;
  for (let j = 0; j < N; j++) {
    const a = (j / N) * Math.PI * 2 + rnd() * 0.12;
    const b = a + 0.14;
    const r0 = SNOW_R + 2.6 + rnd() * 1.2;
    const r1 = SNOW_R + 8.5 + rnd() * 2.5;
    m.push([CENTRE + Math.cos(a) * r0, CENTRE + Math.sin(a) * r0, CENTRE + Math.cos(b) * r1, CENTRE + Math.sin(b) * r1]);
  }
  if (hills.size > 2000) hills.clear();
  hills.set(seed, m);
  return m;
}

/**
 * A strait between two islands, in world units: a shallow curve from just outside one island's lamps to just
 * outside the other's, `{ x1, y1, cx, cy, x2, y2, nx, ny }` (a quadratic's ends and control point, and the unit
 * normal of the chord for a second line beside it). `side` is 1 or -1: which way it bows. Null when the islands
 * stand too close for any water to show between them.
 */
export function straitCurve(a, b, side = 1) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const clearA = boxScale(a.radius) * HALO_R;
  const clearB = boxScale(b.radius) * HALO_R;
  if (d - clearA - clearB < 4) return null;
  const ux = dx / d;
  const uy = dy / d;
  const x1 = a.x + ux * clearA;
  const y1 = a.y + uy * clearA;
  const x2 = b.x - ux * clearB;
  const y2 = b.y - uy * clearB;
  const bow = (d - clearA - clearB) * 0.09 * side;
  return { x1, y1, cx: (x1 + x2) / 2 - uy * bow, cy: (y1 + y2) / 2 + ux * bow, x2, y2, nx: -uy, ny: ux };
}
