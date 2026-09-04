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

Two brains, one database. Claude in the terminal is the cartographer (skill → CLI → SQLite): it sketches islands, islets, and straits. The judge runs inside the server on the Claude Agent SDK (`src/server/judge/`), one thread per island, and writes verdicts through the same repositories. The browser is the consumer (server → JSON API → canvas page polling `/api/version`) and the judge's chat surface (`POST /api/probe` streaming server-sent events). Comments and focus flow back through the same database.

```
src/core/       types.ts, errors.ts, validators.ts, db.ts, migrate.ts, migrations/ (0001_initial.sql, 0002_positions.sql, 0003_threads.sql, 0004_landmarks.sql), repositories/, view-model.ts, targets.ts
src/cli/        index.ts (commander), io.ts
src/server/     index.ts (startServer), routes.ts (handleRequest), judge/ (PROTOCOL.md, protocol.ts, context.ts, tools.ts, runner.ts, stub.ts, sdk.ts)
src/web/        index.html, styles.css, app.js, view-model.js, layout.js, camera.js, draw.js, interactions.js, card.js, markdown.js, stream.js, thread.js
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
- Map positions live on `islands.x`/`islands.y` in a fixed 1000×1000 world per scale (null = unplaced). The page places unplaced islands once (existing ones pinned) and posts `/api/positions`; the simulation never runs when everything is placed. Every island at a scale shares one radius (`islandRadius(count)` in `src/web/view-model.js`); elevation never changes size.
- Schema changes go in a new numbered migration under `src/core/migrations/`; `0001_initial.sql` is frozen.
- The judge writes only through its five tools: `island_context` reads; `set_landmarks`, `unlock_landmark`, `record_verdict` (sandbar, settled, mountainous) and `propose_reef` write. A reef is written only when the reader confirms it via `POST /api/probe/reef`.
- `ConflictError` → 409. `POST /api/probe` holds one turn per island at a time.
- Behaviour lives in protocol text before code: the cartographer's in `.claude/skills/archipelago-chart/SKILL.md`, the judge's in `src/server/judge/PROTOCOL.md`.
- The judge's tool surface is closed by `tools: []` plus `allowedTools` in `src/server/judge/sdk.ts`, not by `canUseTool`; do not "fix" it back.
- `bun test` never spawns the SDK: server tests run with `stub: true`; `sdk.ts` imports the SDK lazily.
- Landmarks are dark or lit, never a state; unique per island. `set_landmarks` only when an island has none; `unlock_landmark` links the latest reader message and writes the system line `landmark lit: <name>`. The judge's verdict lands when all landmarks are lit, a reef is clear, or after the fourth reader answer.
