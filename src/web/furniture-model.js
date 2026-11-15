// The chart's furniture and the frame loop's bookkeeping, pure: where the graticule's lines fall, where the compass
// rose can stand in open water, how a sea's name fades as it slides under the header, and the number that tells
// whether anything on the map has moved since the last frame.

/** The graticule's finest pitch, in world units: four squares across a fresh 1000-unit scale. */
export const GRATICULE = 250;
/** A square of the graticule is never smaller than this on screen: zoomed out, the pitch doubles. */
export const GRATICULE_MIN_PX = 64;

/**
 * The graticule across a world rect at `scale` (px per world unit): `{ step, firm: { xs, ys }, faint: { xs, ys },
 * fade }`. The pitch is GRATICULE, doubled until a square is at least GRATICULE_MIN_PX on screen, so a map zoomed
 * far out is not ruled like graph paper. The lines that the next doubling would drop are `faint`, drawn at `fade`
 * (0..1) of the firm ones' strength: they thin away as the map zooms out, and never pop.
 */
export function graticule(view, scale) {
  const doublings = Math.max(0, Math.ceil(Math.log2(GRATICULE_MIN_PX / (GRATICULE * scale))));
  const step = GRATICULE * 2 ** doublings;
  const fade = Math.max(0, Math.min(1, (step * scale) / GRATICULE_MIN_PX - 1));
  const firm = { xs: [], ys: [] };
  const faint = { xs: [], ys: [] };
  const sort = (from, to, into) => {
    for (let i = Math.ceil(from / step); i * step <= to; i++) (i % 2 === 0 ? firm : faint)[into].push(i * step || 0); // never -0
  };
  sort(view.x0, view.x1, "xs");
  sort(view.y0, view.y1, "ys");
  return { step, firm, faint, fade };
}

/** How much room the rose takes around its centre, in rose radii: its long points, and to the north the N over them. */
export const ROSE_REACH = 1.3;
export const ROSE_NORTH = 1.65;

function rectGap(r, x, y) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dy = Math.max(r.y0 - y, 0, y - r.y1);
  return Math.hypot(dx, dy);
}

/**
 * Where the compass rose stands: in the clearest water of `frame` (the world rect home shows), away from every
 * disc (`{ x, y, r }`: an island with its lamps) and every rect (a name, a sea's lettering, a control that covers
 * the map), leaning toward the lower right as on a printed chart. `r` is the rose's radius. Returns `{ x, y, r }`,
 * or null when no spot is clear: a crowded map goes without.
 */
export function roseSpot({ frame, r, discs = [], rects = [] }) {
  const reach = r * ROSE_REACH;
  const x0 = frame.x0 + reach;
  const y0 = frame.y0 + r * ROSE_NORTH;
  const w = frame.x1 - reach - x0;
  const h = frame.y1 - reach - y0;
  if (w < 0 || h < 0) return null;
  const NX = 16;
  const NY = 12;
  let best = null;
  let bestScore = -Infinity;
  for (let j = 0; j <= NY; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = x0 + (w * i) / NX;
      const y = y0 + (h * j) / NY;
      let clear = Infinity;
      for (const d of discs) clear = Math.min(clear, Math.hypot(d.x - x, d.y - y) - d.r);
      for (const b of rects) clear = Math.min(clear, rectGap(b, x, y));
      clear -= reach;
      if (clear < reach * 0.3) continue; // touching something, or crowding it
      // Once it stands well clear, more water adds nothing; then the corner decides.
      const score = Math.min(clear, reach) + reach * 0.55 * (i / NX + j / NY);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y, r };
      }
    }
  }
  return best;
}

/**
 * How strongly a sea's name is drawn as it nears the header: 1 while its top is below the header's foot, falling
 * to 0 once the header covers most of it, so no lettering runs behind the header's words. All in screen px.
 */
export function headerFade(headerFoot, top, height) {
  if (top >= headerFoot || height <= 0) return 1;
  return Math.max(0, 1 - (headerFoot - top) / (height * 0.7));
}

/**
 * One number for where everything is: it changes when any island or sea moves (a drag changes positions in place,
 * so the arrays' identity does not). Each term is weighted by its place in the list, so two that swap still count.
 */
export function positionSum(nodes, seas) {
  let sum = 0;
  for (let i = 0; i < nodes.length; i++) sum += nodes[i].x * (i + 1.5) + nodes[i].y * (i * 2 + 3.25);
  for (let i = 0; i < seas.length; i++) if (seas[i].x !== null && seas[i].x !== undefined) sum += seas[i].x * (i + 7.5) + seas[i].y * (i * 2 + 11.25);
  return sum;
}

/** True when two flat lists of values differ (the frame loop's "has anything changed" test). */
export function differs(a, b) {
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return true;
  return false;
}
