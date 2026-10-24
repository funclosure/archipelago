// `bun run build:web [--out dir]`: the hosted build, a static site in `dist/web/`. The page's files are copied as they
// are (the local page has no build step and keeps none); the server becomes `worker.js`, bundled with three modules
// swapped for browser twins; the vendor libraries the local server bundles per process are written out as files.
import { createHash } from "node:crypto";
import { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BunPlugin } from "bun";
import { PROVIDERS } from "../src/hosted/settings.ts";
import { vendorBundle } from "../src/server/vendor.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = (path: string) => join(ROOT, "src", path);

/** A module of the server, by its path under src/, and the browser twin the worker bundle uses instead. */
export const TWINS: Record<string, string> = {
  "core/db.ts": "hosted/db.ts",
  "server/judge/protocol.ts": "hosted/protocol.ts",
  "server/judge/sdk.ts": "hosted/no-sdk.ts",
};

const twins: BunPlugin = {
  name: "hosted-twins",
  setup(build) {
    build.onResolve({ filter: /\.ts$/ }, (args) => {
      if (!args.path.startsWith(".")) return undefined;
      const path = resolve(dirname(args.importer), args.path);
      for (const [from, to] of Object.entries(TWINS)) if (path === src(from)) return { path: src(to) };
      return undefined;
    });
  },
};

/** The page's `index.html` with the flag that sends its requests to the worker. */
export function hostedIndex(html: string): string {
  const marker = '<script type="module" src="/app.js"></script>';
  if (!html.includes(marker)) throw new Error("index.html no longer loads /app.js as expected");
  return html.replace(marker, `<script>window.ARCHIPELAGO_HOSTED = true;</script>\n${marker}`);
}

/**
 * Cloudflare Pages' `_headers`: a CSP that lets the page reach only itself and the providers a key can be for, with the inline
 * scripts of `html` (the theme stamp, the hosted flag) allowed by hash, and wasm compilation for sqlite and shiki.
 * `'unsafe-eval'` is for function-plot, which compiles each parsed expression with `new Function`; nothing on the
 * page builds markup from strings (no innerHTML), so there is no injected text for an eval to reach.
 */
export function headersFile(html: string): string {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`,
  );
  const csp = [
    "default-src 'self'",
    `connect-src 'self' ${PROVIDERS.map((p) => `https://${p.host}`).join(" ")}`,
    `script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' ${hashes.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    "  Referrer-Policy: no-referrer",
    "  X-Content-Type-Options: nosniff",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
    // The page has no build hashes in its file names: every load asks whether a file changed.
    "  Cache-Control: no-cache",
    "",
  ].join("\n");
}

export async function buildWeb(out: string): Promise<void> {
  rmSync(out, { recursive: true, force: true });
  cpSync(src("web"), out, { recursive: true });
  const html = hostedIndex(readFileSync(src("web/index.html"), "utf8"));
  writeFileSync(join(out, "index.html"), html);
  writeFileSync(join(out, "_headers"), headersFile(html));

  mkdirSync(join(out, "vendor"), { recursive: true });
  copyFileSync(src("server/vendor/mermaid.min.js"), join(out, "vendor/mermaid.js"));
  copyFileSync(fileURLToPath(import.meta.resolve("shiki/dist/onig.wasm")), join(out, "vendor/onig.wasm"));
  for (const name of ["shiki", "plot"] as const) writeFileSync(join(out, `vendor/${name}.js`), (await vendorBundle(name)).body);

  const worker = await Bun.build({
    entrypoints: [src("hosted/worker.ts")],
    target: "browser",
    format: "esm",
    minify: true,
    plugins: [twins],
    // Read only when a turn runs on the API; the hosted build passes its settings in instead.
    define: { "process.env.ARCHIPELAGO_MODEL": "undefined", "process.env.ARCHIPELAGO_EFFORT": "undefined" },
  });
  if (!worker.success) throw new Error(`worker bundle failed: ${worker.logs.map((l) => l.message).join("; ")}`);
  writeFileSync(join(out, "worker.js"), await worker.outputs[0]!.text());
  // sqlite-wasm finds its wasm beside the module that loads it, which is now worker.js.
  copyFileSync(fileURLToPath(import.meta.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")), join(out, "sqlite3.wasm"));
}

if (import.meta.main) {
  const i = process.argv.indexOf("--out");
  const out = resolve(i > 0 ? process.argv[i + 1]! : join(ROOT, "dist/web"));
  await buildWeb(out);
  console.log(`built ${out}`);
}
