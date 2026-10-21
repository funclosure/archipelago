// `bun run build:web` into a temporary folder: everything the page asks for is there, the worker carries no
// Bun or Node import, and it took the browser twins.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWeb, hostedIndex } from "../../scripts/build-web.ts";

let out: string;

beforeAll(async () => {
  out = join(mkdtempSync(join(tmpdir(), "archipelago-build-")), "web");
  await buildWeb(out);
}, 60_000);
afterAll(() => rmSync(join(out, ".."), { recursive: true, force: true }));

test("index.html sets the hosted flag before the page's module loads", () => {
  const html = readFileSync(join(out, "index.html"), "utf8");
  expect(html.indexOf("window.ARCHIPELAGO_HOSTED = true")).toBeGreaterThan(-1);
  expect(html.indexOf("window.ARCHIPELAGO_HOSTED = true")).toBeLessThan(html.indexOf('src="/app.js"'));
  expect(() => hostedIndex("<html></html>")).toThrow("no longer loads /app.js");
});

test("every file the page, its modules, and the worker ask for exists", () => {
  const html = readFileSync(join(out, "index.html"), "utf8");
  const wanted = new Set([...html.matchAll(/(?:src|href)="\/([^"]+)"/g)].map((m) => m[1]!));
  for (const file of readdirSync(out).filter((f) => f.endsWith(".js"))) {
    const code = readFileSync(join(out, file), "utf8");
    for (const m of code.matchAll(/from "\.\/([^"]+)"/g)) wanted.add(m[1]!);
    for (const m of code.matchAll(/["'`]\/((?:vendor\/)?[\w.-]+\.(?:js|wasm))["'`]/g)) wanted.add(m[1]!);
  }
  wanted.add("sqlite3.wasm");
  expect([...wanted].filter((f) => !existsSync(join(out, f)))).toEqual([]);
  expect(wanted).toContain("worker.js");
  expect(wanted).toContain("vendor/onig.wasm");
});

test("the worker imports nothing from Bun or Node and never bundles the Agent SDK", () => {
  const worker = readFileSync(join(out, "worker.js"), "utf8");
  expect(worker).not.toMatch(/(?:from|import\()\s*["'](?:bun|node):/);
  expect(worker).not.toContain("claude-agent-sdk");
  expect(worker).not.toContain("readFileSync");
});
