import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { THEMES } from "../../src/web/theme-model.js";

const css = readFileSync(resolve(import.meta.dir, "../../src/web/styles.css"), "utf8");
const SIZES = new Set(["--outline-w", "--pane-w"]);
const PALETTE = ["--sea", "--line-1", "--lamp", "--reef", "--sand-fill", "--grass", "--snow", "--explore"];

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

test("the chart theme defines every literal colour token of :root, and nothing else", () => {
  const root = block(":root");
  const chart = block(':root[data-theme="chart"]');
  const literal = Object.keys(root).filter((k) => !SIZES.has(k) && !root[k].startsWith("var("));
  expect(literal.length).toBeGreaterThan(20);
  expect(Object.keys(chart).filter((k) => !(k in root))).toEqual([]);
  expect(literal.filter((k) => !(k in chart))).toEqual([]);
});

test("the canvas tokens are six-digit hex in both themes", () => {
  for (const sel of [":root", ':root[data-theme="chart"]']) {
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
