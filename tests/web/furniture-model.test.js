import { test, expect } from "bun:test";
import { GRATICULE, GRATICULE_MIN_PX, ROSE_REACH, ROSE_NORTH, graticule, roseSpot, headerFade, positionSum, differs } from "../../src/web/furniture-model.js";

test("the graticule rules every 250 units while a square is large enough on screen", () => {
  const g = graticule({ x0: -100, y0: 40, x1: 1100, y1: 600 }, 0.6); // 150 px a square
  expect(g.step).toBe(GRATICULE);
  expect(g.fade).toBe(1);
  expect([...g.firm.xs, ...g.faint.xs].sort((a, b) => a - b)).toEqual([0, 250, 500, 750, 1000]);
  expect([...g.firm.ys, ...g.faint.ys].sort((a, b) => a - b)).toEqual([250, 500]);
  expect(g.firm.xs).toEqual([0, 500, 1000]); // every other line is the one the next doubling keeps
  expect(g.faint.xs).toEqual([250, 750]);
});

test("zoomed out, the graticule's pitch doubles so no square is smaller than its minimum, and the lines it will drop next thin away", () => {
  const view = { x0: 0, y0: 0, x1: 4000, y1: 2000 };
  for (const scale of [0.9, 0.3, 0.2, 0.1, 0.04, 0.011]) {
    const g = graticule(view, scale);
    expect(g.step * scale).toBeGreaterThanOrEqual(GRATICULE_MIN_PX);
    expect(Math.log2(g.step / GRATICULE) % 1).toBe(0);
    if (g.step > GRATICULE) expect(g.step * scale).toBeLessThan(GRATICULE_MIN_PX * 2); // and no larger than it need be
    expect(g.fade).toBeGreaterThanOrEqual(0);
    expect(g.fade).toBeLessThanOrEqual(1);
  }
  // just before the pitch doubles, the lines about to go are nearly gone: nothing pops
  const before = graticule(view, (GRATICULE_MIN_PX / GRATICULE) * 1.001);
  const after = graticule(view, (GRATICULE_MIN_PX / GRATICULE) * 0.999);
  expect(before.step).toBe(GRATICULE);
  expect(before.fade).toBeLessThan(0.01);
  expect(after.step).toBe(GRATICULE * 2);
  expect(after.fade).toBeGreaterThan(0.99);
  expect([...after.firm.xs, ...after.faint.xs].sort((a, b) => a - b)).toEqual(before.firm.xs); // the lines that stayed are the firm ones
});

const frame = { x0: 0, y0: 0, x1: 2000, y1: 1200 };

test("the rose stands in clear water, inside the frame, leaning to the lower right", () => {
  const spot = roseSpot({ frame, r: 60, discs: [{ x: 600, y: 500, r: 150 }] });
  expect(spot.r).toBe(60);
  expect(spot.x).toBeGreaterThan(1500);
  expect(spot.y).toBeGreaterThan(900);
  expect(spot.x + 60 * ROSE_REACH).toBeLessThanOrEqual(frame.x1);
  expect(spot.y + 60 * ROSE_REACH).toBeLessThanOrEqual(frame.y1);
  // with nothing on the map it takes the corner itself
  const alone = roseSpot({ frame, r: 60 });
  expect(alone.x).toBeCloseTo(frame.x1 - 60 * ROSE_REACH);
  expect(alone.y).toBeCloseTo(frame.y1 - 60 * ROSE_REACH);
});

test("the rose keeps off islands, names and controls, and room for its N at the top of the frame", () => {
  const corner = { x0: 1700, y0: 900, x1: 2000, y1: 1200 }; // the dock's corner
  const island = { x: 1500, y: 1000, r: 160 };
  const spot = roseSpot({ frame, r: 60, discs: [island], rects: [corner] });
  const reach = 60 * ROSE_REACH;
  expect(Math.hypot(spot.x - island.x, spot.y - island.y)).toBeGreaterThan(island.r + reach);
  expect(spot.x < corner.x0 - reach || spot.y < corner.y0 - reach).toBe(true);
  // everything but the top strip taken: it stands there, its north point and N still inside the frame
  const top = roseSpot({ frame, r: 60, rects: [{ x0: 0, y0: 320, x1: 2000, y1: 1200 }] });
  expect(top.y - 60 * ROSE_NORTH).toBeGreaterThanOrEqual(frame.y0);
});

test("a crowded map, or a frame too small for it, goes without a rose", () => {
  expect(roseSpot({ frame, r: 60, rects: [{ x0: -100, y0: -100, x1: 2100, y1: 1300 }] })).toBeNull();
  expect(roseSpot({ frame: { x0: 0, y0: 0, x1: 100, y1: 1200 }, r: 60 })).toBeNull();
  const discs = [];
  for (let x = 0; x <= 2000; x += 200) for (let y = 0; y <= 1200; y += 200) discs.push({ x, y, r: 90 });
  expect(roseSpot({ frame, r: 60, discs })).toBeNull();
});

test("a sea's name is whole below the header and gone once the header covers most of it", () => {
  expect(headerFade(100, 100, 40)).toBe(1);
  expect(headerFade(100, 260, 40)).toBe(1);
  const half = headerFade(100, 86, 40); // 14 px of 40 under the header
  expect(half).toBeGreaterThan(0);
  expect(half).toBeLessThan(1);
  expect(headerFade(100, 72, 40)).toBe(0);
  expect(headerFade(100, -500, 40)).toBe(0);
  expect(headerFade(100, 90, 0)).toBe(1);
});

test("positionSum changes when an island or a sea moves, or two swap places; an unplaced sea counts for nothing", () => {
  const nodes = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
  const seas = [{ x: 5, y: 6 }, { x: null, y: null }];
  const sum = positionSum(nodes, seas);
  expect(positionSum(nodes, seas)).toBe(sum);
  expect(positionSum([{ x: 10, y: 20.5 }, nodes[1]], seas)).not.toBe(sum);
  expect(positionSum([nodes[1], nodes[0]], seas)).not.toBe(sum);
  expect(positionSum(nodes, [{ x: 5.5, y: 6 }, seas[1]])).not.toBe(sum);
  expect(Number.isFinite(sum)).toBe(true);
  expect(positionSum([], [])).toBe(0);
});

test("differs compares two flat lists by identity", () => {
  const nodes = [];
  expect(differs(null, [1])).toBe(true);
  expect(differs([1, "a", nodes, null, undefined], [1, "a", nodes, null, undefined])).toBe(false);
  expect(differs([1, nodes], [1, []])).toBe(true); // another array with the same contents is another snapshot
  expect(differs([1], [1, 2])).toBe(true);
  expect(differs([NaN], [NaN])).toBe(false);
  expect(differs([0.5], [0.25])).toBe(true);
});
