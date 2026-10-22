// Seas, pure: which islands each sea holds, how its name is lettered, and where its stippled water goes.
// The page draws from these (draw.js); src/core/seas.ts applies the same membership rule for the cartographer.

/** An island belongs to its nearest sea within this many island radii of the sea's name; else to none. */
export const REACH = 7.5;
/** Sea lettering, in world units per island radius: the cap height, and the tracking bounds in ems. */
export const SEA_FONT = 0.48;
export const TRACK_MIN = 0.3;
export const TRACK_MAX = 1.4;

/**
 * Each sea's islands: every island goes to the nearest sea name within REACH radii, so two seas never claim the
 * same water. `nodes` carry slug, x, y, radius. Returns a Map sea id → nodes.
 */
export function seaMembers(allSeas, nodes) {
  const out = new Map(allSeas.map((s) => [s.id, []]));
  const seas = allSeas.filter((s) => s.x !== null && s.x !== undefined); // a suggested sea not placed yet claims no water
  for (const n of nodes) {
    let best = null;
    let bestD = REACH * n.radius;
    for (const s of seas) {
      const d = Math.hypot(n.x - s.x, n.y - s.y);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    if (best) out.get(best.id).push(n);
  }
  return out;
}

/**
 * How a sea's name is set: upright capitals, tracked so the name spreads across about two thirds of the water its
 * islands cover, as OCEANO ORIENTALE spreads across an ocean. `measure(ch)` is a character's width at `font`.
 * Returns { text, font, widths, track, total } in world units.
 */
export function lettering(name, members, radius, measure) {
  const text = name.toUpperCase();
  const font = SEA_FONT * radius;
  const chars = [...text];
  const widths = chars.map(measure);
  const ink = widths.reduce((a, b) => a + b, 0);
  const span = members.length ? Math.max(...members.map((m) => m.x)) - Math.min(...members.map((m) => m.x)) + 2 * radius : 0;
  const gaps = Math.max(1, chars.length - 1);
  const track = Math.min(font * TRACK_MAX, Math.max(font * TRACK_MIN, (span * 0.66 - ink) / gaps));
  return { text, font, widths, track, total: ink + track * (chars.length - 1) };
}

/**
 * Where a suggested sea's name goes: the clearest water near the islands it groups. Candidates lie on a grid over
 * the group's box (a radius beyond it sideways, two and a half above and below); each scores how clear the name's
 * box would be of every coast and every island's name (under the coast), less a pull toward the group's centre. `members` and `others` carry x, y;
 * `halfWidth` is half the lettered name's width (`lettering(...).total / 2`). Returns { x, y }.
 */
export function seaSpot(members, others, radius, halfWidth = radius * 2) {
  const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
  const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
  const xs = members.map((m) => m.x);
  const ys = members.map((m) => m.y);
  const x0 = Math.min(...xs) - radius;
  const x1 = Math.max(...xs) + radius;
  const y0 = Math.min(...ys) - radius * 2.5; // a name above or below a row of islands sits more than a radius off
  const y1 = Math.max(...ys) + radius * 2.5;
  // each mark: a point and how far around it is already ink (the coast's radius; half a wrapped island name's width)
  const marks = others.flatMap((n) => [{ x: n.x, y: n.y, r: radius }, { x: n.x, y: n.y + radius * 1.55, r: radius * 1.2 }]);
  const font = SEA_FONT * radius;
  const clearance = (x, y) =>
    Math.min(
      ...marks.map((m) => {
        const dx = Math.max(0, Math.abs(m.x - x) - halfWidth);
        const dy = Math.max(0, m.y < y - font ? y - font - m.y : m.y > y + font * 0.6 ? m.y - y - font * 0.6 : 0);
        return Math.hypot(dx, dy) - m.r;
      }),
    );
  const STEPS = 12;
  let best = { x: cx, y: cy };
  let bestScore = -Infinity;
  for (let i = 0; i <= STEPS; i++) {
    for (let j = 0; j <= STEPS; j++) {
      const x = x0 + ((x1 - x0) * i) / STEPS;
      const y = y0 + ((y1 - y0) * j) / STEPS;
      const score = clearance(x, y) - 0.25 * Math.hypot(x - cx, y - cy);
      if (score > bestScore) {
        best = { x, y };
        bestScore = score;
      }
    }
  }
  return best;
}

/** The name's box in world units, for hit-testing and the selection outline. */
export function letteringBox(sea, set) {
  return { x0: sea.x - set.total / 2 - set.font * 0.5, x1: sea.x + set.total / 2 + set.font * 0.5, y0: sea.y - set.font * 0.9, y1: sea.y + set.font * 0.6 };
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/**
 * The sea's stippled water: dots on a jittered grid wherever its islands make the water near (a sum of gaussians
 * above a threshold), fading toward the edge, never on land or among an island's lamps. Deterministic per sea.
 * Returns [x, y, strength 0..1][].
 */
export function stippleDots(sea, members, allNodes, radius) {
  if (members.length === 0) return [];
  const sigma = radius * 1.9;
  const step = radius * 0.22;
  const pad = radius * 3.4;
  const x0 = Math.min(...members.map((m) => m.x)) - pad;
  const x1 = Math.max(...members.map((m) => m.x)) + pad;
  const y0 = Math.min(...members.map((m) => m.y)) - pad;
  const y1 = Math.max(...members.map((m) => m.y)) + pad;
  const rnd = seeded(sea.id * 2654435761);
  const dots = [];
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const jx = x + (rnd() - 0.5) * step * 0.9;
      const jy = y + (rnd() - 0.5) * step * 0.9;
      let f = 0;
      for (const m of members) f += Math.exp(-((jx - m.x) ** 2 + (jy - m.y) ** 2) / (2 * sigma * sigma));
      if (f < 0.32) continue;
      if (allNodes.some((n) => Math.hypot(jx - n.x, jy - n.y) < n.radius * 1.25)) continue;
      dots.push([jx, jy, Math.min(1, (f - 0.32) * 2.2)]);
    }
  }
  return dots;
}
