# Plot fences: the Keeper can draw a curve

**Date:** 2026-09-12
**Status:** approved, not implemented
**Builds on:** code blocks (`2026-09-05-code-blocks-design.md`), themes (`2026-09-07-themes-design.md`), board (`2026-09-06-board-design.md`)
**Reference:** shuttle's `plot` fence, `~/Documents/Workspace/Projects/shuttle-worktree/shuttle/app/src/components/FunctionPlot.tsx`

## Why

Victor, on 2026-09-12, after charting Data Structures and Algorithms: "if we need to learn about the Math, we should be able to plot as well." That chart is full of claims that are curves. Why `n log n` beats `n²` only past some `n`; what the recurrence `T(n) = 2T(n/2) + n` grows like; why a hash table's amortised cost is flat while its worst case is not. Mermaid draws structure and shiki draws code; nothing on the page draws `y = f(x)`.

Shuttle already reads a `plot` fence, so the format is not ours to invent. Taking it unchanged means a plot written in either app renders in the other, which is the whole point of borrowing it.

## Decisions

| Question | Decision |
|---|---|
| Format | Shuttle's, unchanged. A fence tagged `plot`, `function-plot` or `math-plot`; the body is one expression per line, with blank lines and `//` or `#` comments dropped, or a function-plot options object when the body starts with `{`. |
| Renderer | `function-plot`, pinned to `1.25.3`. It ships no browser-ready file, so a second `Bun.build` entry beside shiki, served at `/vendor/plot.js` with an ETag, dynamic-imported by the page the way `code.js` imports shiki. Measured on 2026-09-12: 216 KB minified, 65 KB gzipped. |
| Interaction | Static: `disableZoom: true`. The pane's log is the only scroll region and a plot must not eat the wheel. Interactivity is a later slice and this flag is the only thing it turns. |
| Colours | The seven canvas tokens through `PALETTE`, never a literal. Sea is the ground, line draws axes and grid, and series take lamp, grass, snow, reef in order and then wrap. A plot re-renders on the `theme` event with its cache cleared, exactly as a diagram does. |
| Where a plot appears | Wherever `renderMarkdown` runs: the pane's log, and the body of a board note card, so a plot fence inside a note draws from day one. A plot *card*, with its own kind and preview, is the next slice, and `plotElement` takes `diagramElement`'s signature so that slice adds one branch to `bodyEl` rather than a second machinery. |
| An unclosed fence | `drawing a plot…`, matching the mermaid placeholder. A half-typed expression is never handed to the library. |
| The judge | PROTOCOL §9 widens to one fence per reply: code, a diagram, **or** a plot. A plot earns its place for a growth curve or two costs compared, never for decoration. |
| Fixed options last | `target`, `width`, `height`, `grid` and `disableZoom` are applied **after** the parsed body, so a body carrying its own `target` cannot move the plot out of its card. Shuttle spreads them the other way round; that is a bug, not a feature to port. |
| The cartographer | Nothing. The CLI, the snapshot, the skill and the database are untouched. A plot is text inside a message. |

## Modules

`src/web/plot-model.js` — pure, unit-tested, no DOM.

- `parsePlot(body)` → `{ options }` or `{ error }`. JSON when the trimmed body starts with `{`, otherwise one `{ fn }` per surviving line. An empty body is an error, not an empty plot.
- `plotOptions(parsed, { target, width, height, palette })` → the options object handed to the library: the parsed body first, then the fixed fields, then a colour per series taken from the palette in order.

`src/web/plot.js` — DOM, checked by hand.

- `plotElement(body, { cache = true } = {})` returns an element at once and fills it when the bundle resolves. The bundle is imported once per page. Renders are cached by source, and the cache is cleared on `theme` so the next render takes the new tokens. A `ResizeObserver` on the element re-renders at the new width and disconnects when the element leaves the document. `cache: false` is the live-preview door the board slice will use.

`src/server/vendor.ts` — from one bundle to a bundle per entry: `vendorBundle("shiki" | "plot")`, each name mapping to an entry under `src/server/vendor/`. `plot-entry.js` imports function-plot's default and re-exports it as a named export, since the page imports an ES module.

`src/server/routes.ts` — `GET /vendor/plot.js`, sharing one helper with the shiki route for the content type, the ETag and the 304.

`src/web/markdown.js` — two branches beside mermaid's, keyed on a `PLOT_LANGS` set holding the three tags.

`src/server/judge/PROTOCOL.md` — §9 only.

## Data flow

A judge reply is text. `mdBlocks` finds a closed fence whose language is in `PLOT_LANGS`, `plotElement` is asked for an element, `parsePlot` reads the body, `plotOptions` merges the palette and the fixed fields, and function-plot draws SVG into that element. No server round trip, no row, no version bump. The same path runs for the reader's own markdown.

## Errors

- A body that starts with `{` but is not JSON → `{ error }` → the fallback shows the source text and the parser's message.
- A body the library rejects, an unparseable expression → the same fallback, carrying the thrown message.
- The bundle failing to import → the source block stands, one console error, the rest of the log unharmed. Shiki's precedent.
- No `innerHTML` anywhere: the library writes into the element it was given, and the fallback is built with DOM calls.

## Tests

`tests/web/plot-model.test.js`, pure and new:

- one expression; several expressions; blank lines and `//` and `#` comments dropped; an empty body is an error.
- a JSON body parsed; malformed JSON is an error carrying a message.
- a body carrying `target`, `width` or `disableZoom` cannot override the fixed fields. This pins the shuttle bug shut.
- series colours follow the palette in order and wrap past the fourth series.

`tests/server/routes.test.ts`, beside the shiki case: `/vendor/plot.js` serves JavaScript with an ETag and answers 304 to a matching `if-none-match`.

`bun test` still spawns no SDK and no browser. Checked by hand before merge: a plot in the pane's log under both themes, a broken expression, a plot in a narrow pane, a theme switch with a plot on screen, and the wheel over a plot scrolling the log rather than zooming.

## Out of scope

Named here so the next slice does not have to rediscover them.

- **Board plot cards.** Wanted next. Migration 0008 has to rebuild `board_cards` for a `plot` kind, because SQLite cannot alter a CHECK constraint, carrying the index and all three version triggers. Then `boardKinds`, the `board_write` schema, `p` in `KIND_KEYS`, the editor's preview, and PROTOCOL §10.
- **Interactive zoom and pan.** Wanted after that. One flag, plus a decision about who owns the wheel between a plot, the log, the board sheet and the map.
- **Math typesetting.** Shuttle has none. Inline notation is a different library and a separate decision.
- **Publishing a plot off this machine.** Expressions compile through the `Function` constructor, so a plot needs `unsafe-eval` and stays on the local page.
