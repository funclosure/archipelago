// Pure, DOM-free parts of a demo fence: its tag, the size limits, the theme tokens it is handed, and how the
// frame's reports are read. demo.js does the rest.

/** The fence tag that runs a demo. */
export const DEMO_LANG = "demo";

/** The longest body a demo may have; past it the fence shows as its source. */
export const DEMO_MAX = 8000;

export const DEMO_MIN_H = 80;
export const DEMO_MAX_H = 520;

/** The theme tokens a demo can use as `var(--name)`, so it looks like the page in every theme. */
export const DEMO_TOKENS = ["--text", "--text-2", "--muted", "--line", "--panel", "--panel-2", "--water", "--sea", "--lamp", "--reef", "--grass", "--snow", "--explore", "--font-text", "--font-mono"];

/** The frame's reported height, kept between the limits (a demo taller than the cap scrolls inside its frame). */
export function demoHeight(reported) {
  const h = Number(reported);
  if (!Number.isFinite(h)) return DEMO_MIN_H;
  return Math.max(DEMO_MIN_H, Math.min(DEMO_MAX_H, Math.ceil(h)));
}

/** The column a demo is written for, in px: full screen draws it larger by how much wider the window is. */
export const DEMO_COLUMN = 640;
const ZOOM_MAX = 1.75;

/** How much larger a demo is drawn when it fills a frame `width` px wide: 1 in a column, at most `ZOOM_MAX`. */
export function fullZoom(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= DEMO_COLUMN) return 1;
  return Math.min(ZOOM_MAX, Math.round((w / DEMO_COLUMN) * 20) / 20);
}

/** A colour property and its value in CSS (`background: #111`) or script (`style.color = on ? '#eee' : '#888'`); the
 *  value runs to the end of the declaration, keeping commas inside parentheses (`rgb(…)`). */
const DECLARATION = /(?<![\w-])(background-color|background|backgroundColor|border-(?:top-|right-|bottom-|left-)?color|border(?:-top|-right|-bottom|-left)?|border(?:Top|Right|Bottom|Left)?Color|border(?:Top|Right|Bottom|Left)?|outline-color|outline|outlineColor|color)(\s*[:=]\s*)((?:[^;}\n<>,(]|\([^)]*\))*)/g;

const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|gr[ae]y|silver|gainsboro|whitesmoke|dimgr[ae]y|darkgr[ae]y|lightgr[ae]y)\b/gi;

const NAMED = { white: "#ffffff", black: "#000000", gray: "#808080", grey: "#808080", silver: "#c0c0c0", gainsboro: "#dcdcdc", whitesmoke: "#f5f5f5", dimgray: "#696969", dimgrey: "#696969", darkgray: "#a9a9a9", darkgrey: "#a9a9a9", lightgray: "#d3d3d3", lightgrey: "#d3d3d3" };

/** `[r, g, b, alpha]` of a hex, rgb(), or named colour, or null. */
function rgbOf(literal) {
  const text = NAMED[literal.toLowerCase()] ?? literal;
  if (text.startsWith("#")) {
    let hex = text.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i) => parseInt(hex.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1];
  }
  const parts = text.replace(/^rgba?\(|\)$/g, "").split(/[\s,/]+/).filter(Boolean).map((p) => (p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
  if (parts.length < 3 || parts.slice(0, 3).some((v) => !Number.isFinite(v))) return null;
  const alpha = parts[3] === undefined ? 1 : parts[3] > 1 ? parts[3] / 255 : parts[3];
  return [parts[0], parts[1], parts[2], alpha];
}

/** How light an opaque grey literal is (0–1), or null for a colour, a see-through one, or no colour at all. */
function greyLightness(literal) {
  const rgb = rgbOf(literal);
  if (!rgb) return null;
  const [r, g, b, alpha] = rgb;
  if (Math.max(r, g, b) - Math.min(r, g, b) > 30) return null;
  return { l: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, alpha };
}

/** The theme token a grey literal stands for, by the property it colours and how light it is; null keeps it (an
 *  accent, a see-through overlay, a colour that is not grey). `lightPage` says which page the demo was written for:
 *  its text is the other way round from that page, and text the same way round sits on an accent, so it stays. */
function tokenFor(property, literal, lightPage) {
  const grey = greyLightness(literal);
  if (!grey) return null;
  const p = property.toLowerCase();
  if (p.startsWith("border") || p.startsWith("outline")) return "var(--line)";
  if (grey.alpha < 1) return null;
  const l = grey.l;
  if (p.startsWith("background")) {
    if (l < 0.09 || l > 0.96) return "transparent";
    if (l < 0.16 || l > 0.85) return "var(--panel)";
    return "var(--panel-2)";
  }
  if (lightPage ? l > 0.85 : l < 0.35) return null;
  if (l > 0.85 || l < 0.35) return "var(--text)";
  if (l > 0.6) return "var(--text-2)";
  return "var(--muted)";
}

const isText = (property) => property.toLowerCase() === "color";

/** Canvas and SVG paint (`ctx.strokeStyle = '#000'`, `fill="#333"`, `stroke: #ccc`): a canvas cannot read `var(--…)`,
 *  so these take the theme's values, not its tokens. */
const PAINT = /(?<![\w-])(strokeStyle|fillStyle|shadowColor|fill|stroke)(\s*[:=]\s*)((?:[^;}\n<>,(]|\([^)]*\))*)/g;

/** A demo's own custom property (`--bg: #111`), read by its role from the name; a name that says none stays. */
const CUSTOM = /(?<![\w-])(--[\w-]+)(\s*:\s*)((?:[^;}\n<>,(]|\([^)]*\))*)/g;

function customRole(name) {
  if (/bg|back|surface|panel|card|box|fill/i.test(name)) return "background";
  if (/line|grid|border|rule|axis|divider/i.test(name)) return "border";
  if (/text|fg|fore|ink|label|font|colou?r/i.test(name)) return "color";
  return null;
}

/** Paint is mostly marks and labels, so it reads like text; paint the colour of the page it was written for is
 *  that page's background, and fills nothing. */
function paintFor(literal, lightPage) {
  const grey = greyLightness(literal);
  if (!grey || grey.alpha < 1) return null;
  const l = grey.l;
  if (lightPage ? l > 0.96 : l < 0.09) return "transparent";
  if (l > 0.85 || l < 0.35) return "var(--text)";
  if (l > 0.6) return "var(--text-2)";
  return "var(--muted)";
}

/** `var(--x)` as the theme's value of `--x`, from `values`; null when it has none. */
function resolved(token, values) {
  const name = /^var\((--[\w-]+)\)$/.exec(token)?.[1];
  return name ? (values[name] ?? null) : token;
}

/** The demo with its grey literals (backgrounds, text, borders, canvas and SVG paint, its own custom properties)
 *  swapped for the theme, so a demo written for a black page sits on any theme. CSS takes the tokens; paint and
 *  custom properties take their values from `values` (the theme's, as the frame gets them), since a canvas cannot
 *  read a token and `--text: var(--text)` is a cycle. Accents stay as written; the Code view shows the source. */
export function themeColours(source, values = {}) {
  let dark = 0;
  let light = 0;
  const count = (value) => {
    for (const [literal] of value.matchAll(LITERAL)) {
      const grey = greyLightness(literal);
      if (grey && grey.alpha === 1 && grey.l < 0.35) dark++;
      else if (grey && grey.alpha === 1 && grey.l > 0.6) light++;
    }
  };
  for (const [, property, , value] of source.matchAll(DECLARATION)) if (isText(property)) count(value);
  for (const [, , , value] of source.matchAll(PAINT)) count(value);
  for (const [, name, , value] of source.matchAll(CUSTOM)) if (customRole(name) === "color") count(value);
  const lightPage = dark > light;
  return source
    .replace(CUSTOM, (whole, name, sep, value) => {
      const role = customRole(name);
      if (!role) return whole;
      return name + sep + value.replace(LITERAL, (literal) => resolved(tokenFor(role, literal, lightPage) ?? literal, values) ?? literal);
    })
    .replace(DECLARATION, (whole, property, sep, value) =>
      property + sep + value.replace(LITERAL, (literal) => tokenFor(property, literal, lightPage) ?? literal))
    .replace(PAINT, (whole, property, sep, value) =>
      property + sep + value.replace(LITERAL, (literal) => resolved(paintFor(literal, lightPage) ?? literal, values) ?? literal));
}

export function logLine(data) {
  if (!data || typeof data.text !== "string") return null;
  const level = ["log", "info", "warn", "error"].includes(data.level) ? data.level : "log";
  const text = data.text.length > 400 ? `${data.text.slice(0, 400)}…` : data.text;
  return { level, text };
}
