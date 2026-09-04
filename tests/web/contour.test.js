import { test, expect } from "bun:test";
import {
  BOX, CENTRE, COAST, POINTS, LEVEL, boxScale, ringPoints, arcRanges, arcIndices, polar, rollupSegments, hatchLines, polylineLength,
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

test("rollupSegments is proportional, ordered, and leaves open islets as gaps", () => {
  const segs = rollupSegments({ mountainous: 0, settled: 2, sandbar: 1, reef: 1, open: 4 });
  expect(segs.map((s) => s.state)).toEqual(["settled", "sandbar", "reef"]);
  expect(segs[0].from).toBeCloseTo(-Math.PI / 2);
  expect(segs[0].to - segs[0].from).toBeCloseTo((2 / 8) * Math.PI * 2);
  expect(segs[2].to).toBeCloseTo(-Math.PI / 2 + (4 / 8) * Math.PI * 2);
  expect(rollupSegments({ open: 3 })).toEqual([]);
  expect(rollupSegments({})).toEqual([]);
});

test("hatchLines cover the box at the pitch, all at 45 degrees", () => {
  const lines = hatchLines(6);
  expect(lines.length).toBeGreaterThan(40);
  for (const l of lines) expect(l.x2 - l.x1).toBeCloseTo(l.y2 - l.y1);
  const spacing = (lines[1].y1 - lines[0].y1) / Math.SQRT2;
  expect(spacing).toBeCloseTo(6);
});
