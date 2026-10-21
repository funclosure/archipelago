// Where each island's name goes, so names never sit on each other or across another island's coast. Pure: the
// caller passes a `measure(text)` that returns a width in box units (the name's font is 20 box units tall).
// Names wrap to WRAP box units, at most MAX_LINES lines. Each island tries below its coast, then above, right, and
// left; the first spot clear of every label already placed and every other island's lamps wins. An island with
// no clear spot shows no name until it is hovered or selected (the outline still lists it): those two are placed
// first and always drawn, below when nothing is clear.
import { CENTRE, LAMP_R, NAME_Y } from "./contour.js";

export const WRAP = 210;
export const MAX_LINES = 3;
export const LINE_H = 23;
/** The "draft" line under a draft island's name. */
export const DRAFT_H = 20;
/** Above the coast: the label's last line ends this far over the lamps. */
const ABOVE_GAP = 10;
/** Around each island, the disc no other island's name may cross: its lamps, plus a little water. */
const KEEP_R = LAMP_R + 6;

/** Splits a name into lines no wider than `max`, breaking at spaces; the last allowed line ends in "…" if words remain. */
export function wrapName(name, measure, max = WRAP, maxLines = MAX_LINES) {
  const words = name.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (!line || measure(next) <= max) {
      line = next;
      continue;
    }
    if (lines.length === maxLines - 1) {
      lines.push(`${line}…`);
      return lines;
    }
    lines.push(line);
    line = words[i];
  }
  if (line) lines.push(line);
  return lines;
}

/** Beside the coast: the label's near edge starts this far out from the island's centre. */
const SIDE_GAP = LAMP_R + 10;
export const PLACES = ["below", "above", "right", "left"];

/** Where the label sits in box units: its centre x and its top. Text is drawn centred on `cx`. */
export function spotFor(place, width, height) {
  if (place === "below") return { cx: CENTRE, top: NAME_Y };
  if (place === "above") return { cx: CENTRE, top: CENTRE - LAMP_R - ABOVE_GAP - height };
  const cx = place === "right" ? CENTRE + SIDE_GAP + width / 2 : CENTRE - SIDE_GAP - width / 2;
  return { cx, top: CENTRE - height / 2 };
}

/** The label's box in world units for one placement, from the island's centre and its box scale `s`. */
function rectFor(node, s, width, height, place) {
  const { cx, top } = spotFor(place, width, height);
  const x = node.x + (cx - CENTRE) * s;
  return { x0: x - (width / 2) * s, x1: x + (width / 2) * s, y0: node.y + (top - CENTRE) * s, y1: node.y + (top - CENTRE + height) * s };
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function crossesDisc(r, cx, cy, radius) {
  const nx = Math.max(r.x0, Math.min(cx, r.x1));
  const ny = Math.max(r.y0, Math.min(cy, r.y1));
  return (nx - cx) ** 2 + (ny - cy) ** 2 < radius ** 2;
}

/**
 * Lays out every node's name. `nodes` carry x, y (world), radius, name, slug, and draft; `scale(node)` is its box
 * scale (world units per box unit). Returns a Map slug → { lines, place, cx, top (box units), hidden }; a hidden
 * label is not drawn.
 */
export function layoutLabels(nodes, { measure, scale, focus = null, hover = null }) {
  const order = [...nodes].sort((a, b) => rank(a) - rank(b) || a.y - b.y || a.x - b.x);
  function rank(n) {
    if (n.slug === focus) return 0;
    if (n.slug === hover) return 1;
    return n.draft ? 3 : 2;
  }
  const placed = [];
  const out = new Map();
  for (const node of order) {
    const s = scale(node);
    const lines = wrapName(node.name, measure);
    const width = Math.max(...lines.map(measure));
    const height = lines.length * LINE_H + (node.draft ? DRAFT_H : 0);
    const clear = (r) =>
      !placed.some((p) => overlaps(p, r)) &&
      !nodes.some((o) => o !== node && crossesDisc(r, o.x, o.y, KEEP_R * scale(o)));
    const must = node.slug === focus || node.slug === hover;
    const place = PLACES.find((p) => clear(rectFor(node, s, width, height, p))) ?? (must ? "below" : undefined);
    const hidden = place === undefined;
    const chosen = place ?? "below";
    if (!hidden) placed.push(rectFor(node, s, width, height, chosen));
    out.set(node.slug, { lines, place: chosen, ...spotFor(chosen, width, height), hidden });
  }
  return out;
}
