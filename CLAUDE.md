# Archipelago

Chart what you understand about a domain, as islands in open water. Brief: `docs/BRIEF.md`. Slice 1 spec: `docs/superpowers/specs/2026-09-03-archipelago-slice1-design.md`. Plan: `docs/superpowers/plans/2026-09-03-archipelago-slice1.md`.

## Commands

```bash
bun install
bun test                              # all tests (bun test, NOT vitest — vitest cannot resolve bun:sqlite)
bunx tsc --noEmit                     # typecheck
bun run src/cli/index.ts <command>    # the CLI; `bun link` registers it as `archipelago`
bun run src/cli/index.ts serve        # map server on 127.0.0.1:4480, opens the browser
```

## Architecture

One seam. Claude in the terminal is the producer (skill → CLI → SQLite). The browser is the consumer (server → JSON API → canvas page polling `/api/version`). Comments and focus flow back through the same database.

```
src/core/       types.ts, errors.ts, validators.ts, db.ts, migrate.ts, migrations/0002_positions.sql, repositories/, view-model.ts, targets.ts
src/cli/        index.ts (commander), io.ts
src/server/     index.ts (startServer), routes.ts (handleRequest)
src/web/        index.html, styles.css, app.js, view-model.js, layout.js, camera.js, draw.js, interactions.js, card.js
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
- Page: no framework, no bundler. Pure helpers in `view-model.js` are unit-tested; the canvas is checked by hand.
- Skill is the charting protocol; change behaviour there before changing code.
- Map positions live on `islands.x`/`islands.y` in a fixed 1000×1000 world per scale (null = unplaced). The page places unplaced islands once (existing ones pinned) and posts `/api/positions`; the simulation never runs when everything is placed. Every island at a scale shares one radius (`islandRadius(count)` in `src/web/view-model.js`); elevation never changes size.
- Schema changes go in a new numbered migration under `src/core/migrations/`; `0001_initial.sql` is frozen.
