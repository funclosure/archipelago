import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { THEMES } from "../../src/web/theme-model.js";

const css = readFileSync(resolve(import.meta.dir, "../../src/web/styles.css"), "utf8");
/** Tokens of :root that are not colours, so no theme redefines them. */
const NOT_COLOURS = new Set(["--outline-w", "--pane-w", "--font-mono", "--font-text"]);
const PALETTE = ["--sea", "--line-1", "--lamp", "--reef", "--sand-fill", "--grass", "--snow", "--explore"];

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const OTHERS = THEMES.slice(1).map((t) => `:root[data-theme="${t.id}"]`);

test("every other theme defines every literal colour token of :root, and nothing else", () => {
  const root = block(":root");
  const literal = Object.keys(root).filter((k) => !NOT_COLOURS.has(k) && !root[k].startsWith("var("));
  expect(literal.length).toBeGreaterThan(20);
  for (const sel of OTHERS) {
    const theme = block(sel);
    expect(Object.keys(theme).filter((k) => !(k in root))).toEqual([]);
    expect(literal.filter((k) => !(k in theme))).toEqual([]);
  }
});

test("the canvas tokens are six-digit hex in every theme", () => {
  for (const sel of [":root", ...OTHERS]) {
    const b = block(sel);
    for (const k of PALETTE) expect(b[k]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  }
});

test("no literal colour survives outside the token blocks", () => {
  const body = css.replace(/:root(\[data-theme="\w+"\])? \{[^}]*\}/g, "");
  expect(body.match(/rgba?\(|#[0-9A-Fa-f]{6}\b/g) ?? []).toEqual([]);
});

test("every registered theme defines --explore, the mentor lens's lamp, as six-digit hex", () => {
  for (const t of THEMES) {
    const b = block(t.id === THEMES[0].id ? ":root" : `:root[data-theme="${t.id}"]`);
    expect(b["--explore"]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  }
});

// ---- contrast: the pairs a theme change could quietly break ----

/** A theme's tokens with :root's beneath, `var()` resolved, as [r, g, b, a]. */
function themeColours(id) {
  // the scale block's aliases (--on-accent) under the palette's tokens
  const scaleAt = css.indexOf(":root {", css.indexOf(`:root[data-theme="${THEMES.at(-1).id}"]`));
  const scale = {};
  for (const m of css.slice(scaleAt, css.indexOf("}", scaleAt)).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) scale[m[1]] = m[2].trim();
  const root = { ...scale, ...block(":root") };
  const tokens = id === THEMES[0].id ? root : { ...root, ...block(`:root[data-theme="${id}"]`) };
  const resolve = (v) => {
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    return m ? resolve(tokens[m[1]]) : v;
  };
  return (name) => {
    const v = resolve(tokens[name]);
    if (v.startsWith("#")) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).concat(1);
    const p = /rgba?\(([^)]+)\)/.exec(v)[1].split(",").map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  };
}
const channel = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** WCAG contrast of `fg` (composited over `bg` when it has alpha) against `bg`. */
function contrast(fg, bg) {
  const a = fg[3];
  const seen = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
  const [hi, lo] = [luminance(seen), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [text, ground, why]: each must reach 4.5:1 in every theme. */
const TEXT_PAIRS = [
  ["--on-accent", "--lamp", "a label on a lamp-filled button, segment or lit chip"],
  ["--on-accent", "--explore", "a label on a mentor-filled button or segment"],
  ["--lamp", "--panel", "lamp-coloured small text on a panel (bylines, step numbers, A LAMP IS LIT)"],
  ["--lamp", "--sea", "lamp-coloured text on the water (the breadcrumb's start, the first page's eyebrow)"],
  ["--explore", "--panel", "the mentor's coloured text on a panel"],
  ...["--code-fg", "--code-keyword", "--code-string", "--code-comment", "--code-type", "--code-number"].flatMap((code) => [
    [code, "--sea", "code in a reply (the block sits on the water)"],
    [code, "--panel", "code on a board card"],
  ]),
];

test("text on the accents, accent-coloured text, and code reach 4.5:1 in every theme", () => {
  const fails = [];
  for (const { id } of THEMES) {
    const colour = themeColours(id);
    for (const [fg, bg, why] of TEXT_PAIRS) {
      const r = contrast(colour(fg), colour(bg));
      if (r < 4.5) fails.push(`${id}: ${fg} on ${bg} is ${r.toFixed(2)}:1 (${why})`);
    }
  }
  expect(fails).toEqual([]);
});

test("the scale block holds no literal colour, and braces balance", () => {
  const start = css.indexOf(":root {", css.indexOf(`:root[data-theme="${THEMES.at(-1).id}"]`));
  expect(start).toBeGreaterThan(0);
  const scale = css.slice(start, css.indexOf("}", start));
  expect(scale).toContain("--sp-1");
  expect(scale.match(/rgba?\(|#[0-9A-Fa-f]{3,8}\b/g) ?? []).toEqual([]);
  // a stray brace silently drops the rule after it
  expect(css.split("{").length).toBe(css.split("}").length);
});
