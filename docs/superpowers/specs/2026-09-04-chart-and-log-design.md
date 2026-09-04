# Chart and log: the page layout

**Date:** 2026-09-04
**Status:** approved design, awaiting plan
**Builds on:** landmarks (`2026-09-04-landmarks-design.md`); markdown and streaming rules from medium-pool's text lane (`~/Documents/Workspace/Projects/medium-pool/skills/medium-text/`)
**Mockups:** https://claude.ai/code/artifact/4c4ed1c3-d830-47c3-a011-8fd3ead6eadd (direction A)

## Why

The judge works; the page around it does not. After the first real sitting with landmarks the reader said the functionality works but the UI is bad. The screenshot showed why:

1. Two nested scroll regions: the card scrolls, and the message list inside it scrolls again.
2. The island record and the live conversation share one column, with the verdict above the question that produced it.
3. The answer box floats at the bottom centre of the viewport, detached from the words it answers, and covers the selected island.
4. Selecting an island never reframes the map; the card hides the right third and clips the footer strip.
5. Two inputs mean different things (answer the judge, note the cartographer) and look the same.
6. Reader messages show raw markdown.
7. Open-water islands are nearly invisible against the water.

Three directions were mocked up. The reader chose **A, Chart and log**: the map keeps the left of the viewport, and the right is one full-height pane with a compact island header, a single scrolling log, and the answer box pinned to the pane's bottom. This reverses the earlier "answer box at the bottom centre" decision on purpose: the box belongs with the words it answers, not with the map.

## Decisions

| Question | Decision |
|---|---|
| Where the conversation lives | One pane on the right, full height, three regions: head, log, foot. The log is the only thing that scrolls. |
| Where the answer box lives | Pinned to the bottom of the pane. Confirm and Dispute replace Send while a reef is pending. |
| What happens to the map on select | It pans and zooms in a little, so the selected island sits at the centre of the area left of the pane at 1.5× the home scale (or at the reader's own zoom when that is larger). On deselect it returns to the home framing. |
| Where the verdict shows | As a card in the log at the point it landed, and as a pill in the head afterwards. |
| The note to the cartographer | A link in the head that opens a small field under it. The foot always means "answer the judge". |
| Markdown | Every message, and the reply while it streams, renders through one forgiving markdown renderer modelled on medium-pool's text lane: paragraphs, lists, headings, bold, italic, code spans, and fenced code, tolerant of half-written input. |
| Open water on the map | Brighter dashed outline and label so unsurveyed islands read from across the room. |
| Chrome | The strip (nearest open water, reefs, unread) moves under the breadcrumb at the top left. The legend stays at the bottom left. Nothing sits under the pane. |

## The pane

`<aside id="pane">` replaces both `#card` and `#dock`. It is hidden when nothing is selected. Its width is `clamp(340px, 38vw, 440px)`; below a 720px viewport it takes the full width and covers the map.

**Head** (never scrolls):

- Island name, and on the same line a state pill: `settled · 82%` for a verdict (`reef` in the reef colour), a dashed `open water` pill otherwise. Islets: `open water · islets below`.
- The summary, one muted line.
- The landmark chips, exactly as today (dashed dark, filled lit, pulse on newly lit, evidence on hover).
- A sub line: left `5 of 5 charted · round 2 of 4` (round only before a verdict and after the first answer, as today); right two links, `Sail closer` (or `Sail in` when the island has islets) and `Note to cartographer`.
- If the island has islets, the counts line as today.
- If the island has more than one verdict, one muted line `earlier: sandbar · 2026-09-03`, oldest last, from `/api/history`.
- The note field, only while the link is toggled on: one input, `Send`, and the sent confirmation line under it. Toggling it off clears nothing typed.

**Log** (the one scroll region), in message order:

- Judge messages in the serif face, rendered as markdown. The live reply streams at the end while a turn is in flight through the same renderer, with a caret after the last character and the progress line under it. DOM writes for the stream are batched once per animation frame, not once per delta.
- Reader messages as right-aligned bubbles, rendered as markdown.
- Consecutive `landmark lit:` lines collapse into one lit line: `◆ Bottleneck analysis · Statelessness`, drawn between two rules.
- The last `charted as <state>` line renders as the verdict card: a pill `charted as settled`, `confidence 82% · 2026-09-04`, the evidence in italic serif, the rationale muted. Earlier `charted as` lines stay as small system lines. The card reads its content from the island's latest verdict.
- Reef proposals as the reef block, as today.
- Other system lines as today.
- Empty thread: `Unsurveyed. The judge asks first.` (or `No thread yet…` when a verdict exists) with the `Probe this` button. The foot's box is disabled until the thread has a message.
- The log sticks to the bottom: when the reader was within 40px of the bottom before an update, the update scrolls it to the bottom; otherwise it stays where it is.
- Load and turn errors show at the end of the log with `Retry`, as today.

**Foot** (never scrolls):

- A textarea that grows from one to five lines. Enter sends, Shift-Enter inserts a newline. Placeholders as today (`your answer`, `the judge is thinking…`, `what is wrong with this reef`, `press Probe this to begin`).
- `Send`, or `Dispute` (ghost) and `Confirm` while a reef is pending. One answer per proposal: both buttons disable the moment one is pressed, so a double click cannot post twice.
- A meta line under the box: left `Enter to send · Shift-Enter for a new line`; right, while a turn is in flight, `the judge is answering`.
- Focus lands in the textarea when an island is selected, after a turn ends, and after the opening turn's refetch, using the existing `focusPending` mechanism. Escape in the textarea does nothing; Escape elsewhere deselects, as today.

Everything in `card.js` that guards against stale islands, lost drafts, and loads that resolve late stays as it is. The pane is a re-layout of that module, not a rewrite of its state.

## The map beside the pane

`camera.js` learns about an inset.

- `fit(w, h, inset = 0)`: the home framing centres the world in the `w - inset` by `h` area. `app.resize()` and the pane's open/close both call it; the inset is the pane's rendered width when it is visible and zero otherwise.
- `centreOn(point, w, h, inset = 0, scale = current)`: the framing at `scale` that puts a world point at the centre of the same area. Pure; returns `{ x, y, scale }`.
- `closer()`: the select zoom, `max(current scale, home scale × 1.5)`.
- On select, the page calls `camera.animateTo(camera.centreOn(node, w, h, inset, camera.closer()), 450)`. On deselect, `animateTo(home, 450)`, which also restores the home zoom. A select while the pane is already open pans between islands. A wheel zoom larger than the select zoom is kept.
- The focus spotlight and the dimming of far islands stay as today.

`draw.js`: open-water outline colour becomes `#8a8078` and open-water labels `#a8a097`; both are new entries in `PALETTE` (`open`, `openText`). Nothing else on the canvas changes.

`index.html` and `app.js`: the `#strip` moves from the footer into the header under the breadcrumb, laid out left to right; `renderStrip` is unchanged. The status line stays in the header and the legend in the footer.

## Pure helpers

In `src/web/thread.js`, tested in `tests/web/thread.test.js`:

- `inlineSegments(text)` → `[{ type: "text" | "strong" | "em" | "code", text }]`. `**x**` strong, `*x*` or `_x_` em, `` `x` `` code; unmatched markers stay literal; no nesting.
- `mdBlocks(text)` → `[{ type: "p" | "h" | "ul" | "ol" | "code", ... }]`, line by line as in medium-pool's `renderMd`: `#`–`###` headings (`level`), `-`/`*` bullets and `1.` numbered items (`items`, each an inline segment list), ``` fences (`text`, verbatim; an unclosed fence at the end of the input is still a code block), and paragraphs split on blank lines with single newlines kept as line breaks. Every text piece goes through `inlineSegments`. Partial input never throws and never loses text: an unclosed `**` renders literally until it closes. `paragraphs()` is retired in favour of `mdBlocks`.
- `card.js` builds DOM from these blocks with `createElement` and `textContent`, never `innerHTML`.
- `logItems(messages, island)` → the items above: `threadItems` plus (a) consecutive `landmark` items merged into `{ kind: "landmark", names: [...] }`, (b) the last system item whose body starts with `charted as ` becomes `{ kind: "verdict", state, verdict: island.verdict }` when `island.verdict` exists, else stays a system line.

In `src/web/camera.js`, tested in `tests/web/camera.test.js`:

- `fit(w, h, inset)` centres the world in the reduced area.
- `centreOn(point, w, h, inset, scale)` puts the point at the reduced area's centre at the given scale; `closer()` is 1.5× home, or the current scale when larger.

## Copy

- Pills: `open water`, `open water · islets below`, `sandbar`, `settled · 82%`, `mountainous · 91%`, `reef · 88%`.
- Head links: `Sail closer`, `Sail in`, `Note to cartographer`.
- Note sent: `Note sent. Claude reads it at the start of the next turn.`
- Foot meta: `Enter to send · Shift-Enter for a new line`; `the judge is answering`.
- Verdict card pill: `charted as <state>`.

## Out of scope

- Landmark names drawn on the coastline itself (direction B's best idea). It is a `draw.js` change on its own and follows once the pan makes room for it.
- A sheet, a focus stage, any change to the judge, the server, the CLI, or the database.
- Tables, links, images, nested lists, and block quotes. They render as plain paragraphs.
- A narrow-viewport layout beyond "the pane covers the map".

## Tests

- `tests/web/thread.test.js`: `inlineSegments` (strong, em, code, unmatched marker literal, mixed); `mdBlocks` (paragraphs with line breaks, heading levels, bullet and numbered lists, closed and unclosed fence, the reader's real `**1. Bottleneck analysis first.** Look at CPU…` line, partial input mid-word and mid-marker); `logItems` (merges consecutive lit lines, keeps a lone one, converts only the last `charted as` line, leaves it a system line without a verdict).
- `tests/web/camera.test.js`: `fit` with and without an inset centres in the right area; `centreOn` keeps the scale and lands the point at the area's centre.
- By hand, against the stub judge: select pans the island to the centre of the map area and the pane opens; the log is the only scroll region and sticks to the bottom while a reply streams; a four-round thread with a verdict reads top to bottom in order; reef mode swaps the buttons and a double click posts once; the note link opens and sends; deselect pans home; wheel zoom survives a select.
