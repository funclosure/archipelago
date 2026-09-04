import { test, expect } from "bun:test";
import { createCamera } from "../../src/web/camera.js";
import { WORLD } from "../../src/web/view-model.js";

test("fit centres the world in the area left of the inset", () => {
  const cam = createCamera();
  const full = cam.fit(1000, 800);
  expect(full.scale).toBeCloseTo((800 * 0.88) / WORLD);
  expect(full.x + (WORLD * full.scale) / 2).toBeCloseTo(500);
  const inset = cam.fit(1000, 800, 400);
  expect(inset.scale).toBeCloseTo((600 * 0.88) / WORLD);
  expect(inset.x + (WORLD * inset.scale) / 2).toBeCloseTo(300);
  expect(inset.y + (WORLD * inset.scale) / 2).toBeCloseTo(400);
});

test("centreOn lands the point at the area's centre at the given scale", () => {
  const cam = createCamera();
  cam.fit(1000, 800, 400);
  cam.snapHome();
  const f = cam.centreOn({ x: 640, y: 700 }, 1000, 800, 400);
  expect(f.scale).toBe(cam.state.scale);
  expect(640 * f.scale + f.x).toBeCloseTo(300);
  expect(700 * f.scale + f.y).toBeCloseTo(400);
  const g = cam.centreOn({ x: 640, y: 700 }, 1000, 800, 400, 2);
  expect(g.scale).toBe(2);
  expect(640 * 2 + g.x).toBeCloseTo(300);
});

test("closer is 1.5× home unless the reader already zoomed further", () => {
  const cam = createCamera();
  cam.fit(1000, 800, 400);
  cam.snapHome();
  expect(cam.closer()).toBeCloseTo(cam.home.scale * 1.5);
  cam.zoomAt(0, 0, 4);
  expect(cam.closer()).toBe(cam.state.scale);
});
