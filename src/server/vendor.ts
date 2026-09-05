import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("./vendor/shiki-entry.js", import.meta.url));

export type VendorBundle = { body: string; etag: string };

let bundle: Promise<VendorBundle> | null = null;

/**
 * shiki, bundled once per process from `src/server/vendor/shiki-entry.js`. The page has no bundler;
 * shiki's ESM uses bare specifiers across seven packages, so this is the one place the server builds
 * anything. A failed build rejects with the bundler's messages and is retried on the next request.
 */
export function shikiBundle(): Promise<VendorBundle> {
  if (!bundle) {
    bundle = build().catch((error) => {
      bundle = null;
      throw error;
    });
  }
  return bundle;
}

async function build(): Promise<VendorBundle> {
  const result = await Bun.build({ entrypoints: [ENTRY], target: "browser", format: "esm", minify: true });
  if (!result.success || result.outputs.length === 0) {
    throw new Error(`shiki bundle failed: ${result.logs.map((l) => l.message).join("; ")}`);
  }
  const body = await result.outputs[0].text();
  return { body, etag: `"${Bun.hash(body).toString(16)}"` };
}
