// The demo fence's pure parts: its tag, its limits, the tokens it is handed, how the frame's reports are read.
import { test, expect } from "bun:test";
import { DEMO_LANG, DEMO_MAX, DEMO_MIN_H, DEMO_MAX_H, DEMO_TOKENS, DEMO_COLUMN, demoHeight, fullZoom, logLine, themeColours } from "../../src/web/demo-model.js";
import { mdBlocks } from "../../src/web/thread.js";

test("a demo is a fence tagged demo, with a body cap", () => {
  expect(DEMO_LANG).toBe("demo");
  expect(DEMO_MAX).toBe(8000);
  const [b] = mdBlocks("```demo\n<button>go</button>\n```");
  expect(b).toMatchObject({ type: "code", lang: "demo", closed: true });
});

test("the frame's height is kept between the limits; nonsense falls to the floor", () => {
  expect(demoHeight(200.2)).toBe(201);
  expect(demoHeight(10)).toBe(DEMO_MIN_H);
  expect(demoHeight(5000)).toBe(DEMO_MAX_H);
  expect(demoHeight("tall")).toBe(DEMO_MIN_H);
});

test("console lines: a known level or log, cut to one readable line, nothing that is not text", () => {
  expect(logLine({ level: "warn", text: "evicted a" })).toEqual({ level: "warn", text: "evicted a" });
  expect(logLine({ level: "debug", text: "x" }).level).toBe("log");
  expect(logLine({ text: "y".repeat(500) }).text).toHaveLength(401);
  expect(logLine({ text: 3 })).toBeNull();
  expect(logLine(null)).toBeNull();
});

test("the tokens handed to a demo are theme tokens the page defines", async () => {
  const css = await Bun.file(new URL("../../src/web/styles.css", import.meta.url)).text();
  const root = /:root \{([\s\S]*?)\n\}/.exec(css)[1];
  for (const name of DEMO_TOKENS) expect(root).toContain(`${name}:`);
});

test("grey literals become the theme's tokens: backgrounds, text, borders, in CSS and in script", () => {
  expect(themeColours('<div style="background:#111; color:#eee; border:1px solid #333">')).toBe('<div style="background:transparent; color:var(--text); border:1px solid var(--line)">');
  expect(themeColours(".card { background-color: #1b1b1b; color: #999 }")).toBe(".card { background-color: var(--panel); color: var(--muted) }");
  expect(themeColours("box.style.backgroundColor = '#2a2a2a';\nbox.style.color = on ? '#fff' : '#aaa';")).toBe("box.style.backgroundColor = 'var(--panel-2)';\nbox.style.color = on ? 'var(--text)' : 'var(--text-2)';");
  expect(themeColours("button { background: white; color: black; outline-color: rgb(80, 80, 80) }")).toBe("button { background: transparent; color: var(--text); outline-color: var(--line) }");
});

test("text the same way round as the page it was written for sits on an accent, and stays", () => {
  const dark = '<div style="background:#111; color:#eee"><b style="color:#ddd">n</b><button style="background:#e0b04a; color:#111">go</button></div>';
  expect(themeColours(dark)).toBe('<div style="background:transparent; color:var(--text)"><b style="color:var(--text)">n</b><button style="background:#e0b04a; color:#111">go</button></div>');
  const light = '<div style="background:#fff; color:#222"><p style="color:#333">n</p><button style="background:#2563eb; color:#fff">go</button></div>';
  expect(themeColours(light)).toBe('<div style="background:transparent; color:var(--text)"><p style="color:var(--text)">n</p><button style="background:#2563eb; color:#fff">go</button></div>');
});

test("accents, overlays, ids, and paint with no theme values stay as written", () => {
  for (const kept of [
    "button { background: #e0b04a; color: #111 }".replace("#111", "#3b82f6"),
    "div { background: rgba(255, 255, 255, 0.05) }",
    "ctx.fillStyle = '#111';",
    "#slots { display: flex }",
    "el.style.color = 'var(--lamp)';",
    "<p>a white cat</p>",
  ]) expect(themeColours(kept)).toBe(kept);
  expect(themeColours("{ color: '#eee', background: '#000' }")).toBe("{ color: 'var(--text)', background: 'transparent' }");
});

const THEME = { "--text": "#e6e1d6", "--text-2": "#b8b2a6", "--muted": "#8a8478", "--line": "#3a4a5a", "--panel": "#14202b", "--panel-2": "#1b2a37" };

test("canvas and SVG paint takes the theme's values, since a canvas cannot read a token", () => {
  // the ski demo's shape: black marks and labels drawn for a white page, an accent, and a white clear
  const light = "ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);\nctx.strokeStyle = '#000';\nctx.fillStyle = '#333'; ctx.fillText(label, 8, 16);\nctx.strokeStyle = '#999';\nctx.fillStyle = '#e0b04a';";
  expect(themeColours(light, THEME)).toBe("ctx.fillStyle = 'transparent'; ctx.fillRect(0, 0, w, h);\nctx.strokeStyle = '#e6e1d6';\nctx.fillStyle = '#e6e1d6'; ctx.fillText(label, 8, 16);\nctx.strokeStyle = '#8a8478';\nctx.fillStyle = '#e0b04a';");
  const dark = "ctx.fillStyle = '#000'; ctx.strokeStyle = '#eee'; ctx.shadowColor = '#ccc';";
  expect(themeColours(dark, THEME)).toBe("ctx.fillStyle = 'transparent'; ctx.strokeStyle = '#e6e1d6'; ctx.shadowColor = '#b8b2a6';");
  expect(themeColours('<path d="M0 0" stroke="#111" fill="none"/><circle fill="#222"/>', THEME)).toBe('<path d="M0 0" stroke="#e6e1d6" fill="none"/><circle fill="#e6e1d6"/>');
});

test("a demo's own custom properties are read by their names", () => {
  const src = ":root { --bg: #111; --text: #eee; --grid: #333; --accent: #888 } body { background: var(--bg); color: var(--text) }";
  expect(themeColours(src, THEME)).toBe(":root { --bg: transparent; --text: #e6e1d6; --grid: #3a4a5a; --accent: #888 } body { background: var(--bg); color: var(--text) }");
  // without the theme's values nothing is put in: `--text: var(--text)` would be a cycle
  expect(themeColours(":root { --text: #eee }")).toBe(":root { --text: #eee }");
});

test("a demo filling the window is drawn larger, by how much wider than its column, up to a limit", () => {
  expect(fullZoom(DEMO_COLUMN)).toBe(1);
  expect(fullZoom(390)).toBe(1); // a phone: already as wide as it gets
  expect(fullZoom(DEMO_COLUMN * 1.5)).toBe(1.5);
  expect(fullZoom(4000)).toBe(1.75);
  expect(fullZoom(undefined)).toBe(1);
});
