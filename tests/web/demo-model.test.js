// The demo fence's pure parts: its tag, its limits, the tokens it is handed, how the frame's reports are read.
import { test, expect } from "bun:test";
import { DEMO_LANG, DEMO_MAX, DEMO_MIN_H, DEMO_MAX_H, DEMO_TOKENS, demoHeight, logLine, themeColours } from "../../src/web/demo-model.js";
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

test("accents, overlays, canvas colours, and ids stay as written", () => {
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
