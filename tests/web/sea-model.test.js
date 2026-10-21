import { test, expect } from "bun:test";
import { seaMembers, lettering, letteringBox, stippleDots, REACH, SEA_FONT, TRACK_MIN, TRACK_MAX } from "../../src/web/sea-model.js";

const R = 62;
const node = (slug, x, y) => ({ slug, x, y, radius: R });
const measure = () => 20; // every capital 20 units wide

test("each island goes to its nearest sea within reach; two seas never share one", () => {
  const nodes = [node("a", 0, 0), node("b", 400, 0), node("c", 4000, 0)];
  const seas = [{ id: 1, x: 100, y: 0 }, { id: 2, x: 350, y: 0 }];
  const m = seaMembers(seas, nodes);
  expect(m.get(1).map((n) => n.slug)).toEqual(["a"]);
  expect(m.get(2).map((n) => n.slug)).toEqual(["b"]); // c is beyond REACH radii of both
  expect(REACH * R).toBeLessThan(4000);
});

test("lettering is upright capitals, tracked to spread across the sea and kept within bounds", () => {
  const font = SEA_FONT * R;
  const wide = lettering("On screen", [node("a", 0, 0), node("b", 1200, 0)], R, measure);
  expect(wide.text).toBe("ON SCREEN");
  expect(wide.track).toBe(font * TRACK_MAX); // a wide sea hits the upper bound
  const none = lettering("Alone", [], R, measure);
  expect(none.track).toBe(font * TRACK_MIN); // no islands: the tightest spacing
  const mid = lettering("Sea", [node("a", 0, 0), node("b", 120, 0)], R, measure);
  expect(mid.track).toBeGreaterThan(font * TRACK_MIN);
  expect(mid.total).toBeCloseTo(3 * 20 + 2 * mid.track);
  const box = letteringBox({ x: 10, y: 20 }, mid);
  expect(box.x0).toBeLessThan(10 - mid.total / 2);
  expect(box.x1).toBeGreaterThan(10 + mid.total / 2);
});

test("stippled water surrounds the sea's islands, never on land, the same every time", () => {
  const members = [node("a", 0, 0), node("b", 200, 0)];
  const all = [...members, node("x", 100, 0)];
  const dots = stippleDots({ id: 7 }, members, all, R);
  expect(dots.length).toBeGreaterThan(50);
  for (const [x, y, a] of dots) {
    for (const n of all) expect(Math.hypot(x - n.x, y - n.y)).toBeGreaterThanOrEqual(n.radius * 1.25);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(1);
  }
  expect(stippleDots({ id: 7 }, members, all, R)).toEqual(dots);
  expect(stippleDots({ id: 8 }, [], all, R)).toEqual([]);
});
