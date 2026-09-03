# Archipelago — Slice 1 Design

*2026-09-03 · status: approved in brainstorming, awaiting spec review*

Archipelago is a conversational tool for charting what you understand about a domain, shown as islands in open water. This spec covers the first buildable slice: a local web app, a SQLite database, a CLI that Claude drives from the terminal, a charting skill, and a canvas map with a comment channel back to the session. Two scales (archipelago and island) with real zoom.

The project brief (`docs/BRIEF.md`) is the source for vocabulary and principles; this document is the source for how slice 1 is built.

## 1. Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Where the conversation lives | In the Claude Code terminal only. The browser is an output surface with a comment channel back. |
| Data home | Local SQLite at `.archipelago/archipelago.sqlite`. No hosted artifact, no Agent SDK, no API key. |
| Zoom scope | Two scales work end to end. The schema is a tree, so deeper levels are more rows, not new tables. |
| Approach | Locus-shaped (CLI + skill write path, static page over a JSON API), mindgraph-faced (single canvas, force layout, spotlight). |
| Runtime | Bun, `bun:sqlite`, plain ES modules for the page, no bundler, no framework. Vitest for tests. |

References: `../locus` (CLI + skill + browse UI pattern), `../mindgraph` (canvas map, `ui/layout.js`, `docs/graph-system.md`), `../loupe` (launcher `cli.ts`, warm-ink palette).

## 2. Architecture

One seam. Claude in the terminal is the **producer**; the browser is the **consumer**; the SQLite file is the **contract**. The page never authors verdicts. Claude never draws.

```
Charting skill  →  archipelago CLI  →  SQLite  ←  Bun server  ←  canvas page
(terminal Claude)   (JSON in/out)        │          /api/*         (polls version)
                                         └──────── comments, focus ◄── page writes
```

| Piece | Path | Responsibility |
|---|---|---|
| Core | `src/core/` | Types, zod validators, db open + migrations, repositories, view-model. No CLI, HTTP, or DOM. |
| CLI | `src/cli/` | The only write path for Claude. Commander. Flags or stdin JSON in, JSON out. |
| Charting skill | `.claude/skills/archipelago-chart/SKILL.md` | How Claude probes, classifies, records evidence, reads comments, sails closer. |
| Server | `src/server/` | `Bun.serve` on port 4480. Static files + JSON API. Launched by `cli.ts` which opens the browser. |
| Map page | `src/web/` | `index.html`, `app.js`, `view-model.js`, `layout.js`, `draw.js`, `camera.js`, `styles.css`. One canvas. |

Per charting turn: user answers in the terminal → Claude runs `archipelago verdict set` → trigger bumps `view_state.version` → page's next poll sees a new version → fetches snapshot → redraws with animation.

Back-channel: user clicks an island or types a note on the map → page `POST /api/comment` → row in `comments` → the skill's first step next turn is `archipelago comment list --unread`.

## 3. Data model

SQLite, `pragma foreign_keys = on`, numbered migrations in `src/core/migrations/NNNN_name.sql` with a `schema_migrations` table (as in locus). All timestamps ISO text.

### domains
`id, slug (unique), name, created_at`. One row per archipelago.

### islands
`id, domain_id → domains, parent_id → islands (nullable), slug, name, summary, sort_order, created_at, updated_at`.
Unique `(domain_id, parent_id, slug)`. Depth 0 rows are top-level islands; rows with a parent are that island's islets. **Scale is depth**, not a stored column.

### straits
`id, domain_id, from_island_id → islands, to_island_id → islands, name (nullable), summary (nullable), created_at`.
Both ends must be siblings (same `parent_id`); enforced in the repository. Unique on the unordered pair (store `from_island_id < to_island_id`).

### verdicts
`id, target_type check in ('island','strait'), target_id, state check in ('sandbar','settled','mountainous','reef'), confidence real 0..1, evidence text not null, rationale text, session_id → sessions (nullable), created_at`.
**Append-only.** The view reads the latest per target. **Open water is the absence of a verdict**, never a stored state. `evidence` is the user's own words, verbatim.

### comments
`id, domain_id, target_type check in ('island','strait','domain'), target_id, body text (may be empty), kind check in ('note','probe_me','dispute'), read_at (nullable), created_at`.
Written by the page. A bare click on an island with the "closer" or "probe" affordance posts `probe_me` with an empty body.

### sessions
`id, domain_id, started_at, ended_at (nullable), summary (nullable)`. One row per sitting.

### view_state
`domain_id (pk), focus_island_id → islands (nullable), version integer not null default 0`.
Triggers on insert/update of islands, straits, verdicts, comments, sessions, and on update of `focus_island_id` bump `version` for that domain.

### View-model (`src/core/view-model.ts`)
`buildSnapshot(db, domainSlug, scaleIslandSlug | null)` returns:

```
{
  version, domain: {slug, name},
  scale: { path: [{slug,name}...] },              // breadcrumb; [] at top level
  islands: [{ slug, name, summary,
              verdict: null | {state, confidence, evidence, rationale, at},
              children: { total, byState: {sandbar,settled,mountainous,reef,open} },
              hasChildren }],
  straits: [{ from, to, name, verdict: null | {...} }],
  focus: slug | null,
  unreadComments: n
}
```
Rules: latest verdict wins; a parent with no verdict of its own shows `children.byState` as a roll-up and is never assigned a state; `open` counts children with no verdict.

## 4. Charting protocol (the skill)

`.claude/skills/archipelago-chart/SKILL.md`, invocable as `/archipelago-chart`.

**Setup.** On a new domain: Claude proposes 6–10 top-level islands (name + one-line summary) and the straits between neighbours, prints the sketch, and writes it with `domain add`, `island add`, `strait add` only after the user approves. The sketch is then stable: later sessions read it from the database.

**Turn opening.** Every turn:
1. `archipelago comment list --unread --domain <slug>`. `probe_me` → the next probe goes to that target. `dispute` → reopen that verdict: ask one question, then record a new verdict (history keeps the old one). `note` → read and acknowledge. Then `comment mark-read`.
2. `archipelago focus show --domain <slug>` → "this one" in conversation resolves to the focused island.

**Probe, don't quiz.** One island per probe. Ask for an explanation, an application to a concrete scenario, or a prediction. Never ask for a definition. At most two follow-ups per island before moving on.

**Classification tests.**

| State | Test |
|---|---|
| sandbar | Shape is right; a scenario or "why" question exposes a missing layer. |
| settled | Explains correctly and applies it to a scenario. |
| mountainous | Also handles an edge case, or explains why the naive approach fails. |
| reef | A confident, specific claim that is wrong, and Claude can name what breaks because of it. |

`confidence < 0.6` → ask one more question instead of writing. `evidence` = a verbatim quote from the user's answer. `rationale` = one sentence naming which test decided it.

**Reef rule.** A reef is written only when Claude can state (a) the specific false claim and (b) a concrete consequence. Otherwise record a sandbar and a `note` comment. False reefs are worse than missed ones because the map treats a reef as a hazard.

**Straits.** When two neighbouring islands both have verdicts, ask one question about how they relate, then `verdict set --target strait:<a>~<b>`.

**Sailing closer.** When an island is settled or mountainous and the user asks to go closer (or a `probe_me` arrives on an island with no islets), sketch its islets and straits with `--parent <slug>`, get approval, write them. Verdicts on islets are tagged by depth automatically. A verdict on a parent says nothing about its islets; the skill says so explicitly.

**Stop.** `archipelago session end --summary "<one paragraph>"`, then print an orientation: charted islands, sandbars, reefs, nearest open water at the current scale.

## 5. CLI

Binary `archipelago` (Bun, `bin` in `package.json`, `bun link`). Every command: options or stdin JSON in, JSON out with `--json` (default when stdout is not a TTY). Slugs everywhere Claude types; `add` is an upsert by slug.

```
archipelago domain   add --slug --name | list | show --slug
archipelago island   add --domain --slug --name [--summary] [--parent <slug>] [--order n]
                     update --domain --slug [...] | list --domain [--parent] | show --domain --slug
archipelago strait   add --domain --from <slug> --to <slug> [--name] [--summary] | list --domain [--parent]
archipelago verdict  set --domain --target island:<slug>|strait:<a>~<b> --state --confidence --evidence [--rationale]
                     history --domain --target ...
archipelago session  start --domain | end --domain --summary | show --domain
archipelago focus    show --domain | set --domain --island <slug>
archipelago comment  list --domain [--unread] | mark-read --domain [--id n | --all]
archipelago snapshot --domain [--scale <island-slug>]
archipelago serve    [--port 4480] [--no-open]
```

Errors exit non-zero with `{ "error": "...", "valid": [...] }` where a list of valid slugs helps (unknown island, unknown strait endpoint, non-sibling strait).

`ARCHIPELAGO_DB_PATH` overrides the database path (used by tests).

## 6. Server

`Bun.serve` on `127.0.0.1:4480`, idle timeout 120s. Static files from `src/web/` read fresh per request (`Cache-Control: no-cache`). No build step for the page.

| Route | Purpose |
|---|---|
| `GET /api/version?domain=` | `{ version }`. Polled every 2s. |
| `GET /api/snapshot?domain=&scale=` | View-model output for one level. |
| `POST /api/focus` `{domain, island}` | Sets `focus_island_id`, bumps version. |
| `POST /api/comment` `{domain, targetType, targetId(slug), body, kind}` | Inserts a comment, bumps version. |
| `GET /api/domains` | List for the domain switcher. |

POST bodies carry slugs (`domain`, `island`, `targetId` as an island slug or `a~b` strait pair); routes resolve them to ids before writing and answer 404 with `{ error }` on an unknown slug.

`cli.ts` starts the server and runs `open http://127.0.0.1:4480/?domain=<slug>` unless `--no-open`.

## 7. Map page

**Layout.** Force simulation in the style of mindgraph's gravity-field model: islands are bodies, straits are springs, mass ∝ elevation (`open`=1, `sandbar`=1.5, `settled`=2.5, `mountainous`=4; a parent with roll-up uses the max of its children). Initial positions seeded from a hash of the slug so the archipelago is stable across loads. Simulation reheats only on snapshot change, hover, or drag; asleep at rest.

**Encoding.**

| State | Island | Strait |
|---|---|---|
| open water | faint dashed outline, name, no fill | thin dashed channel |
| sandbar | low pale sand shape | thin solid, pale |
| settled | solid landmass, warm-ink palette | solid |
| mountainous | landmass + darker ridge + contour rings | solid, heavier |
| reef | settled-looking shape broken by a jagged red-brown line + hazard glyph | jagged red-brown stroke |

Rule: unknown must never look like beginner; reef must never look like open water.

**Scale.** Breadcrumb top-left (`System Design › Caching`). Clicking an island with islets sails in: camera zooms, siblings fade, children rise. A breadcrumb click sails out. An island without islets shows a "closer" affordance on hover that posts `probe_me`.

**Focus.** Hover spotlights and dims the rest. Click selects: posts `/api/focus` and opens a right-side card with state, evidence quote, rationale, verdict history, and a one-line note box (`note` or `dispute`).

**Live.** Poll `/api/version`; on change fetch `/api/snapshot`, diff by slug, animate state transitions (new verdict rises out of the water over ~600ms).

**Orientation.** Legend bottom-left. Bottom strip lists nearest open water and reefs at this scale.

**Palette.** Warm ink (loupe/grip): `#1a1816` water, `#ede8e3` text, sand `#d9c7a3`, land `#c9a87c`, ridge `#8a6e4b`, reef `#a3452e`.

## 8. Error handling

- Validators reject bad states, unknown targets, non-sibling straits before any write.
- CLI: non-zero exit, `{ error }` on stdout, so the skill can read and correct.
- Page: if a poll fails, show a small "disconnected" mark and keep the last snapshot; resume silently when polls succeed.
- Server: migration failure aborts start with the error printed.
- Comments are never lost: if the skill fails mid-turn, unread rows remain unread.

## 9. Testing

Vitest, `bunx vitest run`. Temp database per test via `ARCHIPELAGO_DB_PATH`.

- Repositories: upsert by slug, sibling check on straits, append-only verdicts, comment read lifecycle, version bump on every write.
- View-model: open water is absence (never a state), latest verdict wins, parent roll-up when no own verdict, breadcrumb path, unread count.
- CLI end-to-end: domain → islands → strait → verdict → snapshot round trip; error shape on unknown slug.
- Page: not unit-tested beyond the view-model. Manual check via `archipelago serve`.

## 10. Out of scope for slice 1

- Depth beyond two scales in the skill's guidance (the schema supports it; the map breadcrumb supports it; the skill only describes one "closer" step).
- Multiple users, sync, hosting.
- Persona-style probing lenses.
- Export (markdown/JSON) beyond `snapshot`.
- Any in-browser chat.

## 11. Layout

```
archipelago/
  cli.ts                      launcher: serve + open
  package.json                bin: archipelago
  src/core/{types,validators,db,migrate,view-model}.ts
  src/core/migrations/0001_initial.sql
  src/core/repositories/{domain,island,strait,verdict,comment,session,viewState}.ts
  src/cli/index.ts
  src/server/{index,routes}.ts
  src/web/{index.html,app.js,view-model.js,layout.js,draw.js,camera.js,styles.css}
  .claude/skills/archipelago-chart/SKILL.md
  docs/BRIEF.md
  docs/superpowers/specs/  docs/superpowers/plans/
  tests/
```
