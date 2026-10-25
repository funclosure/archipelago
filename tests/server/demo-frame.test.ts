// The demo frame: served with its own CSP (no network, scripts inline only), and the mentor stub writes a demo fence.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../../src/server/index.ts";
import { DEMO_FRAME_CSP, DEMO_FRAME_PATH } from "../../src/server/demo-frame.ts";

const WEB = fileURLToPath(new URL("../../src/web", import.meta.url));
let dir: string;
let server: ReturnType<typeof startServer>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-demo-"));
  server = startServer({ port: 0, dbPath: join(dir, "t.sqlite"), staticRoot: WEB, stub: true });
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

test("the frame carries its own CSP: inline scripts, no network, no forms, embeddable by the page only", async () => {
  const res = await fetch(`http://127.0.0.1:${server.port}${DEMO_FRAME_PATH}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-security-policy")).toBe(DEMO_FRAME_CSP);
  for (const rule of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "frame-ancestors 'self'", "script-src 'unsafe-inline' 'unsafe-eval'"]) {
    expect(DEMO_FRAME_CSP).toContain(rule);
  }
  expect(await res.text()).toContain("demo-run");
  // every other file keeps no CSP locally
  expect((await fetch(`http://127.0.0.1:${server.port}/index.html`)).headers.get("content-security-policy")).toBeNull();
});
