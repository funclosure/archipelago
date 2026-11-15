// What the map builds once and draws many times. draw.js keeps no state of its own: the paths of an island's
// engraving (per seed, in box units, so they hold at every zoom) and the few sprites a soft mark needs (a lamp's
// glow, the sheet's vignette) live here, keyed by everything they are drawn from. A theme change clears the
// sprites, since every one of them holds a colour; a path holds none.

const paths = new Map();
const PATHS_MAX = 4000;

/** The Path2D for `key`, built by `build(path)` the first time it is asked for. */
export function cachedPath(key, build) {
  let p = paths.get(key);
  if (!p) {
    if (paths.size >= PATHS_MAX) paths.clear(); // a long session across many domains: start over rather than grow
    p = new Path2D();
    build(p);
    paths.set(key, p);
  }
  return p;
}

const sprites = new Map();
const slots = new Map(); // slot → the one key it holds now

/**
 * The offscreen canvas for `key`, `width` × `height` px, painted by `paint(ctx, canvas)` the first time. With a
 * `slot`, the sprite takes the place of whatever that slot held (a sprite that depends on the window's size would
 * otherwise leave one behind for every size it has been).
 */
export function cachedSprite(key, width, height, paint, slot = null) {
  let c = sprites.get(key);
  if (c) return c;
  if (slot !== null) {
    sprites.delete(slots.get(slot));
    slots.set(slot, key);
  }
  c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(width));
  c.height = Math.max(1, Math.ceil(height));
  paint(c.getContext("2d"), c);
  sprites.set(key, c);
  return c;
}

/** Every sprite holds the palette's colours: a new palette starts them over. */
export function clearSprites() {
  sprites.clear();
  slots.clear();
}
