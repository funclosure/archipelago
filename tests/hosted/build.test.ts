// `bun run build:web` into a temporary folder: everything the page asks for is there, the worker carries no
// Bun or Node import, and it took the browser twins.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWeb, headersFile, hostedIndex } from "../../scripts/build-web.ts";
import { DEMO_FRAME_CSP, DEMO_FRAME_PATH } from "../../src/server/demo-frame.ts";

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
  // Bun writes its own imports with double quotes; the API SDK's error text quotes `import('node:buffer')` in single ones.
  expect(worker).not.toMatch(/(?:from|import\(|require\()\s*"(?:bun|node):/);
  expect(worker).not.toContain("claude-agent-sdk");
  expect(worker).not.toContain("readFileSync");
});

test("the worker carries the protocols, and the API client set up for a browser", () => {
  const worker = readFileSync(join(out, "worker.js"), "utf8");
  for (const file of ["PROTOCOL.md", "MENTOR.md", "CARTOGRAPHER.md"]) {
    const firstLine = readFileSync(join(import.meta.dir, "../../src/server/judge", file), "utf8").split("\n")[0]!;
    expect(worker).toContain(firstLine);
  }
  expect(worker).toContain("dangerouslyAllowBrowser");
});

test("_headers allows the page's inline scripts by hash, and connections only to itself and the API", () => {
  const headers = readFileSync(join(out, "_headers"), "utf8");
  const html = readFileSync(join(out, "index.html"), "utf8");
  expect(headers).toBe(headersFile(html));
  const csp = /Content-Security-Policy: (.*)/.exec(headers)![1]!;
  expect(csp).toContain("connect-src 'self' https://api.anthropic.com https://generativelanguage.googleapis.com https://openrouter.ai;");
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  expect(inline.length).toBe(2); // the theme stamp and the hosted flag
  expect(csp.match(/'sha256-/g)!.length).toBe(inline.length);
  // a changed inline script changes its hash: the build can never ship a CSP that blocks its own page
  expect(headersFile(html.replace("ARCHIPELAGO_HOSTED = true", "ARCHIPELAGO_HOSTED = 1"))).not.toBe(headers);
});

test("the demo frame trades the page's CSP for its own", () => {
  const headers = readFileSync(join(out, "_headers"), "utf8");
  // Pages redirects the .html path to the bare one, so both carry the frame's CSP
  for (const path of [DEMO_FRAME_PATH, "/demo-frame"]) {
    expect(headers).toContain(`\n${path}\n  ! Content-Security-Policy\n  Content-Security-Policy: ${DEMO_FRAME_CSP}\n`);
  }
  expect(readFileSync(join(out, "demo-frame.html"), "utf8")).toContain("demo-run");
});
