# Plot fences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A closed fence tagged `plot` draws a function graph in the pane's log, so the Keeper can argue in curves.

**Architecture:** Shuttle's fence format is taken unchanged, so a body renders in either app. A pure module parses the body and builds the library's options; a DOM module draws it; `function-plot` reaches the browser as a second `Bun.build` bundle beside shiki, served at `/vendor/plot.js` and dynamic-imported by the page. Plots are static and get their colours from the canvas palette.

**Tech Stack:** Bun, `bun:sqlite` (untouched here), `function-plot` 1.25.3, `Bun.build`, plain ES modules on the page, `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-12-plot-fences-design.md`

## Global Constraints

- Tests run with `bun test`, never vitest (vitest cannot resolve `bun:sqlite`). Typecheck with `bunx tsc --noEmit`.
- The page has no framework and no bundler. Never `innerHTML`; build DOM with `createElement` and `textContent`.
- Pure helpers are unit-tested; the canvas and the pane are checked by hand.
- No colour literal anywhere outside the `:root` blocks in `src/web/styles.css`. On the page, colours come from `PALETTE` in `src/web/draw.js` or from `var(--token)` in CSS. `tests/web/theme-tokens.test.js` enforces this.
- `function-plot` is pinned to exactly `1.25.3` (no caret): the bundle and the option names are version-specific.
- The three fence tags are exactly `plot`, `function-plot`, `math-plot`. Shuttle reads the same three; do not add or rename any.
- Every plot is static: `disableZoom: true`, always, so the pane's log keeps the wheel.
- The fixed options (`target`, `width`, `height`, `grid`, `disableZoom`) are applied **after** the parsed body, never before.
- Commit at the end of every task. House style: `feat(web):`, `docs:`, `style(web):`, lowercase subject, no trailing period.
- Nothing in this slice touches the database, a migration, the CLI, the snapshot, or the charting skill.

---

### Task 1: The pure model

**Files:**
- Create: `src/web/plot-model.js`
- Test: `tests/web/plot-model.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PLOT_LANGS: Set<string>` — `"plot"`, `"function-plot"`, `"math-plot"`.
  - `SERIES_KEYS: string[]` — palette keys a series takes in order: `["lamp", "grass", "snow", "reef"]`.
  - `parsePlot(body: string) → { options } | { error: string }`.
  - `plotSize(containerWidth: number) → { width: number, height: number }`.
  - `rgba(hex: string, a: number) → string`.
  - `plotColours(palette: {sea,line,…}) → { ground, axis, grid, text }`.
  - `plotOptions(options, { target, width, height, palette }) → object` handed straight to the library.

- [ ] **Step 1: Write the failing test**

Create `tests/web/plot-model.test.js`:

```js
// The plot fence's body → the library's options. Pure: the library is never imported here.
import { test, expect } from "bun:test";
import { PLOT_LANGS, SERIES_KEYS, parsePlot, plotSize, rgba, plotColours, plotOptions } from "../../src/web/plot-model.js";

const PALETTE = { sea: "#1B3F5B", line: "#FFFFFF", lamp: "#F5C242", reef: "#D9473A", sand: "#E7D39A", grass: "#6FAF5E", snow: "#F2F4F1" };

test("the three fence tags are shuttle's, and series colours have an order", () => {
  expect([...PLOT_LANGS].sort()).toEqual(["function-plot", "math-plot", "plot"]);
  expect(SERIES_KEYS).toEqual(["lamp", "grass", "snow", "reef"]);
});

test("one expression per line, comments and blank lines dropped", () => {
  expect(parsePlot("x^2")).toEqual({ options: { data: [{ fn: "x^2" }] } });
  expect(parsePlot("  x^2  \n\nsin(x)\n")).toEqual({ options: { data: [{ fn: "x^2" }, { fn: "sin(x)" }] } });
  expect(parsePlot("// the naive one\nx^2\n# and the good one\nx*log(x)")).toEqual({
    options: { data: [{ fn: "x^2" }, { fn: "x*log(x)" }] },
  });
});

test("an empty body, or one that is only comments, is an error and never an empty plot", () => {
  expect(parsePlot("").error).toBeTruthy();
  expect(parsePlot("   \n  ").error).toBeTruthy();
  expect(parsePlot("// nothing to draw").error).toBeTruthy();
  expect(parsePlot(null).error).toBeTruthy();
});

test("a body that starts with a brace is a function-plot options object", () => {
  const body = '{ "data": [{ "fn": "x^2" }], "xAxis": { "domain": [1, 50] } }';
  expect(parsePlot(body)).toEqual({ options: { data: [{ fn: "x^2" }], xAxis: { domain: [1, 50] } } });
});

test("malformed JSON is an error carrying a message, and a JSON array is not a config", () => {
  const bad = parsePlot('{ "data": [ }');
  expect(bad.options).toBeUndefined();
  expect(typeof bad.error).toBe("string");
  expect(bad.error.length).toBeGreaterThan(0);
  expect(parsePlot('[{ "fn": "x^2" }]').error).toBeTruthy();
});

test("plotSize fills the box, keeps 4:3, and stays inside the caps", () => {
  expect(plotSize(400)).toEqual({ width: 384, height: 288 });
  expect(plotSize(2000).width).toBe(560);
  expect(plotSize(2000).height).toBe(380);
  expect(plotSize(40).width).toBe(180);
});

test("rgba reads a six-digit token, and the colours come off the palette", () => {
  expect(rgba("#FFFFFF", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  expect(rgba("#1B3F5B", 1)).toBe("rgba(27, 63, 91, 1)");
  const c = plotColours(PALETTE);
  expect(c.ground).toBe("#1B3F5B");
  expect(c.axis).toBe("rgba(255, 255, 255, 0.65)");
  expect(c.grid).toBe("rgba(255, 255, 255, 0.16)");
  expect(c.text).toBe("rgba(255, 255, 255, 0.8)");
});

test("series take palette colours in order and wrap past the fourth; an explicit colour is kept", () => {
  const parsed = parsePlot("a\nb\nc\nd\ne").options;
  const out = plotOptions(parsed, { target: "T", width: 10, height: 20, palette: PALETTE });
  expect(out.data.map((d) => d.color)).toEqual(["#F5C242", "#6FAF5E", "#F2F4F1", "#D9473A", "#F5C242"]);
  const kept = plotOptions({ data: [{ fn: "x", color: "#123456" }] }, { target: "T", width: 10, height: 20, palette: PALETTE });
  expect(kept.data[0].color).toBe("#123456");
});

test("the body keeps its own axis options", () => {
  const parsed = parsePlot('{ "data": [{ "fn": "x^2" }], "xAxis": { "domain": [1, 50] }, "yAxis": { "domain": [0, 2500] } }').options;
  const out = plotOptions(parsed, { target: "T", width: 10, height: 20, palette: PALETTE });
  expect(out.xAxis).toEqual({ domain: [1, 50] });
  expect(out.yAxis).toEqual({ domain: [0, 2500] });
});

test("a body cannot move the plot, resize it, or take the wheel: the fixed options land last", () => {
  const parsed = parsePlot('{ "data": [{ "fn": "x" }], "target": "#elsewhere", "width": 9999, "height": 9999, "disableZoom": false, "grid": false }').options;
  const out = plotOptions(parsed, { target: "T", width: 300, height: 225, palette: PALETTE });
  expect(out.target).toBe("T");
  expect(out.width).toBe(300);
  expect(out.height).toBe(225);
  expect(out.disableZoom).toBe(true);
  expect(out.grid).toBe(true);
});

test("a config without data still yields a drawable options object", () => {
  const out = plotOptions({ xAxis: { domain: [0, 1] } }, { target: "T", width: 10, height: 20, palette: PALETTE });
  expect(out.data).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/web/plot-model.test.js`
Expected: FAIL, every test erroring on the missing module (`Cannot find module '.../src/web/plot-model.js'`).

- [ ] **Step 3: Write the implementation**

Create `src/web/plot-model.js`:

```js
// Pure, DOM-free: a plot fence's body → function-plot's options, the size of a plot in its box, and the
// colours the render pass paints on. The library is never imported here, and no colour is ever a literal:
// every one comes from the canvas palette the theme pushed into draw.js.

/** The fence tags that draw a plot. shuttle reads the same three, so a body renders in either app. */
export const PLOT_LANGS = new Set(["plot", "function-plot", "math-plot"]);

/** The palette keys a series takes, in order, wrapping past the fourth. */
export const SERIES_KEYS = ["lamp", "grass", "snow", "reef"];

const COMMENT = /^(\/\/|#)/;
const MIN_W = 180;
const MAX_W = 560;
const MAX_H = 380;

/**
 * A fence body → `{ options }` or `{ error }`. A body starting with a bracket is a function-plot options
 * object; anything else is one expression per line, with blank lines and `//` or `#` comments dropped.
 * shuttle tests only `{`; taking `[` here too turns a mistyped config into a plain message rather than
 * an expression the library chokes on, and no valid body in either app starts with a bracket.
 */
export function parsePlot(body) {
  const trimmed = String(body ?? "").trim();
  if (!trimmed) return { error: "nothing to plot" };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let options;
    try {
      options = JSON.parse(trimmed);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "the plot config is not JSON" };
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) return { error: "the plot config is not an object" };
    return { options };
  }
  const data = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !COMMENT.test(line))
    .map((fn) => ({ fn }));
  if (data.length === 0) return { error: "nothing to plot" };
  return { options: { data } };
}

/** A plot's box: the container's width less its padding, capped, and three quarters of that for the height. */
export function plotSize(containerWidth) {
  const width = Math.max(MIN_W, Math.min(Math.round(containerWidth) - 16, MAX_W));
  return { width, height: Math.min(Math.round(width * 0.75), MAX_H) };
}

/** `#RRGGBB` plus an alpha → `rgba(r, g, b, a)`. Six digits only, which every theme token is. */
export function rgba(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** What the render pass paints onto the SVG, from the canvas palette. */
export function plotColours(palette) {
  return {
    ground: palette.sea,
    axis: rgba(palette.line, 0.65),
    grid: rgba(palette.line, 0.16),
    text: rgba(palette.line, 0.8),
  };
}

/**
 * The options handed to the library: the body first, then ours. A body carrying `target`, `width`,
 * `height`, `grid` or `disableZoom` therefore cannot move the plot out of its box or take the wheel.
 */
export function plotOptions(options, { target, width, height, palette }) {
  const data = (Array.isArray(options.data) ? options.data : []).map((d, i) => ({
    ...d,
    color: d.color ?? palette[SERIES_KEYS[i % SERIES_KEYS.length]],
  }));
  return { ...options, data, target, width, height, grid: true, disableZoom: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/web/plot-model.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/web/plot-model.js tests/web/plot-model.test.js
git commit -m "feat(web): a plot fence's body becomes function-plot options, ours applied last"
```

---

### Task 2: The bundle and its route

**Files:**
- Modify: `package.json` (via `bun add`), `bun.lock`
- Create: `src/server/vendor/plot-entry.js`
- Modify: `src/server/vendor.ts` (whole file rewritten below)
- Modify: `src/server/routes.ts:23` (the import), `src/server/routes.ts:48-60` (the vendor branches)
- Test: `tests/server/routes.test.ts` (one new test beside the shiki one, near line 381)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `GET /vendor/plot.js`, an ES module exporting `functionPlot`, served with an ETag and answering 304. In `vendor.ts`: `vendorBundle(name: "shiki" | "plot") → Promise<{ body, etag }>` and the exported type `VendorName`. `shikiBundle()` no longer exists; the shiki route calls `vendorBundle("shiki")`.

- [ ] **Step 1: Add the dependency**

Run: `bun add --exact function-plot@1.25.3`
Expected: `installed function-plot@1.25.3`, and `package.json` gains `"function-plot": "1.25.3"` with no caret.

- [ ] **Step 2: Write the failing test**

In `tests/server/routes.test.ts`, immediately after the test named `"shiki is bundled and served from the vendor route with an ETag"`, add:

```ts
test("function-plot is bundled and served from the vendor route with an ETag", async () => {
  const r = await fetch(`${base}/vendor/plot.js`);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("javascript");
  const etag = r.headers.get("etag");
  expect(etag).toMatch(/^"[0-9a-f]+"$/);
  const body = await r.text();
  expect(body.length).toBeGreaterThan(100000);
  expect(body).toContain("functionPlot");
  const again = await fetch(`${base}/vendor/plot.js`, { headers: { "if-none-match": etag! } });
  expect(again.status).toBe(304);
  expect(await again.text()).toBe("");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/server/routes.test.ts`
Expected: FAIL on the new test with `expect(received).toBe(200)` receiving 404, since the route does not exist yet.

- [ ] **Step 4: Write the bundle entry**

Create `src/server/vendor/plot-entry.js`:

```js
// The plot bundle the page loads: function-plot's default export, given a name so the page can import it.
// Built once per process by `vendorBundle("plot")` and served at /vendor/plot.js. The library's own ESM
// spans eleven packages (a d3 subset, an interval-arithmetic evaluator), which is why it is bundled at all.
import functionPlot from "function-plot";

export { functionPlot };
```

- [ ] **Step 5: Generalise the bundler from one library to a named set**

Replace the whole of `src/server/vendor.ts` with:

```ts
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
```

- [ ] **Step 6: Serve both bundles through one helper**

In `src/server/routes.ts`, change the import on line 23 from:

```ts
import { shikiBundle } from "./vendor.ts";
```

to:

```ts
import { vendorBundle, type VendorName } from "./vendor.ts";
```

Then replace the `GET /vendor/shiki.js` branch (the five lines from `if (route === "GET /vendor/shiki.js") {`) with these two lines, keeping the mermaid and wasm branches above them untouched:

```ts
    if (route === "GET /vendor/shiki.js") return await vendorResponse(req, "shiki");
    if (route === "GET /vendor/plot.js") return await vendorResponse(req, "plot");
```

And add this helper at module level, directly above `export async function handleRequest`:

```ts
/** A bundled library: built on first request, then an ETag the page can revalidate against. */
async function vendorResponse(req: Request, name: VendorName): Promise<Response> {
  const { body, etag } = await vendorBundle(name);
  const headers = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", ETag: etag };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/server/routes.test.ts`
Expected: PASS, including both vendor-bundle tests. The first `/vendor/plot.js` request builds the bundle, which takes a second or two.

- [ ] **Step 8: Typecheck and run everything**

Run: `bunx tsc --noEmit && bun test`
Expected: no type errors; the whole suite passes. `shikiBundle` must appear nowhere: `grep -rn "shikiBundle" src tests` returns nothing.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock src/server/vendor.ts src/server/vendor/plot-entry.js src/server/routes.ts tests/server/routes.test.ts
git commit -m "feat(server): function-plot is bundled beside shiki and served at /vendor/plot.js"
```

---

### Task 3: The element, the fence branch, and the box it sits in

**Files:**
- Create: `src/web/plot.js`
- Modify: `src/web/markdown.js:1-4` (imports), `src/web/markdown.js:177-183` (the fence branches)
- Modify: `src/web/styles.css:210-212` (a `.plot` block beside `.diagram`), `src/web/styles.css:315` (the board's card margin rule)

**Interfaces:**
- Consumes: `parsePlot`, `plotSize`, `plotOptions`, `plotColours`, `PLOT_LANGS` from Task 1; `GET /vendor/plot.js` from Task 2; `PALETTE` from `src/web/draw.js`.
- Produces: `plotElement(source: string) → HTMLDivElement`, the mirror of `diagramElement(source)` in `markdown.js`. The board slice will call exactly this.

- [ ] **Step 1: Write the element**

Create `src/web/plot.js`:

```js
// Plot fences in the log: a function-plot drawing from the bundle the server builds (/vendor/plot.js).
// Static by design — zoom and pan are off, so the log keeps the wheel. Colours are read from the canvas
// palette at draw time, and a plot is redrawn rather than cached, so a resize or a theme switch (which
// rebuilds the pane and the board) comes back in the right tokens with nothing to invalidate.
import { PALETTE } from "./draw.js";
import { parsePlot, plotSize, plotOptions, plotColours } from "./plot-model.js";

let plotter = null;
let loading = null;

/** Imports the bundle once. Resolves false when it cannot be had, and the fence stays as its source. */
function load() {
  if (plotter) return Promise.resolve(true);
  if (!loading) {
    loading = import("/vendor/plot.js")
      .then((m) => {
        plotter = m.functionPlot;
        return true;
      })
      .catch((error) => {
        console.warn("plots unavailable:", error);
        loading = null; // a later fence may try again
        return false;
      });
  }
  return loading;
}

/** The source, with the reason it did not draw above it. */
function fallback(source, message) {
  const frag = document.createDocumentFragment();
  const err = document.createElement("div");
  err.className = "error";
  err.textContent = message;
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = source;
  pre.append(code);
  frag.append(err, pre);
  return frag;
}

/** function-plot writes attributes and classes, so the palette goes on as inline styles: nothing outbids them. */
function paint(target, colours) {
  const svg = target.querySelector("svg");
  if (!svg) return;
  svg.style.backgroundColor = colours.ground;
  for (const el of svg.querySelectorAll(".axis path, .axis line")) el.style.stroke = colours.axis;
  for (const el of svg.querySelectorAll(".grid line, .grid path")) el.style.stroke = colours.grid;
  for (const el of svg.querySelectorAll("text")) el.style.fill = colours.text;
}

function draw(holder, source, options) {
  const box = holder.clientWidth || holder.parentElement?.clientWidth || 320;
  const target = document.createElement("div");
  holder.replaceChildren(target);
  try {
    plotter(plotOptions(options, { target, ...plotSize(box), palette: PALETTE }));
    paint(target, plotColours(PALETTE));
  } catch (e) {
    holder.replaceChildren(fallback(source, e instanceof Error ? e.message : "the plot did not draw"));
  }
}

/** Redraws at a new width. Disconnects itself once the plot has left the document. */
function observe(box, holder, source, options) {
  if (typeof ResizeObserver !== "function") return;
  let last = holder.clientWidth;
  const ro = new ResizeObserver(() => {
    if (!box.isConnected) {
      ro.disconnect();
      return;
    }
    const now = holder.clientWidth;
    if (Math.abs(now - last) < 8) return; // a redraw changes the height, never the width
    last = now;
    draw(holder, source, options);
  });
  ro.observe(holder);
}

/** A closed plot fence: an element now, the drawing when the bundle lands, the source if it cannot draw. */
export function plotElement(source) {
  const box = document.createElement("div");
  box.className = "plot";
  const cap = document.createElement("div");
  cap.className = "cap";
  cap.textContent = "plot";
  box.append(cap);
  const holder = document.createElement("div");
  holder.className = "holder";
  box.append(holder);

  const parsed = parsePlot(source);
  if (parsed.error) {
    holder.append(fallback(source, parsed.error));
    return box;
  }
  holder.textContent = "drawing a plot…";
  load().then((ready) => {
    if (!ready) {
      holder.replaceChildren(fallback(source, "plots unavailable"));
      return;
    }
    // A frame later: the element is in the document by then, so the first draw already has the pane's width.
    requestAnimationFrame(() => {
      draw(holder, source, parsed.options);
      observe(box, holder, source, parsed.options);
    });
  });
  return box;
}
```

- [ ] **Step 2: Route the fence**

In `src/web/markdown.js`, add two imports under the existing `import { codeElement } from "./code.js";` on line 4:

```js
import { plotElement } from "./plot.js";
import { PLOT_LANGS } from "./plot-model.js";
```

Then in `renderMarkdown`, insert two branches between the mermaid branches and the generic code branch, so the chain reads:

```js
    } else if (b.type === "code" && b.lang === "mermaid" && b.closed) {
      frag.append(diagramElement(b.text));
    } else if (b.type === "code" && b.lang === "mermaid") {
      frag.append(sourceBlock("drawing a diagram…"));
    } else if (b.type === "code" && PLOT_LANGS.has(b.lang) && b.closed) {
      frag.append(plotElement(b.text));
    } else if (b.type === "code" && PLOT_LANGS.has(b.lang)) {
      frag.append(sourceBlock("drawing a plot…"));
    } else if (b.type === "code") {
      frag.append(codeElement(b.lang, b.text, b.closed));
    }
```

- [ ] **Step 3: Give the plot its box**

In `src/web/styles.css`, directly after the three `.diagram` rules (line 212), add:

```css
.plot { margin: 6px 0 8px; padding: 10px 8px; background: var(--water); border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; }
.plot svg { display: block; margin: 0 auto; }
.plot .cap { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
.plot .error { margin-bottom: 6px; }
```

And extend the board's card rule (line 315) so a plot inside a card sits flush like a diagram:

```css
.board .card .diagram, .board .card .codeblock, .board .card .plot { margin: 0; }
```

- [ ] **Step 4: Run the suite and the typechecker**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS, `tests/web/theme-tokens.test.js` included — it fails if any literal colour reached `styles.css`.

- [ ] **Step 5: Check it by hand in the browser**

There is no DOM in `bun test`, so the drawing is checked the way the canvas and the pane are. Start the server against the DSA domain:

```bash
bun run src/cli/index.ts serve --domain data-structures-algorithms --stub
```

Select an island, press **Make landfall**, and in the answer box send this reader message, which renders through the same markdown path:

````
Two costs:

```plot
x^2
x*log(x)
```
````

Confirm, in order:

1. The plot draws inside a bordered box captioned `plot`, curves in lamp and grass, axes and gridlines visible, the sea colour behind it.
2. The wheel over the plot scrolls the log. Dragging the plot does nothing.
3. Press `t` to switch to the paper chart theme. The pane rebuilds and the plot comes back with the light theme's tokens, legible on paper.
4. A windowed body draws in its window: send ```` ```plot ```` with `{ "data": [{ "fn": "x^2" }], "xAxis": { "domain": [1, 50] } }`.
5. A broken body shows the message above its own source, and the rest of the log is unharmed: send a fence containing `{ "data": [ }`, then one containing `x^^2`.
6. Widen and narrow the window: the plot redraws to the pane's width without clipping.
7. An unclosed fence, mid-stream, reads `drawing a plot…` and never a half-expression.

- [ ] **Step 6: Commit**

```bash
git add src/web/plot.js src/web/markdown.js src/web/styles.css
git commit -m "feat(web): a plot fence draws a curve in the log, static and in the theme's colours"
```

---

### Task 4: The judge may answer with a plot

**Files:**
- Modify: `src/server/judge/PROTOCOL.md` (§9 only)
- Modify: `CLAUDE.md` (the conventions bullet that already covers mermaid and shiki)

**Interfaces:**
- Consumes: the fence tags from Task 1, the rendering from Task 3.
- Produces: nothing in code. The judge's system prompt is this file, read whole by `src/server/judge/context.ts`.

- [ ] **Step 1: Widen the one-fence rule**

In `src/server/judge/PROTOCOL.md`, change the §9 heading from `## 9. Code` to `## 9. Code and plots`, and in its paragraph replace:

> One fence per reply, a code block or a diagram, not both.

with:

> One fence per reply: a code block, a diagram, or a plot, never two.

- [ ] **Step 2: Say when a plot earns its place**

Append this paragraph to the end of §9, above the `## 10. The board` heading:

```markdown
**A plot** when the claim is a curve rather than a structure: how two costs diverge, what a recurrence grows like, where the threshold between two approaches actually sits. Fence it as `plot`, with one expression per line (`x^2`, `x*log(x)`, `x*x/2`) or a JSON body when the window matters (`{"data":[{"fn":"x^2"}],"xAxis":{"domain":[1,50]}}`). Use `x` as the variable; the plot is static, so choose the domain yourself rather than inviting the reader to zoom. One sentence before it says what to look at, and the question that follows asks the reader to read the curve — where they cross, what happens past the crossing — never "what do you see". A plot instead of a code block or a diagram, not beside one.
```

- [ ] **Step 3: Record the convention**

In `CLAUDE.md`, in the conventions bullet beginning "Asks: `asks` rows attach…", append this sentence at the end of the bullet:

```markdown
Plot fences (`plot`, `function-plot`, `math-plot`) draw through `function-plot`, bundled like shiki by `vendorBundle("plot")` and served at `/vendor/plot.js`; they are static (`disableZoom`), take their colours from `PALETTE`, and are redrawn rather than cached (`src/web/plot.js`, pure parts in `src/web/plot-model.js`). The format is shuttle's, so a body renders in both apps, and the judge's plot rule is PROTOCOL §9.
```

- [ ] **Step 4: Run the suite**

Run: `bun test`
Expected: PASS. No test asserts the protocol's text, so this step is a regression check only.

- [ ] **Step 5: Check the real judge draws one**

The stub judge never writes a plot, so this needs the real one. Run:

```bash
bun run src/cli/index.ts serve --domain data-structures-algorithms
```

Make landfall on `sorting-and-searching` or `complexity` and answer twice in a way that invites a curve, for instance claiming that "n log n is always faster than n²". Confirm the Keeper's plot fence renders as a drawing, that the reply carries no second fence beside it, and that its question asks you to read the curve.

- [ ] **Step 6: Commit**

```bash
git add src/server/judge/PROTOCOL.md CLAUDE.md
git commit -m "docs: the Keeper may answer with a plot; the plot convention"
```

---

### Task 5: Close the slice

**Files:**
- Modify: `docs/superpowers/specs/2026-09-12-plot-fences-design.md` (the status line)
- Modify: `.superpowers/sdd/progress.md` (the ledger, a "Plot fences plan" section)

- [ ] **Step 1: Run everything one last time**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 2: Mark the spec implemented**

In `docs/superpowers/specs/2026-09-12-plot-fences-design.md`, change `**Status:** approved, not implemented` to `**Status:** implemented`.

- [ ] **Step 3: Write down what was deferred**

Append a `## Plot fences plan` section to `.superpowers/sdd/progress.md` naming anything the hand-checks turned up and left, plus the two follow-on slices the spec already names: board plot cards (migration 0008 rebuilds `board_cards`) and interactive zoom (one flag plus a decision about who owns the wheel).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-12-plot-fences-design.md .superpowers/sdd/progress.md
git commit -m "docs: plot fences spec is implemented; what was deferred"
```
