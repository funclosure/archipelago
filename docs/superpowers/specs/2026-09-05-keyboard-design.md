# Keyboard: one focused region, Linear keys

**Date:** 2026-09-05
**Status:** implemented (plan: docs/superpowers/plans/2026-09-05-keyboard.md)
**Builds on:** outline (`2026-09-04-outline-design.md`), chart-and-log (`2026-09-04-chart-and-log-design.md`), teacher's tools (`2026-09-04-teachers-tools-design.md`)

## Why

Victor: "for the left panel, can we support keyboard up and down, and let's think a bit more from the keyboard perspective." Then, on the arrow-moves-a-cursor choice: "we also need to be aware of which panel got focus, otherwise it's messy." Today `[` toggles the rail, Escape deselects or closes the menu, Enter sends; nothing else works without the mouse, and the outline rows are divs.

## Decisions

| Question | Decision |
|---|---|
| Vocabulary | Arrows plus `j`/`k`, Linear style; single-letter actions; `?` shows the keys. |
| What Down does | Moves a cursor row in the outline. Enter selects. The map does not move on a cursor move. |
| Focus | Exactly one of three regions holds focus: outline, map, pane. Keys dispatch to the focused region. Tab cycles regions. The page shows the focused region. |
| Letters in text fields | Dead. Inside any input or textarea only Escape, Enter, and Tab are live. |
| Escape | A ladder, one rung per press: close the menu or the cheat sheet → leave the text field → hide the outline cursor → deselect. |
| Rows | Stay divs. The outline list carries `tabindex="0"` and `aria-activedescendant`; rows get ids. |

## Regions and focus

`src/web/keys.js` owns the one window `keydown` listener (capture phase, replacing the two in `outline.js` and `interactions.js`) and the region state: `region ∈ {"outline","map","pane"}`, initially `outline`. `setRegion(name)` stores it, stamps `document.body.dataset.focus = name`, and moves DOM focus to the region's container (`#outline .list`, `#map`, `#pane`), each of which carries `tabindex="0"` (`-1` is not used: the containers are the Tab stops). Clicking inside a region calls `setRegion` (a `mousedown` listener on each container). Selecting from the outline with Enter keeps the outline focused; selecting by clicking the map focuses the map; `/` focuses the pane and its answer box.

The focused region shows a 1px lamp line along its inner edge: the outline's right edge, the pane's left edge, and for the map a line along the top of the map area between the outline and the pane (`#map-focus`, positioned from `--outline-w` and `--pane-w`). Reduced motion does not matter here; it is a static line. The outline's cursor row draws only while the outline is focused.

Tab and Shift-Tab always move the region (`preventDefault`), even from inside the answer box. Nothing else on the page is a Tab stop except the buttons that already are, which remain reachable by mouse and by the letter keys below; the region cycle is the keyboard's way around.

A region whose container is hidden never keeps focus: the dispatcher steps past it, and deselecting from the pane hands focus to the map.

## Keys

**Global**, any region, dead in text fields except Escape, Enter, Tab, Cmd-Enter:

| Key | Does |
|---|---|
| Tab / Shift-Tab | Next / previous region: outline → map → pane → outline. |
| `[` | Toggle the rail (unchanged). |
| `?` | Open or close the cheat sheet. |
| `/` | Focus the pane and its answer box (if there is one). |
| Escape | One rung of the ladder. |

**Outline focused:**

| Key | Does |
|---|---|
| Down / `j`, Up / `k` | Move the cursor over `visibleRows`. Wraps at neither end. |
| Home / End | First / last visible row. |
| Enter | Select the cursor row (`setScale` first if its scale differs, as a click does). |
| Right | Expand the cursor island if it has islets and is collapsed; else move to its first islet. |
| Left | Collapse the cursor island if expanded; else move to its parent row. |

The cursor is a slug in `outline.js` state (not persisted). When the outline gains focus with no cursor, it lands on the selected island, else the harbour, else the first row. When the rail is collapsed, Up/Down still move the cursor over the top-level dashes and Enter selects; the peek does not open from the keyboard.

**Map focused:**

| Key | Does |
|---|---|
| Enter | Select the hovered island, else the island nearest the centre of the map area. |
| Arrows | Pan the camera by 80px. |
| `+` / `=` / `-` | Zoom by 1.2 about the centre of the map area. |
| `0` | Frame home (`frameSelection`). |
| Escape | Deselect (existing). |

**Pane focused** (island selected; keys are ignored while a turn is in flight except Escape and `?`):

| Key | Does |
|---|---|
| Enter or `/` | Focus the answer box. |
| `l` | Make landfall / Explore it, when that button is shown. |
| `n` | Open the note form and focus it. |
| `1`–`4` | Pick that option of the pending ask. |
| `c` | Confirm the pending reef (same one-shot path as the card). |
| `d` | Focus the dispute box (the answer box in reef mode). |
| Cmd-Enter | Send, from anywhere in the pane. |
| Escape (in a text field) | Blur it; the pane stays focused. |

## The cheat sheet

`?` opens `<div id="keys">`, a card centred over the map area (same surface as the call-to-action card: panel background, line border, 10px radius), titled `Keys` with the global keys and the focused region's keys as two columns of `kbd` + label, 12px. `?` or Escape closes it. It never steals region focus.

## Modules

- `src/web/keys-model.js` (pure, tested): `REGIONS`, `nextRegion(region, backwards)`, `isTyping(target)` (tagName/contentEditable check, the one in three files today), `escapeRung({ menuOpen, sheetOpen, typing, cursor, selected })` → one of `"menu" | "sheet" | "blur" | "cursor" | "deselect" | null`, `moveCursor(rows, cursorSlug, key, expanded)` → `{ cursor }` or `{ toggle: slug }` given the `visibleRows` array from `outline-model.js` (Right on a collapsed parent yields `toggle`; Right on an expanded parent yields its first child; Left on a child yields the parent; Left on an expanded parent yields `toggle`), `cheatSheet(region)` → the rows to render.
- `src/web/keys.js` (DOM): region state, the listener, `setRegion`, the focus line, the cheat sheet element, and the dispatch to handlers the three regions register: `registerRegion(name, { onKey(e) → boolean handled, onFocus(), onBlur() })`.
- `outline.js`: cursor state and rendering (`row.cur`, `aria-activedescendant`), `onKey` for its table, `onFocus` seeds the cursor. Its own keydown listener goes.
- `interactions.js`: `onKey` for the map table; its Escape listener goes. Exposes the hovered slug.
- `card.js`: `onKey` for the pane table; the textarea's Enter handler stays (it is the field's own behaviour).
- `styles.css`: `body[data-focus="outline"] #outline`, `body[data-focus="pane"] #pane` get `box-shadow: inset -1px 0 var(--lamp)` / `inset 1px 0 var(--lamp)`; `#map-focus` is a 1px lamp bar shown when `data-focus="map"`; `.row.cur` is `outline: 1px solid var(--lamp); outline-offset: -1px` while the outline is focused; `#keys` styles.

## Copy

- Cheat sheet title `Keys`; section labels `Everywhere`, `Outline`, `Map`, `Pane`. Labels are verbs: `next region`, `move`, `select`, `expand / collapse`, `make landfall`, `note`, `pick option`, `confirm reef`, `dispute`, `send`, `answer`, `pan`, `zoom`, `home`, `deselect`, `close`.
- The outline footer keycap row becomes `[ outline · ? keys`.

## Tests

- `tests/web/keys-model.test.js`: `nextRegion` cycles both ways; `isTyping`; `escapeRung` returns the top rung only, in order; `moveCursor` over a three-level fixture (down/up bounds, Home/End, Right expands then descends, Left ascends then collapses); `cheatSheet` lists the region's keys.
- By hand against the stub: Tab cycles with the lamp line moving; j/k moves the cursor without moving the map; Enter selects and frames; Right/Left on an island with islets; `?` sheet; `/` lands in the answer box and letters type there; Escape ladder from inside the answer box down to deselect; `1` picks an ask option; `c` confirms a reef once; map arrows and zoom.

## Out of scope

- Reordering, renaming, or any writes from the keyboard beyond the pane's existing actions.
- A command palette. Custom key bindings.
- Screen-reader announcements beyond `aria-activedescendant` and the containers' roles.
