# Chart and Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the card and the dock with one full-height conversation pane on the right, make the map frame the selected island beside it, and render every message as forgiving markdown.

**Architecture:** Pure helpers first (`thread.js` markdown and log items, `camera.js` inset framing), each unit-tested with `bun test`. Then the map side (`draw.js` colours, `app.js` framing, chrome moved out from under the pane). Then the pane itself: `card.js` is re-laid out into head, log, and foot, with a new `markdown.js` that turns `mdBlocks` into DOM. No server, CLI, or database change. Spec: `docs/superpowers/specs/2026-09-04-chart-and-log-design.md`. Prototype to match: https://claude.ai/code/artifact/a0a1b592-9237-4115-8f70-18d1dd9fc924.

**Tech Stack:** Bun, plain ES modules in `src/web/` (no framework, no bundler), canvas map, `bun test` for pure helpers.

## Global Constraints

- Tests run with `bun test`, never vitest. Pure helpers in `src/web/` are unit-tested; DOM and canvas are checked by hand against `bun run src/cli/index.ts serve --stub`.
- No framework, no bundler, no `innerHTML`: DOM is built with `createElement` and `textContent`.
- Pane width `clamp(340px, 38vw, 440px)`; below a 720px viewport the pane is full width.
- The log is the only scroll region. It sticks to the bottom when the reader was within 40px of the bottom before an update.
- Select frames the island at the centre of the area left of the pane at `max(current scale, home scale × 1.5)`, animated over 450 ms. Deselect animates to the home framing over 450 ms.
- Open-water outline colour `#8a8078` (`PALETTE.open`), open-water label colour `#a8a097` (`PALETTE.openText`).
- Copy, verbatim: pills `open water`, `open water · islets below`, `settled · 82%` (state, middle dot, confidence percent), `reef · 88%`; head links `Sail closer`, `Sail in`, `Note to cartographer`; empty-thread buttons `Make landfall` (no verdict) and `Explore it` (verdict); placeholders `your answer`, `the judge is thinking…`, `what is wrong with this reef`, `press Make landfall to begin`, `press Explore it to begin`; foot meta `Enter to send · Shift-Enter for a new line`, `Confirm charts the reef · Dispute sends your objection`, busy `the judge is answering`; verdict pill `charted as <state>`; lit line `◆ A · B`; note sent `Note sent. Claude reads it at the start of the next turn.`
- Markdown: `**strong**`, `*em*`/`_em_`, `` `code` ``, `#`–`###` headings, `-`/`*`/`+` bullets, `1.`/`1)` numbered items, ``` fences (an unclosed fence is still a code block), paragraphs split on blank lines with single newlines kept as line breaks. Partial input never throws and never loses text.
- Streaming DOM writes are batched once per animation frame. A caret follows the last character while a reply streams.
- Everything in `card.js` that guards stale islands, lost drafts, and late loads (`loadGen`, slug checks, `focusPending`, `thread.version`) stays.
- Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq`.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/web/thread.js` | pure: `inlineSegments`, `mdBlocks`, `logItems`; `paragraphs` removed | 1 |
| `tests/web/thread.test.js` | tests for the above | 1 |
| `src/web/camera.js` | `fit(w, h, inset)`, `centreOn(point, w, h, inset, scale)`, `closer()` | 2 |
| `tests/web/camera.test.js` | new | 2 |
| `src/web/draw.js` | `PALETTE.open`, `PALETTE.openText` | 3 |
| `src/web/app.js` | `paneInset()`, `frameSelection()`, resize with inset | 3 |
| `src/web/interactions.js` | `select` frames the island | 3 |
| `src/web/index.html` | strip and status under the breadcrumb; later `#pane` replaces `#card` and `#dock` | 3, 4 |
| `src/web/styles.css` | chrome column; pane styles replace card and dock styles | 3, 4 |
| `src/web/markdown.js` | new: `renderMarkdown(text)` → `DocumentFragment` | 4 |
| `src/web/card.js` | the pane: head, log, foot | 4 |
| `README.md`, `CLAUDE.md`, spec status | docs | 5 |

---

### Task 1: Markdown and log-item helpers in `thread.js`

**Files:**
- Modify: `src/web/thread.js`
- Test: `tests/web/thread.test.js`

**Interfaces:**
- Consumes: `threadItems(messages)` (existing, unchanged).
- Produces: `inlineSegments(text) → [{ type: "text"|"strong"|"em"|"code", text }]`; `mdBlocks(text) → [{ type: "p", lines: Segment[][] } | { type: "h", level: 1|2|3, segments: Segment[] } | { type: "list", ordered: boolean, items: Segment[][] } | { type: "code", text }]`; `logItems(messages, island) → items` where a merged lit line is `{ kind: "landmark", names: string[] }` and the last `charted as` system line becomes `{ kind: "verdict", verdict: island.verdict }`. `paragraphs` stays until Task 4 rewrites its only importer.

- [ ] **Step 1: Write the failing tests**

In `tests/web/thread.test.js`, update the import line to:

```js
import { threadItems, proposalFromBody, paragraphs, landmarkFromSystem, inlineSegments, mdBlocks, logItems } from "../../src/web/thread.js";
```

Keep the existing tests (including `paragraphs`) and append:

```js
test("inlineSegments renders strong, em, and code, and leaves unmatched markers literal", () => {
  expect(inlineSegments("plain")).toEqual([{ type: "text", text: "plain" }]);
  expect(inlineSegments("**1. Bottleneck analysis first.** Look at CPU")).toEqual([
    { type: "strong", text: "1. Bottleneck analysis first." },
    { type: "text", text: " Look at CPU" },
  ]);
  expect(inlineSegments("that charts *transactions* and _contention_ via `cache-aside`")).toEqual([
    { type: "text", text: "that charts " },
    { type: "em", text: "transactions" },
    { type: "text", text: " and " },
    { type: "em", text: "contention" },
    { type: "text", text: " via " },
    { type: "code", text: "cache-aside" },
  ]);
  expect(inlineSegments("an **unclosed marker")).toEqual([{ type: "text", text: "an **unclosed marker" }]);
  expect(inlineSegments("2 * 3 * 4 and snake_case_name")).toEqual([{ type: "text", text: "2 * 3 * 4 and snake_case_name" }]);
  expect(inlineSegments("")).toEqual([]);
});

test("mdBlocks splits paragraphs on blank lines and keeps single newlines as line breaks", () => {
  expect(mdBlocks("one\ntwo\n\nthree\n")).toEqual([
    { type: "p", lines: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]] },
    { type: "p", lines: [[{ type: "text", text: "three" }]] },
  ]);
  expect(mdBlocks("")).toEqual([]);
});

test("mdBlocks parses headings, bullet and numbered lists, and fences, closed or not", () => {
  const blocks = mdBlocks("## Why\n- **first** point\n- second\n1. one\n2) two\n```\nlet x = 1;\n```\ntail");
  expect(blocks.map((b) => b.type)).toEqual(["h", "list", "list", "code", "p"]);
  expect(blocks[0]).toEqual({ type: "h", level: 2, segments: [{ type: "text", text: "Why" }] });
  expect(blocks[1]).toEqual({ type: "list", ordered: false, items: [[{ type: "strong", text: "first" }, { type: "text", text: " point" }], [{ type: "text", text: "second" }]] });
  expect(blocks[2]).toEqual({ type: "list", ordered: true, items: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]] });
  expect(blocks[3]).toEqual({ type: "code", text: "let x = 1;" });
  expect(mdBlocks("before\n```js\nstill open")).toEqual([
    { type: "p", lines: [[{ type: "text", text: "before" }]] },
    { type: "code", text: "still open" },
  ]);
  expect(mdBlocks("*emphasis* at the start is not a bullet")).toEqual([
    { type: "p", lines: [[{ type: "em", text: "emphasis" }, { type: "text", text: " at the start is not a bullet" }]] },
  ]);
});

test("mdBlocks never loses text on partial input", () => {
  const full = "Measuring first is the **right instinct**, and you named it.\n\n- one\n- tw";
  for (let i = 0; i <= full.length; i++) {
    const text = full.slice(0, i);
    const flat = mdBlocks(text)
      .flatMap((b) => (b.type === "p" ? b.lines.flat() : b.type === "list" ? b.items.flat() : b.type === "h" ? b.segments : [{ type: "text", text: b.text }]))
      .map((s) => s.text)
      .join("");
    // markers and structure characters are the only things allowed to disappear
    expect(flat.replace(/[*_`#\-\s]/g, "")).toBe(text.replace(/[*_`#\-\s]/g, ""));
  }
});

test("logItems merges consecutive lit lines and turns only the last 'charted as' line into a verdict card", () => {
  const verdict = { state: "settled", confidence: 0.82, evidence: "e", rationale: "r", at: "2026-09-04T10:00:00Z" };
  const messages = [
    { id: 1, role: "judge", kind: "text", body: "Explain." },
    { id: 2, role: "you", kind: "text", body: "answer" },
    { id: 3, role: "judge", kind: "system", body: "landmark lit: Statelessness" },
    { id: 4, role: "judge", kind: "system", body: "landmark lit: Bottleneck analysis" },
    { id: 5, role: "judge", kind: "system", body: "charted as sandbar" },
    { id: 6, role: "judge", kind: "system", body: "landmark lit: Elasticity" },
    { id: 7, role: "judge", kind: "text", body: "Reply." },
    { id: 8, role: "judge", kind: "system", body: "charted as settled" },
  ];
  const items = logItems(messages, { verdict });
  expect(items.map((i) => i.kind)).toEqual(["text", "text", "landmark", "system", "landmark", "text", "verdict"]);
  expect(items[2].names).toEqual(["Statelessness", "Bottleneck analysis"]);
  expect(items[3].text).toBe("charted as sandbar");
  expect(items[4].names).toEqual(["Elasticity"]);
  expect(items[6].verdict).toBe(verdict);
  // without a verdict on the island the line stays a system line
  expect(logItems(messages, { verdict: null }).map((i) => i.kind)).toEqual(["text", "text", "landmark", "system", "landmark", "text", "system"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/web/thread.test.js`
Expected: FAIL, `inlineSegments`, `mdBlocks`, `logItems` are not exported.

- [ ] **Step 3: Implement the helpers**

In `src/web/thread.js`, keep `paragraphs` (Task 4 removes it) and append:

```js
// Inline markdown. Strong and em require non-space content at both ends, so "2 * 3 * 4" stays literal;
// underscores need a non-word character on the outside, so snake_case stays literal. No nesting.
const INLINE = /\*\*(\S(?:[^*\n]*?\S)?)\*\*|`([^`\n]+)`|(?<![\w*])\*(\S(?:[^*\n]*?\S)?)\*(?![\w*])|(?<!\w)_(\S(?:[^_\n]*?\S)?)_(?!\w)/g;

/** Inline markdown → segments: **strong**, *em* or _em_, `code`. Unmatched markers stay literal text. */
export function inlineSegments(text) {
  const out = [];
  let last = 0;
  let m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: "strong", text: m[1] });
    else if (m[2] !== undefined) out.push({ type: "code", text: m[2] });
    else out.push({ type: "em", text: m[3] ?? m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/**
 * Block markdown, line by line, forgiving of half-written input: paragraphs (single newlines kept as
 * line breaks), #–### headings, -/*/+ bullets, 1. or 1) items, ``` fences (unclosed at the end still counts).
 */
export function mdBlocks(text) {
  const blocks = [];
  let para = [];
  let list = null;
  let fence = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", lines: para.map(inlineSegments) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of String(text).split("\n")) {
    const line = raw.trimEnd();
    if (fence) {
      if (/^\s*```/.test(line)) {
        blocks.push(fence);
        fence = null;
      } else fence.text += (fence.text ? "\n" : "") + raw;
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushPara();
      flushList();
      fence = { type: "code", text: "" };
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)/);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ type: "h", level: h[1].length, segments: inlineSegments(h[2]) });
      continue;
    }
    const li = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)/);
    if (li) {
      flushPara();
      const ordered = li[2] !== undefined;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { type: "list", ordered, items: [] };
      }
      list.items.push(inlineSegments(li[3]));
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  if (fence) blocks.push(fence);
  return blocks;
}

const CHARTED_PREFIX = "charted as ";

/**
 * What the log renders: threadItems, with consecutive landmark items merged into one lit line and the
 * last "charted as" system line turned into a verdict card when the island has a verdict to show.
 */
export function logItems(messages, island) {
  const items = threadItems(messages);
  let lastCharted = -1;
  items.forEach((it, i) => {
    if (it.kind === "system" && it.text.startsWith(CHARTED_PREFIX)) lastCharted = i;
  });
  const out = [];
  items.forEach((it, i) => {
    if (it.kind === "landmark") {
      const prev = out[out.length - 1];
      if (prev && prev.kind === "landmark") prev.names.push(it.text);
      else out.push({ id: it.id, role: it.role, kind: "landmark", names: [it.text], text: it.text, proposal: null });
      return;
    }
    if (i === lastCharted && island && island.verdict) {
      out.push({ ...it, kind: "verdict", verdict: island.verdict });
      return;
    }
    out.push(it);
  });
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/web/thread.test.js`
Expected: PASS, 9 tests. Then `bun test` for the whole suite, green.

- [ ] **Step 5: Commit**

```bash
git add src/web/thread.js tests/web/thread.test.js
git commit -m "feat(web): markdown segments and blocks, merged log items

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

### Task 2: Camera framing beside a pane

**Files:**
- Modify: `src/web/camera.js`
- Create: `tests/web/camera.test.js`

**Interfaces:**
- Produces: `fit(w, h, inset = 0)` centres the world in the `w - inset` by `h` area; `centreOn(point, w, h, inset = 0, scale = current)` → `{ x, y, scale }` with the point at that area's centre; `closer()` → `max(current scale, home scale × 1.5)`. Existing `snapHome`, `animateTo`, `tick`, `panBy`, `zoomAt`, `toWorld`, `apply`, `state`, `home` unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/web/camera.test.js`:

```js
import { test, expect } from "bun:test";
import { createCamera } from "../../src/web/camera.js";
import { WORLD } from "../../src/web/view-model.js";

test("fit centres the world in the area left of the inset", () => {
  const cam = createCamera();
  const full = cam.fit(1000, 800);
  expect(full.scale).toBeCloseTo((800 * 0.88) / WORLD);
  expect(full.x + (WORLD * full.scale) / 2).toBeCloseTo(500);
  const inset = cam.fit(1000, 800, 400);
  expect(inset.scale).toBeCloseTo((600 * 0.88) / WORLD);
  expect(inset.x + (WORLD * inset.scale) / 2).toBeCloseTo(300);
  expect(inset.y + (WORLD * inset.scale) / 2).toBeCloseTo(400);
});

test("centreOn lands the point at the area's centre at the given scale", () => {
  const cam = createCamera();
  cam.fit(1000, 800, 400);
  cam.snapHome();
  const f = cam.centreOn({ x: 640, y: 700 }, 1000, 800, 400);
  expect(f.scale).toBe(cam.state.scale);
  expect(640 * f.scale + f.x).toBeCloseTo(300);
  expect(700 * f.scale + f.y).toBeCloseTo(400);
  const g = cam.centreOn({ x: 640, y: 700 }, 1000, 800, 400, 2);
  expect(g.scale).toBe(2);
  expect(640 * 2 + g.x).toBeCloseTo(300);
});

test("closer is 1.5× home unless the reader already zoomed further", () => {
  const cam = createCamera();
  cam.fit(1000, 800, 400);
  cam.snapHome();
  expect(cam.closer()).toBeCloseTo(cam.home.scale * 1.5);
  cam.zoomAt(0, 0, 4);
  expect(cam.closer()).toBe(cam.state.scale);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/web/camera.test.js`
Expected: FAIL, `fit` ignores the third argument (centre lands at 500, not 300) and `centreOn`/`closer` are not functions.

- [ ] **Step 3: Implement**

In `src/web/camera.js`, replace the `fit` method and add two methods after it:

```js
    /** The framing that fits the whole world into the w − inset by h area, centred, with a margin. */
    fit(w, h, inset = 0) {
      const aw = Math.max(1, w - inset);
      const scale = (Math.min(aw, h) * (1 - 2 * MARGIN)) / WORLD;
      home = { x: (aw - WORLD * scale) / 2, y: (h - WORLD * scale) / 2, scale };
      return home;
    },
    /** The framing at `scale` that puts a world point at the centre of the w − inset by h area. */
    centreOn(point, w, h, inset = 0, scale = cam.scale) {
      const aw = Math.max(1, w - inset);
      return { x: aw / 2 - point.x * scale, y: h / 2 - point.y * scale, scale };
    },
    /** The select zoom: a step in from home, unless the reader is already closer. */
    closer() {
      return Math.max(cam.scale, home.scale * SELECT_ZOOM);
    },
```

Add the constant under `MARGIN`:

```js
const SELECT_ZOOM = 1.5; // × home scale when an island is selected
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/web/camera.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/web/camera.js tests/web/camera.test.js
git commit -m "feat(web): camera fits beside an inset and centres a selected point

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

### Task 3: The map beside the pane

**Files:**
- Modify: `src/web/draw.js` (PALETTE and the two open-water uses)
- Modify: `src/web/app.js` (`resize`, `applySnapshot`, new `paneInset`, `frameSelection`)
- Modify: `src/web/interactions.js` (`select`)
- Modify: `src/web/index.html` (header)
- Modify: `src/web/styles.css` (chrome)

**Interfaces:**
- Consumes: `camera.fit(w, h, inset)`, `camera.centreOn(point, w, h, inset, scale)`, `camera.closer()` from Task 2.
- Produces: `export function paneInset()` (0 when there is no `#pane` or it is hidden, else its rendered width) and `export function frameSelection()` in `app.js`. Task 4's pane is `#pane`; until then `paneInset()` returns 0 and everything behaves as today except the chrome layout and colours.

- [ ] **Step 1: Colours in `draw.js`**

Add to `PALETTE`:

```js
  open: "#8a8078",
  openText: "#a8a097",
```

In `drawIsland`, the open-water branch: change `ctx.strokeStyle = PALETTE.muted;` (the dashed outline stroke, directly after `ctx.lineWidth = 1.8;`) to `ctx.strokeStyle = PALETTE.open;`. In `drawLabel`, change `ctx.fillStyle = node.state === "open" ? PALETTE.muted : PALETTE.text;` to `ctx.fillStyle = node.state === "open" ? PALETTE.openText : PALETTE.text;`. `drawRollup` keeps `PALETTE.muted` for its open dots.

- [ ] **Step 2: Framing in `app.js`**

Add after `hitTest`:

```js
/** How much of the viewport's right edge the pane covers: 0 when it is hidden or absent. */
export function paneInset() {
  const pane = document.getElementById("pane");
  return pane && !pane.hidden ? pane.offsetWidth : 0;
}

const FRAME_MS = 450;

/** Frames the selected island at the centre of the map area beside the pane, or returns home. */
export function frameSelection() {
  const { w, h } = app.size;
  const inset = paneInset();
  app.camera.fit(w, h, inset);
  const node = app.selected ? app.nodes.find((n) => n.slug === app.selected) : null;
  if (node) app.camera.animateTo(app.camera.centreOn(node, w, h, inset, app.camera.closer()), FRAME_MS);
  else app.camera.animateTo(app.camera.home, FRAME_MS);
}
```

Replace the two camera lines at the end of `resize()`:

```js
  app.camera.fit(app.size.w, app.size.h, paneInset());
  if (app.selected) frameSelection();
  else app.camera.snapHome();
```

In `applySnapshot`, the first snapshot restores the terminal's focus; frame it. Replace the last three lines of the function with:

```js
  if (isFirstSnapshot) app.selected = snapshot.focus;
  renderChrome();
  for (const fn of app.listeners) fn(snapshot);
  if (isFirstSnapshot && app.selected) frameSelection(); // the pane is open now, so its width is known
```

(`if (!sameScale) app.camera.animateTo(app.camera.home, 400);` above stays; a scale change clears the selection so home is right.)

- [ ] **Step 3: `select` frames the island**

In `src/web/interactions.js`, import `frameSelection`:

```js
import { app, api, hitTest, setScale, postPositions, frameSelection } from "./app.js";
```

In `select`, after the listeners loop (`for (const fn of app.listeners) fn(app.snapshot);`) add:

```js
  frameSelection(); // the listeners have opened or closed the pane, so its width is settled
```

- [ ] **Step 4: Chrome out from under the pane**

`src/web/index.html` header becomes:

```html
<header class="chrome top">
  <div class="chrome-stack">
    <nav id="breadcrumb" class="breadcrumb" aria-label="Scale"></nav>
    <div id="strip" class="strip"></div>
    <div id="status" class="status"></div>
  </div>
</header>
```

and the footer loses the strip:

```html
<footer class="chrome bottom">
  <div class="legend">
    <span class="open">open water</span>
    <span class="sandbar">sandbar</span>
    <span class="settled">settled</span>
    <span class="mountainous">mountainous</span>
    <span class="reef">reef</span>
  </div>
</footer>
```

`src/web/styles.css`: replace the `.chrome`, `.top`, `.bottom`, `.strip`, `.strip-item` rules with:

```css
.chrome { position: fixed; left: 0; display: flex; padding: 16px 20px; pointer-events: none; }
.chrome > * { pointer-events: auto; }
.top { top: 0; }
.bottom { bottom: 0; }
.chrome-stack { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }

.strip { display: flex; gap: 24px; font-size: 12px; }
.strip-item { display: flex; flex-direction: column; gap: 2px; }
```

(`.strip-label` and `.status` stay as they are; `.legend .open::before` changes its dashed colour to `var(--open)` and add `--open: #8a8078;` to `:root`.)

- [ ] **Step 5: Check by hand**

Run: `bun run src/cli/index.ts serve --stub --no-open` and open `http://127.0.0.1:4480/?domain=system-design`.
Expected: strip and status sit under the breadcrumb at the top left; open-water outlines and names read clearly; clicking an island still opens the old card (Task 4 replaces it) and the map pans and zooms the island toward the centre of the whole viewport (the inset is 0 until the pane exists); Escape pans home; wheel zoom above 1.5× survives a select. `bun test` and `bunx tsc --noEmit` stay green.

- [ ] **Step 6: Commit**

```bash
git add src/web/draw.js src/web/app.js src/web/interactions.js src/web/index.html src/web/styles.css
git commit -m "feat(web): frame the selected island, brighter open water, chrome under the breadcrumb

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

### Task 4: The pane

**Files:**
- Create: `src/web/markdown.js`
- Modify: `src/web/card.js` (re-laid out; the state and the network code stay)
- Modify: `src/web/thread.js` (remove `paragraphs`) and `tests/web/thread.test.js` (remove its test and import)
- Modify: `src/web/index.html` (`#pane` replaces `#card` and `#dock`)
- Modify: `src/web/styles.css` (pane rules replace `.card` and `.dock` rules)

**Interfaces:**
- Consumes: `logItems(messages, island)` and `mdBlocks(text)` from Task 1; `frameSelection` is called by `select` (Task 3), not by the pane.
- Produces: `renderMarkdown(text) → DocumentFragment` in `markdown.js`; `installCard()` unchanged in name (app.js imports it).

- [ ] **Step 1: `markdown.js`**

Create `src/web/markdown.js`:

```js
// mdBlocks → DOM. Built with createElement and textContent only; never innerHTML.
import { mdBlocks } from "./thread.js";

function appendInline(parent, segments) {
  for (const s of segments) {
    if (s.type === "text") {
      parent.append(s.text);
    } else {
      const e = document.createElement(s.type); // strong | em | code
      e.textContent = s.text;
      parent.append(e);
    }
  }
}

/** The rendered blocks of a markdown string, as a fragment ready to append. */
export function renderMarkdown(text) {
  const frag = document.createDocumentFragment();
  for (const b of mdBlocks(text)) {
    if (b.type === "p") {
      const p = document.createElement("p");
      b.lines.forEach((segments, i) => {
        if (i) p.append(document.createElement("br"));
        appendInline(p, segments);
      });
      frag.append(p);
    } else if (b.type === "h") {
      const h = document.createElement(`h${b.level}`);
      appendInline(h, b.segments);
      frag.append(h);
    } else if (b.type === "list") {
      const list = document.createElement(b.ordered ? "ol" : "ul");
      for (const item of b.items) {
        const li = document.createElement("li");
        appendInline(li, item);
        list.append(li);
      }
      frag.append(list);
    } else if (b.type === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = b.text;
      pre.append(code);
      frag.append(pre);
    }
  }
  return frag;
}
```

- [ ] **Step 2: `index.html`**

Replace

```html
<aside id="card" class="card" hidden></aside>

<div id="dock" class="dock" hidden></div>
```

with

```html
<aside id="pane" class="pane" hidden></aside>
```

- [ ] **Step 3: `styles.css`**

Delete every rule that starts with `.card` or `.dock` (from `.card {` through `.dock button:disabled, .dock input:disabled`). Append:

```css
/* ---- the pane: head, log, foot ---- */
.pane { position: fixed; top: 0; right: 0; bottom: 0; width: clamp(340px, 38vw, 440px); background: var(--panel);
  border-left: 1px solid var(--line); display: flex; flex-direction: column; box-shadow: -12px 0 32px rgba(0, 0, 0, .35); }
.pane[hidden] { display: none; }
@media (max-width: 720px) { .pane { width: 100%; } }

.head { padding: 18px 20px 12px; border-bottom: 1px solid var(--line); display: grid; gap: 8px; }
.head .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.head h2 { margin: 0; font: 22px Georgia, serif; }
.pill { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; padding: 4px 8px; border-radius: 4px;
  background: var(--land); color: var(--water); white-space: nowrap; }
.pill.open { background: transparent; border: 1px dashed var(--open); color: var(--muted); }
.pill.reef { background: var(--reef); color: var(--text); }
.head .summary { margin: 0; color: var(--muted); font-size: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px dashed var(--muted); color: var(--muted); }
.chip.lit { background: var(--sand); border: 1px solid var(--sand); color: var(--water); }
.chip.just-lit { animation: lit-pulse .8s ease-out 1; }
@keyframes lit-pulse { 0% { box-shadow: 0 0 0 0 rgba(217, 199, 163, .8); } 100% { box-shadow: 0 0 0 10px rgba(217, 199, 163, 0); } }
.sub { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--muted); }
.sub .links { display: flex; gap: 10px; }
.link { background: none; border: 0; padding: 0; color: var(--text); font: inherit; font-size: 12px; text-decoration: underline;
  text-underline-offset: 2px; cursor: pointer; }
.link:hover { color: var(--sand); }
.note { display: flex; gap: 6px; margin: 0; }
.note input { flex: 1; background: var(--water); border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 6px 8px;
  font: inherit; font-size: 12px; }
.sent { color: var(--sand); font-size: 12px; }
.earlier { font-size: 12px; color: var(--muted); }
.muted { color: var(--muted); font-size: 12px; }
.error { color: var(--reef); font-size: 12px; }

.log { flex: 1; overflow: auto; padding: 14px 20px; display: flex; flex-direction: column; gap: 12px; }
.msg p { margin: 0 0 6px; }
.msg p:last-child { margin-bottom: 0; }
.msg ul, .msg ol { margin: 0 0 6px; padding-left: 20px; }
.msg h1, .msg h2, .msg h3 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
.msg pre { margin: 0 0 6px; padding: 8px 10px; background: var(--water); border-radius: 6px; overflow-x: auto; font-size: 12px; }
.msg code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; background: var(--water); padding: 1px 4px; border-radius: 3px; }
.msg pre code { background: none; padding: 0; }
.msg.judge { font-family: Georgia, serif; font-size: 14.5px; }
.msg.you { align-self: flex-end; max-width: 88%; background: #2a2622; border-radius: 10px 10px 2px 10px; padding: 8px 12px; }
.msg.system { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); text-align: center; }
.lit-line { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--sand); }
.lit-line::before, .lit-line::after { content: ""; flex: 1; border-top: 1px solid var(--line); }
.verdict-card { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: #2a2622; display: grid; gap: 6px; }
.verdict-card .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.verdict-card .conf { font-size: 11px; color: var(--muted); }
.verdict-card q { font-family: Georgia, serif; font-style: italic; quotes: "“" "”"; }
.verdict-card .why { font-size: 12px; color: var(--muted); }
.reef-block { border: 1px solid var(--reef); border-radius: 8px; padding: 8px 10px; }
.reef-block p { margin: 0 0 4px; }
.reef-title { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--reef); margin-bottom: 4px; }
.progress { font-size: 11px; color: var(--muted); font-style: italic; }
.caret { display: inline-block; width: 2px; height: 1em; background: var(--sand); vertical-align: -2px; margin-left: 2px;
  animation: blink 1s steps(2) infinite; }
@keyframes blink { to { visibility: hidden; } }
@media (prefers-reduced-motion: reduce) { .caret, .chip.just-lit { animation: none; } }
.empty { display: grid; gap: 10px; justify-items: start; }
.btn { background: var(--land); color: var(--water); border: 0; border-radius: 6px; padding: 7px 12px; font: inherit; font-size: 12px;
  font-weight: 500; cursor: pointer; }
.btn.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
.btn:disabled { opacity: .5; cursor: default; }
button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid var(--sand); outline-offset: 1px; }

.foot { padding: 12px 20px 14px; border-top: 1px solid var(--line); display: grid; gap: 6px; }
.foot form { display: flex; gap: 6px; align-items: flex-end; margin: 0; }
.foot textarea { flex: 1; resize: none; background: var(--water); border: 1px solid var(--line); border-radius: 6px; color: var(--text);
  padding: 8px 10px; font: inherit; font-size: 13px; line-height: 1.4; min-height: 36px; max-height: 118px; }
.foot textarea:disabled { color: var(--muted); }
.foot .meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
.foot .meta .busy { color: var(--sand); }
```

- [ ] **Step 4: `card.js`**

Replace the whole of `src/web/card.js` with the following. The network functions (`loadThread`, `runTurn`, `answerReef`, `sendComment`, `renderHistory`) keep their guards; what changes is the layout and three behaviours: one scroll region that sticks to the bottom, streaming batched per frame with a caret, and a one-shot reef answer.

```js
import { app, api, setScale } from "./app.js";
import { streamPost } from "./stream.js";
import { logItems } from "./thread.js";
import { renderMarkdown } from "./markdown.js";

const pane = document.getElementById("pane");
const STICK_PX = 40;            // within this of the bottom, the log follows new content
const MAX_ANSWER_HEIGHT = 118;  // about five lines of the answer box
const ROUNDS = 4;

let noteDraft = "";       // note text survives re-renders
let noteOpen = false;     // the "Note to cartographer" field is showing
let lastSent = null;      // { slug, text } shown under the head
let renderId = 0;         // guards async appends against stale renders
let loadGen = 0;          // monotonic across islands, so a slow load can never overwrite a newer one
let liveFrame = 0;        // pending animation frame for the streaming reply

// The one thread the page shows: the selected island's stored messages plus the turn in flight.
const thread = {
  slug: null,
  version: null,      // snapshot version the messages were fetched at; null forces a refetch
  messages: [],
  loaded: false,
  draft: "",
  live: "",           // the judge's reply as it streams
  progress: null,     // tool in flight, shown under the live text
  inFlight: false,
  error: null,        // a turn failed; the messages on screen are still good
  loadError: null,    // the thread itself could not be fetched
  disputeDraft: "",   // the objection typed while a reef is pending
  litSeen: null,      // slugs already lit at the last render, so only newly lit chips pulse
  focusPending: false, // a turn ended before the answer box was usable; the next render focuses it
  answering: false,   // a reef answer is in flight: Confirm and Dispute are one-shot
};

export function installCard() {
  app.listeners.add(() => render());
  render();
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, className = "btn") {
  const b = el("button", className, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

const pct = (v) => `${Math.round(v * 100)}%`;
const atBottom = (log) => log.scrollHeight - log.scrollTop - log.clientHeight < STICK_PX;
const roundOf = (messages) => messages.filter((m) => m.role === "you" && m.kind === "text").length;

const SENT_TEXT = {
  sail_closer: "Asked Claude to chart this island's coastline.",
  note: "Note sent. Claude reads it at the start of the next turn.",
};

async function sendComment(island, kind, body) {
  try {
    await api("/api/comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: app.domain, targetType: "island", targetId: island.slug, body, kind }),
    });
    lastSent = { slug: island.slug, text: SENT_TEXT[kind] };
  } catch (error) {
    lastSent = { slug: island.slug, text: `Could not send: ${error.message}` };
  }
  render();
}

function post(path, body) {
  return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** Points the thread at another island, dropping everything from the previous one. */
function resetThread(slug) {
  Object.assign(thread, {
    slug, version: null, messages: [], loaded: false, draft: "", live: "", progress: null, inFlight: false, error: null, loadError: null,
    disputeDraft: "", litSeen: null, focusPending: false, answering: false,
  });
  noteOpen = false;
}

async function loadThread(slug) {
  thread.version = app.version;
  const gen = ++loadGen;
  try {
    const { messages } = await api(`/api/thread?domain=${encodeURIComponent(app.domain)}&island=${encodeURIComponent(slug)}`);
    if (thread.slug !== slug || gen !== loadGen) return;
    thread.messages = messages;
    thread.loaded = true;
    thread.loadError = null; // thread.error belongs to the last turn and stays until the next one
  } catch (error) {
    if (thread.slug !== slug || gen !== loadGen) return;
    thread.loadError = error.message; // version stays set: the next version change retries, a re-render does not
  }
  render();
}

/** One judge turn. `message` null opens or continues the thread without a new reader message. */
async function runTurn(slug, message) {
  if (thread.inFlight || thread.slug !== slug) return;
  thread.inFlight = true;
  thread.live = "";
  thread.progress = null;
  thread.error = null;
  if (message) thread.messages = [...thread.messages, { id: `local-${Date.now()}`, role: "you", kind: "text", body: message }];
  render();
  try {
    await streamPost("/api/probe", { domain: app.domain, island: slug, ...(message ? { message } : {}) }, (e) => {
      if (thread.slug !== slug) return;
      if (e.type === "text") {
        thread.live += e.data.text;
        thread.progress = null;
        scheduleLive();
      } else if (e.type === "progress") {
        thread.progress = e.data.message;
        scheduleLive();
      } else if (e.type === "error") {
        thread.error = e.data.message;
      }
    });
  } catch (error) {
    if (thread.slug !== slug) return; // the reader is on another island; nothing here is theirs
    thread.error = error.message;
    if (message) thread.draft = message; // the fetch never reached the server, so the message is not stored: give it back
  }
  if (thread.slug !== slug) return;
  cancelLive();
  thread.inFlight = false;
  thread.live = "";
  thread.progress = null;
  thread.version = null; // the stored reply and any system lines come back with the refetch
  render();
  // The opening turn renders the box disabled until the refetched thread arrives: focus it then.
  if (!focusAnswer()) thread.focusPending = true;
}

async function answerReef(slug, id, answer, note) {
  if (thread.answering || thread.slug !== slug) return; // one answer per proposal: a second click does nothing
  thread.answering = true;
  render();
  let ok = false;
  try {
    await post("/api/probe/reef", { domain: app.domain, id, answer, ...(note ? { note } : {}) });
    if (thread.slug !== slug) return; // the reader moved on while the answer was in flight
    thread.disputeDraft = "";
    thread.version = null;
    ok = true;
  } catch (error) {
    if (thread.slug !== slug) return; // the reader moved on; this failure is not theirs to see
    thread.error = error.message;
  } finally {
    if (thread.slug === slug) thread.answering = false;
  }
  render();
  if (ok && answer === "dispute" && thread.slug === slug) await runTurn(slug, null);
}

// ---- streaming: one DOM write per animation frame, never one per delta ----

function scheduleLive() {
  if (liveFrame) return;
  liveFrame = requestAnimationFrame(() => {
    liveFrame = 0;
    renderLive();
  });
}

function cancelLive() {
  if (liveFrame) cancelAnimationFrame(liveFrame);
  liveFrame = 0;
}

/** Updates only the streaming parts, so deltas do not rebuild the pane. */
function renderLive() {
  const live = pane.querySelector("#live");
  const progress = pane.querySelector("#progress");
  const log = pane.querySelector(".log");
  if (!live || !progress || !log) return; // no list on screen yet; the full render at the end of the turn shows everything
  const stuck = atBottom(log);
  if (thread.live) {
    live.replaceChildren(renderMarkdown(thread.live));
    (live.lastElementChild || live).append(el("span", "caret"));
  } else {
    live.replaceChildren();
  }
  live.hidden = !thread.live;
  progress.textContent = thread.progress ? `judge: ${thread.progress}` : "";
  progress.hidden = !thread.progress;
  if (stuck) log.scrollTop = log.scrollHeight;
}

/** Focuses the answer box if it can take input; returns whether it did. */
function focusAnswer() {
  const ta = pane.querySelector("#answer");
  if (!ta || ta.disabled) return false;
  thread.focusPending = false;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  return true;
}

function growAnswer(ta) {
  ta.style.height = "auto";
  ta.style.height = `${Math.min(MAX_ANSWER_HEIGHT, ta.scrollHeight)}px`;
}

// ---- head ----

function chipsEl(island) {
  const row = el("div", "chips");
  for (const l of island.landmarks.items) {
    const chip = el("span", `chip${l.lit ? " lit" : ""}`, l.name);
    if (l.lit && l.evidence) chip.title = `“${l.evidence}”`;
    if (l.lit && thread.litSeen && !thread.litSeen.has(l.slug)) chip.classList.add("just-lit");
    row.append(chip);
  }
  return row;
}

function noteForm(island) {
  const form = el("form", "note");
  const input = el("input");
  input.id = "note";
  input.placeholder = "a note for Claude in the terminal";
  input.value = noteDraft;
  input.addEventListener("input", () => (noteDraft = input.value));
  const send = button("Send", null);
  send.type = "submit";
  form.append(input, send);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    noteDraft = "";
    noteOpen = false;
    void sendComment(island, "note", body);
  });
  return form;
}

function headEl(island) {
  const head = el("div", "head");
  const row = el("div", "row");
  row.append(el("h2", null, island.name));
  const v = island.verdict;
  const pillText = v ? `${v.state} · ${pct(v.confidence)}` : island.children.total ? "open water · islets below" : "open water";
  row.append(el("span", `pill${v ? (v.state === "reef" ? " reef" : "") : " open"}`, pillText));
  head.append(row);
  if (island.summary) head.append(el("p", "summary", island.summary));
  const hasLandmarks = island.landmarks && island.landmarks.total > 0;
  if (hasLandmarks) head.append(chipsEl(island));

  const sub = el("div", "sub");
  const parts = [];
  if (hasLandmarks) parts.push(`${island.landmarks.unlocked} of ${island.landmarks.total} charted`);
  const round = roundOf(thread.messages);
  if (!v && round > 0) parts.push(`round ${Math.min(round, ROUNDS)} of ${ROUNDS}`); // the opening turn is not a round yet
  sub.append(el("span", null, parts.join(" · ")));
  const links = el("span", "links");
  if (island.hasChildren) links.append(button("Sail in", () => setScale(island.slug), "link"));
  else links.append(button("Sail closer", () => sendComment(island, "sail_closer", ""), "link"));
  links.append(
    button("Note to cartographer", () => {
      noteOpen = !noteOpen;
      render();
      if (noteOpen) pane.querySelector("#note")?.focus();
    }, "link"),
  );
  sub.append(links);
  head.append(sub);

  if (island.children.total) {
    const b = island.children.byState;
    head.append(
      el("p", "muted", `${island.children.total} islets: ${b.mountainous} mountainous, ${b.settled} settled, ${b.sandbar} sandbar, ${b.reef} reef, ${b.open} open`),
    );
  }
  const earlier = el("div", "earlier");
  earlier.id = "earlier";
  earlier.hidden = true; // filled by renderHistory when the island has more than one verdict
  head.append(earlier);
  if (noteOpen) head.append(noteForm(island));
  if (lastSent && lastSent.slug === island.slug) head.append(el("div", "sent", lastSent.text));
  return head;
}

// ---- log ----

function retryButton() {
  const actions = el("div", "empty");
  actions.append(
    button("Retry", () => {
      thread.version = null; // the render below refetches
      render();
    }),
  );
  return actions;
}

function verdictEl(v) {
  const card = el("div", "verdict-card");
  const row = el("div", "row");
  row.append(el("span", `pill${v.state === "reef" ? " reef" : ""}`, `charted as ${v.state}`));
  row.append(el("span", "conf", `confidence ${pct(v.confidence)} · ${v.at.slice(0, 10)}`));
  card.append(row);
  card.append(el("q", null, v.evidence));
  if (v.rationale) card.append(el("div", "why", v.rationale));
  return card;
}

/** The reef the judge proposed. The reader answers it in the foot, not here. */
function reefEl(item) {
  const p = item.proposal;
  const box = el("div", "reef-block");
  box.append(el("div", "reef-title", "Reef?"));
  box.append(el("p", null, p.claim));
  box.append(el("p", "muted", `If so: ${p.consequence}`));
  const status = p.status === "pending" ? "pending — answer below" : p.status === "confirmed" ? "confirmed, charted as reef" : "disputed";
  box.append(el("div", "muted", status));
  return box;
}

function itemEl(item) {
  if (item.kind === "landmark") return el("div", "lit-line", `◆ ${item.names.join(" · ")}`);
  if (item.kind === "verdict") return verdictEl(item.verdict);
  if (item.kind === "system") return el("div", "msg system", item.text);
  if (item.kind === "reef_proposal") return reefEl(item);
  const m = el("div", `msg ${item.role}`);
  m.append(renderMarkdown(item.text));
  return m;
}

function logEl(island) {
  const log = el("div", "log");
  if (!thread.loaded) {
    if (!thread.loadError) {
      log.append(el("p", "muted", "loading the thread…"));
      return log;
    }
    log.append(el("p", "error", thread.loadError), retryButton());
    return log;
  }
  if (thread.loadError) {
    // the messages below are the last good ones; only the refetch failed
    log.append(el("p", "muted", `could not refresh the thread: ${thread.loadError}`), retryButton());
  }
  const items = logItems(thread.messages, island);
  if (items.length === 0 && !thread.inFlight) {
    const empty = el("div", "empty");
    empty.append(el("p", "muted", island.verdict ? "No thread yet. The judge asks first." : "Unsurveyed. The judge asks first."));
    empty.append(button(island.verdict ? "Explore it" : "Make landfall", () => void runTurn(island.slug, null)));
    log.append(empty);
    return log;
  }
  for (const item of items) log.append(itemEl(item));
  const live = el("div", "msg judge");
  live.id = "live";
  live.hidden = true;
  const progress = el("div", "progress");
  progress.id = "progress";
  progress.hidden = true;
  log.append(live, progress);
  if (thread.error) log.append(el("div", "error", thread.error));
  return log;
}

// ---- foot ----

function footEl(island) {
  const foot = el("div", "foot");
  const form = el("form");
  const ta = el("textarea");
  ta.id = "answer";
  ta.rows = 1;
  const pending = thread.loaded ? logItems(thread.messages, island).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending") : null;
  const empty = thread.messages.length === 0;
  const busy = thread.inFlight || thread.answering;
  ta.disabled = !thread.loaded || busy || empty;
  ta.placeholder = thread.inFlight
    ? "the judge is thinking…"
    : pending
      ? "what is wrong with this reef"
      : empty
        ? island.verdict ? "press Explore it to begin" : "press Make landfall to begin"
        : "your answer";
  ta.value = pending ? thread.disputeDraft : thread.draft;
  ta.addEventListener("input", () => {
    if (pending) thread.disputeDraft = ta.value;
    else thread.draft = ta.value;
    growAnswer(ta);
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.append(ta);
  if (pending) {
    const dispute = button("Dispute", null, "btn ghost");
    dispute.type = "submit";
    dispute.disabled = busy;
    const confirm = button("Confirm", () => void answerReef(island.slug, pending.id, "confirm"));
    confirm.disabled = busy;
    form.append(dispute, confirm);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) return;
      void answerReef(island.slug, pending.id, "dispute", ta.value.trim() || undefined);
    });
  } else {
    const send = button("Send", null);
    send.type = "submit";
    send.disabled = ta.disabled;
    form.append(send);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body || thread.inFlight) return;
      thread.draft = "";
      void runTurn(island.slug, body);
    });
  }
  foot.append(form);
  const meta = el("div", "meta");
  meta.append(el("span", null, pending ? "Confirm charts the reef · Dispute sends your objection" : "Enter to send · Shift-Enter for a new line"));
  if (thread.inFlight) meta.append(el("span", "busy", "the judge is answering"));
  foot.append(meta);
  return foot;
}

// ---- the pane ----

function render() {
  const s = app.snapshot;
  const island = s && app.selected ? s.islands.find((i) => i.slug === app.selected) : null;
  if (!island) {
    pane.hidden = true;
    pane.replaceChildren();
    if (thread.slug !== null) resetThread(null);
    return;
  }
  if (thread.slug !== island.slug) {
    resetThread(island.slug);
    void loadThread(island.slug);
  } else if (thread.version !== app.version) {
    void loadThread(island.slug); // also mid-turn: a verdict's system line shows in the same beat as the map
  }

  const hadFocus = document.activeElement && document.activeElement.id === "answer";
  const prevLog = pane.querySelector(".log");
  const stuck = !prevLog || atBottom(prevLog);
  const prevTop = prevLog ? prevLog.scrollTop : 0;

  pane.hidden = false;
  pane.replaceChildren(headEl(island), logEl(island), footEl(island));
  growAnswer(pane.querySelector("#answer"));
  renderLive();
  const log = pane.querySelector(".log");
  log.scrollTop = stuck ? log.scrollHeight : prevTop;
  if (hadFocus || thread.focusPending) focusAnswer();
  // Remember which chips are lit so the next render can pulse only the newly lit ones.
  thread.litSeen = new Set((island.landmarks?.items ?? []).filter((l) => l.lit).map((l) => l.slug));
  void renderHistory(island, ++renderId);
}

async function renderHistory(island, id) {
  try {
    const { history } = await api(`/api/history?domain=${encodeURIComponent(app.domain)}&target=island:${encodeURIComponent(island.slug)}`);
    if (id !== renderId || app.selected !== island.slug || history.length < 2) return;
    const earlier = pane.querySelector("#earlier");
    if (!earlier) return;
    earlier.textContent = `earlier: ${history.slice(1).map((v) => `${v.state} · ${v.createdAt.slice(0, 10)}`).join("; ")}`;
    earlier.hidden = false;
  } catch (error) {
    console.error(error);
  }
}
```

- [ ] **Step 5: Retire `paragraphs`**

Delete the `paragraphs` function from `src/web/thread.js`, and in `tests/web/thread.test.js` delete the `paragraphs splits on blank lines and drops empties` test and drop `paragraphs` from the import. `card.js` no longer imports it.

Run: `bunx tsc --noEmit && bun test`
Expected: both clean (tsc does not check `src/web`).

- [ ] **Step 6: Check by hand against the stub**

Run: `bun run src/cli/index.ts serve --stub --no-open`, open `http://127.0.0.1:4480/?domain=system-design`, and walk:

1. Click an open-water island. The map pans and zooms it to the centre of the area left of the pane; the pane opens with the head, `Unsurveyed. The judge asks first.` and **Make landfall**; the box says `press Make landfall to begin`.
2. Make landfall. The reply streams with a caret; the head chips appear (the stub names four); focus lands in the box when the reply ends.
3. Type `unlock shape` and Enter. A lit line `◆ shape` appears between your bubble and the reply; the chip pulses; one arc of the coastline turns solid; the sub line reads `1 of 4 charted · round 1 of 4`.
4. Type a reply with `**bold**`, a `- bullet` line, and Shift-Enter newlines. The bubble renders them.
5. Scroll the log up, then send another answer: the log stays where you left it. Scroll to the bottom and send: it follows the stream.
6. Type `reef` and Enter. The reef block appears, the foot shows **Dispute** and **Confirm**, the meta reads `Confirm charts the reef · Dispute sends your objection`. Double-click Confirm: exactly one request, no error. The verdict card `charted as reef` lands in the log, the pill in the head turns red, the island draws the reef.
7. On another island, type `settled`: the verdict card reads `charted as settled` with confidence and date, the pill reads `settled · NN%`, the island fills in.
8. **Note to cartographer** opens the field; Send closes it and shows `Note sent. Claude reads it at the start of the next turn.` **Sail closer** shows its line.
9. Escape with focus on the map: the pane closes and the map pans home. Escape inside the box does nothing.
10. Narrow the window under 720px: the pane covers the map.

Record anything off in the task report.

- [ ] **Step 7: Commit**

```bash
git add src/web/markdown.js src/web/card.js src/web/index.html src/web/styles.css src/web/thread.js tests/web/thread.test.js
git commit -m "feat(web): the conversation pane — head, one-scroll log, pinned answer box

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

### Task 5: Docs

**Files:**
- Modify: `README.md` (the "From the map" paragraph, the landmarks paragraph's "a chip fills on the card", the layout listing)
- Modify: `CLAUDE.md` (the `src/web/` listing, the Page convention line)
- Modify: `docs/superpowers/specs/2026-09-04-chart-and-log-design.md` (status line)

- [ ] **Step 1: README**

Replace the "From the map" paragraph (line ~41) with:

```markdown
Click an island to select it. The map frames the island beside a pane on the right that holds everything about it: the head (name, state, landmark chips, **Sail closer** or **Sail in**, and **Note to cartographer**), the log, and the answer box. **Make landfall** starts the thread (**Explore it** on an island that already has a verdict); the judge asks first, each answer lights the landmarks it covers as a lit line in the log and a solid arc on the coastline, and each verdict lands as a card in the log while the island fills in on the map. Messages render as markdown. While a reef proposal is pending the box switches to **Confirm** and **Dispute**, and you answer the proposal — its false claim and its consequence — before the reef is written. Escape closes the pane and pans the map home.
```

In the landmarks paragraph, change `a chip fills on the card` to `a chip fills in the pane`. In the Layout block, change `src/web/       one-canvas map, plain ES modules` to `src/web/       one-canvas map and the conversation pane, plain ES modules`.

- [ ] **Step 2: CLAUDE.md**

In the architecture listing, change the `src/web/` line to:

```
src/web/        index.html, styles.css, app.js, view-model.js, layout.js, camera.js, draw.js, interactions.js, card.js, markdown.js, stream.js, thread.js
```

Replace the Page convention bullet with:

```
- Page: no framework, no bundler, no `innerHTML`. Pure helpers in `view-model.js`, `thread.js` (markdown, log items), and `camera.js` are unit-tested; the canvas and the pane are checked by hand. The pane (`card.js`) is head, log, foot: the log is the only scroll region. Selecting an island frames it at the centre of the map area beside the pane at 1.5× the home scale (`frameSelection` in `app.js`).
```

Also in the architecture paragraph, change `the browser is the consumer (server → JSON API → canvas page polling /api/version)` wording only if it mentions the card or dock (it does not); leave it.

- [ ] **Step 3: Spec status**

In the spec, change `**Status:** approved design, awaiting plan` to `**Status:** implemented (plan: docs/superpowers/plans/2026-09-04-chart-and-log.md)`.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-09-04-chart-and-log-design.md
git commit -m "docs: the conversation pane

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

## Self-review

- Spec coverage: pane head/log/foot (Task 4), sticky log and rAF streaming with caret (Task 4), one-shot reef answer (Task 4), note link (Task 4), earlier verdicts line (Task 4 `renderHistory`), markdown helpers and DOM (Tasks 1, 4), camera inset, `centreOn`, `closer`, 450 ms (Tasks 2, 3), palette (Task 3), strip under breadcrumb (Task 3), Make landfall / Explore it (Task 4), copy (Task 4), docs (Task 5). Out of scope items untouched.
- Types: `logItems` returns `{ kind: "landmark", names }` and `{ kind: "verdict", verdict }`; `card.js` reads `item.names` and `item.verdict` accordingly. `centreOn(point, w, h, inset, scale)` matches its use in `frameSelection`. `renderMarkdown` returns a fragment appended with `append`.
- `paragraphs` survives Tasks 1–3 so the page keeps working between tasks; Task 4 removes it with its only importer.
