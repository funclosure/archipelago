// Pan/zoom camera over the 1000-unit world. World → screen is (x * scale + cam.x).
// `fit` computes the home framing for a viewport; pan and wheel adjust the camera on top of it.

import { WORLD } from "./view-model.js";

const MARGIN = 0.12; // of the shorter viewport side, each edge

export function createCamera() {
  const cam = { x: 0, y: 0, scale: 1 };
  let home = { x: 0, y: 0, scale: 1 };
  let anim = null;

  return {
    state: cam,
    get home() {
      return home;
    },
    /** The framing that fits the whole world into a w × h viewport, centred, with a margin. */
    fit(w, h) {
      const scale = (Math.min(w, h) * (1 - 2 * MARGIN)) / WORLD;
      home = { x: (w - WORLD * scale) / 2, y: (h - WORLD * scale) / 2, scale };
      return home;
    },
    snapHome() {
      Object.assign(cam, home);
      anim = null;
    },
    apply(ctx, dpr) {
      ctx.setTransform(cam.scale * dpr, 0, 0, cam.scale * dpr, cam.x * dpr, cam.y * dpr);
    },
    toWorld(px, py) {
      return { x: (px - cam.x) / cam.scale, y: (py - cam.y) / cam.scale };
    },
    panBy(dx, dy) {
      cam.x += dx;
      cam.y += dy;
      anim = null;
    },
    zoomAt(px, py, factor) {
      const next = Math.min(home.scale * 6, Math.max(home.scale * 0.5, cam.scale * factor));
      const k = next / cam.scale;
      cam.x = px - (px - cam.x) * k;
      cam.y = py - (py - cam.y) * k;
      cam.scale = next;
      anim = null;
    },
    animateTo(target, ms = 500) {
      anim = { from: { ...cam }, to: target, start: performance.now(), ms };
    },
    tick(now) {
      if (!anim) return false;
      const t = Math.min(1, (now - anim.start) / anim.ms);
      const e = 1 - Math.pow(1 - t, 3);
      cam.x = anim.from.x + (anim.to.x - anim.from.x) * e;
      cam.y = anim.from.y + (anim.to.y - anim.from.y) * e;
      cam.scale = anim.from.scale + (anim.to.scale - anim.from.scale) * e;
      if (t >= 1) anim = null;
      return true;
    },
  };
}
