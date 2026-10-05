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

// The expression-bearing keys of a datum: `fn` for a plain function, `x`/`y` for a parametric curve,
// `r` for a polar one. The evaluator compiles these with the Function constructor and, inside an array
// literal, emits a string's contents raw instead of quoting them — so a character that lets an expression
// close its own literal and start a new statement (a bracket, a quote, a backtick) must never reach it.
const EXPR_KEYS = ["fn", "x", "y", "r"];
const UNSAFE_EXPR_CHAR = /[[\]'"`]/;

/**
 * True when a datum carries an expression no legitimate curve needs a bracket, a quote, or a backtick
 * for. A datum's own `derivative` is checked too: function-plot compiles `derivative.fn` (the tangent
 * line's slope) through the same evaluator, so it is exactly as reachable and exactly as dangerous.
 */
function hasUnsafeExpression(datum) {
  if (!datum || typeof datum !== "object") return false;
  if (EXPR_KEYS.some((key) => typeof datum[key] === "string" && UNSAFE_EXPR_CHAR.test(datum[key]))) return true;
  const derivative = datum.derivative;
  return !!derivative && typeof derivative === "object" && typeof derivative.fn === "string" && UNSAFE_EXPR_CHAR.test(derivative.fn);
}

/**
 * A fence body → `{ options }` or `{ error }`. A body starting with a bracket is a function-plot options
 * object; anything else is one expression per line, with blank lines and `//` or `#` comments dropped.
 * shuttle tests only `{`; taking `[` here too turns a mistyped config into a plain message rather than
 * an expression the library chokes on, and no valid body in either app starts with a bracket.
 *
 * Every datum's expression keys are checked against `hasUnsafeExpression` before the options are handed
 * back: the text reaching the evaluator is model-written and reader-steerable, so a `fn` (or parametric
 * `x`/`y`, or polar `r`) that carries a bracket, a quote, or a backtick is rejected here rather than run.
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
    if (Array.isArray(options.data) && options.data.some(hasUnsafeExpression)) {
      return { error: "an expression cannot contain a bracket, a quote, or a backtick" };
    }
    return { options };
  }
  const data = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !COMMENT.test(line))
    .map((fn) => ({ fn }));
  if (data.length === 0) return { error: "nothing to plot" };
  if (data.some(hasUnsafeExpression)) return { error: "an expression cannot contain a bracket, a quote, or a backtick" };
  return { options: { data } };
}

/** A plot's box: the container's width (already clear of its padding), capped, and three quarters of that for the height. */
export function plotSize(containerWidth) {
  const width = Math.max(MIN_W, Math.min(Math.round(containerWidth), MAX_W));
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

const LABEL_MAX = 40;

/** A curve's name in the legend: its `title`, else the expression it draws, else its place. */
function seriesLabel(d, i) {
  const title = typeof d.title === "string" ? d.title.trim() : "";
  const raw = title || (typeof d.fn === "string" && d.fn)
    || (typeof d.x === "string" && typeof d.y === "string" && `(${d.x}, ${d.y})`)
    || (typeof d.r === "string" && `r = ${d.r}`)
    || `series ${i + 1}`;
  return raw.length > LABEL_MAX ? `${raw.slice(0, LABEL_MAX - 1)}…` : raw;
}

/**
 * The legend under a plot: one `{ label, color }` per curve, in the colours `plotOptions` hands the
 * library, so a swatch always matches its line. Empty for a single curve with no title: one line needs
 * no key, but a curve the writer named is worth naming.
 */
export function plotLegend(options, palette) {
  const data = Array.isArray(options?.data) ? options.data.filter((d) => d && typeof d === "object") : [];
  const titled = data.some((d) => typeof d.title === "string" && d.title.trim());
  if (data.length === 0 || (data.length === 1 && !titled)) return [];
  return data.map((d, i) => ({ label: seriesLabel(d, i), color: d.color ?? palette[SERIES_KEYS[i % SERIES_KEYS.length]] }));
}
