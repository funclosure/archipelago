// Contour geometry: pure, in box units (a 200 × 200 box centred at 100,100). No canvas here; draw.js turns these into marks.
import { seededRandom } from "./view-model.js";

export const BOX = 200;
export const CENTRE = 100;
export const COAST = 62;
export const LAMP_R = 70;
export const SOUNDING_R = 52;
export const RING_STEP = 14;
export const ROLLUP_R = 48;
export const SNOW_R = 12;
export const HALO_R = 76;
export const ANCHOR = { x: 100, y: 184 };
export const NAME_Y = 204;
export const HATCH_PITCH = 6;
export const POINTS = 60; // divisible by 4, 5, and 6, so 4–6 landmarks get equal arcs on whole points
export const LEVEL = { open: 0, sandbar: 1, settled: 2, mountainous: 3, reef: 1 };

/** World units per box unit for an island whose shared map radius is `radius`. */
export function boxScale(radius) {
  return radius / COAST;
}

/**
 * A wobbly ring of `n` points at `radius`, from 12 o'clock clockwise. The wobble is three low
 * harmonics with seeded phases, so the same island always has the same shape at every radius,
 * and the ring stays within ±10 % of the radius.
 */
export function ringPoints(seed, radius, n = POINTS) {
  const rnd = seededRandom(seed);
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const p3 = rnd() * Math.PI * 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const w = 0.05 * Math.sin(3 * a + p1) + 0.03 * Math.sin(5 * a + p2) + 0.02 * Math.sin(7 * a + p3);
    const r = radius * (1 + w);
    pts.push({ x: CENTRE + Math.cos(a) * r, y: CENTRE + Math.sin(a) * r, a });
  }
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

/** Rollup ring segments proportional to the islet states, from 12 o'clock; open islets are gaps. */
export function rollupSegments(byState) {
  const total = ROLLUP_ORDER.reduce((n, s) => n + (byState[s] || 0), 0);
  const out = [];
  let a = -Math.PI / 2;
  for (const state of ROLLUP_ORDER) {
    const n = byState[state] || 0;
    if (!n) continue;
    const span = (n / total) * Math.PI * 2;
    if (state !== "open") out.push({ state, from: a, to: a + span });
    a += span;
  }
  return out;
}

/** 45° lines covering the box, `pitch` apart measured perpendicular to the lines. The caller clips to the coast. */
export function hatchLines(pitch = HATCH_PITCH) {
  const out = [];
  const step = pitch * Math.SQRT2; // spacing along the y axis for a perpendicular pitch
  for (let c = -BOX; c <= BOX; c += step) out.push({ x1: 0, y1: c, x2: BOX, y2: BOX + c });
  return out;
}
