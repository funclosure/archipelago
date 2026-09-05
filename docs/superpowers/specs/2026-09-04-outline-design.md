# Outline: the domain's tree on the left

**Date:** 2026-09-04
**Status:** implemented (plan: docs/superpowers/plans/2026-09-05-outline.md)
**Builds on:** chart-and-log (`2026-09-04-chart-and-log-design.md`), harbour (`2026-09-04-harbour-design.md`)
**Prototype:** https://claude.ai/code/artifact/a251c701-2f8a-4bd2-9e1c-090be3cfa9c0 (left panel and rail)

## Why

The map shows one scale at a time and has no list. After the React Native chart Victor asked for an outline panel of the topics on the left. He then asked for it in the style of Linear's sidebar or Shuttle's, and the prototype settled on: Linear's compact rows, header and chevrons; Shuttle's collapsed rail of dashes that peeks on hover.

## Decisions

| Question | Decision |
|---|---|
| What it lists | The whole domain as a tree: every island at every scale, with state, lit-landmark count, and harbour. |
| What a click does | Selects the island. If it is at another scale, the map changes scale first, then selects it. |
| Collapse | Press `[` or the header button: the panel becomes a 44px rail of dashes, one per top-level island. Hovering the rail peeks the full list as a floating card. |
| Width | 232px expanded, 44px as a rail. Not resizable. The map area is what is left between the outline and the pane. |
| Domain switcher | The header names the domain with a chevron; clicking lists the domains from `/api/domains` and navigates to `?domain=<slug>`. |
| Persistence | Rail state and which islands are expanded live in `localStorage`, per domain. |

## Data

`GET /api/outline?domain=<slug>` → `{ version, domain: { slug, name }, harbour, charted, lit, islands: OutlineNode[] }` where

```ts
type OutlineNode = {
  slug: string; name: string;
  state: "open" | "sandbar" | "settled" | "mountainous" | "reef";
  landmarks: { total: number; unlocked: number };
  harbour: boolean;
  scale: string | null;          // the parent slug the map needs to show this island, null at the top
  children: OutlineNode[];
};
```

`buildOutline(db, domainSlug)` in `src/core/view-model.ts` walks `listIslands` recursively (islets are few; no N+1 concern at this size), using `latestVerdicts` and `listLandmarksByIsland` per level as `buildSnapshot` does. `charted` and `lit` counts are over the whole tree. The route is read-only and opens the database per request like the others.

## Page

`src/web/outline.js` renders `<aside id="outline">` and owns its state (`rail`, `expanded`). `app.js` fetches the outline whenever the version changes (with the snapshot) and stores it on `app.outline`; the outline module subscribes through `app.listeners` like the pane.

**Header row** (44px): the domain name in 13px medium with a chevron; clicking opens a small menu of domains (`/api/domains`) and navigates on pick. On the right, a collapse button (`«` / `»`).

**Summary line**: `2 of 8 charted · 8 lit`, 11px muted.

**Section label** `Islands`, then the list:

- Rows 28px, 13px sans, 6px radius, hover `--panel-2`, selected `rgba(245,194,66,.12)` (the lamp at 12%).
- Left to right: chevron (`▸` / `▾`, hidden when the island has no islets), state dot (dashed open, solid ring when open with lit landmarks, filled by state, reef with a red underline), name (muted when open), anchor when harbour, count `lit/total` in 11px tabular muted.
- Islets nest one level per scale, 26px rows, 12.5px, indented 20px per level. An island's islets show when it is expanded or when it or one of its descendants is selected.
- Clicking a row selects. If the row's `scale` differs from the map's current scale, the page awaits `setScale(scale)` and then calls `select(slug)`.
- Clicking the chevron toggles expansion without selecting.

**Footer**: `[ outline` with a keycap, and `n islands`.

**Rail**: `[` or the header button toggles `rail`. The panel animates to 44px; the header keeps the button; the list is replaced by a column of dashes centred vertically, one per top-level island: 14px muted when open, 18px lamp at 60% when some landmarks are lit, 22px grass when charted (22px reef colour for a reef), 26px lamp at 100% when selected. Clicking a dash selects. Hovering the rail opens the peek: the same list in a floating card at `left: 52px`, 240px wide, closed on mouse leave.

**Map**: `camera.fit(w, h, insets)` and `centreOn(point, w, h, insets, scale)` take `{ left, right }`; `frameSelection` passes the outline's rendered width as `left` and the pane's as `right`. The top chrome (breadcrumb, strip) moves right by the outline width (`--outline-w`). Toggling the rail reframes the map.

**Keyboard**: `[` toggles the rail unless focus is in a text field. Escape still deselects.

## Copy

- Section label: `Islands`. Summary: `<n> of <m> charted · <k> lit`. Footer: `[ outline`, `<m> islands`.
- Collapse button titles: `collapse to a rail  [`, `expand the outline  [`.
- Domain menu: the domains' names; the current one marked.

## Tests

- `tests/core/view-model.test.ts`: `buildOutline` nests islets under their parent with the right `scale`, reports state and counts, marks the harbour, counts charted and lit over the whole tree.
- `tests/server/routes.test.ts`: `GET /api/outline` returns the tree; unknown domain 404.
- `tests/web/camera.test.js`: `fit` and `centreOn` with left and right insets.
- `tests/web/outline.test.js`: pure helpers live in `outline-model.js`, DOM-free, and are tested: `dashClass(node, selected)` and `visibleRows(tree, expanded, selected)` (which islets show).
- By hand: click an islet in the outline changes scale and selects it; `[` collapses; the peek opens on hover; the domain menu switches domains; the map reframes on toggle.

## Out of scope

- Reordering or renaming from the outline. Drag to reorder.
- Straits in the outline.
- Resizing the outline.
