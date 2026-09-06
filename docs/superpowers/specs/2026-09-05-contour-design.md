# Contour: how an island is drawn

**Date:** 2026-09-05
**Status:** implemented (plan: docs/superpowers/plans/2026-09-05-contour.md)
**Reads:** the island spec (data and growth); replaces the island and strait drawing in `src/web/draw.js`


Contour is a rendering of one island. It reads only derived data from the island spec — `state`, `landmarks`, `harbour`, `children.byState`, strait verdicts — and never writes. Everything here is a mapping from data to marks; the renderer has no state of its own.

## Canvas

- Each island is drawn in a 200×200 unit box centred at (100, 100). The map scales the box; the marks scale with it.
- Background is the sea, one flat colour. Nothing else is drawn on it except straits.
- Palette (six values, all named): sea `#1B3F5B`, line `#FFFFFF`, lamp `#F5C242`, reef `#D9473A`, sand `#E7D39A`, grass `#6FAF5E`, snow `#F2F4F1`. Sand and grass are used only as low-alpha fills; line is used at three alphas: 1.0 (firm), 0.7 (contour), 0.3 (uncharted).

## Coastline

- The coastline is a closed wobbly ring of radius 62 with a deterministic wobble seeded by the island's slug, so the same island always has the same shape and no two siblings look identical.
- The ring is divided into N equal arcs, one per landmark, in `sort_order`, starting at 12 o'clock and running clockwise. N is `landmarks.total`, normally 4–6.
- A **dark** landmark's arc is dotted: line at alpha 0.3, width 1, dash 1 on 5 off. A sounding mark `?` sits inside the arc at radius 52.
- A **lit** landmark's arc is firm: line at alpha 1.0, width 2.4, round caps. Lighting is permanent; an arc never returns to dotted.
- Arcs are the only progress indicator before a verdict. `landmarks.unlocked / total` is legible by counting firm arcs.

## Lamps

- One lamp per landmark, on the arc's midpoint at radius 70, just outside the coast.
- Dark: hollow ring, radius 2.2, line alpha 0.35.
- Lit: solid lamp dot radius 3 with a soft halo radius 7 at alpha 0.22.
- Lamps are the same before and after a verdict; they belong to the reader's progress, not the judge's.

## Elevation (verdict)

- The interior is filled at alpha 0.04 line when `state` is open, sand at alpha 0.18 for sandbar and reef, grass at alpha 0.22 for settled and mountainous.
- Contour rings are drawn inside the coast, one per elevation level, each a smaller wobbly ring (radius 62 − 14·k, k = 1…level), line alpha 0.7, width 1.2.
- Levels: open 0, sandbar 1, settled 2, mountainous 3, reef 1.
- Mountainous also gets a snow cap: a small filled ring of radius 12 at the centre.
- Elevation is countable. A reader who knows "settled = two rings" never needs a legend.

## Reef

- Reef keeps sandbar's one ring and fill, and lays a 45° hatch across the whole interior: reef colour, line width 1.8, 6-unit pitch.
- A *proposed* reef (pending in the thread, not yet a verdict) is not drawn. The map only shows verdicts.
- If a newer verdict lifts the reef, the hatch disappears; rings follow the new state.

## Harbour

- One island per scale may carry `harbour = 1`. Draw a small anchor glyph at (100, 184), below the coast, in line at alpha 0.85.
- The harbour mark is fixed and never changes with state.

## Straits

- A strait is drawn between two sibling islands as a line from coast edge to coast edge along the segment joining their centres, inset 8 units from each coastline.
- No verdict on the strait: dotted line, alpha 0.3, dash 2 on 6.
- Verdict on the strait: firm line, alpha 0.85, width 2. Mountainous straits add a second parallel line 3 units off; reef straits use the reef colour dashed 6 on 3.
- Straits are drawn only when *both* islands have a verdict; otherwise the map shows nothing between them.

## Parent with islets

- A parent that has islets and no verdict of its own shows a **rollup ring**: a single contour ring at radius 48 split into segments proportional to `children.byState`. Each segment uses that state's fill at full alpha (open segments are left as gaps). No hatch, no snow cap.
- Once the parent has its own verdict, the rollup ring is replaced by normal elevation rings.
- Sailing into a parent shows its islets as a scale of their own, drawn by these same rules.

## Motion

- Nothing moves on its own. The only animations answer a write: a lamp lighting (halo fades in over 300 ms), an arc firming (dash length grows to solid over 300 ms), a ring appearing (draws clockwise over 400 ms). All respect reduced-motion, which collapses them to instant.
- Version polling redraws the island only when `version` changes.

## Invariants

- The renderer reads derived fields only; it never infers state from the thread.
- Firm arcs never become dotted; rings can go up or down with verdicts.
- Reef is a hatch over an elevation, never a separate shape.
- Open water is drawn as the absence of rings, never as a fill.
- Any two islands with the same `landmarks`, `state`, and `harbour` render identically except for their seeded coastline.

## Addendum: what the renderer needs that the spec leaves open

Decided 2026-09-05 with Victor's palette decision: **one world, the chrome follows Contour.**

- **Box to world.** The map keeps one shared radius per scale (`islandRadius(count)`, 48–88 world units). That radius is the coast radius 62 of the 200-unit box, so one box unit is `radius / 62` world units; every Contour measure scales by that.
- **Name.** Not in the spec; kept. Drawn centred at (100, 204), just under the box, in line at alpha 0.9 (0.6 while open), 20 box units, Georgia. The anchor at (100, 184) sits between the coast and the name.
- **Selection and hover.** Outside Contour, the map's own marks, two states (Victor, 2026-09-06: "the hover and selected need to be different states"). Selected: a firm ring at radius 76, line at alpha 0.7, width 1.5; far islands dim to alpha 0.28 and the dimming follows the selection only. Hovered (and not selected): a dotted ring at radius 76, line at alpha 0.35, width 1, dash 2 on 4; hover never dims anything. Either state lifts the name to alpha 0.9. The renderer stays stateless; the map passes `selected`, `hovered`, and `dim`.
- **Straits.** As written: nothing between two islands until both have verdicts. The sketch's straits still exist in the data and the CLI; the map only shows charted channels.
- **Legend.** Removed. Elevation is countable and lamps are self-evident; the strip keeps nearest open water and reefs.
- **Motion.** The old rise animation goes. The page keeps, per island, the time each aspect last changed (`litAt` per landmark, `stateAt`, `levelAt`) so the three write animations can run; reduced motion collapses them to instant.
- **Palette on the chrome.** `styles.css` defines the Contour tokens (`--sea`, `--line-1`, `--line-07`, `--line-03`, `--lamp`, `--reef`, `--sand`, `--grass`, `--snow`) and aliases the old names to them so the pane, strip, outline, and chips change colour without changing class names: `--water → sea`, `--text → line at .92`, `--muted → line at .55`, `--sand → lamp`, `--land → grass`, `--ridge → snow`, `--panel → #163449`, `--panel-2 → #245069`, `--line → line at .14`, `--open → line at .30`. Lit chips, the harbour pill, the lit line, the caret, and primary buttons are lamp on sea. Typography is unchanged.
- **Sounding mark.** `?` at radius 52 on the arc's midpoint, 9 box units, line at alpha 0.3, Georgia.
- **Rollup ring.** Segment colours: sandbar sand, settled and mountainous grass, reef the reef colour, open a gap; stroke width 3, alpha 1, no fill inside.
- **Hatch.** Clipped to the coast path; 45° lines across the whole box at 6-unit pitch.

## Addendum: reading contrast (2026-09-05)

Victor, on the iOS Engineering chart at the top scale: "we need to improve on the contrast for the better reading." On a retina display the uncharted marks (line at alpha 0.3) and open names (0.6) sit near 2:1 against the sea. The values below replace the ones above; everything else in the spec stands.

| Mark | was | now |
|---|---|---|
| Dark landmark arc (dotted coast) | line 0.3 | line 0.45 |
| Sounding mark `?` | line 0.3 | line 0.45 |
| Dark landmark ring | line 0.35 | line 0.5 |
| Open strait (dotted) | line 0.3 | line 0.45 |
| Island name while open | line 0.6 | line 0.75 |
| `--muted` (counts, labels, summaries, meta, code comments via `--code-comment`) | line .55 | line .65 |
| `--open` (dashed dots in the outline, the open pill's border) | line .30 | line .40 |
| `--line-03` token | .3 | .45 (renamed in meaning only; the token name stays) |

Firm arcs (1.0), contour rings (0.7), charted names (0.9), lamps, and fills are unchanged. Checked by hand on Victor's display against `ios-engineering` at the top scale: the dotted coasts, the `?` marks, and the open names read without leaning in; the lit/dark distinction on an island with two lamps is still obvious.
