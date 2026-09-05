// Pan/zoom camera over the 1000-unit world. World → screen is (x * scale + cam.x).
// `fit` computes the home framing for a viewport; pan and wheel adjust the camera on top of it.

import { WORLD } from "./view-model.js";

const MARGIN = 0.06; // of the shorter viewport side, each edge
const SELECT_ZOOM = 1.5; // × home scale when an island is selected

export function createCamera() {
  const cam = { x: 0, y: 0, scale: 1 };
  let home = { x: 0, y: 0, scale: 1 };
  let anim = null;

  return {
    state: cam,
    get home() {
      return home;
    },
    /** The framing that fits the whole world into the area between the insets, centred, with a margin. */
    fit(w, h, { left = 0, right = 0 } = {}) {
      const aw = Math.max(1, w - left - right);
      const scale = (Math.min(aw, h) * (1 - 2 * MARGIN)) / WORLD;
      home = { x: left + (aw - WORLD * scale) / 2, y: (h - WORLD * scale) / 2, scale };
      return home;
    },
    /** The framing at `scale` that puts a world point at the centre of the area between the insets. */
    centreOn(point, w, h, { left = 0, right = 0 } = {}, scale = cam.scale) {
      const aw = Math.max(1, w - left - right);
      return { x: left + aw / 2 - point.x * scale, y: h / 2 - point.y * scale, scale };
    },
    /** The select zoom: a step in from home, unless the reader is already closer. */
    closer() {
      return Math.max(cam.scale, home.scale * SELECT_ZOOM);
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
