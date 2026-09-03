# Fixed Island Positions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Islands keep a fixed, persisted place on the map: placed once by the page's force layout with existing islands pinned, stored in SQLite, moved only by dragging, with a fixed footprint per island so verdicts never shift the archipelago.

**Architecture:** Two nullable columns on `islands` hold coordinates in a 1000×1000 world per scale. The snapshot carries them; a guarded `POST /api/positions` writes them. The page fits the world to the window, draws placed islands exactly where stored, runs the simulation only for unplaced islands (placed ones pinned), posts the result once, and posts again after a drag.

**Tech Stack:** unchanged — Bun, `bun:sqlite`, commander, zod 4, `bun test`, plain ES modules + Canvas 2D.

Spec: `docs/superpowers/specs/2026-09-03-fixed-positions-design.md`. Slice 1 plan (for conventions and existing code): `docs/superpowers/plans/2026-09-03-archipelago-slice1.md`.

## Global Constraints

- Coordinates are in a fixed world of 1000 × 1000 units per scale, origin top-left; null means unplaced. The server stores only values in 0..1000.
- Placed islands never move on their own: no simulation runs when every island at a scale is placed; verdicts, straits added later, hover and resize move nothing.
- Fixed footprint: at a scale every island has the same radius, `clamp(48, 220 / sqrt(count), 88)` world units, never a function of the verdict.
- `POST /api/positions` sits behind the same content-type and Origin/Host guard as `/api/comment`; an unknown slug fails the whole batch with 404 and `valid`; nothing partial is written.
- Every position write goes through `islands_au`, so `view_state.version` bumps once per island written.
- Schema changes go in `src/core/migrations/0002_positions.sql`; never edit `0001_initial.sql`.
- Tests run with `bun test`; typecheck with `bunx tsc --noEmit`. Pure page helpers (`view-model.js`) are unit-tested; the canvas is checked in a browser by the controller.
- Every commit message ends with the two trailer lines:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq`.

---

## File structure

```
src/core/migrations/0002_positions.sql     add x, y to islands
src/core/types.ts                           Island gains x, y
src/core/repositories/islandRepository.ts   COLS + x,y; updateIsland accepts x,y; setIslandPositions()
src/core/validators.ts                      coordinate, positionsInputSchema, islandUpdateSchema x,y
src/core/view-model.ts                      IslandView gains x, y
src/cli/index.ts                            island update --x --y
src/server/routes.ts                        POST /api/positions
src/web/camera.js                           world fit + home framing
src/web/view-model.js                       placed nodes, fixed radius, provisional positions
src/web/app.js                              world camera, placement post, no idle simulation
src/web/interactions.js                     drag persists, no reheat
src/web/draw.js                             sizes in world units (labels, glyphs, lines)
README.md, CLAUDE.md                        positions and dragging documented
tests/core/{db,islandRepository,validators,view-model}.test.ts, tests/cli/cli.test.ts,
tests/server/routes.test.ts, tests/web/view-model.test.js
```

---

### Task 1: Migration, types, repository

**Files:**
- Create: `src/core/migrations/0002_positions.sql`
- Modify: `src/core/types.ts` (Island), `src/core/repositories/islandRepository.ts`
- Test: `tests/core/db.test.ts`, `tests/core/islandRepository.test.ts`

**Interfaces:**
- Consumes: `migrateDatabase`, `requireIsland`, `NOW`, `COLS` in `islandRepository.ts`.
- Produces: `Island.x: number | null`, `Island.y: number | null`; `updateIsland(db, domainId, slug, { name?, summary?, sortOrder?, x?, y? })`; `setIslandPositions(db, domainId, positions: { slug, x, y }[]): number` (all-or-nothing, throws `NotFoundError` with valid slugs on any unknown slug); type `IslandPosition = { slug: string; x: number; y: number }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/db.test.ts`:

```ts
test("0002 adds nullable island positions", () => {
  const db = openDatabase(":memory:");
  const cols = db
    .query<{ name: string }, []>("select name from pragma_table_info('islands')")
    .all()
    .map((r) => r.name);
  expect(cols).toContain("x");
  expect(cols).toContain("y");
  const versions = db.query<{ version: string }, []>("select version from schema_migrations order by version").all().map((r) => r.version);
  expect(versions).toEqual(["0001_initial", "0002_positions"]);
});
```

Append to `tests/core/islandRepository.test.ts` (add `setIslandPositions` to the import from `islandRepository.ts`, and import `getViewState` from `../../src/core/repositories/viewStateRepository.ts`):

```ts
test("islands start unplaced and positions persist through upsert", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  expect(a.x).toBeNull();
  expect(a.y).toBeNull();
  updateIsland(db, domainId, "caching", { x: 120.5, y: 640 });
  const again = upsertIsland(db, { domainId, slug: "caching", name: "Caching renamed" });
  expect(again.x).toBe(120.5);
  expect(again.y).toBe(640);
  expect(getIsland(db, domainId, "caching")!.name).toBe("Caching renamed");
});

test("setIslandPositions writes all rows or none and bumps the version once per island", () => {
  upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const before = getViewState(db, domainId).version;
  expect(setIslandPositions(db, domainId, [{ slug: "caching", x: 100, y: 200 }, { slug: "databases", x: 300, y: 400 }])).toBe(2);
  expect(getViewState(db, domainId).version).toBe(before + 2);
  expect(getIsland(db, domainId, "databases")).toMatchObject({ x: 300, y: 400 });
  try {
    setIslandPositions(db, domainId, [{ slug: "caching", x: 1, y: 1 }, { slug: "nope", x: 2, y: 2 }]);
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(NotFoundError);
    expect((e as NotFoundError).valid).toEqual(["caching", "databases"]);
  }
  expect(getIsland(db, domainId, "caching")).toMatchObject({ x: 100, y: 200 });
  expect(getViewState(db, domainId).version).toBe(before + 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/db.test.ts tests/core/islandRepository.test.ts`
Expected: FAIL — `0002_positions` missing; `setIslandPositions` not exported; `x` undefined.

- [ ] **Step 3: Write the migration and the type**

`src/core/migrations/0002_positions.sql`:

```sql
-- Fixed map positions in a 1000 x 1000 world per scale. Null means the page has not placed the island yet.
alter table islands add column x real;
alter table islands add column y real;
```

In `src/core/types.ts`, change the `Island` type to:

```ts
export type Island = {
  id: number;
  domainId: number;
  parentId: number | null;
  slug: string;
  name: string;
  summary: string | null;
  sortOrder: number;
  x: number | null;
  y: number | null;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 4: Update the repository**

In `src/core/repositories/islandRepository.ts`:

Replace the `COLS` constant with:

```ts
const COLS =
  "id, domain_id as domainId, parent_id as parentId, slug, name, summary, sort_order as sortOrder, x, y, created_at as createdAt, updated_at as updatedAt";
```

Replace `updateIsland` with:

```ts
export function updateIsland(
  db: Database,
  domainId: number,
  slug: string,
  patch: { name?: string; summary?: string; sortOrder?: number; x?: number; y?: number },
): Island {
  const current = requireIsland(db, domainId, slug);
  return db
    .query<Island, Record<string, string | number | null>>(
      `update islands set name = $name, summary = $summary, sort_order = $sortOrder, x = $x, y = $y, updated_at = ${NOW}
       where id = $id returning ${COLS}`,
    )
    .get({
      $id: current.id,
      $name: patch.name ?? current.name,
      $summary: patch.summary ?? current.summary,
      $sortOrder: patch.sortOrder ?? current.sortOrder,
      $x: patch.x ?? current.x,
      $y: patch.y ?? current.y,
    })!;
}
```

Add after `updateIsland`:

```ts
export type IslandPosition = { slug: string; x: number; y: number };

/**
 * Writes every position or none: all slugs are resolved first, so an unknown one fails the batch
 * before any row changes. Each row update fires `islands_au`, bumping the version once per island.
 */
export function setIslandPositions(db: Database, domainId: number, positions: IslandPosition[]): number {
  return db.transaction(() => {
    const rows = positions.map((p) => ({ id: requireIsland(db, domainId, p.slug).id, x: p.x, y: p.y }));
    const update = db.prepare(`update islands set x = ?, y = ?, updated_at = ${NOW} where id = ?`);
    for (const row of rows) update.run(row.x, row.y, row.id);
    return rows.length;
  })();
}
```

The `upsertIsland` insert does not mention `x`/`y` (they stay null) and its `on conflict` update does not touch them, so a re-add keeps the position. No change there.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/core/db.test.ts tests/core/islandRepository.test.ts`
Expected: all pass (the existing version-count test in `tests/core/viewState.test.ts` is unaffected: no positions are written there).

- [ ] **Step 6: Run the whole suite and typecheck, then commit**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass (tests constructing `Island` objects, if any, will fail typecheck until `x`/`y` are added — search `tests/` for object literals typed as `Island` and add `x: null, y: null`; none are expected).

```bash
git add src/core/migrations/0002_positions.sql src/core/types.ts src/core/repositories/islandRepository.ts tests/core/db.test.ts tests/core/islandRepository.test.ts
git commit -m "feat(core): persisted island positions"
```

---

### Task 2: Validators, snapshot, CLI

**Files:**
- Modify: `src/core/validators.ts`, `src/core/view-model.ts`, `src/cli/index.ts` (island update, island section only)
- Test: `tests/core/validators.test.ts`, `tests/core/view-model.test.ts`, `tests/cli/cli.test.ts`

**Interfaces:**
- Consumes: `numberInput` in validators; `updateIsland` with `x`/`y` from Task 1.
- Produces: `coordinate` schema (number 0..1000, `""` rejected); `positionsInputSchema = { domain, positions: [{ island, x, y }] min 1 }`; `islandUpdateSchema` gains optional `x`, `y`; `IslandView` gains `x: number | null`, `y: number | null`; CLI `island update --x <n> --y <n>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/validators.test.ts` (add `positionsInputSchema`, `islandUpdateSchema` to the import):

```ts
test("positions are 0..1000 numbers and never empty", () => {
  const ok = positionsInputSchema.safeParse({ domain: "sd", positions: [{ island: "caching", x: "12.5", y: 999 }] });
  expect(ok.success).toBe(true);
  expect(ok.data!.positions[0]).toEqual({ island: "caching", x: 12.5, y: 999 });
  expect(positionsInputSchema.safeParse({ domain: "sd", positions: [] }).success).toBe(false);
  expect(positionsInputSchema.safeParse({ domain: "sd", positions: [{ island: "caching", x: 1001, y: 0 }] }).success).toBe(false);
  expect(positionsInputSchema.safeParse({ domain: "sd", positions: [{ island: "caching", x: -1, y: 0 }] }).success).toBe(false);
  expect(positionsInputSchema.safeParse({ domain: "sd", positions: [{ island: "caching", x: "", y: 0 }] }).success).toBe(false);
  expect(positionsInputSchema.safeParse({ domain: "sd", positions: [{ island: "Caching", x: 1, y: 0 }] }).success).toBe(false);
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching", x: "40", y: "10" }).success).toBe(true);
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching", y: 2000 }).success).toBe(false);
});

test("island update needs both --x and --y, or neither", () => {
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching", x: 10 }).success).toBe(false);
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching", y: 10 }).success).toBe(false);
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching", x: 10, y: 20 }).success).toBe(true);
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching" }).success).toBe(true);
});
```

Append to `tests/core/view-model.test.ts` (add `updateIsland` to the islandRepository import):

```ts
test("snapshot islands carry their positions", () => {
  updateIsland(db, domainId, "caching", { x: 100, y: 200 });
  const snap = buildSnapshot(db, "sd", null);
  expect(snap.islands.find((i) => i.slug === "caching")).toMatchObject({ x: 100, y: 200 });
  expect(snap.islands.find((i) => i.slug === "queues")).toMatchObject({ x: null, y: null });
});
```

Append to `tests/cli/cli.test.ts`:

```ts
test("island update --x --y round-trips", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  expect(cli(["island", "show", "--domain", "sd", "--slug", "caching"]).json).toMatchObject({ x: null, y: null });
  const updated = cli(["island", "update", "--domain", "sd", "--slug", "caching", "--x", "250", "--y", "750.5"]);
  expect(updated.code).toBe(0);
  expect(updated.json).toMatchObject({ x: 250, y: 750.5 });
  expect(cli(["island", "list", "--domain", "sd"]).json.islands[0]).toMatchObject({ x: 250, y: 750.5 });
  expect(cli(["island", "update", "--domain", "sd", "--slug", "caching", "--x", "1200"]).code).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/validators.test.ts tests/core/view-model.test.ts tests/cli/cli.test.ts`
Expected: FAIL — `positionsInputSchema` not exported; snapshot island lacks `x`; CLI rejects `--x`.

- [ ] **Step 3: Validators**

In `src/core/validators.ts`, add after `numberInput`:

```ts
/** A map coordinate in the 1000-unit world. */
const coordinate = numberInput.pipe(z.number().min(0).max(1000));
```

Replace `islandUpdateSchema` with:

```ts
export const islandUpdateSchema = z
  .object({
    domain: slugSchema,
    slug: slugSchema,
    name: z.string().min(1).optional(),
    summary: z.string().optional(),
    order: numberInput.pipe(z.number().int()).optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
  })
  .refine((v) => (v.x === undefined) === (v.y === undefined), { message: "pass both --x and --y, or neither" });
```

Add after `focusInputSchema`:

```ts
export const positionsInputSchema = z.object({
  domain: slugSchema,
  positions: z.array(z.object({ island: slugSchema, x: coordinate, y: coordinate })).min(1).max(1000),
});
```

- [ ] **Step 4: Snapshot**

In `src/core/view-model.ts`, add to `IslandView`:

```ts
  x: number | null;
  y: number | null;
```

and in `buildSnapshot`'s island mapping, after `summary: island.summary,` add:

```ts
      x: island.x,
      y: island.y,
```

- [ ] **Step 5: CLI**

In `src/cli/index.ts`, replace the `island update` command with:

```ts
common(
  island.command("update")
    .option("--domain <slug>").option("--slug <slug>").option("--name <name>").option("--summary <text>").option("--order <n>")
    .option("--x <n>", "map position, 0..1000").option("--y <n>", "map position, 0..1000"),
).action(
  run((o) =>
    withDb((db) => {
      const input = islandUpdateSchema.parse(o);
      const d = requireDomain(db, input.domain);
      return updateIsland(db, d.id, input.slug, {
        name: input.name, summary: input.summary, sortOrder: input.order, x: input.x, y: input.y,
      });
    }),
  ),
);
```

(`island show` and `island list` spread the row, so `x`/`y` appear without changes.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/core/validators.test.ts tests/core/view-model.test.ts tests/cli/cli.test.ts`
Expected: all pass.

- [ ] **Step 7: Run the whole suite and typecheck, then commit**

Run: `bun test && bunx tsc --noEmit`

```bash
git add src/core/validators.ts src/core/view-model.ts src/cli/index.ts tests/core/validators.test.ts tests/core/view-model.test.ts tests/cli/cli.test.ts
git commit -m "feat: positions in validators, snapshot and island update"
```

---

### Task 3: `POST /api/positions`

**Files:**
- Modify: `src/server/routes.ts`
- Test: `tests/server/routes.test.ts`

**Interfaces:**
- Consumes: `positionsInputSchema`, `setIslandPositions`, `getViewState`, the existing `crossSitePostGuard`.
- Produces: `POST /api/positions` `{ domain, positions: [{ island, x, y }] }` → `{ written, version }`; 404 `{ error, valid }` on an unknown slug with nothing written; 400 on bad numbers; 403/415 from the guard.

- [ ] **Step 1: Write the failing test**

Append to `tests/server/routes.test.ts`:

```ts
test("positions persist as a batch and reject unknown slugs whole", async () => {
  const v1 = (await get("/api/version?domain=sd")).json.version;
  const ok = await post("/api/positions", { domain: "sd", positions: [{ island: "caching", x: 100, y: 200 }, { island: "databases", x: 300, y: 400 }] });
  expect(ok.status).toBe(200);
  expect(ok.json).toEqual({ written: 2, version: v1 + 2 });
  const snap = (await get("/api/snapshot?domain=sd")).json;
  expect(snap.islands.find((i: any) => i.slug === "databases")).toMatchObject({ x: 300, y: 400 });

  const bad = await post("/api/positions", { domain: "sd", positions: [{ island: "caching", x: 1, y: 1 }, { island: "nope", x: 2, y: 2 }] });
  expect(bad.status).toBe(404);
  expect(bad.json).toEqual({ error: 'no island "nope" in this domain', valid: ["caching", "databases"] });
  expect((await get("/api/snapshot?domain=sd")).json.islands.find((i: any) => i.slug === "caching")).toMatchObject({ x: 100, y: 200 });
  expect((await get("/api/version?domain=sd")).json.version).toBe(v1 + 2);

  expect((await post("/api/positions", { domain: "sd", positions: [{ island: "caching", x: 5000, y: 1 }] })).status).toBe(400);
  expect((await post("/api/positions", { domain: "sd", positions: [] })).status).toBe(400);
  const foreign = await fetch(base + "/api/positions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ domain: "sd", positions: [{ island: "caching", x: 1, y: 1 }] }),
  });
  expect(foreign.status).toBe(403);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/routes.test.ts`
Expected: FAIL — `POST /api/positions` answers 404 `no route`.

- [ ] **Step 3: Add the route**

In `src/server/routes.ts`, extend the validators import to `import { commentInputSchema, focusInputSchema, positionsInputSchema, slugSchema } from "../core/validators.ts";` and the island repository import to `import { requireIsland, setIslandPositions } from "../core/repositories/islandRepository.ts";`. Then add before the final `return json({ error: \`no route ${route}\` }, 404);`:

```ts
  if (route === "POST /api/positions") {
    const input = positionsInputSchema.parse(await req.json());
    return json(
      withDb(ctx, (db) => {
        const d = requireDomain(db, input.domain);
        const written = setIslandPositions(
          db,
          d.id,
          input.positions.map((p) => ({ slug: p.island, x: p.x, y: p.y })),
        );
        return { written, version: getViewState(db, d.id).version };
      }),
    );
  }
```

The guard already covers every POST under `/api/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/routes.test.ts`
Expected: all pass.

- [ ] **Step 5: Run the whole suite and typecheck, then commit**

Run: `bun test && bunx tsc --noEmit`

```bash
git add src/server/routes.ts tests/server/routes.test.ts
git commit -m "feat(server): POST /api/positions"
```

---

### Task 4: Page — world camera, fixed footprint, placed nodes

**Files:**
- Modify: `src/web/camera.js`, `src/web/view-model.js`, `src/web/draw.js`, `src/web/app.js`
- Test: `tests/web/view-model.test.js`

**Interfaces:**
- Consumes: snapshot islands with `x`, `y` (Task 2).
- Produces: `WORLD = 1000`, `islandRadius(count)`, `buildNodes(snapshot, previous = new Map())` → nodes `{ slug, name, island, state, mass: 1, radius, seed, placed, x, y, vx, vy, pinned, changedAt }` (`placed` true and `pinned` true when the island has coordinates); `camera.fit(w, h)`, `camera.home`, `camera.snapHome()`; `app.unplaced()` helper in `app.js` returning the unplaced nodes. Task 5 builds the placement post on top of these.

After this task the map draws placed islands exactly where stored and still lays out unplaced ones with the simulation, but does not persist yet.

- [ ] **Step 1: Rewrite the pure-module tests**

Replace `tests/web/view-model.test.js` with:

```js
import { test, expect } from "bun:test";
import { hashSeed, seededRandom, islandRadius, buildNodes, buildLinks, WORLD } from "../../src/web/view-model.js";

const island = (slug, verdict = null, pos = { x: null, y: null }, byState = { sandbar: 0, settled: 0, mountainous: 0, reef: 0, open: 0 }) => ({
  slug, name: slug, summary: null, hasChildren: Object.values(byState).some(Boolean), verdict, x: pos.x, y: pos.y,
  children: { total: Object.values(byState).reduce((a, b) => a + b, 0), byState },
});
const snapshot = (islands, straits = []) => ({
  version: 1, domain: { slug: "sd", name: "SD" }, scale: { path: [] }, islands, straits, focus: null, unreadComments: 0, nearestOpenWater: [], reefs: [],
});

test("hashSeed and seededRandom are deterministic", () => {
  expect(hashSeed("caching")).toBe(hashSeed("caching"));
  expect(hashSeed("caching")).not.toBe(hashSeed("queues"));
  const a = seededRandom(42), b = seededRandom(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});

test("radius depends on the island count at a scale, never on the verdict", () => {
  expect(islandRadius(1)).toBe(88);
  expect(islandRadius(9)).toBeCloseTo(220 / 3, 5);
  expect(islandRadius(100)).toBe(48);
  const nodes = buildNodes(snapshot([island("a", { state: "mountainous" }), island("b"), island("c", { state: "reef" })]));
  expect(new Set(nodes.map((n) => n.radius)).size).toBe(1);
  expect(nodes[0].radius).toBe(islandRadius(3));
  expect(nodes.every((n) => n.mass === 1)).toBe(true);
});

test("placed islands sit exactly at their stored coordinates, pinned, across rebuilds and verdict changes", () => {
  const first = buildNodes(snapshot([island("caching", null, { x: 120, y: 640 })]));
  expect(first[0]).toMatchObject({ x: 120, y: 640, placed: true, pinned: true });
  const previous = new Map(first.map((n) => [n.slug, { ...n, x: 5, y: 6 }]));
  const next = buildNodes(snapshot([island("caching", { state: "settled" }, { x: 120, y: 640 })]), previous);
  expect(next[0]).toMatchObject({ x: 120, y: 640, placed: true, state: "settled" });
  expect(next[0].changedAt).toBeGreaterThan(0);
});

test("unplaced islands start near their placed strait neighbours, else near the centre, and keep provisional spots", () => {
  const snap = snapshot(
    [island("a", null, { x: 100, y: 100 }), island("b", null, { x: 300, y: 100 }), island("c"), island("d")],
    [{ from: "a", to: "c", name: null, verdict: null }, { from: "b", to: "c", name: null, verdict: null }],
  );
  const nodes = buildNodes(snap);
  const c = nodes.find((n) => n.slug === "c");
  const d = nodes.find((n) => n.slug === "d");
  expect(c.placed).toBe(false);
  expect(Math.hypot(c.x - 200, c.y - 100)).toBeLessThan(200);
  expect(Math.hypot(d.x - WORLD / 2, d.y - WORLD / 2)).toBeLessThan(200);
  expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeGreaterThan(1);
  for (const n of nodes) {
    expect(n.x).toBeGreaterThanOrEqual(0);
    expect(n.x).toBeLessThanOrEqual(WORLD);
    expect(n.y).toBeGreaterThanOrEqual(0);
    expect(n.y).toBeLessThanOrEqual(WORLD);
  }
  const previous = new Map(nodes.map((n) => [n.slug, { ...n, x: 777, y: 888 }]));
  const again = buildNodes(snap, previous);
  expect(again.find((n) => n.slug === "c")).toMatchObject({ x: 777, y: 888, placed: false, pinned: false });
});

test("buildLinks joins nodes by slug and skips unknown ends", () => {
  const nodes = buildNodes(snapshot([island("a"), island("b")]));
  const links = buildLinks(snapshot([], [{ from: "a", to: "b", name: null, verdict: { state: "reef" } }, { from: "a", to: "zzz", name: null, verdict: null }]), nodes);
  expect(links).toHaveLength(1);
  expect(links[0].source.slug).toBe("a");
  expect(links[0].state).toBe("reef");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/web/view-model.test.js`
Expected: FAIL — `islandRadius`/`WORLD` not exported; `buildNodes` signature differs.

- [ ] **Step 3: Rewrite view-model.js**

Replace `src/web/view-model.js` with:

```js
// Pure helpers: snapshot → drawable nodes and links. No DOM.
// Coordinates are world units: a fixed 1000 × 1000 square per scale, origin top-left.

export const WORLD = 1000;

export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function islandState(island) {
  return island.verdict ? island.verdict.state : "open";
}

/** Fixed footprint: every island at a scale shares one radius, set by how many islands share the scale. */
export function islandRadius(count) {
  return Math.min(88, Math.max(48, 220 / Math.sqrt(Math.max(1, count))));
}

const clampWorld = (v) => Math.min(WORLD, Math.max(0, v));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * A starting spot for an island the page has not placed yet: near the centroid of its placed
 * strait neighbours, else near the world centre, offset by a seeded angle so siblings never coincide.
 */
function provisionalPosition(snapshot, island, placedBySlug, radius) {
  const rnd = seededRandom(hashSeed(snapshot.domain.slug + "/" + island.slug));
  const angle = rnd() * Math.PI * 2;
  const offset = radius * (1.5 + rnd());
  const neighbours = snapshot.straits
    .filter((s) => s.from === island.slug || s.to === island.slug)
    .map((s) => placedBySlug.get(s.from === island.slug ? s.to : s.from))
    .filter(Boolean);
  let cx = WORLD / 2;
  let cy = WORLD / 2;
  if (neighbours.length) {
    cx = neighbours.reduce((sum, n) => sum + n.x, 0) / neighbours.length;
    cy = neighbours.reduce((sum, n) => sum + n.y, 0) / neighbours.length;
  }
  return { x: clampWorld(cx + Math.cos(angle) * offset), y: clampWorld(cy + Math.sin(angle) * offset) };
}

export function buildNodes(snapshot, previous = new Map()) {
  const radius = islandRadius(snapshot.islands.length);
  const placedBySlug = new Map(snapshot.islands.filter((i) => i.x !== null && i.y !== null).map((i) => [i.slug, i]));
  return snapshot.islands.map((island) => {
    const prev = previous.get(island.slug);
    const state = islandState(island);
    const placed = island.x !== null && island.y !== null;
    let x;
    let y;
    if (placed) {
      x = island.x;
      y = island.y;
    } else if (prev) {
      x = prev.x;
      y = prev.y;
    } else {
      ({ x, y } = provisionalPosition(snapshot, island, placedBySlug, radius));
    }
    return {
      slug: island.slug,
      name: island.name,
      island,
      state,
      mass: 1,
      radius,
      seed: hashSeed(island.slug),
      placed,
      x,
      y,
      vx: prev && !placed ? prev.vx : 0,
      vy: prev && !placed ? prev.vy : 0,
      pinned: placed,
      changedAt: prev ? (prev.state !== state ? now() : prev.changedAt) : now(),
    };
  });
}

export function buildLinks(snapshot, nodes) {
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  return snapshot.straits
    .filter((s) => bySlug.has(s.from) && bySlug.has(s.to))
    .map((s) => ({ source: bySlug.get(s.from), target: bySlug.get(s.to), strait: s, state: s.verdict ? s.verdict.state : "open" }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/web/view-model.test.js`
Expected: 5 pass.

- [ ] **Step 5: Camera with a home framing**

Replace `src/web/camera.js` with:

```js
// Pan/zoom camera over the 1000-unit world. World → screen is (x * scale + cam.x).
// `fit` computes the home framing for a viewport; pan and wheel adjust the camera on top of it.

import { WORLD } from "./view-model.js";

const MARGIN = 0.06; // of the shorter viewport side, each edge

export function createCamera() {
  const cam = { x: 0, y: 0, scale: 1 };
  let home = { x: 0, y: 0, scale: 1 };
  let anim = null;

  return {
    state: cam,
    get home() {
      return home;
    },
    /** The framing that fits the whole world into a w × h viewport, centred, with a margin. */
    fit(w, h) {
      const scale = (Math.min(w, h) * (1 - 2 * MARGIN)) / WORLD;
      home = { x: (w - WORLD * scale) / 2, y: (h - WORLD * scale) / 2, scale };
      return home;
    },
    snapHome() {
      Object.assign(cam, home);
      anim = null;
    },
    apply(ctx, dpr) {
      ctx.setTransform(cam.scale * dpr, 0, 0, cam.scale * dpr, cam.x * dpr, cam.y * dpr);
    },
    toWorld(px, py) {
      return { x: (px - cam.x) / cam.scale, y: (py - cam.y) / cam.scale };
    },
    panBy(dx, dy) {
      cam.x += dx;
      cam.y += dy;
      anim = null;
    },
    zoomAt(px, py, factor) {
      const next = Math.min(home.scale * 6, Math.max(home.scale * 0.5, cam.scale * factor));
      const k = next / cam.scale;
      cam.x = px - (px - cam.x) * k;
      cam.y = py - (py - cam.y) * k;
      cam.scale = next;
      anim = null;
    },
    animateTo(target, ms = 500) {
      anim = { from: { ...cam }, to: target, start: performance.now(), ms };
    },
    tick(now) {
      if (!anim) return false;
      const t = Math.min(1, (now - anim.start) / anim.ms);
      const e = 1 - Math.pow(1 - t, 3);
      cam.x = anim.from.x + (anim.to.x - anim.from.x) * e;
      cam.y = anim.from.y + (anim.to.y - anim.from.y) * e;
      cam.scale = anim.from.scale + (anim.to.scale - anim.from.scale) * e;
      if (t >= 1) anim = null;
      return true;
    },
  };
}
```

- [ ] **Step 6: Sizes in world units**

The home scale is about 0.6 on a laptop window, so pixel sizes written for a 1:1 world shrink. In `src/web/draw.js` make these replacements (values only, structure unchanged):

- In `drawIsland`, the open-water stroke: `ctx.lineWidth = 1.2;` → `ctx.lineWidth = 1.8;`.
- In `drawIsland`, the contour rings: `ctx.lineWidth = 1.2;` → `ctx.lineWidth = 1.8;`.
- In `drawReef`: `ctx.lineWidth = 3;` → `ctx.lineWidth = 4.5;`; the glyph triangle `gy - 8`, `gx + 7, gy + 5`, `gx - 7, gy + 5` → `gy - 12`, `gx + 10, gy + 7`, `gx - 10, gy + 7`; the "!" font `"bold 9px system-ui, sans-serif"` → `"bold 13px system-ui, sans-serif"` and its `gy + 1` → `gy + 2`.
- In `drawRollup`: `const r = node.radius * grow + 9;` → `const r = node.radius * grow + 13;` and the dot `ctx.arc(..., 3, ...)` → `ctx.arc(..., 4.5, ...)`.
- In `drawLabel`: `ctx.font = "13px Georgia, 'Times New Roman', serif";` → `ctx.font = "24px Georgia, 'Times New Roman', serif";` and `const offset = ... ? 18 : 8;` → `const offset = ... ? 30 : 14;`.
- In `drawStrait`: open `ctx.lineWidth = 1.2;` → `1.8`; sandbar `1.2` → `1.8`; settled `2` → `3`; mountainous (the final else) `3.5` → `5`; reef `ctx.lineWidth = 2;` → `3` and its zigzag offset `(i % 2 ? 1 : -1) * 4` → `* 6`.

- [ ] **Step 7: app.js uses the world camera and only simulates unplaced islands**

In `src/web/app.js`:

Replace the `resize` function with:

```js
function resize() {
  const dpr = window.devicePixelRatio || 1;
  app.size = { w: window.innerWidth, h: window.innerHeight, dpr };
  canvas.width = Math.round(app.size.w * dpr);
  canvas.height = Math.round(app.size.h * dpr);
  canvas.style.width = app.size.w + "px";
  canvas.style.height = app.size.h + "px";
  app.camera.fit(app.size.w, app.size.h);
  app.camera.snapHome();
}
```

Add after `hitTest`:

```js
/** Nodes the page still has to place (no stored coordinates). */
export function unplaced() {
  return app.nodes.filter((n) => !n.placed);
}
```

Replace `applySnapshot` with:

```js
function applySnapshot(snapshot) {
  const sameScale = app.snapshot !== null && samePath(app.snapshot, snapshot);
  const previous = sameScale ? new Map(app.nodes.map((n) => [n.slug, n])) : new Map();
  const isFirstSnapshot = app.snapshot === null;
  app.snapshot = snapshot;
  app.version = snapshot.version;
  app.nodes = buildNodes(snapshot, previous);
  app.links = buildLinks(snapshot, app.nodes);
  // The simulation exists only to place islands that have no stored position; placed ones are pinned.
  app.sim.setGraph(app.nodes, app.links, unplaced().length ? (sameScale ? 0.5 : 1) : 0);
  if (!sameScale) app.camera.animateTo(app.camera.home, 400);
  // A reload should still show the terminal's focus, without posting a fresh selection.
  if (isFirstSnapshot) app.selected = snapshot.focus;
  renderChrome();
  for (const fn of app.listeners) fn(snapshot);
}
```

In `boot()`, replace `resize();` with:

```js
  app.sim.setCenter(WORLD / 2, WORLD / 2);
  resize();
```

and change the first import line to `import { buildNodes, buildLinks, WORLD } from "./view-model.js";`.

- [ ] **Step 8: Syntax check, suite, commit**

Run: `bun build src/web/app.js --outdir /tmp/archipelago-build --target browser && rm -rf /tmp/archipelago-build && bun test && bunx tsc --noEmit`
Expected: bundle succeeds; all tests pass.

```bash
git add src/web tests/web
git commit -m "feat(web): world camera, fixed footprint, placed islands drawn where stored"
```

---

### Task 5: Page — persist placement and drags

**Files:**
- Modify: `src/web/app.js`, `src/web/interactions.js`

**Interfaces:**
- Consumes: `POST /api/positions` (Task 3), `unplaced()`, `app.sim.tick()` returning `false` once settled.
- Produces: `postPositions(nodes)` exported from `app.js`; `app.placing: Set<slug>` and `app.placementInFlight: boolean` state.

Behaviour: when a snapshot has unplaced islands, the simulation runs with placed islands pinned; once it settles, the page posts every unplaced island's position once. On success the version bump brings back a snapshot with coordinates and the nodes become placed. On failure the error is logged and the post is retried after five seconds with the current provisional spots. A drag beyond the click slop posts that island's new position on release. Nothing reheats the simulation any more.

- [ ] **Step 1: Placement state and post in app.js**

In `src/web/app.js`, add to the `app` object after `listeners`:

```js
  placing: new Set(),        // slugs awaiting their first persisted position
  placementInFlight: false,  // a positions post is in progress (or backing off after a failure)
  placementGen: 0,           // bumped on a scale change so a stale post cannot clear the new scale's placing set
```

Add after `unplaced()`:

```js
/** Persists positions for the given nodes; coordinates are clamped to the world (inset by each node's radius) so the server accepts them. */
export async function postPositions(nodes) {
  const positions = nodes.map((n) => {
    n.x = Math.min(WORLD - n.radius, Math.max(n.radius, n.x));
    n.y = Math.min(WORLD - n.radius, Math.max(n.radius, n.y));
    return { island: n.slug, x: n.x, y: n.y };
  });
  return api("/api/positions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: app.domain, positions }),
  });
}

/** Called once the simulation has settled while islands still await placement. */
async function persistPlacement() {
  const nodes = app.nodes.filter((n) => app.placing.has(n.slug));
  if (nodes.length === 0) {
    app.placing.clear();
    return;
  }
  const gen = app.placementGen;
  app.placementInFlight = true;
  try {
    await postPositions(nodes);
    if (gen === app.placementGen) for (const n of nodes) app.placing.delete(n.slug);
    app.placementInFlight = false;
  } catch (error) {
    console.error("placement not saved, retrying in 5s", error);
    setTimeout(() => {
      app.placementInFlight = false;
    }, 5000);
  }
}
```

In `applySnapshot`, after the `app.sim.setGraph(...)` line add — a scale change bumps `placementGen` so a post still in flight for the old scale cannot clear the new scale's placing set:

```js
  if (!sameScale) {
    app.placementGen += 1;
    app.placing = new Set(unplaced().map((n) => n.slug));
  } else if (!app.placementInFlight) {
    app.placing = new Set(unplaced().map((n) => n.slug));
  }
```

In `frame`, replace `app.sim.tick();` with:

```js
  const moving = app.sim.tick();
  if (!moving && app.placing.size > 0 && !app.placementInFlight) void persistPlacement();
```

- [ ] **Step 2: Drags persist; nothing reheats**

In `src/web/interactions.js`, change the import to `import { app, api, hitTest, setScale, postPositions } from "./app.js";`.

In the `pointermove` handler, replace the node-drag branch:

```js
      } else if (drag.moved) {
        const node = nodeBySlug(drag.slug);
        if (!node) return;
        const w = app.camera.toWorld(e.clientX, e.clientY);
        node.x = w.x;
        node.y = w.y;
        node.pinned = true;
        app.sim.reheat(0.4);
      }
```

with:

```js
      } else if (drag.moved) {
        const node = nodeBySlug(drag.slug);
        if (!node) return;
        const w = app.camera.toWorld(e.clientX, e.clientY);
        node.x = w.x;
        node.y = w.y;
        node.pinned = true; // a dragged island is placed by hand from now on
      }
```

In the `pointerup` handler, replace:

```js
    if (d.kind === "node") {
      const node = nodeBySlug(d.slug);
      if (node) node.pinned = false;
      app.sim.reheat(0.2);
    }
    if (d.moved) return;
```

with:

```js
    if (d.kind === "node" && d.moved) {
      const node = nodeBySlug(d.slug);
      if (node) postPositions([node]).catch((error) => console.error(error));
      return;
    }
    if (d.moved) return;
```

- [ ] **Step 3: Syntax check and suite**

Run: `bun build src/web/app.js --outdir /tmp/archipelago-build --target browser && rm -rf /tmp/archipelago-build && bun test && bunx tsc --noEmit`
Expected: bundle succeeds; all tests pass.

- [ ] **Step 4: Headless functional check**

With `ARCHIPELAGO_DB_PATH=/tmp/archipelago-fixed.sqlite`: seed a domain with three islands and two straits (as in the slice 1 plan's Task 12 Step 9, any three), start `bun src/cli/index.ts serve --no-open --port 4483` in the background with the same env var, then confirm with curl that `GET /api/snapshot?domain=<slug>` shows `x: null` for every island and that `POST /api/positions` with `content-type: application/json` and `origin: http://127.0.0.1:4483` for one island returns `{ written: 1, version: <n> }`. Stop the server and delete the database. The browser check (placement on first open, stability across reload and verdicts, drag persistence, both scales) is the controller's.

- [ ] **Step 5: Commit**

```bash
git add src/web/app.js src/web/interactions.js
git commit -m "feat(web): persist first placement and drags"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `.claude/skills/archipelago-chart/SKILL.md`

- [ ] **Step 1: README**

In `README.md`, in the "From the map" section, append this paragraph:

```markdown
Islands keep their place. The map lays out new islands once, around the ones already there, and stores the positions; verdicts never move anything. Drag an island to rearrange, and it stays where you put it. `archipelago island update --domain <slug> --slug <island> --x <0..1000> --y <0..1000>` sets a position by hand.
```

- [ ] **Step 2: CLAUDE.md**

In `CLAUDE.md`, under "Conventions", add:

```markdown
- Map positions live on `islands.x`/`islands.y` in a fixed 1000×1000 world per scale (null = unplaced). The page places unplaced islands once (existing ones pinned) and posts `/api/positions`; the simulation never runs when everything is placed. Every island at a scale shares one radius (`islandRadius(count)` in `src/web/view-model.js`); elevation never changes size.
- Schema changes go in a new numbered migration under `src/core/migrations/`; `0001_initial.sql` is frozen.
```

and in the "Architecture" file listing, add `0002_positions.sql` after `migrations/`.

- [ ] **Step 3: Skill**

In `.claude/skills/archipelago-chart/SKILL.md`, in the "## 0. The map" section, append: "Islands keep fixed positions once the map has placed them; if the user wants one moved, they drag it, or you run `A island update --domain <slug> --slug <island> --x <n> --y <n>` with world coordinates 0..1000."

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md .claude/skills/archipelago-chart/SKILL.md
git commit -m "docs: fixed island positions"
```

---

## Plan self-review (done while writing)

- **Spec coverage.** §2 data → Task 1 (migration, type, repository) and Task 2 (snapshot fields). §3 API and CLI → Tasks 2 and 3. §4 page → Task 4 (world camera, fixed footprint, placed nodes pinned, provisional spots) and Task 5 (placement post, retry, drag persistence, no idle simulation). §5 errors → Task 3 (batch semantics, 400/404) and Task 5 (retry after failure). §6 tests → each task; the browser check is the controller's after Task 5. §7 out of scope respected.
- **Type consistency.** `setIslandPositions(db, domainId, { slug, x, y }[])` (Task 1) is what Task 3 calls with `positions.map(p => ({ slug: p.island, ... }))`; `buildNodes(snapshot, previous)` (Task 4) is what Task 4's `applySnapshot` calls; `unplaced()` and `postPositions(nodes)` are exported from `app.js` and imported by `interactions.js` (Task 5); `camera.fit/home/snapHome` (Task 4) are used by `resize` and `applySnapshot`.
- **Judgement calls.** Resize snaps the camera home (a pan does not survive a window resize). Zoom limits are relative to the home scale. A dragged island stays pinned in memory even before its post lands. Drawing sizes were scaled up roughly 1.5× because the home scale is about 0.6 on a laptop window; the browser check may tune them. Reparenting nulls the stored position; a scale change bumps `placementGen` so a late post cannot clear the new scale's placing set.
