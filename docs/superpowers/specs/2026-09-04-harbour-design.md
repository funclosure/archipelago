# Harbour: the island to set out from

**Date:** 2026-09-04
**Status:** approved design, awaiting plan
**Builds on:** chart-and-log (`2026-09-04-chart-and-log-design.md`)

## Why

A fresh domain is ten dashed islands and no hint of where to begin. After sketching React Native for iOS engineers, Victor asked for a way to mark the starting island. The cartographer knows which island the reader already half-stands on; the map should say so.

## Decisions

| Question | Decision |
|---|---|
| What the mark does | Shows on the map and in the strip. It does not select the island on open; `focus` already does that when wanted. |
| Who sets it | The cartographer, with the CLI, at sketch time or later. The reader does not set it from the page. |
| After the island is charted | The mark stays. The strip line changes from `Set out from` to `Home port`. |
| Where it lives | A flag on the island, at most one per parent, so every scale can have its own harbour. |
| Name | Harbour. The vocabulary tables gain: *harbour*, the island you set out from at this scale. |

## Data

`src/core/migrations/0005_harbour.sql`:

```sql
-- Harbour: the island the reader sets out from at a scale. At most one per parent.
alter table islands add column harbour integer not null default 0;
create unique index islands_harbour_per_parent on islands(domain_id, coalesce(parent_id, 0)) where harbour = 1;
```

`islands_au` (0001) already bumps `view_state.version` on update, so the page learns of a harbour change through the poll. `0001`–`0004` stay frozen.

`Island` gains `harbour: 0 | 1` (the column added to `COLS`; SQLite hands back the integer). `IslandView.harbour` is the boolean. `IslandUpsert` does not take it; the harbour is set by its own verb.

`src/core/repositories/islandRepository.ts`:

- `setHarbour(db, domainId, slug)`: in one transaction, clears `harbour` on every island with the same `domain_id` and `parent_id` as the named island, then sets it on the named island. Returns the island. `NotFoundError` with `valid` slugs when the slug is unknown.
- `clearHarbour(db, domainId, parentId: number | null)`: clears the flag among that parent's children. Returns how many rows changed.
- `getHarbour(db, domainId, parentId: number | null)`: the island with the flag among that parent's children, or null.

## Snapshot

`IslandView` gains `harbour: boolean`. `Snapshot` gains `harbour: string | null`, the slug of the harbour island at the current scale. `buildSnapshot` reads it from the island views it already built.

## CLI

```
harbour  set --domain <slug> --island <slug>
         clear --domain <slug> [--parent <slug>]
         show --domain <slug> [--parent <slug>]
```

`set` prints `{ harbour: <slug>, parent: <slug|null>, version }`. `clear` prints `{ cleared: <n>, version }`. `show` prints `{ harbour: <slug|null>, parent: <slug|null> }`. Unknown slugs exit 1 with `{ error, valid }` as everywhere else. `--parent` omitted means the top scale.

## Skill

`.claude/skills/archipelago-chart/SKILL.md`:

- Vocabulary table: `harbour — the island to set out from at this scale; the strip names it.`
- Setup (§1): the sketch table gets a note under it, "and the harbour: which island the user already half-stands on", and step 3's example ends with `A harbour set --domain system-design --island caching`. Choose the island closest to what the user said they already know; when nothing is known, the island with the most straits.
- Sailing closer (§7): after writing the islets, set a harbour among them when one is the natural first step, otherwise leave it unset.
- Ending a sitting (§8): the orientation names the harbour when the reader has not set out from it yet.

## Page

- **Map** (`draw.js`): when `node.island.harbour` is true, `drawLabel` draws an anchor glyph `⚓` in the label font, sand colour, immediately left of the island name, with a 6px gap; the name stays centred on the island as before, so the glyph hangs off its left edge. Drawn in every state, dimmed with the island.
- **Strip** (`app.js` `renderStrip`): when `snapshot.harbour` is set, the first item is `Set out from` with the island's name while that island has no verdict, and `Home port` with the name once it has one. `Nearest open water` and `Reefs` follow. When no harbour is set, the strip is unchanged.
- **Pane head** (`card.js`): a `harbour` pill (dashed, sand text) after the state pill when the island is the harbour.
- The judge is unchanged; `island_context` does not mention the harbour.

## Copy

- Strip labels: `Set out from`, `Home port`.
- Pane pill: `harbour`.
- CLI `harbour set` when the island already is the harbour: idempotent, same output, no error.

## Tests

- `tests/core/islandRepository.test.ts`: `setHarbour` moves the flag from a sibling; two parents can each have a harbour; `setHarbour` on an islet does not disturb the top-level harbour; `clearHarbour` returns the count; unknown slug throws with `valid`.
- `tests/core/db.test.ts`: migration 0005 applies on a 0004 database and the partial unique index exists.
- `tests/core/view-model.test.ts`: `snapshot.harbour` is the slug at the current scale and null at a scale without one; `IslandView.harbour` set on exactly one island.
- `tests/cli/cli.test.ts`: `harbour set` then `harbour show`; `harbour clear`; unknown island exits 1 with `valid`.
- By hand: the anchor glyph beside the harbour on the map, the strip line switching after a verdict, the pill in the pane.

## Out of scope

- The reader setting the harbour from the page.
- A route or ordering beyond the single starting island.
- Telling the judge about the harbour.
