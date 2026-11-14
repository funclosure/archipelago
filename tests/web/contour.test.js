import { test, expect } from "bun:test";
import {
  BOX, CENTRE, COAST, POINTS, LEVEL, LAMP_R, LAMP_OFF, HALO_R, STAR, SHELF, WATER, SNOW_R, ROLLUP_R, ROLLUP_MAX, RING_STEP, ANCHOR_R, NAME_Y,
  boxScale, wobble, ringPoints, arcRanges, arcIndices, polar, lampPoint, anchorAngle, rollupMarks, hatchLines, polylineLength,
  shoreMarks, hillMarks, straitCurve,
} from "../../src/web/contour.js";

const dist = (p) => Math.hypot(p.x - CENTRE, p.y - CENTRE);

test("the box is 200 units with the coast at 62; one box unit is radius/62 world units", () => {
  expect(BOX).toBe(200);
  expect(CENTRE).toBe(100);
  expect(COAST).toBe(62);
  expect(boxScale(62)).toBe(1);
  expect(boxScale(78)).toBeCloseTo(78 / 62);
  expect(LEVEL).toEqual({ open: 0, sandbar: 1, settled: 2, mountainous: 3, reef: 1 });
});

test("ringPoints is deterministic per seed, starts at 12 o'clock, runs clockwise, and wobbles within 10%", () => {
  const a = ringPoints(7, COAST);
  const b = ringPoints(7, COAST);
  const c = ringPoints(8, COAST);
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
  expect(a).toHaveLength(POINTS);
  expect(a[0].a).toBeCloseTo(-Math.PI / 2);
  expect(a[1].a).toBeGreaterThan(a[0].a);
  for (const p of a) {
    expect(dist(p)).toBeGreaterThanOrEqual(COAST * 0.9 - 1e-9);
    expect(dist(p)).toBeLessThanOrEqual(COAST * 1.1 + 1e-9);
  }
  // an inner ring keeps the same shape, scaled
  const inner = ringPoints(7, COAST - 14);
  for (let i = 0; i < POINTS; i++) expect(dist(inner[i]) / dist(a[i])).toBeCloseTo((COAST - 14) / COAST);
});

test("arcRanges cuts the circle into equal arcs from 12 o'clock; arcIndices maps them onto the ring's points", () => {
  const arcs = arcRanges(5);
  expect(arcs).toHaveLength(5);
  expect(arcs[0].from).toBeCloseTo(-Math.PI / 2);
  expect(arcs[4].to).toBeCloseTo((3 * Math.PI) / 2);
  for (let k = 1; k < 5; k++) expect(arcs[k].from).toBeCloseTo(arcs[k - 1].to);
  expect(arcs[0].mid).toBeCloseTo(-Math.PI / 2 + Math.PI / 5);
  const idx = arcIndices(4, 60);
  expect(idx).toEqual([{ i0: 0, i1: 15 }, { i0: 15, i1: 30 }, { i0: 30, i1: 45 }, { i0: 45, i1: 60 }]);
  expect(arcIndices(6, 60)[5]).toEqual({ i0: 50, i1: 60 });
});

test("polar and polylineLength", () => {
  const p = polar(-Math.PI / 2, 70);
  expect(p.x).toBeCloseTo(100);
  expect(p.y).toBeCloseTo(30);
  const pts = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }];
  expect(polylineLength(pts, 0, 2)).toBeCloseTo(11);
  expect(polylineLength(pts, 0, 3)).toBeCloseTo(11 + Math.hypot(3, 10)); // i1 === length wraps to the first point
});

test("rollupMarks is one mark per islet, in order, on a small ring; a single islet sits at the centre", () => {
  const marks = rollupMarks({ mountainous: 0, settled: 2, sandbar: 1, reef: 1, open: 2 });
  expect(marks.map((m) => m.state)).toEqual(["settled", "settled", "sandbar", "reef", "open", "open"]);
  expect(marks[0].x).toBeCloseTo(CENTRE); // the first at 12 o'clock
  expect(marks[0].y).toBeCloseTo(CENTRE - ROLLUP_R);
  for (const m of marks) expect(dist(m)).toBeCloseTo(ROLLUP_R);
  expect(rollupMarks({ open: 1 })).toEqual([{ state: "open", x: CENTRE, y: CENTRE }]);
  expect(rollupMarks({})).toEqual([]);
  expect(rollupMarks({ open: 0 })).toEqual([]);
});

test("past ROLLUP_MAX islets the marks are shared out in proportion, and every state that has an islet keeps one", () => {
  const marks = rollupMarks({ settled: 10, sandbar: 5, open: 1 });
  expect(marks).toHaveLength(ROLLUP_MAX);
  const count = (state) => marks.filter((m) => m.state === state).length;
  expect(count("settled")).toBe(5);
  expect(count("sandbar")).toBe(2);
  expect(count("open")).toBe(1);
  // many states, each with a floor of one, still fit the ring
  const crowded = rollupMarks({ mountainous: 1, settled: 1, sandbar: 1, reef: 1, open: 40 });
  expect(crowded).toHaveLength(ROLLUP_MAX);
  expect(new Set(crowded.map((m) => m.state)).size).toBe(5);
});

test("the rings of an island keep clear of each other: lamps outside the coast, the halo outside a lit lamp's rays, the name outside the halo", () => {
  expect(LAMP_OFF).toBe(LAMP_R - COAST);
  // a lamp stands LAMP_OFF outside the coast wherever the coast is, so its rays reach at most this far from the centre
  const reach = COAST * 1.1 + LAMP_OFF + STAR.long;
  expect(HALO_R).toBeGreaterThan(reach);
  expect(CENTRE + HALO_R + 5).toBeLessThanOrEqual(NAME_Y); // the gathered ring too
  expect(ANCHOR_R + 8).toBeLessThan(HALO_R);
  expect(STAR.from).toBeGreaterThan(STAR.core);
  expect(STAR.long).toBeGreaterThan(STAR.short);
  // a mountain's summit fits inside its innermost ring
  expect(SNOW_R + 11.5).toBeLessThan((COAST - 3 * RING_STEP) * 0.9);
});

test("wobble is the coast's shape: ringPoints follows it, and a lamp stands LAMP_OFF outside the coast on its angle", () => {
  const w = wobble(7);
  expect(wobble(7)).toBe(w); // one function per seed
  const ring = ringPoints(7, COAST);
  expect(ringPoints(7, COAST)).toBe(ring); // memoised: the same array
  for (const p of ring) expect(dist(p)).toBeCloseTo(COAST * w(p.a));
  for (const a of [-Math.PI / 2, 0.3, 2.2, 4]) {
    const p = lampPoint(7, a);
    expect(dist(p)).toBeCloseTo(COAST * w(a) + LAMP_OFF);
    expect(Math.atan2(p.y - CENTRE, p.x - CENTRE)).toBeCloseTo(Math.atan2(Math.sin(a), Math.cos(a)));
  }
});

test("the anchor sits at the join of two arcs nearest 6 o'clock, never under a lamp", () => {
  const down = Math.PI / 2;
  expect(anchorAngle(0)).toBeCloseTo(down);
  expect(anchorAngle(4)).toBeCloseTo(down); // joins at 12, 3, 6, 9
  expect(anchorAngle(6)).toBeCloseTo(down);
  // three landmarks: lamps at 2, 6 and 10 o'clock, joins at 12, 4 and 8: the anchor takes the left one, 8 o'clock
  expect(anchorAngle(3)).toBeCloseTo(-Math.PI / 2 + (2 / 3) * Math.PI * 2);
  expect(Math.cos(anchorAngle(5))).toBeLessThan(0);
  for (const total of [1, 2, 3, 4, 5, 6]) {
    const a = anchorAngle(total);
    for (const arc of arcRanges(total)) {
      const off = Math.abs(Math.atan2(Math.sin(a - arc.mid), Math.cos(a - arc.mid)));
      expect(off).toBeGreaterThan(Math.PI / total - 1e-6); // half an arc from every lamp
    }
  }
});

test("shoreMarks: level water-lining inside its ellipse and off the land, hachures just inside the coast; the same for a seed", () => {
  const m = shoreMarks(7);
  expect(shoreMarks(7)).toBe(m);
  expect(shoreMarks(8)).not.toEqual(m);
  expect(m.water.length).toBeGreaterThan(40);
  let last = -Infinity;
  for (const [x0, x1, y] of m.water) {
    expect(x1).toBeGreaterThan(x0);
    expect(y).toBeGreaterThanOrEqual(last); // rows run down the sheet, a fixed pitch apart
    last = y;
    for (const x of [x0, x1]) {
      const inEllipse = ((x - CENTRE) / WATER.rx) ** 2 + ((y - CENTRE) / WATER.ry) ** 2;
      expect(inEllipse).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.hypot(x - CENTRE, y - CENTRE)).toBeGreaterThanOrEqual(WATER.inner - 1e-9); // never across the land
    }
  }
  // the strokes start under the shelf, which the island draws over them, so the lining meets the shelf all round
  expect(WATER.inner).toBeLessThan(COAST * SHELF * 0.9);
  expect(m.hachures).toHaveLength(64);
  const w = wobble(7);
  for (const [x1, y1, x2, y2] of m.hachures) {
    const a = Math.atan2(y1 - CENTRE, x1 - CENTRE);
    expect(Math.hypot(x1 - CENTRE, y1 - CENTRE)).toBeLessThan(COAST * w(a)); // inside the coast
    expect(Math.hypot(x2 - CENTRE, y2 - CENTRE)).toBeLessThan(Math.hypot(x1 - CENTRE, y1 - CENTRE)); // running inland
    expect(Math.hypot(x2 - CENTRE, y2 - CENTRE)).toBeGreaterThan((COAST - RING_STEP) * 1.1 * 0.9); // short of the first ring's widest
  }
});

test("hillMarks ring a summit: strokes running down from the snow line, inside the innermost ring", () => {
  const m = hillMarks(7);
  expect(hillMarks(7)).toBe(m);
  expect(m.length).toBeGreaterThan(12);
  for (const [x1, y1, x2, y2] of m) {
    expect(Math.hypot(x1 - CENTRE, y1 - CENTRE)).toBeGreaterThan(SNOW_R);
    expect(Math.hypot(x2 - CENTRE, y2 - CENTRE)).toBeGreaterThan(Math.hypot(x1 - CENTRE, y1 - CENTRE));
    expect(Math.hypot(x2 - CENTRE, y2 - CENTRE)).toBeLessThan((COAST - 3 * RING_STEP) * 0.9);
  }
});

test("a strait is a shallow curve between two islands' halos, bowing to its side; none when they stand too close", () => {
  const a = { x: 0, y: 0, radius: 62 };
  const b = { x: 500, y: 0, radius: 62 };
  const c = straitCurve(a, b, 1);
  expect(c.x1).toBeCloseTo(HALO_R); // clear of the lamps at each end
  expect(c.x2).toBeCloseTo(500 - HALO_R);
  expect(c.y1).toBeCloseTo(0);
  expect(c.cx).toBeCloseTo(250);
  expect(c.cy).toBeGreaterThan(0);
  expect(c.cy).toBeLessThan((500 - 2 * HALO_R) * 0.15); // shallow
  expect(straitCurve(a, b, -1).cy).toBeCloseTo(-c.cy);
  expect(c.nx).toBeCloseTo(0); // the chord's normal
  expect(c.ny).toBeCloseTo(1);
  expect(straitCurve(a, { x: 2 * HALO_R + 2, y: 0, radius: 62 })).toBeNull();
  // a larger island keeps a larger halo
  expect(straitCurve({ ...a, radius: 124 }, { ...b, x: 900 }, 1).x1).toBeCloseTo(2 * HALO_R);
});

test("hatchLines cover the box at the pitch, all at 45 degrees", () => {
  const lines = hatchLines(6);
  expect(lines.length).toBeGreaterThan(40);
  for (const l of lines) expect(l.x2 - l.x1).toBeCloseTo(l.y2 - l.y1);
  const spacing = (lines[1].y1 - lines[0].y1) / Math.SQRT2;
  expect(spacing).toBeCloseTo(6);
});
