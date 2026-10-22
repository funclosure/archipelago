// Touch on the map, pure: what a long-press does, how far a finger may wander before a press is a drag, and how
// two fingers pan and zoom. Phones have no double-click and no shift key, so a long-press stands in for both.

/** How long a finger rests before the press counts as a long-press. */
export const LONG_PRESS_MS = 500;

/** px of travel before a press is a drag: a mouse is precise, a finger is not. */
export const slopFor = (pointerType) => (pointerType === "mouse" ? 4 : 10);

/**
 * What a long-press does, acted on when the finger lifts (a keyboard only opens from a touch the reader ends):
 * on an island it gathers it into the group, or lets it out ("gather", like shift-click); on a sea's name it
 * renames it ("rename", like double-click); on open water it names a sea there ("name").
 */
export function pressAction({ island = null, sea = null }) {
  if (island) return "gather";
  if (sea) return "rename";
  return "name";
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * One step of a two-finger pinch, from the fingers' last points (`a0`, `b0`) to their new ones (`a1`, `b1`), in
 * screen px: zoom by `factor` about `at` (the new midpoint), then pan by `dx`, `dy` (how far the midpoint moved).
 */
export function pinchStep(a0, b0, a1, b1) {
  const before = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
  const after = Math.hypot(b1.x - a1.x, b1.y - a1.y) || 1;
  const m0 = mid(a0, b0);
  const m1 = mid(a1, b1);
  return { at: m1, factor: after / before, dx: m1.x - m0.x, dy: m1.y - m0.y };
}
