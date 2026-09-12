import { fileURLToPath } from "node:url";

const ENTRIES = {
  shiki: fileURLToPath(new URL("./vendor/shiki-entry.js", import.meta.url)),
  plot: fileURLToPath(new URL("./vendor/plot-entry.js", import.meta.url)),
} as const;

export type VendorName = keyof typeof ENTRIES;
export type VendorBundle = { body: string; etag: string };

const bundles = new Map<VendorName, Promise<VendorBundle>>();

/**
 * A vendored library, bundled once per process for the browser. The page has no bundler; shiki's ESM
 * spans seven packages and function-plot's eleven, so this is the one place the server builds anything.
 * A failed build rejects with the bundler's messages and is retried on the next request.
 */
export function vendorBundle(name: VendorName): Promise<VendorBundle> {
  let bundle = bundles.get(name);
  if (!bundle) {
    bundle = build(ENTRIES[name]).catch((error) => {
      bundles.delete(name);
      console.error(`${name} bundle failed:`, error);
      throw error;
    });
    bundles.set(name, bundle);
  }
  return bundle;
}

async function build(entry: string): Promise<VendorBundle> {
  const result = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm", minify: true });
  if (!result.success || result.outputs.length === 0) {
    throw new Error(`bundle failed: ${result.logs.map((l) => l.message).join("; ")}`);
  }
  const body = await result.outputs[0].text();
  return { body, etag: `"${Bun.hash(body).toString(16)}"` };
}
