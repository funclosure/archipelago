# Strip hints: the map's chrome explains itself

**Date:** 2026-09-07
**Status:** implemented
**Builds on:** chart-and-log (`2026-09-04-chart-and-log-design.md`), harbour (`2026-09-04-teachers-tools-design.md`)

## Why

Victor, looking at the strip's `UNREAD · 1 for Claude` on 2026-09-07: "how user can deal with this, or it's outdated … I think we need to have tooltip or something telling user how to use." The strip speaks the product's vocabulary (set out from, open water, reefs, unread for Claude) with nothing on the page to explain it, and "Claude" is ambiguous now that the Keeper is also Claude.

## Decisions

| Question | Decision |
|---|---|
| Shape | A hint card under each strip cell, shown on hover and toggled by a click (touch), in the keys card's style. Not native tooltips (hidden, unstyled), not a manual sheet. |
| The unread cell | Renamed. Label `For the cartographer`; value names the requests (`sail closer · App architecture`), up to two, then `+n`. Its hint says what waits and how to answer it: in the terminal. |
| Dealing with it on the page | No. A request is a message to the cartographer; the terminal is where it is answered (Victor: "we can keep it simple"). No dismiss, no route. |
| Snapshot | Gains `unread: { kind, target }[]` (the unread comments, oldest first) beside the count, so the page can name them. |
| Keys | None. Hints are hover and click; Tab belongs to the regions. |

## Snapshot

`src/core/view-model.ts`: `Snapshot.unread: { kind: CommentKind; target: string }[]`, built from `listCommentViews(db, domain.id, true)`. `unreadComments` stays (the count).

## The page

`src/web/view-model.js`, pure:

```js
export const KIND_WORDS = { sail_closer: "sail closer", note: "note", probe_me: "probe", dispute: "dispute" };
export const HINTS = {
  harbour: "The harbour: where to set out from at this scale. The cartographer sets it; the anchor marks it on the map.",
  homePort: "The harbour, already charted. Sail on from here to the nearest open water.",
  openWater: "Islands with no verdict yet, nearest first. Select one and make landfall to chart it with the Keeper.",
  reefs: "A reef is a confident claim the Keeper found wrong. Open the island and answer the Keeper to clear it.",
  cartographer: "Requests waiting for the cartographer, Claude in the terminal, who sketches the islands. Open a terminal in this project and run /archipelago-chart: it reads these first and marks them read.",
};
export function stripItems(snapshot) // → [{ label, value, hint }]
```

`stripItems`: the harbour cell (`Set out from` / `Home port` with the matching hint) when there is a harbour; `Nearest open water` (up to four names, or `none at this scale`); `Reefs` (names, or `none charted`); and, only when `unread` is non-empty, `For the cartographer` with the value `<kind word> · <island name>` per request (a domain target is `<kind word>` alone), the first two joined by ` · `, then ` +n` for the rest.

`app.js` `renderStrip` maps `stripItems(app.snapshot)` to cells. A cell is `div.strip-item` with the label, the value, and `div.hint` holding the sentence; a click on the cell toggles `.open`. `styles.css`: `.strip-item { position: relative; cursor: help; }`, `.strip-item .hint { display: none; position: absolute; top: calc(100% + 8px); left: 0; width: 260px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; box-shadow: 0 8px 24px var(--shadow); font-size: 12px; line-height: 1.45; color: var(--text); text-transform: none; letter-spacing: 0; z-index: 4; }`, shown by `.strip-item:hover .hint, .strip-item.open .hint { display: block; }`; the last cell's card hangs from its right edge.

## Tests

- `tests/core/view-model.test.ts`: `snap.unread` equals `[{ kind: "probe_me", target: "island:queues" }]` beside the count.
- `tests/web/view-model.test.js`: `stripItems` with no harbour and nothing unread gives two cells; a charted harbour gives `Home port` with the home-port hint; an uncharted one `Set out from`; an unread sail-closer on an island names it; three requests show two and ` +1`; a domain-target note shows the kind word alone; every cell has a hint string.
- By hand: hover each cell in both themes; click toggles; the cartographer card names the request on the real chart.

## Out of scope

Marking comments read from the page. Hints anywhere else (the pane and the outline have their own labels).
