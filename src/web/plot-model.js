// Pure, DOM-free: a plot fence's body → function-plot's options, the size of a plot in its box, and the
// colours the render pass paints on. The library is never imported here, and no colour is ever a literal:
// every one comes from the canvas palette the theme pushed into draw.js.

/** The fence tags that draw a plot. shuttle reads the same three, so a body renders in either app. */
export const PLOT_LANGS = new Set(["plot", "function-plot", "math-plot"]);

/** The palette keys a series takes, in order, wrapping past the fourth. */
export const SERIES_KEYS = ["lamp", "grass", "snow", "reef"];

const COMMENT = /^(\/\/|#)/;
const MIN_W = 180;
const MAX_W = 560;
const MAX_H = 380;

/**
 * A fence body → `{ options }` or `{ error }`. A body starting with a bracket is a function-plot options
 * object; anything else is one expression per line, with blank lines and `//` or `#` comments dropped.
 * shuttle tests only `{`; taking `[` here too turns a mistyped config into a plain message rather than
 * an expression the library chokes on, and no valid body in either app starts with a bracket.
 */
export function parsePlot(body) {
  const trimmed = String(body ?? "").trim();
  if (!trimmed) return { error: "nothing to plot" };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let options;
    try {
      options = JSON.parse(trimmed);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "the plot config is not JSON" };
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) return { error: "the plot config is not an object" };
    return { options };
  }
  const data = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !COMMENT.test(line))
    .map((fn) => ({ fn }));
  if (data.length === 0) return { error: "nothing to plot" };
  return { options: { data } };
}

/** A plot's box: the container's width less its padding, capped, and three quarters of that for the height. */
export function plotSize(containerWidth) {
  const width = Math.max(MIN_W, Math.min(Math.round(containerWidth) - 16, MAX_W));
  return { width, height: Math.min(Math.round(width * 0.75), MAX_H) };
}

/** `#RRGGBB` plus an alpha → `rgba(r, g, b, a)`. Six digits only, which every theme token is. */
export function rgba(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** What the render pass paints onto the SVG, from the canvas palette. */
export function plotColours(palette) {
  return {
    ground: palette.sea,
    axis: rgba(palette.line, 0.65),
    grid: rgba(palette.line, 0.16),
    text: rgba(palette.line, 0.8),
  };
}

/**
 * The options handed to the library: the body first, then ours. A body carrying `target`, `width`,
 * `height`, `grid` or `disableZoom` therefore cannot move the plot out of its box or take the wheel.
 */
export function plotOptions(options, { target, width, height, palette }) {
  const data = (Array.isArray(options.data) ? options.data : []).map((d, i) => ({
    ...d,
    color: d.color ?? palette[SERIES_KEYS[i % SERIES_KEYS.length]],
  }));
  return { ...options, data, target, width, height, grid: true, disableZoom: true };
}
