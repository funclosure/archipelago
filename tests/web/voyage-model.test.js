import { test, expect } from "bun:test";
import {
  voyageRoute, pointAt, wakeTo, offshorePoint, sailMs, voyageAt, voyageBounds, fitScale, cameraAt,
  SHORE, CLEAR, OFFSHORE, SAIL_MS, CAMERA_LAG, HOLD_MS, FADE_MS, WAKE_MS,
} from "../../src/web/voyage-model.js";

const R = 40;
const isle = (x, y, r = R) => ({ x, y, r });
const dist = (p, q) => Math.hypot(p[0] - q.x, p[1] - q.y);
/** The least room a route leaves round each island (past its CLEAR reach). */
const room = (route, others) => Math.min(...others.flatMap((o) => route.pts.map((p) => dist(p, o) - o.r * CLEAR)));

test("a route leaves one shore and lands on the other", () => {
  const from = isle(0, 0);
  const to = isle(400, 0);
  const route = voyageRoute(from, to);
  expect(dist(route.pts[0], from)).toBeCloseTo(R * SHORE);
  expect(dist(route.pts.at(-1), to)).toBeCloseTo(R * SHORE);
  expect(route.dir).toBe(1);
  expect(route.total).toBeCloseTo(route.len.at(-1));
  expect(voyageRoute(to, from).dir).toBe(-1);
});

test("with open water between, the route is a shallow curve on the side asked for", () => {
  const route = voyageRoute(isle(0, 0), isle(400, 0), [], 1);
  const mid = pointAt(route, route.total / 2);
  expect(mid.y).toBeGreaterThan(0); // bowed toward +y for side 1 (the normal of a rightward crossing)
  expect(mid.y).toBeLessThan(400 * 0.1);
  expect(pointAt(voyageRoute(isle(0, 0), isle(400, 0), [], -1), route.total / 2).y).toBeLessThan(0);
});

test("a route bows round an island in its way, to whichever side is clear", () => {
  const from = isle(0, 0);
  const to = isle(500, 0);
  const rock = isle(250, 0);
  const route = voyageRoute(from, to, [rock], 1);
  expect(room(route, [rock])).toBeGreaterThanOrEqual(0);
  // with the near side blocked as well, it goes round the other way
  const walled = [rock, isle(250, 110)];
  const round = voyageRoute(from, to, walled, 1);
  expect(room(round, walled)).toBeGreaterThanOrEqual(0);
  expect(pointAt(round, round.total / 2).y).toBeLessThan(0);
});

test("when nothing clears every island, the route keeps furthest from them", () => {
  const others = [isle(250, 0, 200)]; // one island larger than any bow can pass
  const route = voyageRoute(isle(0, 0), isle(500, 0), others);
  expect(room(route, others)).toBeLessThan(0);
  expect(route.pts.length).toBeGreaterThan(2);
});

test("from open sea (radius 0) the route starts at the point itself", () => {
  const route = voyageRoute({ x: -300, y: 0, r: 0 }, isle(0, 0));
  expect(route.pts[0][0]).toBeCloseTo(-300);
  expect(route.pts[0][1]).toBeCloseTo(0);
});

test("pointAt walks the route by length and stays on it at either end", () => {
  const route = voyageRoute(isle(0, 0), isle(400, 0));
  expect(pointAt(route, -10)).toEqual({ x: route.pts[0][0], y: route.pts[0][1] });
  const end = pointAt(route, route.total + 10);
  expect(end.x).toBeCloseTo(route.pts.at(-1)[0]);
  const half = pointAt(route, route.total / 2);
  expect(half.x).toBeGreaterThan(150);
  expect(half.x).toBeLessThan(250);
});

test("the wake runs from the start to exactly where it is asked to end", () => {
  const route = voyageRoute(isle(0, 0), isle(400, 0));
  const wake = wakeTo(route, route.total / 3);
  expect(wake[0]).toEqual(route.pts[0]);
  const at = pointAt(route, route.total / 3);
  expect(wake.at(-1)[0]).toBeCloseTo(at.x);
  expect(wake.at(-1)[1]).toBeCloseTo(at.y);
  expect(wakeTo(route, 0).length).toBe(1);
});

test("open sea lies outside the archipelago, clear of every island", () => {
  const islands = [isle(0, 0), isle(200, 0), isle(100, 150)];
  const to = islands[1];
  const p = offshorePoint(to, islands);
  expect(Math.hypot(p.x - to.x, p.y - to.y)).toBeCloseTo(R * OFFSHORE);
  expect(p.x).toBeGreaterThan(to.x); // away from the middle, which lies to its left
  for (const o of islands.filter((o) => o !== to)) expect(Math.hypot(p.x - o.x, p.y - o.y)).toBeGreaterThanOrEqual(o.r * CLEAR);
  // a lone island: from the lower left
  const lone = offshorePoint(isle(0, 0), [isle(0, 0)]);
  expect(lone.x).toBeLessThan(0);
  expect(lone.y).toBeGreaterThan(0);
});

test("the crossing takes longer the further it goes, within limits", () => {
  expect(sailMs(0)).toBe(SAIL_MS.min);
  expect(sailMs(100_000)).toBe(SAIL_MS.max);
  expect(sailMs(800)).toBeGreaterThan(sailMs(400));
});

test("a voyage launches, sails, rests, fades, and ends", () => {
  const v = { start: 1000, ms: 1000 };
  const at = (t) => voyageAt(v, 1000 + t);
  expect(at(0)).toMatchObject({ boat: 0, camera: 0, boatAlpha: 0, wakeAlpha: 1, done: false });
  expect(at(-50).boat).toBe(0); // a frame stamped before the start
  expect(at(CAMERA_LAG).camera).toBe(0); // the camera waits to see the boat leave
  expect(at(500).boat).toBeCloseTo(0.5);
  expect(at(500).boatAlpha).toBe(1);
  expect(at(1000).boat).toBe(1);
  expect(at(1000 + HOLD_MS).boatAlpha).toBe(1);
  expect(at(1000 + HOLD_MS + FADE_MS).boatAlpha).toBe(0);
  expect(at(1000 + WAKE_MS / 2).wakeAlpha).toBeCloseTo(0.5);
  expect(at(1000 + CAMERA_LAG).camera).toBe(1);
  expect(at(1000 + Math.max(HOLD_MS + FADE_MS, WAKE_MS)).done).toBe(true);
});

test("the camera draws back at the middle only when the route would not fit", () => {
  const path = { f0: { x: 0, y: 0 }, s0: 2, f1: { x: 400, y: 0 }, s1: 2, fit: 1 };
  expect(cameraAt(0, path)).toEqual({ focus: { x: 0, y: 0 }, scale: 2 });
  expect(cameraAt(1, path).scale).toBeCloseTo(2);
  expect(cameraAt(1, path).focus).toEqual({ x: 400, y: 0 });
  expect(cameraAt(0.5, path).scale).toBeCloseTo(1);
  expect(cameraAt(0.5, path).focus).toEqual({ x: 200, y: 0 });
  expect(cameraAt(0.5, { ...path, fit: 3 }).scale).toBeCloseTo(2); // it fits: no zoom out
  expect(cameraAt(0.5, { ...path, s0: 1, s1: 4, fit: 9 }).scale).toBeCloseTo(2); // the scale changes evenly in proportion
});

test("the camera's bounds hold the route and both islands' lamps, and fit the area", () => {
  const from = isle(0, 0);
  const to = isle(400, 0);
  const b = voyageBounds(voyageRoute(from, to), from, to);
  expect(b.x0).toBeCloseTo(-R * CLEAR);
  expect(b.x1).toBeCloseTo(400 + R * CLEAR);
  const s = fitScale(b, 1000, 800);
  expect((b.x1 - b.x0) * s).toBeLessThan(1000);
  expect((b.x1 - b.x0) * s).toBeGreaterThan(700);
});

test("a route keeps clear of the names on the map as well as the islands", () => {
  const name = { x0: 200, y0: -40, x1: 300, y1: 40 }; // lettering straddling the straight line
  const route = voyageRoute(isle(0, 0), isle(500, 0), [name], 1);
  for (const [x, y] of route.pts) expect(x > name.x0 && x < name.x1 && y > name.y0 && y < name.y1).toBe(false);
  const p = offshorePoint(isle(0, 0), [isle(0, 0)], [{ x0: -200, y0: 0, x1: 0, y1: 200 }]); // the lower left is lettered
  expect(p.x > -200 && p.x < 0 && p.y > 0 && p.y < 200).toBe(false);
});
