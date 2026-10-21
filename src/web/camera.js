// Pan/zoom camera over the 1000-unit world. World → screen is (x * scale + cam.x).
// `fit` computes the home framing for a viewport; pan and wheel adjust the camera on top of it.

import { WORLD } from "./view-model.js";

const MARGIN = 0.06; // of the shorter viewport side, each edge
/** Home never zooms closer than this × the scale that fits a whole 1000-unit scale: two islands stay island-sized. */
const MAX_HOME = 1.4;
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
    /**
     * Home: the framing that fits `bounds` (the islands, in world units; a fresh 1000-unit scale when there are
     * none) into the area between the insets, centred, with a margin, and never closer than MAX_HOME. The insets
     * are what covers the map: the outline (left), the pane (right), the header (top), the bottom card (bottom).
     */
    fit(w, h, { left = 0, right = 0, top = 0, bottom = 0 } = {}, bounds = null) {
      const b = bounds ?? { x0: 0, y0: 0, x1: WORLD, y1: WORLD };
      const aw = Math.max(1, w - left - right);
      const ah = Math.max(1, h - top - bottom);
      const bw = Math.max(1, b.x1 - b.x0);
      const bh = Math.max(1, b.y1 - b.y0);
      const cap = ((Math.min(aw, ah) * (1 - 2 * MARGIN)) / WORLD) * MAX_HOME;
      const scale = Math.min(cap, Math.min(aw / bw, ah / bh) * (1 - 2 * MARGIN));
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      home = { x: left + aw / 2 - cx * scale, y: top + ah / 2 - cy * scale, scale };
      return home;
    },
    /** The framing at `scale` that puts a world point at the centre of the area between the insets. */
    centreOn(point, w, h, { left = 0, right = 0, top = 0, bottom = 0 } = {}, scale = cam.scale) {
      const aw = Math.max(1, w - left - right);
      const ah = Math.max(1, h - top - bottom);
      return { x: left + aw / 2 - point.x * scale, y: top + ah / 2 - point.y * scale, scale };
    },
    /** True while the camera sits where `fit` last put it (the reader has not panned or zoomed since). */
    atHome() {
      return !anim && Math.abs(cam.x - home.x) < 0.5 && Math.abs(cam.y - home.y) < 0.5 && Math.abs(cam.scale - home.scale) < 1e-6;
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
