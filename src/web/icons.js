// The page's icons: one 16-unit grid, one 1.4 stroke with round ends, drawn as paths so each takes the colour of the
// text around it. A name maps to stroked path data; FILLED adds a filled part to a few. Add a glyph here rather than
// drawing one where it is used, so every control's icon comes from the same hand.
const NS = "http://www.w3.org/2000/svg";

export const ICONS = {
  plus: "M8 3.5v9M3.5 8h9",
  close: "M4 4l8 8M12 4l-8 8",
  check: "M3.5 8.5l3 3 6-7",
  "chevron-right": "M6 3.5 10.5 8 6 12.5",
  "chevron-down": "M3.5 6 8 10.5 12.5 6",
  "arrow-up": "M8 12.5v-9M4 7l4-4 4 4",
  "arrow-down": "M8 3.5v9M4 9l4 4 4-4",
  "arrow-right": "M3.5 8h9M9 4l4 4-4 4",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14",
  pencil: "M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.6 12.5 2.5 13.5l1-3.1zM9.8 3.7l2.5 2.5",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.8M9.2 7v3.8",
  copy: "M5.5 5.5h7v7h-7zM3.5 10.5v-7h7",
  download: "M8 2.5V10M4.5 7 8 10.5 11.5 7M3 13h10",
  upload: "M8 10.5V3M4.5 6 8 2.5 11.5 6M3 13h10",
  share: "M8 10V2.5M5 5l3-3 3 3M3.5 8.5V13h9V8.5",
  external: "M6.5 3.5h-3v9h9v-3M9 2.5h4.5V7M13.5 2.5l-6 6",
  expand: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10",
  undo: "M4 6.5h5.5a3 3 0 0 1 0 6H6M4 6.5 6.5 4M4 6.5 6.5 9",
  image: "M2.5 3.5h11v9h-11zM2.5 10.5l3.2-3.2 2.8 2.8 2-2 3 3",
  user: "M8 8a2.6 2.6 0 1 0 0-5.2A2.6 2.6 0 0 0 8 8zM3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5",
  globe: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14M8 2C6.2 3.7 5.4 5.7 5.4 8s.8 4.3 2.6 6",
  theme: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z",
  info: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 7.2v3.6M8 5.1v.1",
  keyboard: "M1.5 4.5h13v7h-13zM4 7v.1M6.7 7v.1M9.3 7v.1M12 7v.1M5 9.3h6",
  key: "M5.2 10.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6zM8 8h5.6M11.4 8v2.1M13.6 8v1.5",
  map: "M2.5 4 6 2.5l4 1.5 3.5-1.5V12L10 13.5 6 12l-3.5 1.5zM6 2.5V12M10 4v9.5",
  board: "M2.5 3h11v4h-11zM2.5 9h11v4h-11z",
  sidebar: "M1.5 2.5h13v11h-13zM6 2.5v11",
  compass: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM10.4 5.6 9 9 5.6 10.4 7 7z",
  lamp: "M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1",
  island: "M3.2 9.3c-.9-2.4.6-5.3 3.5-5.8 2.5-.5 5.2.6 6 2.9.8 2.4-.9 5-3.6 5.6-2.6.6-5.1-.5-5.9-2.7z",
  pen: "M10.8 2.6l2.6 2.6-6.9 6.9-3.2.6.6-3.2zM9.4 4l2.6 2.6",
  sparkle: "M8 2.5c.4 2.9 1.6 4.1 5.5 5.5-3.9 1.4-5.1 2.6-5.5 5.5-.4-2.9-1.6-4.1-5.5-5.5C6.4 6.6 7.6 5.4 8 2.5z",
  more: "M3.5 8v.1M8 8v.1M12.5 8v.1",
  enter: "M12.5 3.5v5a1 1 0 0 1-1 1h-8M6 7 3.5 9.5 6 12",
  play: "M5 3.2v9.6L12.5 8z",
  pause: "M5.5 3.5v9M10.5 3.5v9",
};
/** Parts drawn filled, over the strokes. */
const FILLED = {
  theme: "M8 2a6 6 0 0 1 0 12z",
  lamp: "M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z",
  play: "M5 3.2v9.6L12.5 8z",
};
/** Glyphs made of dots, which want a heavier stroke to read as dots. */
const HEAVY = new Set(["more"]);

export const ICON_NAMES = Object.keys(ICONS);

/** One icon as an <svg class="ic">, hidden from readers unless given a label. An unknown name draws nothing in its box. */
export function icon(name, { size = 16, label } = {}) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", `ic ic-${name}`);
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", HEAVY.has(name) ? "2.2" : "1.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  const d = ICONS[name];
  if (d) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  if (FILLED[name]) {
    const fill = document.createElementNS(NS, "path");
    fill.setAttribute("d", FILLED[name]);
    fill.setAttribute("fill", "currentColor");
    fill.setAttribute("stroke", "none");
    svg.append(fill);
  }
  return svg;
}
