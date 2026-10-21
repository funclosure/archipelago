import { test, expect } from "bun:test";
import { createCamera } from "../../src/web/camera.js";
import { WORLD } from "../../src/web/view-model.js";

test("fit centres the world in the area left of the inset", () => {
  const cam = createCamera();
  const full = cam.fit(1000, 800);
  expect(full.scale).toBeCloseTo((800 * 0.88) / WORLD);
  expect(full.x + (WORLD * full.scale) / 2).toBeCloseTo(500);
  const inset = cam.fit(1000, 800, { right: 400 });
  expect(inset.scale).toBeCloseTo((600 * 0.88) / WORLD);
  expect(inset.x + (WORLD * inset.scale) / 2).toBeCloseTo(300);
  expect(inset.y + (WORLD * inset.scale) / 2).toBeCloseTo(400);
});

test("centreOn lands the point at the area's centre at the given scale", () => {
  const cam = createCamera();
  cam.fit(1000, 800, { right: 400 });
  cam.snapHome();
  const f = cam.centreOn({ x: 640, y: 700 }, 1000, 800, { right: 400 });
  expect(f.scale).toBe(cam.state.scale);
  expect(640 * f.scale + f.x).toBeCloseTo(300);
  expect(700 * f.scale + f.y).toBeCloseTo(400);
  const g = cam.centreOn({ x: 640, y: 700 }, 1000, 800, { right: 400 }, 2);
  expect(g.scale).toBe(2);
  expect(640 * 2 + g.x).toBeCloseTo(300);
});

test("closer is 1.5× home unless the reader already zoomed further", () => {
  const cam = createCamera();
  cam.fit(1000, 800, { right: 400 });
  cam.snapHome();
  expect(cam.closer()).toBeCloseTo(cam.home.scale * 1.5);
  cam.zoomAt(0, 0, 4);
  expect(cam.closer()).toBe(cam.state.scale);
});

test("a left inset shifts the area the world is centred in", () => {
  const cam = createCamera();
  const both = cam.fit(1000, 800, { left: 232, right: 400 });
  expect(both.scale).toBeCloseTo((368 * 0.88) / WORLD);
  expect(both.x + (WORLD * both.scale) / 2).toBeCloseTo(232 + 368 / 2);
  cam.snapHome();
  const f = cam.centreOn({ x: 640, y: 700 }, 1000, 800, { left: 232, right: 400 });
  expect(640 * f.scale + f.x).toBeCloseTo(232 + 184);
  expect(700 * f.scale + f.y).toBeCloseTo(400);
});

test("top and bottom insets keep the world clear of the header and the bottom card", () => {
  const cam = createCamera();
  const h = cam.fit(1000, 800, { top: 100, bottom: 160 });
  expect(h.scale).toBeCloseTo((540 * 0.88) / WORLD);
  expect(h.y + (WORLD * h.scale) / 2).toBeCloseTo(100 + 270);
  expect(h.y).toBeGreaterThan(100);
  expect(h.y + WORLD * h.scale).toBeLessThan(800 - 160);
  const f = cam.centreOn({ x: 500, y: 500 }, 1000, 800, { top: 100, bottom: 160 }, 1);
  expect(500 + f.y).toBeCloseTo(370);
});

test("atHome holds until the reader pans", () => {
  const cam = createCamera();
  cam.fit(1000, 800);
  cam.snapHome();
  expect(cam.atHome()).toBe(true);
  cam.panBy(10, 0);
  expect(cam.atHome()).toBe(false);
});

test("home frames the islands, wherever they are, and never zooms closer than MAX_HOME", () => {
  const cam = createCamera();
  // islands spread far to the left of the old square: home takes them all in
  const far = cam.fit(1000, 800, {}, { x0: -2000, y0: 0, x1: 1000, y1: 1000 });
  expect(-2000 * far.scale + far.x).toBeGreaterThanOrEqual(0);
  expect(1000 * far.scale + far.x).toBeLessThanOrEqual(1000);
  expect((-2000 + 1000) / 2 * far.scale + far.x).toBeCloseTo(500); // centred
  // one small island: capped, not filling the screen
  const one = cam.fit(1000, 800, {}, { x0: 400, y0: 400, x1: 600, y1: 600 });
  expect(one.scale).toBeCloseTo(((800 * 0.88) / WORLD) * 1.4);
  expect(500 * one.scale + one.y).toBeCloseTo(400);
});
