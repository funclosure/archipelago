// Pan/zoom camera over the 1000-unit world. World → screen is (x * scale + cam.x).
// `fit` computes the home framing for a viewport; pan and wheel adjust the camera on top of it.

import { WORLD } from "./view-model.js";

const MARGIN = 0.06; // of the shorter viewport side, each edge
/** Home never zooms closer than this × the scale that fits a whole 1000-unit scale: two islands stay island-sized. */
const MAX_HOME = 1.4;
const SELECT_ZOOM = 1.5; // × home's scale (with the pane shut) when an island is selected
/** How far the reader can zoom: out to half of home, in to six times it. */
const ZOOM_OUT = 0.5;
const ZOOM_IN = 6;

/**
 * Where one axis of the map stands at a scale too close for the whole of it (`lo`..`hi`, world units) to fit the
 * room (`start`..`start + room`, screen px): `at` (a world coordinate) at the middle of the room, but never so far
 * that open water beyond the islands' own edge takes the screen, so each edge stops at the margin `m`. Islands
 * that do fit this way are centred as ever.
 */
function along(lo, hi, at, scale, start, room, m) {
  if ((hi - lo) * scale <= room - 2 * m) return start + room / 2 - ((lo + hi) / 2) * scale;
  const near = start + m - lo * scale; // the islands' near edge at the margin
  const far = start + room - m - hi * scale; // their far edge at the margin
  return Math.min(near, Math.max(far, start + room / 2 - at * scale));
}

/** The scale at which `bounds` (a fresh 1000-unit scale without them) fit the area between the insets, with the margin, never closer than MAX_HOME. */
function fitted(w, h, { left = 0, right = 0, top = 0, bottom = 0 } = {}, bounds = null) {
  const b = bounds ?? { x0: 0, y0: 0, x1: WORLD, y1: WORLD };
  const aw = Math.max(1, w - left - right);
  const ah = Math.max(1, h - top - bottom);
  const bw = Math.max(1, b.x1 - b.x0);
  const bh = Math.max(1, b.y1 - b.y0);
  const cap = ((Math.min(aw, ah) * (1 - 2 * MARGIN)) / WORLD) * MAX_HOME;
  return Math.min(cap, Math.min(aw / bw, ah / bh) * (1 - 2 * MARGIN));
}

export function createCamera() {
  const cam = { x: 0, y: 0, scale: 1 };
  let home = { x: 0, y: 0, scale: 1 };
  let whole = null; // the scale at which everything fits home's area: home's own, unless home is nearer than that (`fit`'s `near`)
  let zoomBase = null; // see `zoomFrom`
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
     * `near` keeps home legible on a small screen: see `framing`.
     */
    fit(w, h, insets = {}, bounds = null, near = {}) {
      home = this.framing(w, h, insets, bounds, near);
      whole = fitted(w, h, insets, bounds);
      return home;
    },
    /**
     * The framing `fit` would make home, without making it home: what the map would be framed as under other insets.
     * `near` is for a screen too small to show everything legibly (a phone): `{ minScale, focus }`. Where fitting
     * it all would be further out than `minScale`, home is at `minScale` instead and shows a part of the map, the
     * part round `focus` (a world point; the islands' middle without one), and the reader pans to the rest.
     * Without `near`, or where everything fits at `minScale` or closer, the framing is exactly the fitted one.
     */
    framing(w, h, { left = 0, right = 0, top = 0, bottom = 0 } = {}, bounds = null, { minScale = 0, focus = null } = {}) {
      const b = bounds ?? { x0: 0, y0: 0, x1: WORLD, y1: WORLD };
      const aw = Math.max(1, w - left - right);
      const ah = Math.max(1, h - top - bottom);
      const fit = fitted(w, h, { left, right, top, bottom }, bounds);
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      if (!(minScale > fit)) return { x: left + aw / 2 - cx * fit, y: top + ah / 2 - cy * fit, scale: fit };
      const m = Math.min(aw, ah) * MARGIN;
      return { x: along(b.x0, b.x1, focus?.x ?? cx, minScale, left, aw, m), y: along(b.y0, b.y1, focus?.y ?? cy, minScale, top, ah, m), scale: minScale };
    },
    /** The framing at `scale` that puts a world point at the centre of the area between the insets. */
    centreOn(point, w, h, { left = 0, right = 0, top = 0, bottom = 0 } = {}, scale = cam.scale) {
      const aw = Math.max(1, w - left - right);
      const ah = Math.max(1, h - top - bottom);
      return { x: left + aw / 2 - point.x * scale, y: top + ah / 2 - point.y * scale, scale };
    },
    /**
     * True while the camera sits where `fit` last put it (the reader has not panned or zoomed since), or is on its
     * way there: a home that moves during that glide (the strip wraps, new islands settle) is still followed.
     */
    atHome() {
      if (anim) return anim.home;
      return Math.abs(cam.x - home.x) < 0.5 && Math.abs(cam.y - home.y) < 0.5 && Math.abs(cam.scale - home.scale) < 1e-6;
    },
    /**
     * The select zoom: a step in from `base` (home's scale; the caller passes home as it is with the pane shut,
     * since home beside an open pane is much smaller), unless the reader is already closer.
     */
    closer(base = home.scale) {
      return Math.max(cam.scale, base * SELECT_ZOOM);
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
    /**
     * The scale the zoom's limits are measured from, beside home's own: home as it is with the pane shut. Home
     * beside an open pane is far smaller, and limits taken from it alone would stop the reader a step past the
     * selection's own framing.
     */
    zoomFrom(scale) {
      zoomBase = scale;
    },
    zoomAt(px, py, factor) {
      // out to half of home, and where home shows only a part of the map (a phone), always far enough to see it whole
      const far = Math.min(Math.min(home.scale, zoomBase ?? home.scale) * ZOOM_OUT, whole ?? Infinity);
      const near = Math.max(home.scale, zoomBase ?? home.scale) * ZOOM_IN;
      const next = Math.min(near, Math.max(far, cam.scale * factor));
      const k = next / cam.scale;
      cam.x = px - (px - cam.x) * k;
      cam.y = py - (py - cam.y) * k;
      cam.scale = next;
      anim = null;
    },
    /** Glides to `target` over `ms`; with no time to take (reduced motion), it is there at once. */
    animateTo(target, ms = 500) {
      if (ms <= 0) {
        Object.assign(cam, target);
        anim = null;
        return;
      }
      anim = { from: { ...cam }, to: target, start: performance.now(), ms, home: target === home };
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
