// A shared map's picture in the gallery: one island as the map draws it, with the map's emoji standing on it.
// The coast is the island's own (seeded by the map's slug), so each map keeps one shape wherever it is shown.
import { BOX, CENTRE, COAST, RING_STEP, ringPoints } from "./contour.js";

const SVG = "http://www.w3.org/2000/svg";

/** A number from a slug, the same every time: the seed of the map's coast. */
export function iconSeed(slug) {
  let n = 0;
  for (const ch of String(slug)) n = (n * 31 + ch.codePointAt(0)) % 9973;
  return n + 1;
}

/** The island of one gallery entry (`slug`, `icon`), decorative: its name is beside it. */
export function mapIcon(entry) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${BOX} ${BOX}`);
  svg.setAttribute("class", "map-icon");
  svg.setAttribute("aria-hidden", "true");
  const seed = iconSeed(entry.slug);
  for (const [cls, r] of [["coast", COAST + 30], ["ring", COAST + 30 - RING_STEP]]) {
    const p = document.createElementNS(SVG, "polygon");
    p.setAttribute("points", ringPoints(seed, r).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" "));
    p.setAttribute("class", cls);
    svg.append(p);
  }
  if (entry.icon) {
    const text = document.createElementNS(SVG, "text");
    text.setAttribute("x", String(CENTRE));
    text.setAttribute("y", String(CENTRE + 4));
    text.textContent = entry.icon;
    svg.append(text);
  }
  return svg;
}
