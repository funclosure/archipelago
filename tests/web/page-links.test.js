import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

// The page has no build step, so a module that does not parse, declares a name twice, or imports a name its
// neighbour no longer exports only shows as a blank page in the browser. Bundling each entry point (to memory,
// nothing is written) makes the same mistakes fail here instead.
const web = (file) => resolve(import.meta.dir, "../../src/web", file);

describe("the page's modules link", () => {
  for (const entry of ["app.js", "about.js", "maps.js"]) {
    test(`${entry} and everything it imports parse and resolve`, async () => {
      const built = await Bun.build({ entrypoints: [web(entry)], target: "browser", throw: false });
      expect(built.logs.filter((l) => l.level === "error").map((l) => String(l.message ?? l))).toEqual([]);
      expect(built.success).toBe(true);
    });
  }
});
