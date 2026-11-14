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

test("closer steps in from the base it is given: home with the pane shut, not the smaller home beside it", () => {
  const cam = createCamera();
  const open = cam.framing(1000, 800, {}).scale; // what home would be with nothing over the map
  cam.fit(1000, 800, {});
  cam.snapHome(); // the reader is at home, the pane shut
  cam.fit(1000, 800, { right: 600 }); // the pane opens: home is now far smaller
  expect(cam.home.scale).toBeLessThan(open / 1.5);
  expect(cam.closer()).toBe(cam.state.scale); // a step in from the small home is no zoom at all
  expect(cam.closer(open)).toBeCloseTo(open * 1.5);
});

test("the zoom's limits run from half of home to six times it, and with the pane open are measured from home with it shut too", () => {
  const cam = createCamera();
  cam.fit(1000, 800);
  cam.snapHome();
  const home = cam.home.scale;
  cam.zoomAt(500, 400, 100);
  expect(cam.state.scale).toBeCloseTo(home * 6);
  cam.zoomAt(500, 400, 0.0001);
  expect(cam.state.scale).toBeCloseTo(home * 0.5);
  // the pane opens: home is far smaller, but the reader can still zoom in as far as before, and out past the small home
  cam.fit(1000, 800, { right: 700 });
  cam.zoomFrom(home);
  const small = cam.home.scale;
  expect(small).toBeLessThan(home * 0.5);
  cam.snapHome();
  cam.zoomAt(150, 400, 0.9); // a step out from the small home zooms out: it does not jump in to a limit above it
  expect(cam.state.scale).toBeCloseTo(small * 0.9);
  cam.zoomAt(150, 400, 100);
  expect(cam.state.scale).toBeCloseTo(home * 6);
  cam.zoomAt(150, 400, 0.0001);
  expect(cam.state.scale).toBeCloseTo(small * 0.5);
});

test("framing is what fit would make home, without making it home", () => {
  const cam = createCamera();
  const home = { ...cam.fit(1000, 800, { right: 400 }) };
  const other = cam.framing(1000, 800, { left: 200 }, { x0: 0, y0: 0, x1: 3000, y1: 500 });
  expect(cam.home).toEqual(home);
  expect(other).toEqual(createCamera().fit(1000, 800, { left: 200 }, { x0: 0, y0: 0, x1: 3000, y1: 500 }));
});

test("a glide with no time to take is there at once (reduced motion)", () => {
  const cam = createCamera();
  cam.fit(1000, 800);
  cam.snapHome();
  cam.animateTo({ x: 5, y: 6, scale: 2 }, 0);
  expect(cam.state).toEqual({ x: 5, y: 6, scale: 2 });
  expect(cam.tick(performance.now())).toBe(false); // nothing left to animate
  cam.animateTo(cam.home, 0);
  expect(cam.atHome()).toBe(true);
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

test("a camera gliding home is at home, even when home moves under it; one gliding elsewhere is not", () => {
  const cam = createCamera();
  cam.fit(1000, 800);
  cam.snapHome();
  cam.fit(1000, 800, {}, { x0: 0, y0: 0, x1: 3000, y1: 3000 });
  expect(cam.atHome()).toBe(false);
  cam.animateTo(cam.home, 100);
  expect(cam.atHome()).toBe(true);
  cam.fit(1000, 800, {}, { x0: 0, y0: 0, x1: 5000, y1: 5000 }); // home moves during the glide
  expect(cam.atHome()).toBe(true);
  cam.animateTo({ x: 1, y: 2, scale: 3 }, 100);
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
