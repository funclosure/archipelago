# Archipelago — Fixed Island Positions

*2026-09-03 · status: approved in brainstorming, awaiting spec review*

Islands keep a fixed place on the map so the user can remember where things are. Today the map seeds positions from the slug and lets a force simulation settle them on every load and after every verdict (mass changes with elevation), so nothing about "where Caching is" survives. This spec replaces that with placement once, persisted in the database, and a fixed footprint per island.

Builds on `docs/superpowers/specs/2026-09-03-archipelago-slice1-design.md`.

## 1. Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Who places an island | The page, once: force layout with existing islands pinned, then persisted. Verdicts never move anything. Dragging an island persists its new spot. |
| Size | Fixed footprint per island at a scale; elevation shows through fill, contour rings and ridge, not through growth. |
| Where placement runs | In the page (approach A): the simulation already lives there and the map is the only consumer of positions. No `layout` command, no Claude-supplied coordinates. |

## 2. Data

Migration `src/core/migrations/0002_positions.sql`:

```sql
alter table islands add column x real;
alter table islands add column y real;
```

Null means unplaced. Coordinates are in a fixed world of 1000 × 1000 units per scale, origin top-left, independent of window size. Each scale (top level, or the islets of one parent) has its own world. The existing `islands_au` trigger bumps `view_state.version` on every position write, so other tabs see it.

Types: `Island` gains `x: number | null`, `y: number | null`. `IslandView` in the snapshot gains the same two fields.

Repository (`islandRepository.ts`): `setIslandPositions(db, domainId, positions: { slug, x, y }[]): number` resolves every slug first (throwing `NotFoundError` with the valid slugs on any miss), then writes all rows in one `db.transaction`, and returns the number written. `COLS` includes `x, y`. `updateIsland` accepts `x` and `y` in its patch.

Validators: `positionsInputSchema = { domain: slug, positions: [{ island: slug, x: number 0..1000 finite, y: number 0..1000 finite }] (min 1) }`. `islandUpdateSchema` gains optional `x`, `y` (`numberInput.pipe(z.number().min(0).max(1000))`).

## 3. API and CLI

`POST /api/positions` with `{ domain, positions: [{ island, x, y }] }` → `{ written, version }`. Behind the same content-type and origin guard as `/api/comment`. One route serves first placement and drags. Unknown slug → 404 `{ error, valid }` and nothing is written; bad numbers → 400.

CLI: `island update` gains `--x <n> --y <n>`; `island show` and `island list` include `x` and `y`. No new command.

## 4. Page

**World and camera.** `camera.js` gains a fit transform: the 1000-unit world fills the shorter window side with a 6% margin, centred. Pan and wheel adjust the camera on top of the fit; resize recomputes the fit. `hitTest`, `toWorld` and drawing all work in world units.

**Nodes.** `view-model.js`: a node's `x`, `y` come from the island when present; `placed` is true. Unplaced nodes start near the centroid of their strait neighbours that are placed, else the world centre, with a small seeded offset so two unplaced islands do not coincide. Radius is a function of the number of islands at the scale (`clamp(48, 220 / sqrt(n), 88)` world units), the same for every island at that scale, never of the verdict. Mass stays 1 for all.

**Placement.** `app.js`: after `applySnapshot`, if any node is unplaced, run the simulation with placed nodes pinned until it settles (alpha reaches 0 or 600 ticks), then post every previously unplaced node's position to `/api/positions` once. While the post is in flight, and if it fails, the nodes stay at their provisional spots; the post is retried after five seconds while islands remain unplaced. The simulation never runs when every node is placed. Hover no longer reheats anything.

**Drag.** On pointerup after a real drag (beyond the click slop), post that island's new position. The node is not pinned by a flag any more; placed nodes never move unless dragged.

**Scales.** Each scale is its own world, so sailing in shows a stable coastline. Camera animation on scale change is unchanged.

**Nothing else moves.** Adding a strait later does not relayout. New islands are placed around what exists.

## 5. Errors

- A positions post fails as a whole on any unknown slug (404 with valid slugs) or bad number (400); no partial writes.
- A failed placement post is logged and retried after five seconds while islands remain unplaced.
- The page ignores positions outside 0..1000 in a snapshot only by clamping when drawing; the server never stores them.

## 6. Tests

- Migration: the two columns exist and default to null; `0001` and `0002` both apply on a fresh database and `migrateDatabase` is still idempotent.
- Repository: `setIslandPositions` writes all rows or none; version bumps once per island written; unknown slug throws `NotFoundError` with valid slugs and leaves the table unchanged.
- View-model: snapshot islands carry `x` and `y`.
- CLI: `island update --x --y` round-trips through `island show`.
- Routes: a positions post persists and returns the version; an unknown slug rolls the batch back; the origin guard applies.
- Page (`bun test` on `view-model.js`): placed islands keep their coordinates across a rebuild; radius depends on island count, not on the verdict; unplaced nodes start near placed neighbours.
- Browser check: first open places and persists; reload keeps positions; a new verdict moves nothing; a drag persists across reload; sail in and out keep both worlds.

## 7. Out of scope

- Re-layout on demand, snapping, alignment guides.
- Semantic (Claude-chosen) geography.
- Any change to straits, verdicts, comments or the skill.
