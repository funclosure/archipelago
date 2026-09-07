# Archipelago

Chart what you understand about a domain, as islands in open water. Brief: `docs/BRIEF.md`. Slice 1 spec: `docs/superpowers/specs/2026-09-03-archipelago-slice1-design.md`. Plan: `docs/superpowers/plans/2026-09-03-archipelago-slice1.md`.

## Commands

```bash
bun install
bun test                              # all tests (bun test, NOT vitest — vitest cannot resolve bun:sqlite)
bunx tsc --noEmit                     # typecheck
bun run src/cli/index.ts <command>    # the CLI; `bun link` registers it as `archipelago`
bun run src/cli/index.ts serve        # map server on 127.0.0.1:4480, opens the browser
bun run src/cli/index.ts serve --stub # judge without a Claude login
```

## Architecture

Two brains, one database. Claude in the terminal is the cartographer (skill → CLI → SQLite): it sketches islands, islets, and straits. The judge runs inside the server on the Claude Agent SDK (`src/server/judge/`), one thread per island, and writes verdicts through the same repositories. The browser is the consumer (server → JSON API → canvas page polling `/api/version`) and the judge's chat surface (`POST /api/probe` streaming server-sent events). The outline (`outline.js`) reads `GET /api/outline`, the whole tree, refreshed with every snapshot. Comments and focus flow back through the same database.

```
src/core/       types.ts, errors.ts, validators.ts, db.ts, migrate.ts, migrations/ (0001_initial.sql, 0002_positions.sql, 0003_threads.sql, 0004_landmarks.sql, 0005_harbour.sql, 0006_asks.sql, 0007_board.sql), repositories/, view-model.ts, targets.ts
src/cli/        index.ts (commander), io.ts
src/server/     index.ts (startServer), routes.ts (handleRequest), vendor.ts, vendor/ (shiki-entry.js), judge/ (PROTOCOL.md, protocol.ts, context.ts, tools.ts, runner.ts, stub.ts, sdk.ts)
src/web/        index.html, styles.css, app.js, view-model.js, layout.js, camera.js, draw.js, contour.js, interactions.js, card.js, cta.js, outline.js, outline-model.js, keys.js, keys-model.js, markdown.js, stream.js, thread.js, code.js, code-model.js, board.js, board-model.js
.claude/skills/archipelago-chart/SKILL.md
tests/          core/, cli/, server/, web/
```

## Conventions

- `bun:sqlite`, numbered migrations in `src/core/migrations/`, snake_case columns aliased to camelCase in every `select`.
- Open water is the absence of a verdict. Never store or render an "open" state as a score.
- Verdicts are append-only; latest `id` wins. Island slugs are unique per domain. Straits join siblings only.
- Every write bumps `view_state.version` via SQL triggers; the page polls that integer every 2s.
- CLI: JSON always; pretty on a TTY, compact with `--json` or when piped; `--stdin` merges JSON under flags; errors exit 1 with `{ error, valid? }`.
- Server opens and closes the database per request. Static files are read fresh (`Cache-Control: no-cache`); no build step for the page.
- Page: no framework, no bundler, no `innerHTML`. Pure helpers in `view-model.js`, `thread.js` (markdown, log items), and `camera.js` are unit-tested; the canvas and the pane are checked by hand. The pane (`card.js`) is head, log, foot: the log is the only scroll region. Selecting an island frames it at the centre of the map area beside the pane at 1.5× the home scale (`frameSelection` in `app.js`).
- Map positions live on `islands.x`/`islands.y` in a fixed 1000×1000 world per scale (null = unplaced). The page places unplaced islands once (existing ones pinned) and posts `/api/positions`; the simulation never runs when everything is placed. Every island at a scale shares one radius (`islandRadius(count)`); it is the coast radius 62 of Contour's 200-unit box (`src/web/contour.js`), so marks scale with the map and elevation never changes size. `draw.js` is stateless and reads derived fields only; the write animations run off `node.litAt` and `node.stateAt`. The palette is Contour's (sea, line at alphas, lamp, reef, sand, grass, snow); the chrome's old token names are aliases onto it.
- Schema changes go in a new numbered migration under `src/core/migrations/`; `0001_initial.sql` is frozen.
- The judge writes only through its seven tools: `island_context` reads; `set_landmarks`, `unlock_landmark`, `record_verdict` (sandbar, settled, mountainous), `propose_reef`, `ask_reader` (records a question with 2–4 options, attached by the route to the reply), and `board_write` (pins, updates, or removes a card on the island's board; only its own cards) write. A reef is written only when the reader confirms it via `POST /api/probe/reef`.
- `ConflictError` → 409. `POST /api/probe` holds one turn per island at a time.
- Behaviour lives in protocol text before code: the cartographer's in `.claude/skills/archipelago-chart/SKILL.md`, the judge's in `src/server/judge/PROTOCOL.md`.
- The judge's tool surface is closed by `tools: []` plus `allowedTools` in `src/server/judge/sdk.ts`, not by `canUseTool`; do not "fix" it back.
- `bun test` never spawns the SDK: server tests run with `stub: true`; `sdk.ts` imports the SDK lazily.
- Landmarks are dark or lit, never a state; unique per island. `set_landmarks` only when an island has none; `unlock_landmark` links the latest reader message and writes the system line `landmark lit: <name>`. The judge's verdict lands when all landmarks are lit, a reef is clear, or after the fourth reader answer.
- Harbour: `islands.harbour`, at most one per parent (partial unique index); written only by `harbour set` / `clear`. The snapshot carries `harbour` (slug at the current scale); the strip leads with it; the judge never sees it.
- Outline: 232px expanded, 44px rail (`--outline-w`); the camera frames between `insets()` (outline left, pane right). Cross-scale selection is `await setScale(scale)` then `select(slug)`. Rail and expansion state live in `localStorage` under `outline:<domain>`.
- Keys: one focused region at a time (`body[data-focus]`, outline → map → pane on Tab), shown by a lamp line; `keys.js` owns the only window keydown listener (the answer box keeps its own Enter) and dispatches to handlers each region registers; `keys-model.js` is pure (Escape ladder, cursor moves, cheat sheet). Letters are dead in text fields. The outline cursor is a slug, never persisted. Inside the board's editor, Tab moves between its fields.
- Asks: `asks` rows attach to the judge message the route stores after the turn (`attachAsks`); a pick goes through `POST /api/probe` with `askId` and becomes the next reader message. Mermaid is served at `/vendor/mermaid.js` from node_modules; the page renders closed mermaid fences through DOMParser, never innerHTML. shiki is the one bundled artifact: `Bun.build` runs once per process from `src/server/vendor/shiki-entry.js` and serves `/vendor/shiki.js` with an ETag; the engine is oniguruma, whose wasm is served beside it at `/vendor/onig.wasm` as `application/wasm`; the page renders fences as spans per token (`code.js`), colours live in `--code-*` variables, and the judge's code rule is PROTOCOL §9 (one fence per reply, code or diagram). The bottom-centre card (`cta.js`) carries map actions only: reef confirm, sail next.
- Themes: `src/web/theme-model.js` is the registry (`night` first and default, `chart`); a theme is one entry there plus one `:root[data-theme="<id>"]` block in `styles.css` that redefines every literal colour token of `:root` (`tests/web/theme-tokens.test.js` enforces it, and that no literal colour exists outside those blocks). `theme.js` stamps `<html>`, stores `localStorage.theme` (per browser, never the database), pushes the seven canvas tokens into `PALETTE` through `setPalette`, re-initialises mermaid on its `base` theme through `applyMermaidTheme` (cache cleared), and fires a `theme` event the pane and the board rebuild on; a head script stamps the stored id before first paint. Picked from the outline's domain menu or with `t`. The system colour scheme is never read.
- Board: `board_cards` (migration 0007), one board per island, kinds `diagram | note | code`, authors `you | judge`, creation order. `boardWrite(deps, input, author)` in `tools.ts` carries the rules for both the SDK tool (`judge`: own cards only, one `board: …` system line per write) and `POST /api/board` (`you`: any card, no message). The context renders the whole board with "new/edited since your last reply" marks (PROTOCOL §10). On the page, `board.js` is a sheet over the map area (`#board` below the strip with a scrim `#board-scrim` over the peeked map, z-index 2, toggled by the bottom-right button, `b`, the ×, or a click on the scrim; the map keeps drawing behind it), `board-model.js` is pure; while the board is open it is the map region's container and takes the map's keys (`j/k`, Enter, `d/n/c`, `x`, `⌘↵`); Escape rungs: sheet, menu, blur, editor, board, cursor, deselect. Board writes never start a Keeper turn. `board list --domain --island` is the cartographer's read of the board; the charting skill reads it beside the thread before sailing closer.
