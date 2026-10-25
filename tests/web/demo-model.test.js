// The demo fence's pure parts: its tag, its limits, the tokens it is handed, how the frame's reports are read.
import { test, expect } from "bun:test";
import { DEMO_LANG, DEMO_MAX, DEMO_MIN_H, DEMO_MAX_H, DEMO_TOKENS, demoHeight, logLine } from "../../src/web/demo-model.js";
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
