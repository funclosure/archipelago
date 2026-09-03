# Archipelago Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local tool where Claude, driven from the Claude Code terminal by a charting skill, records five-state verdicts about a domain into SQLite through a CLI, and a canvas map in the browser shows the archipelago live and sends comments back.

**Architecture:** One seam. Claude in the terminal is the producer (skill → CLI → SQLite). The browser is the consumer (Bun server → JSON API → one-canvas page that polls a version integer). Comments and focus flow back through the same database. No Agent SDK, no API key, no bundler.

**Tech Stack:** Bun 1.3, `bun:sqlite`, `commander` 12, `zod` 4, `bun test`, plain ES modules + Canvas 2D for the page.

Spec: `docs/superpowers/specs/2026-09-03-archipelago-slice1-design.md`. Brief: `docs/BRIEF.md`.

## Global Constraints

- Runtime is Bun. Use `bun:sqlite`, `Bun.serve()`, `Bun.file()`. Tests run with `bun test` (Vitest cannot resolve `bun:sqlite`, verified 2026-09-03).
- Database path: `.archipelago/archipelago.sqlite` under the current working directory, overridable with `ARCHIPELAGO_DB_PATH`. `:memory:` is allowed.
- Verdict states are exactly `sandbar | settled | mountainous | reef`. **Open water is the absence of a verdict and is never stored.**
- Island slugs are unique per domain (`unique (domain_id, slug)`), so a bare slug addresses an island anywhere in the tree.
- Straits join siblings only (same `parent_id`), stored with `from_island_id < to_island_id`.
- Verdicts are append-only; the latest by `id` wins.
- Comment kinds are exactly `note | probe_me | sail_closer | dispute`.
- Every write bumps `view_state.version` for its domain through SQL triggers, never application code.
- CLI: every command prints JSON. Pretty JSON on a TTY, compact otherwise or with `--json`. Errors exit 1 with `{ "error": "...", "valid": [...]? }` on stdout.
- Server: `127.0.0.1:4480`, static files from `src/web/` read fresh per request with `Cache-Control: no-cache`.
- Page: no framework, no bundler, one `<canvas>`. Palette: water `#1a1816`, text `#ede8e3`, sand `#d9c7a3`, land `#c9a87c`, ridge `#8a6e4b`, reef `#a3452e`.
- Timestamps are ISO-8601 UTC text produced in SQL by `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.
- Commit after every task with the trailer lines below.

Commit trailer for every commit:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq
```

---

## File structure

```
package.json                      bin archipelago → src/cli/index.ts; scripts test/check/serve
tsconfig.json
src/core/types.ts                 enums + row types (camelCase)
src/core/errors.ts                ArchipelagoError, NotFoundError, ConflictError (toJSON → {error, valid?})
src/core/validators.ts            zod input schemas + parseTarget()
src/core/db.ts                    resolveDbPath(), openDatabase() (pragmas + migrate)
src/core/migrate.ts               migrateDatabase(db) over src/core/migrations/*.sql
src/core/migrations/0001_initial.sql
src/core/repositories/domainRepository.ts
src/core/repositories/islandRepository.ts
src/core/repositories/straitRepository.ts
src/core/repositories/verdictRepository.ts
src/core/repositories/sessionRepository.ts
src/core/repositories/commentRepository.ts
src/core/repositories/viewStateRepository.ts
src/core/view-model.ts            buildSnapshot(), listCommentViews(), formatTarget()
src/cli/index.ts                  commander program (all commands incl. serve)
src/cli/io.ts                     readStdinJson(), emit(), fail()
src/server/routes.ts              handleRequest(req, ctx)
src/server/index.ts               startServer(options)
src/web/index.html                page shell
src/web/styles.css
src/web/view-model.js             snapshot → nodes/links (seeded positions, mass)
src/web/layout.js                 force simulation
src/web/camera.js                 pan/zoom/animate
src/web/draw.js                   island/strait rendering by state
src/web/app.js                    polling, events, DOM chrome, rAF loop
.claude/skills/archipelago-chart/SKILL.md
CLAUDE.md, README.md
tests/core/*.test.ts, tests/cli/cli.test.ts, tests/server/routes.test.ts
```

Deviation from spec §11 noted here: there is no separate `cli.ts` launcher. `archipelago serve` (spec §5) starts the server and opens the browser, so one entry point serves both jobs.

---

### Task 1: Project scaffold, database open, migrations

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/core/db.ts`, `src/core/migrate.ts`, `src/core/migrations/0001_initial.sql`
- Test: `tests/core/db.test.ts`

**Interfaces:**
- Produces: `openDatabase(override?: string): Database` (opens, sets pragmas, runs migrations), `resolveDbPath(override?: string): string`, `migrateDatabase(db): string[]` (versions applied this call), `DEFAULT_DB_PATH`.

- [ ] **Step 1: Create package.json and tsconfig.json**

`package.json`:

```json
{
  "name": "archipelago",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "bin": { "archipelago": "src/cli/index.ts" },
  "scripts": {
    "test": "bun test",
    "check": "bunx tsc --noEmit",
    "serve": "bun run src/cli/index.ts serve",
    "archipelago": "bun run src/cli/index.ts"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

Run: `bun install`
Expected: `commander`, `zod`, `@types/bun`, `typescript` installed; `bun.lock` created.

- [ ] **Step 2: Write the failing test**

`tests/core/db.test.ts`:

```ts
import { test, expect } from "bun:test";
import { openDatabase } from "../../src/core/db.ts";
import { migrateDatabase } from "../../src/core/migrate.ts";

test("openDatabase creates the schema", () => {
  const db = openDatabase(":memory:");
  const tables = db
    .query<{ name: string }, []>("select name from sqlite_master where type = 'table' order by name")
    .all()
    .map((r) => r.name);
  for (const t of ["schema_migrations", "domains", "islands", "straits", "verdicts", "sessions", "comments", "view_state"]) {
    expect(tables).toContain(t);
  }
});

test("migrations are idempotent", () => {
  const db = openDatabase(":memory:");
  expect(migrateDatabase(db)).toEqual([]);
});

test("inserting a domain creates its view_state row at version 0", () => {
  const db = openDatabase(":memory:");
  db.run("insert into domains (slug, name) values ('sd', 'System Design')");
  const row = db.query<{ version: number }, []>("select version from view_state").get();
  expect(row).toEqual({ version: 0 });
});

test("foreign keys are enforced", () => {
  const db = openDatabase(":memory:");
  expect(() => db.run("insert into islands (domain_id, slug, name) values (99, 'x', 'X')")).toThrow();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/core/db.test.ts`
Expected: FAIL, cannot resolve `../../src/core/db.ts`.

- [ ] **Step 4: Write the migration**

`src/core/migrations/0001_initial.sql`:

```sql
create table domains (
  id integer primary key autoincrement,
  slug text not null unique,
  name text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table islands (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  parent_id integer references islands(id) on delete cascade,
  slug text not null,
  name text not null,
  summary text,
  sort_order integer not null default 0,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (domain_id, slug)
);
create index islands_parent on islands (domain_id, parent_id, sort_order);

create table straits (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  from_island_id integer not null references islands(id) on delete cascade,
  to_island_id integer not null references islands(id) on delete cascade,
  name text,
  summary text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check (from_island_id < to_island_id),
  unique (from_island_id, to_island_id)
);

create table sessions (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  started_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at text,
  summary text
);

create table verdicts (
  id integer primary key autoincrement,
  target_type text not null check (target_type in ('island', 'strait')),
  target_id integer not null,
  state text not null check (state in ('sandbar', 'settled', 'mountainous', 'reef')),
  confidence real not null check (confidence >= 0 and confidence <= 1),
  evidence text not null,
  rationale text,
  session_id integer references sessions(id) on delete set null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index verdicts_target on verdicts (target_type, target_id, id);

create table comments (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  target_type text not null check (target_type in ('island', 'strait', 'domain')),
  target_id integer not null,
  body text not null default '',
  kind text not null check (kind in ('note', 'probe_me', 'sail_closer', 'dispute')),
  read_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index comments_unread on comments (domain_id, read_at);

create table view_state (
  domain_id integer primary key references domains(id) on delete cascade,
  focus_island_id integer references islands(id) on delete set null,
  version integer not null default 0
);

-- Every domain gets a view_state row; every write bumps its version.
create trigger domains_ai after insert on domains begin
  insert into view_state (domain_id) values (new.id);
end;

create trigger islands_ai after insert on islands begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger islands_au after update on islands begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;

create trigger straits_ai after insert on straits begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger straits_au after update on straits begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;

create trigger verdicts_ai after insert on verdicts begin
  update view_state set version = version + 1 where domain_id = (
    case new.target_type
      when 'island' then (select domain_id from islands where id = new.target_id)
      else (select domain_id from straits where id = new.target_id)
    end
  );
end;

create trigger sessions_ai after insert on sessions begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger sessions_au after update on sessions begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;

create trigger comments_ai after insert on comments begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger comments_au after update on comments begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;

create trigger view_state_focus_au after update of focus_island_id on view_state begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
```

- [ ] **Step 5: Write migrate.ts and db.ts**

`src/core/migrate.ts`:

```ts
import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

/** Applies every unapplied migration in filename order. Returns the versions applied by this call. */
export function migrateDatabase(db: Database): string[] {
  db.exec(
    "create table if not exists schema_migrations (version text primary key, applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  );
  const applied = new Set(
    db.query<{ version: string }, []>("select version from schema_migrations").all().map((r) => r.version),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.run("insert into schema_migrations (version) values (?)", [version]);
    })();
    ran.push(version);
  }
  return ran;
}
```

`src/core/db.ts`:

```ts
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrateDatabase } from "./migrate.ts";

export const DEFAULT_DB_PATH = ".archipelago/archipelago.sqlite";

export function resolveDbPath(override?: string): string {
  const path = override ?? process.env.ARCHIPELAGO_DB_PATH ?? DEFAULT_DB_PATH;
  return path === ":memory:" ? path : resolve(process.cwd(), path);
}

/** Opens (creating if needed) the database, enables foreign keys, and applies migrations. */
export function openDatabase(override?: string): Database {
  const path = resolveDbPath(override);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("pragma foreign_keys = on;");
  if (path !== ":memory:") db.exec("pragma journal_mode = wal;");
  migrateDatabase(db);
  return db;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/core/db.test.ts`
Expected: 4 pass.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock tsconfig.json src/core tests/core
git commit -m "feat(core): database open and initial migration with version triggers"
```

---

### Task 2: Types, errors, validators

**Files:**
- Create: `src/core/types.ts`, `src/core/errors.ts`, `src/core/validators.ts`
- Test: `tests/core/validators.test.ts`

**Interfaces:**
- Produces: enums `verdictStates`, `verdictTargetTypes`, `commentTargetTypes`, `commentKinds`; row types `Domain`, `Island`, `Strait`, `Verdict`, `Session`, `Comment`, `ViewState`; `ArchipelagoError`, `NotFoundError`, `ConflictError` (all with `toJSON()` → `{ error, valid? }`); zod schemas `domainInputSchema`, `islandInputSchema`, `straitInputSchema`, `verdictInputSchema`, `commentInputSchema`, `focusInputSchema`, `sessionEndInputSchema`; `parseTarget(target: string): ParsedTarget`.

- [ ] **Step 1: Write the failing test**

`tests/core/validators.test.ts`:

```ts
import { test, expect } from "bun:test";
import { parseTarget, verdictInputSchema, islandInputSchema } from "../../src/core/validators.ts";
import { ArchipelagoError, NotFoundError } from "../../src/core/errors.ts";

test("parseTarget reads island and strait targets", () => {
  expect(parseTarget("island:caching")).toEqual({ type: "island", slug: "caching" });
  expect(parseTarget("strait:caching~databases")).toEqual({ type: "strait", from: "caching", to: "databases" });
});

test("parseTarget rejects malformed targets", () => {
  expect(() => parseTarget("caching")).toThrow(ArchipelagoError);
  expect(() => parseTarget("strait:caching")).toThrow(ArchipelagoError);
  expect(() => parseTarget("reef:caching")).toThrow(ArchipelagoError);
  expect(() => parseTarget("island:foo:bar")).toThrow(ArchipelagoError);
  expect(() => parseTarget("strait:a~b~c")).toThrow(ArchipelagoError);
});

test("verdict input rejects unknown states and out-of-range confidence", () => {
  const base = { domain: "sd", target: "island:caching", evidence: "quote" };
  expect(verdictInputSchema.safeParse({ ...base, state: "settled", confidence: 0.8 }).success).toBe(true);
  expect(verdictInputSchema.safeParse({ ...base, state: "open", confidence: 0.8 }).success).toBe(false);
  expect(verdictInputSchema.safeParse({ ...base, state: "reef", confidence: 1.2 }).success).toBe(false);
  expect(verdictInputSchema.safeParse({ ...base, state: "reef", confidence: "0.7" }).success).toBe(true);
});

test("island slugs are lowercase kebab", () => {
  expect(islandInputSchema.safeParse({ domain: "sd", slug: "Caching", name: "Caching" }).success).toBe(false);
  expect(islandInputSchema.safeParse({ domain: "sd", slug: "cache-invalidation", name: "x" }).success).toBe(true);
});

test("errors serialise to { error, valid }", () => {
  expect(new NotFoundError("no island x", ["a", "b"]).toJSON()).toEqual({ error: "no island x", valid: ["a", "b"] });
  expect(new ArchipelagoError("plain").toJSON()).toEqual({ error: "plain" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/validators.test.ts`
Expected: FAIL, cannot resolve `validators.ts`.

- [ ] **Step 3: Write types.ts, errors.ts, validators.ts**

`src/core/types.ts`:

```ts
export const verdictStates = ["sandbar", "settled", "mountainous", "reef"] as const;
export type VerdictState = (typeof verdictStates)[number];

export const verdictTargetTypes = ["island", "strait"] as const;
export type VerdictTargetType = (typeof verdictTargetTypes)[number];

export const commentTargetTypes = ["island", "strait", "domain"] as const;
export type CommentTargetType = (typeof commentTargetTypes)[number];

export const commentKinds = ["note", "probe_me", "sail_closer", "dispute"] as const;
export type CommentKind = (typeof commentKinds)[number];

export type Domain = { id: number; slug: string; name: string; createdAt: string };

export type Island = {
  id: number;
  domainId: number;
  parentId: number | null;
  slug: string;
  name: string;
  summary: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Strait = {
  id: number;
  domainId: number;
  fromIslandId: number;
  toIslandId: number;
  name: string | null;
  summary: string | null;
  createdAt: string;
};

export type Verdict = {
  id: number;
  targetType: VerdictTargetType;
  targetId: number;
  state: VerdictState;
  confidence: number;
  evidence: string;
  rationale: string | null;
  sessionId: number | null;
  createdAt: string;
};

export type Session = {
  id: number;
  domainId: number;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
};

export type Comment = {
  id: number;
  domainId: number;
  targetType: CommentTargetType;
  targetId: number;
  body: string;
  kind: CommentKind;
  readAt: string | null;
  createdAt: string;
};

export type ViewState = { domainId: number; focusIslandId: number | null; version: number };
```

`src/core/errors.ts`:

```ts
export class ArchipelagoError extends Error {
  readonly valid?: string[];
  constructor(message: string, valid?: string[]) {
    super(message);
    this.name = new.target.name;
    if (valid) this.valid = valid;
  }
  toJSON(): { error: string; valid?: string[] } {
    return this.valid ? { error: this.message, valid: this.valid } : { error: this.message };
  }
}

/** A slug or id that does not exist. `valid` lists what would have been accepted. */
export class NotFoundError extends ArchipelagoError {}

/** A write that contradicts the model, e.g. a strait between non-siblings. */
export class ConflictError extends ArchipelagoError {}
```

`src/core/validators.ts`:

```ts
import { z } from "zod";
import { ArchipelagoError } from "./errors.ts";
import { commentKinds, commentTargetTypes, verdictStates } from "./types.ts";

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase letters, digits and hyphens");

export const domainInputSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
});

export const islandInputSchema = z.object({
  domain: slugSchema,
  slug: slugSchema,
  name: z.string().min(1),
  summary: z.string().optional(),
  parent: slugSchema.optional(),
  order: z.coerce.number().int().optional(),
});

export const islandUpdateSchema = z.object({
  domain: slugSchema,
  slug: slugSchema,
  name: z.string().min(1).optional(),
  summary: z.string().optional(),
  order: z.coerce.number().int().optional(),
});

export const straitInputSchema = z.object({
  domain: slugSchema,
  from: slugSchema,
  to: slugSchema,
  name: z.string().optional(),
  summary: z.string().optional(),
});

export const verdictInputSchema = z.object({
  domain: slugSchema,
  target: z.string().min(1),
  state: z.enum(verdictStates),
  confidence: z.coerce.number().min(0).max(1),
  evidence: z.string().min(1),
  rationale: z.string().optional(),
});

export const commentInputSchema = z.object({
  domain: slugSchema,
  targetType: z.enum(commentTargetTypes),
  /** island slug, `a~b` strait pair, or the domain slug */
  targetId: z.string().min(1),
  body: z.string().default(""),
  kind: z.enum(commentKinds),
});

export const focusInputSchema = z.object({
  domain: slugSchema,
  island: slugSchema.nullable(),
});

export const sessionEndInputSchema = z.object({
  domain: slugSchema,
  summary: z.string().min(1),
});

export type ParsedTarget = { type: "island"; slug: string } | { type: "strait"; from: string; to: string };

/** `island:<slug>` or `strait:<a>~<b>`. */
export function parseTarget(target: string): ParsedTarget {
  const colon = target.indexOf(":");
  const type = colon === -1 ? target : target.slice(0, colon);
  const rest = colon === -1 ? "" : target.slice(colon + 1);
  if (type === "island" && slugSchema.safeParse(rest).success) {
    return { type: "island", slug: rest };
  }
  if (type === "strait") {
    const parts = rest.split("~");
    if (parts.length === 2 && parts.every((p) => slugSchema.safeParse(p).success)) {
      return { type: "strait", from: parts[0]!, to: parts[1]! };
    }
  }
  throw new ArchipelagoError(`target must be island:<slug> or strait:<a>~<b>, got "${target}"`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/validators.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/errors.ts src/core/validators.ts tests/core/validators.test.ts
git commit -m "feat(core): types, errors and input validators"
```

---

### Task 3: Domain repository

**Files:**
- Create: `src/core/repositories/domainRepository.ts`
- Test: `tests/core/domainRepository.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `Domain`, `NotFoundError`.
- Produces: `upsertDomain(db, { slug, name }): Domain`, `listDomains(db): Domain[]`, `getDomain(db, slug): Domain | null`, `requireDomain(db, slug): Domain` (throws `NotFoundError` with `valid` = all domain slugs).

- [ ] **Step 1: Write the failing test**

`tests/core/domainRepository.test.ts`:

```ts
import { test, expect } from "bun:test";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain, listDomains, getDomain, requireDomain } from "../../src/core/repositories/domainRepository.ts";
import { NotFoundError } from "../../src/core/errors.ts";

test("upsertDomain inserts then updates by slug", () => {
  const db = openDatabase(":memory:");
  const a = upsertDomain(db, { slug: "sd", name: "System Design" });
  const b = upsertDomain(db, { slug: "sd", name: "System Design (renamed)" });
  expect(b.id).toBe(a.id);
  expect(b.name).toBe("System Design (renamed)");
  expect(listDomains(db)).toHaveLength(1);
});

test("requireDomain lists valid slugs on miss", () => {
  const db = openDatabase(":memory:");
  upsertDomain(db, { slug: "sd", name: "System Design" });
  upsertDomain(db, { slug: "ios", name: "iOS" });
  expect(getDomain(db, "nope")).toBeNull();
  try {
    requireDomain(db, "nope");
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(NotFoundError);
    expect((e as NotFoundError).valid).toEqual(["ios", "sd"]);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/domainRepository.test.ts`
Expected: FAIL, cannot resolve `domainRepository.ts`.

- [ ] **Step 3: Write the repository**

`src/core/repositories/domainRepository.ts`:

```ts
import type { Database } from "bun:sqlite";
import { NotFoundError } from "../errors.ts";
import type { Domain } from "../types.ts";

const COLS = "id, slug, name, created_at as createdAt";

export function upsertDomain(db: Database, input: { slug: string; name: string }): Domain {
  return db
    .query<Domain, { $slug: string; $name: string }>(
      `insert into domains (slug, name) values ($slug, $name)
       on conflict(slug) do update set name = excluded.name
       returning ${COLS}`,
    )
    .get({ $slug: input.slug, $name: input.name })!;
}

export function listDomains(db: Database): Domain[] {
  return db.query<Domain, []>(`select ${COLS} from domains order by slug`).all();
}

export function getDomain(db: Database, slug: string): Domain | null {
  return db.query<Domain, [string]>(`select ${COLS} from domains where slug = ?`).get(slug) ?? null;
}

export function requireDomain(db: Database, slug: string): Domain {
  const domain = getDomain(db, slug);
  if (!domain) {
    throw new NotFoundError(`no domain "${slug}"`, listDomains(db).map((d) => d.slug));
  }
  return domain;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/domainRepository.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/repositories/domainRepository.ts tests/core/domainRepository.test.ts
git commit -m "feat(core): domain repository"
```

---

### Task 4: Island repository

**Files:**
- Create: `src/core/repositories/islandRepository.ts`
- Test: `tests/core/islandRepository.test.ts`

**Interfaces:**
- Consumes: `Island`, `NotFoundError`, `upsertDomain`.
- Produces:
  - `upsertIsland(db, { domainId, slug, name, summary?, parentId?, sortOrder? }): Island` (upsert by `(domainId, slug)`; `summary`/`parentId`/`sortOrder` keep the old value when omitted)
  - `updateIsland(db, domainId, slug, { name?, summary?, sortOrder? }): Island`
  - `getIsland(db, domainId, slug): Island | null`
  - `getIslandById(db, id): Island | null`
  - `requireIsland(db, domainId, slug): Island` (throws `NotFoundError`, `valid` = every slug in the domain)
  - `listIslands(db, domainId, parentId: number | null): Island[]` (ordered by `sort_order, name`)
  - `listIslandSlugs(db, domainId): string[]`
  - `islandPath(db, islandId): Island[]` (root → the island itself)

- [ ] **Step 1: Write the failing test**

`tests/core/islandRepository.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import {
  upsertIsland, updateIsland, getIsland, requireIsland, listIslands, listIslandSlugs, islandPath,
} from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait, listStraits } from "../../src/core/repositories/straitRepository.ts";
import { ConflictError, NotFoundError } from "../../src/core/errors.ts";

let db: Database;
let domainId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
});

test("upsert by slug keeps summary and parent when omitted", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching", summary: "Keep hot data close." });
  const b = upsertIsland(db, { domainId, slug: "caching", name: "Caching!" });
  expect(b.id).toBe(a.id);
  expect(b.name).toBe("Caching!");
  expect(b.summary).toBe("Keep hot data close.");
  expect(b.parentId).toBeNull();
});

test("islets hang off a parent and list by parent", () => {
  const parent = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  upsertIsland(db, { domainId, slug: "cache-invalidation", name: "Invalidation", parentId: parent.id, sortOrder: 2 });
  upsertIsland(db, { domainId, slug: "cache-eviction", name: "Eviction", parentId: parent.id, sortOrder: 1 });
  expect(listIslands(db, domainId, null).map((i) => i.slug)).toEqual(["caching"]);
  expect(listIslands(db, domainId, parent.id).map((i) => i.slug)).toEqual(["cache-eviction", "cache-invalidation"]);
});

test("slug is unique per domain across depths; an island cannot parent itself", () => {
  const caching = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const databases = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const moved = upsertIsland(db, { domainId, slug: "caching", name: "Caching", parentId: databases.id });
  expect(moved.id).toBe(caching.id);
  expect(moved.parentId).toBe(databases.id);
  expect(listIslandSlugs(db, domainId)).toEqual(["caching", "databases"]);
  expect(() => upsertIsland(db, { domainId, slug: "caching", name: "Caching", parentId: caching.id })).toThrow(ConflictError);
  const islet = upsertIsland(db, { domainId, slug: "cache-eviction", name: "Eviction", parentId: caching.id });
  const deeper = upsertIsland(db, { domainId, slug: "lru", name: "LRU", parentId: islet.id });
  expect(() => upsertIsland(db, { domainId, slug: "caching", name: "Caching", parentId: deeper.id })).toThrow(ConflictError);
  expect(islandPath(db, deeper.id).map((i) => i.slug)).toEqual(["databases", "caching", "cache-eviction", "lru"]);
});

test("islandPath walks root to self", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "cache-invalidation", name: "Invalidation", parentId: a.id });
  const c = upsertIsland(db, { domainId, slug: "ttl", name: "TTL", parentId: b.id });
  expect(islandPath(db, c.id).map((i) => i.slug)).toEqual(["caching", "cache-invalidation", "ttl"]);
});

test("requireIsland lists valid slugs; updateIsland patches fields", () => {
  upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  expect(getIsland(db, domainId, "nope")).toBeNull();
  expect(() => requireIsland(db, domainId, "nope")).toThrow(NotFoundError);
  try { requireIsland(db, domainId, "nope"); } catch (e) { expect((e as NotFoundError).valid).toEqual(["caching"]); }
  const updated = updateIsland(db, domainId, "caching", { summary: "new" });
  expect(updated.summary).toBe("new");
  expect(updated.name).toBe("Caching");
});

test("reparenting an island drops its straits, which joined its old siblings", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const c = upsertIsland(db, { domainId, slug: "queues", name: "Queues" });
  upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id });
  upsertStrait(db, { domainId, fromIslandId: b.id, toIslandId: c.id });
  upsertIsland(db, { domainId, slug: "caching", name: "Caching", parentId: c.id });
  expect(listStraits(db, domainId, null).map((s) => [s.fromIslandId, s.toIslandId])).toEqual([[b.id, c.id]]);
  expect(listStraits(db, domainId, c.id)).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/islandRepository.test.ts`
Expected: FAIL, cannot resolve `islandRepository.ts`.

- [ ] **Step 3: Write the repository**

`src/core/repositories/islandRepository.ts`:

```ts
import type { Database } from "bun:sqlite";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { Island } from "../types.ts";

const COLS =
  "id, domain_id as domainId, parent_id as parentId, slug, name, summary, sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export type IslandUpsert = {
  domainId: number;
  slug: string;
  name: string;
  summary?: string | null;
  parentId?: number | null;
  sortOrder?: number | null;
};

export function upsertIsland(db: Database, input: IslandUpsert): Island {
  const existing = getIsland(db, input.domainId, input.slug);
  if (existing && input.parentId != null) {
    assertNotDescendant(db, existing, input.parentId);
    if (input.parentId !== existing.parentId) {
      // A moved island has new siblings; its old straits would join non-siblings, so they go.
      db.run("delete from straits where from_island_id = ? or to_island_id = ?", [existing.id, existing.id]);
    }
  }
  return db
    .query<Island, Record<string, string | number | null>>(
      `insert into islands (domain_id, slug, name, summary, parent_id, sort_order)
       values ($domainId, $slug, $name, $summary, $parentId, coalesce($sortOrder, 0))
       on conflict(domain_id, slug) do update set
         name = excluded.name,
         summary = coalesce(excluded.summary, islands.summary),
         parent_id = coalesce(excluded.parent_id, islands.parent_id),
         sort_order = coalesce($sortOrder, islands.sort_order),
         updated_at = ${NOW}
       returning ${COLS}`,
    )
    .get({
      $domainId: input.domainId,
      $slug: input.slug,
      $name: input.name,
      $summary: input.summary ?? null,
      $parentId: input.parentId ?? null,
      $sortOrder: input.sortOrder ?? null,
    })!;
}

export function updateIsland(
  db: Database,
  domainId: number,
  slug: string,
  patch: { name?: string; summary?: string; sortOrder?: number },
): Island {
  const current = requireIsland(db, domainId, slug);
  return db
    .query<Island, Record<string, string | number | null>>(
      `update islands set name = $name, summary = $summary, sort_order = $sortOrder, updated_at = ${NOW}
       where id = $id returning ${COLS}`,
    )
    .get({
      $id: current.id,
      $name: patch.name ?? current.name,
      $summary: patch.summary ?? current.summary,
      $sortOrder: patch.sortOrder ?? current.sortOrder,
    })!;
}

export function getIsland(db: Database, domainId: number, slug: string): Island | null {
  return (
    db.query<Island, [number, string]>(`select ${COLS} from islands where domain_id = ? and slug = ?`).get(domainId, slug) ??
    null
  );
}

export function getIslandById(db: Database, id: number): Island | null {
  return db.query<Island, [number]>(`select ${COLS} from islands where id = ?`).get(id) ?? null;
}

export function listIslandSlugs(db: Database, domainId: number): string[] {
  return db
    .query<{ slug: string }, [number]>("select slug from islands where domain_id = ? order by slug")
    .all(domainId)
    .map((r) => r.slug);
}

export function requireIsland(db: Database, domainId: number, slug: string): Island {
  const island = getIsland(db, domainId, slug);
  if (!island) throw new NotFoundError(`no island "${slug}" in this domain`, listIslandSlugs(db, domainId));
  return island;
}

export function listIslands(db: Database, domainId: number, parentId: number | null): Island[] {
  if (parentId === null) {
    return db
      .query<Island, [number]>(`select ${COLS} from islands where domain_id = ? and parent_id is null order by sort_order, name`)
      .all(domainId);
  }
  return db
    .query<Island, [number, number]>(`select ${COLS} from islands where domain_id = ? and parent_id = ? order by sort_order, name`)
    .all(domainId, parentId);
}

/** Ancestors first, the island itself last. */
export function islandPath(db: Database, islandId: number): Island[] {
  const path: Island[] = [];
  const seen = new Set<number>();
  let current = getIslandById(db, islandId);
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parentId === null ? null : getIslandById(db, current.parentId);
  }
  return path;
}

/** Throws if `candidateParentId` is `island` itself or any descendant of it: a parent link there would form a cycle. */
function assertNotDescendant(db: Database, island: Island, candidateParentId: number): void {
  if (candidateParentId === island.id) throw new ConflictError(`"${island.slug}" cannot be its own parent`);
  const seen = new Set<number>();
  let current = getIslandById(db, candidateParentId);
  while (current && !seen.has(current.id)) {
    if (current.id === island.id) {
      throw new ConflictError(`"${island.slug}" cannot be moved under its own islet`);
    }
    seen.add(current.id);
    current = current.parentId === null ? null : getIslandById(db, current.parentId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/islandRepository.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/repositories/islandRepository.ts tests/core/islandRepository.test.ts
git commit -m "feat(core): island repository with per-domain slugs and tree path"
```

---

### Task 5: Strait repository

**Files:**
- Create: `src/core/repositories/straitRepository.ts`
- Test: `tests/core/straitRepository.test.ts`

**Interfaces:**
- Consumes: `Strait`, `Island`, `getIslandById`, `ConflictError`, `NotFoundError`.
- Produces:
  - `upsertStrait(db, { domainId, fromIslandId, toIslandId, name?, summary? }): Strait` (orders ids, enforces siblings, throws `ConflictError` otherwise)
  - `listStraits(db, domainId, parentId: number | null): Strait[]` (straits whose islands have that parent)
  - `getStrait(db, aIslandId, bIslandId): Strait | null`
  - `requireStrait(db, a: Island, b: Island): Strait` (throws `NotFoundError`)
  - `getStraitById(db, id): Strait | null`

- [ ] **Step 1: Write the failing test**

`tests/core/straitRepository.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait, listStraits, getStrait, requireStrait } from "../../src/core/repositories/straitRepository.ts";
import { ConflictError, NotFoundError } from "../../src/core/errors.ts";

let db: Database;
let domainId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
});

test("strait is stored as an unordered pair and upserts", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const s1 = upsertStrait(db, { domainId, fromIslandId: b.id, toIslandId: a.id, name: "cache aside" });
  const s2 = upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id, summary: "when to cache reads" });
  expect(s2.id).toBe(s1.id);
  expect(s2.fromIslandId).toBe(Math.min(a.id, b.id));
  expect(s2.name).toBe("cache aside");
  expect(s2.summary).toBe("when to cache reads");
  expect(getStrait(db, b.id, a.id)?.id).toBe(s1.id);
  expect(requireStrait(db, a, b).id).toBe(s1.id);
});

test("straits must join siblings", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const child = upsertIsland(db, { domainId, slug: "cache-eviction", name: "Eviction", parentId: a.id });
  expect(() => upsertStrait(db, { domainId, fromIslandId: b.id, toIslandId: child.id })).toThrow(ConflictError);
  expect(() => upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: a.id })).toThrow(ConflictError);
});

test("listStraits filters by parent scale", () => {
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  const c1 = upsertIsland(db, { domainId, slug: "cache-eviction", name: "Eviction", parentId: a.id });
  const c2 = upsertIsland(db, { domainId, slug: "cache-invalidation", name: "Invalidation", parentId: a.id });
  upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id });
  upsertStrait(db, { domainId, fromIslandId: c1.id, toIslandId: c2.id });
  expect(listStraits(db, domainId, null)).toHaveLength(1);
  expect(listStraits(db, domainId, a.id)).toHaveLength(1);
  expect(listStraits(db, domainId, b.id)).toHaveLength(0);
  expect(() => requireStrait(db, a, c1)).toThrow(NotFoundError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/straitRepository.test.ts`
Expected: FAIL, cannot resolve `straitRepository.ts`.

- [ ] **Step 3: Write the repository**

`src/core/repositories/straitRepository.ts`:

```ts
import type { Database } from "bun:sqlite";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { Island, Strait } from "../types.ts";
import { getIslandById } from "./islandRepository.ts";

const COLS =
  "s.id, s.domain_id as domainId, s.from_island_id as fromIslandId, s.to_island_id as toIslandId, s.name, s.summary, s.created_at as createdAt";
/** RETURNING does not see the table alias (verified: "no such column: s.id"); use unprefixed names there. */
const RETURNING_COLS =
  "id, domain_id as domainId, from_island_id as fromIslandId, to_island_id as toIslandId, name, summary, created_at as createdAt";

export type StraitUpsert = {
  domainId: number;
  fromIslandId: number;
  toIslandId: number;
  name?: string | null;
  summary?: string | null;
};

export function upsertStrait(db: Database, input: StraitUpsert): Strait {
  const a = getIslandById(db, input.fromIslandId);
  const b = getIslandById(db, input.toIslandId);
  if (!a || !b || a.domainId !== input.domainId || b.domainId !== input.domainId) {
    throw new NotFoundError("both strait endpoints must be islands in this domain");
  }
  if (a.id === b.id) throw new ConflictError(`a strait needs two different islands, got "${a.slug}" twice`);
  if (a.parentId !== b.parentId) {
    throw new ConflictError(
      `straits join siblings at one scale; "${a.slug}" and "${b.slug}" have different parents`,
    );
  }
  const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  return db
    .query<Strait, Record<string, string | number | null>>(
      `insert into straits as s (domain_id, from_island_id, to_island_id, name, summary)
       values ($domainId, $lo, $hi, $name, $summary)
       on conflict(from_island_id, to_island_id) do update set
         name = coalesce(excluded.name, s.name),
         summary = coalesce(excluded.summary, s.summary)
       returning ${RETURNING_COLS}`,
    )
    .get({ $domainId: input.domainId, $lo: lo, $hi: hi, $name: input.name ?? null, $summary: input.summary ?? null })!;
}

export function getStrait(db: Database, aIslandId: number, bIslandId: number): Strait | null {
  const [lo, hi] = aIslandId < bIslandId ? [aIslandId, bIslandId] : [bIslandId, aIslandId];
  return (
    db
      .query<Strait, [number, number]>(`select ${COLS} from straits s where from_island_id = ? and to_island_id = ?`)
      .get(lo, hi) ?? null
  );
}

export function getStraitById(db: Database, id: number): Strait | null {
  return db.query<Strait, [number]>(`select ${COLS} from straits s where id = ?`).get(id) ?? null;
}

export function requireStrait(db: Database, a: Island, b: Island): Strait {
  const strait = getStrait(db, a.id, b.id);
  if (!strait) throw new NotFoundError(`no strait between "${a.slug}" and "${b.slug}"`);
  return strait;
}

/** Straits between islands that share the given parent (null = top level). */
export function listStraits(db: Database, domainId: number, parentId: number | null): Strait[] {
  if (parentId === null) {
    return db
      .query<Strait, [number]>(
        `select ${COLS} from straits s join islands i on i.id = s.from_island_id
         where s.domain_id = ? and i.parent_id is null order by s.id`,
      )
      .all(domainId);
  }
  return db
    .query<Strait, [number, number]>(
      `select ${COLS} from straits s join islands i on i.id = s.from_island_id
       where s.domain_id = ? and i.parent_id = ? order by s.id`,
    )
    .all(domainId, parentId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/straitRepository.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/repositories/straitRepository.ts tests/core/straitRepository.test.ts
git commit -m "feat(core): strait repository with sibling rule"
```

---

### Task 6: Verdict repository

**Files:**
- Create: `src/core/repositories/verdictRepository.ts`
- Test: `tests/core/verdictRepository.test.ts`

**Interfaces:**
- Consumes: `Verdict`, `VerdictTargetType`, `VerdictState`.
- Produces:
  - `addVerdict(db, { targetType, targetId, state, confidence, evidence, rationale?, sessionId? }): Verdict`
  - `latestVerdict(db, targetType, targetId): Verdict | null`
  - `verdictHistory(db, targetType, targetId): Verdict[]` (newest first)
  - `latestVerdicts(db, targetType, targetIds: number[]): Map<number, Verdict>`

- [ ] **Step 1: Write the failing test**

`tests/core/verdictRepository.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addVerdict, latestVerdict, verdictHistory, latestVerdicts } from "../../src/core/repositories/verdictRepository.ts";

let db: Database;
let islandId: number;
let otherId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  const domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  islandId = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
  otherId = upsertIsland(db, { domainId, slug: "queues", name: "Queues" }).id;
});

test("verdicts append and the latest wins", () => {
  addVerdict(db, { targetType: "island", targetId: islandId, state: "reef", confidence: 0.7, evidence: "TTL always fixes it" });
  addVerdict(db, { targetType: "island", targetId: islandId, state: "settled", confidence: 0.9, evidence: "explained invalidation" });
  expect(latestVerdict(db, "island", islandId)?.state).toBe("settled");
  expect(verdictHistory(db, "island", islandId).map((v) => v.state)).toEqual(["settled", "reef"]);
});

test("open water is absence: no row means null", () => {
  expect(latestVerdict(db, "island", islandId)).toBeNull();
  expect(latestVerdicts(db, "island", [islandId, otherId]).size).toBe(0);
});

test("latestVerdicts maps only charted targets", () => {
  addVerdict(db, { targetType: "island", targetId: islandId, state: "sandbar", confidence: 0.6, evidence: "roughly right" });
  addVerdict(db, { targetType: "island", targetId: islandId, state: "mountainous", confidence: 0.95, evidence: "edge case handled" });
  const map = latestVerdicts(db, "island", [islandId, otherId]);
  expect(map.get(islandId)?.state).toBe("mountainous");
  expect(map.has(otherId)).toBe(false);
});

test("state and confidence are constrained by the schema", () => {
  expect(() =>
    addVerdict(db, { targetType: "island", targetId: islandId, state: "open" as never, confidence: 0.5, evidence: "x" }),
  ).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/verdictRepository.test.ts`
Expected: FAIL, cannot resolve `verdictRepository.ts`.

- [ ] **Step 3: Write the repository**

`src/core/repositories/verdictRepository.ts`:

```ts
import type { Database } from "bun:sqlite";
import type { Verdict, VerdictState, VerdictTargetType } from "../types.ts";

const COLS =
  "id, target_type as targetType, target_id as targetId, state, confidence, evidence, rationale, session_id as sessionId, created_at as createdAt";

export type VerdictInsert = {
  targetType: VerdictTargetType;
  targetId: number;
  state: VerdictState;
  confidence: number;
  evidence: string;
  rationale?: string | null;
  sessionId?: number | null;
};

export function addVerdict(db: Database, input: VerdictInsert): Verdict {
  return db
    .query<Verdict, Record<string, string | number | null>>(
      `insert into verdicts (target_type, target_id, state, confidence, evidence, rationale, session_id)
       values ($targetType, $targetId, $state, $confidence, $evidence, $rationale, $sessionId)
       returning ${COLS}`,
    )
    .get({
      $targetType: input.targetType,
      $targetId: input.targetId,
      $state: input.state,
      $confidence: input.confidence,
      $evidence: input.evidence,
      $rationale: input.rationale ?? null,
      $sessionId: input.sessionId ?? null,
    })!;
}

export function latestVerdict(db: Database, targetType: VerdictTargetType, targetId: number): Verdict | null {
  return (
    db
      .query<Verdict, [string, number]>(
        `select ${COLS} from verdicts where target_type = ? and target_id = ? order by id desc limit 1`,
      )
      .get(targetType, targetId) ?? null
  );
}

export function verdictHistory(db: Database, targetType: VerdictTargetType, targetId: number): Verdict[] {
  return db
    .query<Verdict, [string, number]>(`select ${COLS} from verdicts where target_type = ? and target_id = ? order by id desc`)
    .all(targetType, targetId);
}

/** Latest verdict per target, for the given ids only. Targets with no verdict are absent from the map. */
export function latestVerdicts(db: Database, targetType: VerdictTargetType, targetIds: number[]): Map<number, Verdict> {
  const map = new Map<number, Verdict>();
  if (targetIds.length === 0) return map;
  const wanted = new Set(targetIds);
  const rows = db
    .query<Verdict, [string]>(
      `select ${COLS} from verdicts
       where target_type = ? and id in (select max(id) from verdicts group by target_type, target_id)`,
    )
    .all(targetType);
  for (const row of rows) if (wanted.has(row.targetId)) map.set(row.targetId, row);
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/verdictRepository.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/repositories/verdictRepository.ts tests/core/verdictRepository.test.ts
git commit -m "feat(core): append-only verdict repository"
```

---

### Task 7: Session repository

**Files:**
- Create: `src/core/repositories/sessionRepository.ts`
- Test: `tests/core/sessionRepository.test.ts`

**Interfaces:**
- Consumes: `Session`, `NotFoundError`.
- Produces: `activeSession(db, domainId): Session | null`, `startSession(db, domainId): Session` (returns the open session if one exists), `endSession(db, domainId, summary): Session` (throws `NotFoundError` if none open), `listSessions(db, domainId): Session[]` (newest first).

- [ ] **Step 1: Write the failing test**

`tests/core/sessionRepository.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { activeSession, startSession, endSession, listSessions } from "../../src/core/repositories/sessionRepository.ts";
import { NotFoundError } from "../../src/core/errors.ts";

let db: Database;
let domainId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
});

test("startSession reuses the open session", () => {
  expect(activeSession(db, domainId)).toBeNull();
  const a = startSession(db, domainId);
  const b = startSession(db, domainId);
  expect(b.id).toBe(a.id);
  expect(activeSession(db, domainId)?.id).toBe(a.id);
});

test("endSession closes with a summary; a new start opens a new one", () => {
  const a = startSession(db, domainId);
  const ended = endSession(db, domainId, "charted caching and queues");
  expect(ended.id).toBe(a.id);
  expect(ended.endedAt).not.toBeNull();
  expect(ended.summary).toBe("charted caching and queues");
  expect(activeSession(db, domainId)).toBeNull();
  expect(() => endSession(db, domainId, "again")).toThrow(NotFoundError);
  const b = startSession(db, domainId);
  expect(b.id).not.toBe(a.id);
  expect(listSessions(db, domainId).map((s) => s.id)).toEqual([b.id, a.id]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/sessionRepository.test.ts`
Expected: FAIL, cannot resolve `sessionRepository.ts`.

- [ ] **Step 3: Write the repository**

`src/core/repositories/sessionRepository.ts`:

```ts
import type { Database } from "bun:sqlite";
import { NotFoundError } from "../errors.ts";
import type { Session } from "../types.ts";

const COLS = "id, domain_id as domainId, started_at as startedAt, ended_at as endedAt, summary";

export function activeSession(db: Database, domainId: number): Session | null {
  return (
    db
      .query<Session, [number]>(`select ${COLS} from sessions where domain_id = ? and ended_at is null order by id desc limit 1`)
      .get(domainId) ?? null
  );
}

export function startSession(db: Database, domainId: number): Session {
  const open = activeSession(db, domainId);
  if (open) return open;
  return db.query<Session, [number]>(`insert into sessions (domain_id) values (?) returning ${COLS}`).get(domainId)!;
}

export function endSession(db: Database, domainId: number, summary: string): Session {
  const open = activeSession(db, domainId);
  if (!open) throw new NotFoundError("no open session for this domain");
  return db
    .query<Session, [string, number]>(
      `update sessions set ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), summary = ? where id = ? returning ${COLS}`,
    )
    .get(summary, open.id)!;
}

export function listSessions(db: Database, domainId: number): Session[] {
  return db.query<Session, [number]>(`select ${COLS} from sessions where domain_id = ? order by id desc`).all(domainId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/sessionRepository.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/repositories/sessionRepository.ts tests/core/sessionRepository.test.ts
git commit -m "feat(core): session repository"
```

---

### Task 8: Comment and view-state repositories, version bumps

**Files:**
- Create: `src/core/repositories/commentRepository.ts`, `src/core/repositories/viewStateRepository.ts`
- Test: `tests/core/commentRepository.test.ts`, `tests/core/viewState.test.ts`

**Interfaces:**
- Consumes: `Comment`, `ViewState`, `NotFoundError`, plus earlier repositories in tests.
- Produces:
  - `addComment(db, { domainId, targetType, targetId, body, kind }): Comment`
  - `listComments(db, domainId, { unreadOnly }): Comment[]` (oldest first)
  - `markCommentsRead(db, domainId, ids: number[] | "all"): number` (rows changed)
  - `getViewState(db, domainId): ViewState`
  - `setFocus(db, domainId, islandId: number | null): ViewState`

- [ ] **Step 1: Write the failing tests**

`tests/core/commentRepository.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addComment, listComments, markCommentsRead } from "../../src/core/repositories/commentRepository.ts";

let db: Database;
let domainId: number;
let islandId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  islandId = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
});

test("unread lifecycle", () => {
  const a = addComment(db, { domainId, targetType: "island", targetId: islandId, body: "", kind: "probe_me" });
  const b = addComment(db, { domainId, targetType: "island", targetId: islandId, body: "not a reef", kind: "dispute" });
  expect(listComments(db, domainId, { unreadOnly: true }).map((c) => c.id)).toEqual([a.id, b.id]);
  expect(markCommentsRead(db, domainId, [a.id])).toBe(1);
  expect(listComments(db, domainId, { unreadOnly: true }).map((c) => c.id)).toEqual([b.id]);
  expect(markCommentsRead(db, domainId, "all")).toBe(1);
  expect(listComments(db, domainId, { unreadOnly: true })).toHaveLength(0);
  expect(listComments(db, domainId, { unreadOnly: false })).toHaveLength(2);
  expect(listComments(db, domainId, { unreadOnly: false })[0]!.readAt).not.toBeNull();
});
```

`tests/core/viewState.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait } from "../../src/core/repositories/straitRepository.ts";
import { addVerdict } from "../../src/core/repositories/verdictRepository.ts";
import { addComment, markCommentsRead } from "../../src/core/repositories/commentRepository.ts";
import { startSession } from "../../src/core/repositories/sessionRepository.ts";
import { getViewState, setFocus } from "../../src/core/repositories/viewStateRepository.ts";

let db: Database;
let domainId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
});

const version = () => getViewState(db, domainId).version;

test("every write bumps the domain version", () => {
  expect(version()).toBe(0);
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  expect(version()).toBe(1);
  const b = upsertIsland(db, { domainId, slug: "queues", name: "Queues" });
  expect(version()).toBe(2);
  const s = upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id });
  expect(version()).toBe(3);
  addVerdict(db, { targetType: "island", targetId: a.id, state: "settled", confidence: 0.9, evidence: "q" });
  expect(version()).toBe(4);
  addVerdict(db, { targetType: "strait", targetId: s.id, state: "sandbar", confidence: 0.6, evidence: "q" });
  expect(version()).toBe(5);
  const c = addComment(db, { domainId, targetType: "island", targetId: a.id, body: "", kind: "probe_me" });
  expect(version()).toBe(6);
  markCommentsRead(db, domainId, [c.id]);
  expect(version()).toBe(7);
  startSession(db, domainId);
  expect(version()).toBe(8);
  setFocus(db, domainId, a.id);
  expect(version()).toBe(9);
  expect(getViewState(db, domainId).focusIslandId).toBe(a.id);
  setFocus(db, domainId, null);
  expect(version()).toBe(10);
});

test("a write in one domain does not bump another", () => {
  const other = upsertDomain(db, { slug: "ios", name: "iOS" }).id;
  upsertIsland(db, { domainId: other, slug: "swiftui", name: "SwiftUI" });
  expect(version()).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/commentRepository.test.ts tests/core/viewState.test.ts`
Expected: FAIL, cannot resolve the two repository files.

- [ ] **Step 3: Write both repositories**

`src/core/repositories/commentRepository.ts`:

```ts
import type { Database } from "bun:sqlite";
import type { Comment, CommentKind, CommentTargetType } from "../types.ts";

const COLS =
  "id, domain_id as domainId, target_type as targetType, target_id as targetId, body, kind, read_at as readAt, created_at as createdAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export type CommentInsert = {
  domainId: number;
  targetType: CommentTargetType;
  targetId: number;
  body: string;
  kind: CommentKind;
};

export function addComment(db: Database, input: CommentInsert): Comment {
  return db
    .query<Comment, Record<string, string | number>>(
      `insert into comments (domain_id, target_type, target_id, body, kind)
       values ($domainId, $targetType, $targetId, $body, $kind) returning ${COLS}`,
    )
    .get({
      $domainId: input.domainId,
      $targetType: input.targetType,
      $targetId: input.targetId,
      $body: input.body,
      $kind: input.kind,
    })!;
}

export function listComments(db: Database, domainId: number, options: { unreadOnly: boolean }): Comment[] {
  const where = options.unreadOnly ? "domain_id = ? and read_at is null" : "domain_id = ?";
  return db.query<Comment, [number]>(`select ${COLS} from comments where ${where} order by id`).all(domainId);
}

/** Marks the given comments (or every unread one) as read. Returns the number of rows changed. */
export function markCommentsRead(db: Database, domainId: number, ids: number[] | "all"): number {
  if (ids === "all") {
    return db.run(`update comments set read_at = ${NOW} where domain_id = ? and read_at is null`, [domainId]).changes;
  }
  let changed = 0;
  for (const id of ids) {
    changed += db.run(`update comments set read_at = ${NOW} where domain_id = ? and id = ? and read_at is null`, [domainId, id])
      .changes;
  }
  return changed;
}
```

`src/core/repositories/viewStateRepository.ts`:

```ts
import type { Database } from "bun:sqlite";
import { NotFoundError } from "../errors.ts";
import type { ViewState } from "../types.ts";

const COLS = "domain_id as domainId, focus_island_id as focusIslandId, version";

export function getViewState(db: Database, domainId: number): ViewState {
  const row = db.query<ViewState, [number]>(`select ${COLS} from view_state where domain_id = ?`).get(domainId);
  if (!row) throw new NotFoundError(`no view_state for domain ${domainId}`);
  return row;
}

export function setFocus(db: Database, domainId: number, islandId: number | null): ViewState {
  db.run("update view_state set focus_island_id = ? where domain_id = ?", [islandId, domainId]);
  return getViewState(db, domainId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/commentRepository.test.ts tests/core/viewState.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/repositories/commentRepository.ts src/core/repositories/viewStateRepository.ts tests/core/commentRepository.test.ts tests/core/viewState.test.ts
git commit -m "feat(core): comments, focus and version bump coverage"
```

---

### Task 9: View-model (snapshot)

**Files:**
- Create: `src/core/view-model.ts`
- Test: `tests/core/view-model.test.ts`

**Interfaces:**
- Consumes: every repository from Tasks 3–8.
- Produces:
  - `buildSnapshot(db, domainSlug, scaleSlug: string | null): Snapshot`
  - `listCommentViews(db, domainId, unreadOnly): CommentView[]` (comments with a human/agent-readable `target` string)
  - `formatTarget(db, targetType, targetId): string` → `island:<slug>`, `strait:<a>~<b>`, or `domain:<slug>`
  - Types `Snapshot`, `IslandView`, `StraitView`, `VerdictView`, `CommentView`, `RollupState`.

Snapshot shape (spec §3):

```ts
{
  version, domain: { slug, name },
  scale: { path: [{ slug, name }] },            // [] at top level
  islands: [{ slug, name, summary, hasChildren, verdict, children: { total, byState } }],
  straits: [{ from, to, name, verdict }],
  focus: slug | null,
  unreadComments: n,
  nearestOpenWater: [slug],                     // spec §7 definition
  reefs: [ "island:<slug>" | "strait:<a>~<b>" ]
}
```

- [ ] **Step 1: Write the failing test**

`tests/core/view-model.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait } from "../../src/core/repositories/straitRepository.ts";
import { addVerdict } from "../../src/core/repositories/verdictRepository.ts";
import { addComment } from "../../src/core/repositories/commentRepository.ts";
import { setFocus } from "../../src/core/repositories/viewStateRepository.ts";
import { buildSnapshot, listCommentViews, formatTarget } from "../../src/core/view-model.ts";
import { NotFoundError } from "../../src/core/errors.ts";

let db: Database;
let domainId: number;
let caching: number;
let queues: number;
let dbs: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  caching = upsertIsland(db, { domainId, slug: "caching", name: "Caching", sortOrder: 1 }).id;
  queues = upsertIsland(db, { domainId, slug: "queues", name: "Queues", sortOrder: 2 }).id;
  dbs = upsertIsland(db, { domainId, slug: "databases", name: "Databases", sortOrder: 3 }).id;
  upsertStrait(db, { domainId, fromIslandId: caching, toIslandId: dbs, name: "cache-aside" });
  upsertStrait(db, { domainId, fromIslandId: queues, toIslandId: dbs });
});

test("open water is absence, never a state", () => {
  const snap = buildSnapshot(db, "sd", null);
  expect(snap.islands.map((i) => i.slug)).toEqual(["caching", "queues", "databases"]);
  for (const island of snap.islands) expect(island.verdict).toBeNull();
  expect(JSON.stringify(snap)).not.toContain('"state":"open"');
  expect(snap.scale.path).toEqual([]);
  expect(snap.straits).toHaveLength(2);
  expect(snap.straits[0]).toMatchObject({ from: "caching", to: "databases", name: "cache-aside", verdict: null });
});

test("latest verdict wins and reefs are listed", () => {
  addVerdict(db, { targetType: "island", targetId: caching, state: "reef", confidence: 0.8, evidence: "TTL fixes everything" });
  addVerdict(db, { targetType: "island", targetId: caching, state: "settled", confidence: 0.9, evidence: "explained invalidation" });
  addVerdict(db, { targetType: "island", targetId: queues, state: "reef", confidence: 0.8, evidence: "exactly-once is free" });
  const snap = buildSnapshot(db, "sd", null);
  expect(snap.islands.find((i) => i.slug === "caching")!.verdict).toMatchObject({ state: "settled", evidence: "explained invalidation" });
  expect(snap.reefs).toEqual(["island:queues"]);
});

test("nearest open water prefers neighbours of charted islands, ordered by elevation", () => {
  addVerdict(db, { targetType: "island", targetId: caching, state: "mountainous", confidence: 0.9, evidence: "q" });
  addVerdict(db, { targetType: "island", targetId: queues, state: "sandbar", confidence: 0.6, evidence: "q" });
  const snap = buildSnapshot(db, "sd", null);
  // databases neighbours both; it is the only open island, so it is first and only.
  expect(snap.nearestOpenWater).toEqual(["databases"]);
  upsertIsland(db, { domainId, slug: "consensus", name: "Consensus", sortOrder: 4 });
  expect(buildSnapshot(db, "sd", null).nearestOpenWater).toEqual(["databases", "consensus"]);
  addVerdict(db, { targetType: "island", targetId: dbs, state: "settled", confidence: 0.9, evidence: "q" });
  expect(buildSnapshot(db, "sd", null).nearestOpenWater).toEqual(["consensus"]);
});

test("parent with no verdict rolls up its children and is never assigned a state", () => {
  const ev = upsertIsland(db, { domainId, slug: "cache-eviction", name: "Eviction", parentId: caching }).id;
  upsertIsland(db, { domainId, slug: "cache-invalidation", name: "Invalidation", parentId: caching });
  upsertIsland(db, { domainId, slug: "cache-warming", name: "Warming", parentId: caching });
  addVerdict(db, { targetType: "island", targetId: ev, state: "settled", confidence: 0.9, evidence: "q" });
  const top = buildSnapshot(db, "sd", null).islands.find((i) => i.slug === "caching")!;
  expect(top.verdict).toBeNull();
  expect(top.hasChildren).toBe(true);
  expect(top.children).toEqual({ total: 3, byState: { sandbar: 0, settled: 1, mountainous: 0, reef: 0, open: 2 } });
  const inner = buildSnapshot(db, "sd", "caching");
  expect(inner.scale.path).toEqual([{ slug: "caching", name: "Caching" }]);
  expect(inner.islands.map((i) => i.slug)).toEqual(["cache-eviction", "cache-invalidation", "cache-warming"]);
  expect(inner.straits).toEqual([]);
});

test("focus, unread count, version, and target formatting", () => {
  setFocus(db, domainId, queues);
  addComment(db, { domainId, targetType: "island", targetId: queues, body: "", kind: "probe_me" });
  const snap = buildSnapshot(db, "sd", null);
  expect(snap.focus).toBe("queues");
  expect(snap.unreadComments).toBe(1);
  expect(snap.version).toBeGreaterThan(0);
  const views = listCommentViews(db, domainId, true);
  expect(views[0]).toMatchObject({ kind: "probe_me", target: "island:queues" });
  expect(formatTarget(db, "domain", domainId)).toBe("domain:sd");
});

test("unknown domain or scale throws NotFoundError", () => {
  expect(() => buildSnapshot(db, "nope", null)).toThrow(NotFoundError);
  expect(() => buildSnapshot(db, "sd", "nope")).toThrow(NotFoundError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/view-model.test.ts`
Expected: FAIL, cannot resolve `view-model.ts`.

- [ ] **Step 3: Write the view-model**

`src/core/view-model.ts`:

```ts
import type { Database } from "bun:sqlite";
import type { Comment, CommentTargetType, Verdict, VerdictState } from "./types.ts";
import { requireDomain } from "./repositories/domainRepository.ts";
import { getIslandById, islandPath, listIslands, requireIsland } from "./repositories/islandRepository.ts";
import { getStraitById, listStraits } from "./repositories/straitRepository.ts";
import { latestVerdicts } from "./repositories/verdictRepository.ts";
import { listComments } from "./repositories/commentRepository.ts";
import { getViewState } from "./repositories/viewStateRepository.ts";

export type VerdictView = { state: VerdictState; confidence: number; evidence: string; rationale: string | null; at: string };
export type RollupState = Record<VerdictState | "open", number>;
export type IslandView = {
  slug: string;
  name: string;
  summary: string | null;
  hasChildren: boolean;
  verdict: VerdictView | null;
  children: { total: number; byState: RollupState };
};
export type StraitView = { from: string; to: string; name: string | null; verdict: VerdictView | null };
export type Snapshot = {
  version: number;
  domain: { slug: string; name: string };
  scale: { path: { slug: string; name: string }[] };
  islands: IslandView[];
  straits: StraitView[];
  focus: string | null;
  unreadComments: number;
  nearestOpenWater: string[];
  reefs: string[];
};
export type CommentView = Comment & { target: string };

const ELEVATION: Record<VerdictState, number> = { reef: 1, sandbar: 1, settled: 2, mountainous: 3 };

function toView(v: Verdict | undefined): VerdictView | null {
  return v ? { state: v.state, confidence: v.confidence, evidence: v.evidence, rationale: v.rationale, at: v.createdAt } : null;
}

function emptyRollup(): RollupState {
  return { sandbar: 0, settled: 0, mountainous: 0, reef: 0, open: 0 };
}

export function buildSnapshot(db: Database, domainSlug: string, scaleSlug: string | null): Snapshot {
  const domain = requireDomain(db, domainSlug);
  const scaleIsland = scaleSlug ? requireIsland(db, domain.id, scaleSlug) : null;
  const parentId = scaleIsland ? scaleIsland.id : null;
  const path = scaleIsland ? islandPath(db, scaleIsland.id).map((i) => ({ slug: i.slug, name: i.name })) : [];

  const islands = listIslands(db, domain.id, parentId);
  const islandVerdicts = latestVerdicts(db, "island", islands.map((i) => i.id));
  const islandViews: IslandView[] = islands.map((island) => {
    const children = listIslands(db, domain.id, island.id);
    const childVerdicts = latestVerdicts(db, "island", children.map((c) => c.id));
    const byState = emptyRollup();
    for (const child of children) {
      const v = childVerdicts.get(child.id);
      if (v) byState[v.state] += 1;
      else byState.open += 1;
    }
    return {
      slug: island.slug,
      name: island.name,
      summary: island.summary,
      hasChildren: children.length > 0,
      verdict: toView(islandVerdicts.get(island.id)),
      children: { total: children.length, byState },
    };
  });

  const straits = listStraits(db, domain.id, parentId);
  const straitVerdicts = latestVerdicts(db, "strait", straits.map((s) => s.id));
  const slugById = new Map(islands.map((i) => [i.id, i.slug]));
  const straitViews: StraitView[] = straits.map((s) => ({
    from: slugById.get(s.fromIslandId)!,
    to: slugById.get(s.toIslandId)!,
    name: s.name,
    verdict: toView(straitVerdicts.get(s.id)),
  }));

  const state = getViewState(db, domain.id);
  const focusIsland = state.focusIslandId === null ? null : getIslandById(db, state.focusIslandId);

  return {
    version: state.version,
    domain: { slug: domain.slug, name: domain.name },
    scale: { path },
    islands: islandViews,
    straits: straitViews,
    focus: focusIsland ? focusIsland.slug : null,
    unreadComments: listComments(db, domain.id, { unreadOnly: true }).length,
    nearestOpenWater: nearestOpenWater(islandViews, straitViews),
    reefs: [
      ...islandViews.filter((i) => i.verdict?.state === "reef").map((i) => `island:${i.slug}`),
      ...straitViews.filter((s) => s.verdict?.state === "reef").map((s) => `strait:${s.from}~${s.to}`),
    ],
  };
}

/**
 * Spec §7: open-water islands that share a strait with a charted island, ordered by the charted
 * neighbour's elevation (highest first), then every remaining open-water island in map order.
 */
export function nearestOpenWater(islands: IslandView[], straits: StraitView[]): string[] {
  const byslug = new Map(islands.map((i) => [i.slug, i]));
  const bestNeighbour = new Map<string, number>();
  for (const s of straits) {
    for (const [open, charted] of [
      [s.from, s.to],
      [s.to, s.from],
    ] as const) {
      const o = byslug.get(open);
      const c = byslug.get(charted);
      if (!o || !c || o.verdict || !c.verdict) continue;
      const elevation = ELEVATION[c.verdict.state];
      bestNeighbour.set(open, Math.max(bestNeighbour.get(open) ?? 0, elevation));
    }
  }
  const adjacent = [...bestNeighbour.entries()].sort((a, b) => b[1] - a[1]).map(([slug]) => slug);
  const rest = islands.filter((i) => !i.verdict && !bestNeighbour.has(i.slug)).map((i) => i.slug);
  return [...adjacent, ...rest];
}

export function formatTarget(db: Database, targetType: CommentTargetType | "island" | "strait", targetId: number): string {
  if (targetType === "island") {
    const island = getIslandById(db, targetId);
    return `island:${island ? island.slug : targetId}`;
  }
  if (targetType === "strait") {
    const strait = getStraitById(db, targetId);
    if (!strait) return `strait:${targetId}`;
    const a = getIslandById(db, strait.fromIslandId);
    const b = getIslandById(db, strait.toIslandId);
    return `strait:${a?.slug ?? strait.fromIslandId}~${b?.slug ?? strait.toIslandId}`;
  }
  const domain = db
    .query<{ slug: string }, [number]>("select slug from domains where id = ?")
    .get(targetId);
  return `domain:${domain ? domain.slug : targetId}`;
}

export function listCommentViews(db: Database, domainId: number, unreadOnly: boolean): CommentView[] {
  return listComments(db, domainId, { unreadOnly }).map((c) => ({ ...c, target: formatTarget(db, c.targetType, c.targetId) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/view-model.test.ts`
Expected: 6 pass.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/view-model.ts tests/core/view-model.test.ts
git commit -m "feat(core): snapshot view-model with roll-up, nearest open water and reefs"
```

---

### Task 10: CLI

**Files:**
- Create: `src/core/targets.ts`, `src/cli/io.ts`, `src/cli/index.ts`
- Test: `tests/cli/cli.test.ts`

**Interfaces:**
- Consumes: everything in `src/core`.
- Produces:
  - `resolveVerdictTarget(db, domainId, target: string): { targetType, targetId, label }` and `resolveCommentTarget(db, domain, targetType, targetId: string): { targetType, targetId }` in `src/core/targets.ts` (Task 11 reuses both).
  - The `archipelago` command surface from spec §5 (everything except `serve`, which Task 11 adds).
  - `io.ts`: `readStdinJson()`, `emit(value, forceCompact)`, `fail(error, forceCompact): never`.

Conventions: every command prints one JSON document. Pretty on a TTY, compact when piped or with `--json`. `--stdin` merges a JSON object from stdin under the flags (flags win). Errors: exit 1, `{ "error", "valid"? }` on stdout.

- [ ] **Step 1: Write the failing test**

`tests/cli/cli.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { requireDomain } from "../../src/core/repositories/domainRepository.ts";
import { requireIsland } from "../../src/core/repositories/islandRepository.ts";
import { addComment } from "../../src/core/repositories/commentRepository.ts";

const ROOT = resolve(import.meta.dir, "../..");
let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-"));
  dbPath = join(dir, "test.sqlite");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Result = { code: number; json: any; stderr: string };
function cli(args: string[], stdin?: object): Result {
  const proc = Bun.spawnSync(["bun", "src/cli/index.ts", ...args], {
    cwd: ROOT,
    env: { ...process.env, ARCHIPELAGO_DB_PATH: dbPath },
    stdin: stdin ? new TextEncoder().encode(JSON.stringify(stdin)) : "ignore",
  });
  const out = proc.stdout.toString().trim();
  return { code: proc.exitCode, json: out ? JSON.parse(out) : null, stderr: proc.stderr.toString() };
}

test("round trip: domain → islands → strait → session → verdict → snapshot", () => {
  expect(cli(["domain", "add", "--slug", "sd", "--name", "System Design"]).json).toMatchObject({ slug: "sd" });
  expect(cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching", "--summary", "Hot data close."]).code).toBe(0);
  expect(cli(["island", "add", "--domain", "sd", "--slug", "databases", "--name", "Databases"]).code).toBe(0);
  const islet = cli(["island", "add", "--domain", "sd", "--slug", "cache-eviction", "--name", "Eviction", "--parent", "caching"]);
  expect(islet.json.parentId).not.toBeNull();
  expect(cli(["strait", "add", "--domain", "sd", "--from", "databases", "--to", "caching", "--name", "cache-aside"]).json).toMatchObject({ from: "caching", to: "databases" });

  const session = cli(["session", "start", "--domain", "sd"]).json;
  expect(session.endedAt).toBeNull();
  const verdict = cli([
    "verdict", "set", "--domain", "sd", "--target", "island:caching", "--state", "settled",
    "--confidence", "0.85", "--evidence", "cache-aside means the app populates on miss", "--rationale", "applied to a scenario",
  ]).json;
  expect(verdict).toMatchObject({ target: "island:caching", state: "settled", sessionId: session.id });

  const straitVerdict = cli([
    "verdict", "set", "--domain", "sd", "--target", "strait:caching~databases", "--state", "sandbar", "--confidence", "0.6", "--evidence", "roughly",
  ]).json;
  expect(straitVerdict.target).toBe("strait:caching~databases");

  const snap = cli(["snapshot", "--domain", "sd"]).json;
  expect(snap.islands.map((i: any) => i.slug)).toEqual(["caching", "databases"]);
  expect(snap.islands[0].verdict.state).toBe("settled");
  expect(snap.islands[0].hasChildren).toBe(true);
  expect(snap.straits[0].verdict.state).toBe("sandbar");
  expect(snap.nearestOpenWater).toEqual(["databases"]);

  const inner = cli(["snapshot", "--domain", "sd", "--scale", "caching"]).json;
  expect(inner.scale.path).toEqual([{ slug: "caching", name: "Caching" }]);
  expect(inner.islands.map((i: any) => i.slug)).toEqual(["cache-eviction"]);

  expect(cli(["verdict", "history", "--domain", "sd", "--target", "island:caching"]).json.history).toHaveLength(1);
  expect(cli(["island", "show", "--domain", "sd", "--slug", "caching"]).json).toMatchObject({ slug: "caching", children: ["cache-eviction"] });
  expect(cli(["island", "list", "--domain", "sd"]).json.islands.map((i: any) => i.slug)).toEqual(["caching", "databases"]);
  expect(cli(["island", "list", "--domain", "sd", "--parent", "caching"]).json.islands).toHaveLength(1);

  const ended = cli(["session", "end", "--domain", "sd", "--summary", "charted caching"]).json;
  expect(ended.summary).toBe("charted caching");
  expect(cli(["session", "show", "--domain", "sd"]).json.active).toBeNull();
});

test("focus and comments round trip", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  expect(cli(["focus", "set", "--domain", "sd", "--island", "caching"]).json.focus).toBe("caching");
  expect(cli(["focus", "show", "--domain", "sd"]).json.focus).toBe("caching");
  expect(cli(["focus", "set", "--domain", "sd", "--clear"]).json.focus).toBeNull();

  const db = openDatabase(dbPath);
  const domain = requireDomain(db, "sd");
  const island = requireIsland(db, domain.id, "caching");
  addComment(db, { domainId: domain.id, targetType: "island", targetId: island.id, body: "", kind: "probe_me" });
  addComment(db, { domainId: domain.id, targetType: "island", targetId: island.id, body: "not a reef", kind: "dispute" });
  db.close();

  const unread = cli(["comment", "list", "--domain", "sd", "--unread"]).json.comments;
  expect(unread.map((c: any) => [c.kind, c.target])).toEqual([["probe_me", "island:caching"], ["dispute", "island:caching"]]);
  expect(cli(["comment", "mark-read", "--domain", "sd", "--id", String(unread[0].id)]).json.marked).toBe(1);
  expect(cli(["comment", "list", "--domain", "sd", "--unread"]).json.comments).toHaveLength(1);
  expect(cli(["comment", "mark-read", "--domain", "sd", "--all"]).json.marked).toBe(1);
  expect(cli(["comment", "list", "--domain", "sd"]).json.comments).toHaveLength(2);
});

test("errors carry valid slugs and exit 1", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  const miss = cli(["verdict", "set", "--domain", "sd", "--target", "island:nope", "--state", "settled", "--confidence", "0.9", "--evidence", "q"]);
  expect(miss.code).toBe(1);
  expect(miss.json).toEqual({ error: 'no island "nope" in this domain', valid: ["caching"] });
  const badState = cli(["verdict", "set", "--domain", "sd", "--target", "island:caching", "--state", "open", "--confidence", "0.9", "--evidence", "q"]);
  expect(badState.code).toBe(1);
  expect(badState.json.error).toContain("state");
  cli(["island", "add", "--domain", "sd", "--slug", "cache-eviction", "--name", "Eviction", "--parent", "caching"]);
  const nonSibling = cli(["strait", "add", "--domain", "sd", "--from", "caching", "--to", "cache-eviction"]);
  expect(nonSibling.code).toBe(1);
  expect(nonSibling.json.error).toContain("siblings");
  expect(cli(["domain", "show", "--slug", "nope"]).json).toEqual({ error: 'no domain "nope"', valid: ["sd"] });
});

test("--stdin merges a JSON object under the flags", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  const result = cli(["island", "add", "--domain", "sd", "--stdin"], { slug: "queues", name: "Queues", summary: "Async work." });
  expect(result.code).toBe(0);
  expect(result.json).toMatchObject({ slug: "queues", summary: "Async work." });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/cli.test.ts`
Expected: FAIL (the spawned CLI does not exist; `json` is null).

- [ ] **Step 3: Write targets.ts and io.ts**

`src/core/targets.ts`:

```ts
import type { Database } from "bun:sqlite";
import { ArchipelagoError } from "./errors.ts";
import { requireIsland } from "./repositories/islandRepository.ts";
import { requireStrait } from "./repositories/straitRepository.ts";
import type { CommentTargetType, Domain, VerdictTargetType } from "./types.ts";
import { parseTarget } from "./validators.ts";

export type ResolvedVerdictTarget = { targetType: VerdictTargetType; targetId: number; label: string };

/** `island:<slug>` or `strait:<a>~<b>` → row id, or NotFoundError with valid slugs. */
export function resolveVerdictTarget(db: Database, domainId: number, target: string): ResolvedVerdictTarget {
  const parsed = parseTarget(target);
  if (parsed.type === "island") {
    const island = requireIsland(db, domainId, parsed.slug);
    return { targetType: "island", targetId: island.id, label: `island:${island.slug}` };
  }
  const a = requireIsland(db, domainId, parsed.from);
  const b = requireIsland(db, domainId, parsed.to);
  const strait = requireStrait(db, a, b);
  return { targetType: "strait", targetId: strait.id, label: `strait:${a.slug}~${b.slug}` };
}

/** Comment targets arrive as slugs from the page: island slug, `a~b`, or the domain slug. */
export function resolveCommentTarget(
  db: Database,
  domain: Domain,
  targetType: CommentTargetType,
  targetId: string,
): { targetType: CommentTargetType; targetId: number } {
  if (targetType === "domain") return { targetType, targetId: domain.id };
  if (targetType === "island") return { targetType, targetId: requireIsland(db, domain.id, targetId).id };
  const [from, to] = targetId.split("~");
  if (!from || !to) throw new ArchipelagoError(`strait targetId must be "<a>~<b>", got "${targetId}"`);
  const a = requireIsland(db, domain.id, from);
  const b = requireIsland(db, domain.id, to);
  return { targetType, targetId: requireStrait(db, a, b).id };
}
```

`src/cli/io.ts`:

```ts
import { z } from "zod";
import { ArchipelagoError } from "../core/errors.ts";

export async function readStdinJson(): Promise<Record<string, unknown>> {
  const text = await Bun.stdin.text();
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ArchipelagoError("stdin JSON must be an object");
  }
  return parsed as Record<string, unknown>;
}

export function emit(value: unknown, forceCompact: boolean): void {
  const pretty = process.stdout.isTTY && !forceCompact;
  process.stdout.write(JSON.stringify(value, null, pretty ? 2 : 0) + "\n");
}

export function fail(error: unknown, forceCompact: boolean): never {
  let payload: unknown;
  if (error instanceof ArchipelagoError) payload = error.toJSON();
  else if (error instanceof z.ZodError) {
    payload = { error: error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  } else if (error instanceof Error) payload = { error: error.message };
  else payload = { error: String(error) };
  emit(payload, forceCompact);
  process.exit(1);
}
```

- [ ] **Step 4: Write the CLI**

`src/cli/index.ts`:

```ts
#!/usr/bin/env bun
import { Command } from "commander";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../core/db.ts";
import {
  domainInputSchema, islandInputSchema, islandUpdateSchema, straitInputSchema, verdictInputSchema,
  sessionEndInputSchema, slugSchema,
} from "../core/validators.ts";
import { listDomains, requireDomain, upsertDomain } from "../core/repositories/domainRepository.ts";
import {
  getIslandById, islandPath, listIslands, requireIsland, updateIsland, upsertIsland,
} from "../core/repositories/islandRepository.ts";
import { listStraits, upsertStrait } from "../core/repositories/straitRepository.ts";
import { addVerdict, latestVerdict, latestVerdicts, verdictHistory } from "../core/repositories/verdictRepository.ts";
import { activeSession, endSession, listSessions, startSession } from "../core/repositories/sessionRepository.ts";
import { markCommentsRead } from "../core/repositories/commentRepository.ts";
import { getViewState, setFocus } from "../core/repositories/viewStateRepository.ts";
import { buildSnapshot, listCommentViews } from "../core/view-model.ts";
import { resolveVerdictTarget } from "../core/targets.ts";
import { emit, fail, readStdinJson } from "./io.ts";
import { startServer } from "../server/index.ts";

type Opts = Record<string, unknown>;

function withDb<T>(fn: (db: Database) => T): T {
  const db = openDatabase();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Wraps an action: merges --stdin JSON under the flags, emits JSON, maps errors to exit 1. */
function run(action: (options: Opts) => unknown) {
  return async (options: Opts) => {
    const compact = Boolean(options.json);
    try {
      const { stdin, json: _json, ...flags } = options;
      const merged = stdin ? { ...(await readStdinJson()), ...flags } : flags;
      emit(await action(merged), compact);
    } catch (error) {
      fail(error, compact);
    }
  };
}

const common = (cmd: Command) => cmd.option("--json", "compact JSON output").option("--stdin", "merge a JSON object from stdin");

const program = new Command();
program.name("archipelago").description("Chart what you understand about a domain, as islands in open water.").version("0.1.0");

// ---- domain ----
const domain = program.command("domain").description("Domains (one per archipelago)");
common(domain.command("add").option("--slug <slug>").option("--name <name>")).action(
  run((o) => withDb((db) => upsertDomain(db, domainInputSchema.parse(o)))),
);
common(domain.command("list")).action(run(() => withDb((db) => ({ domains: listDomains(db) }))));
common(domain.command("show").option("--slug <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.slug));
      return {
        ...d,
        islands: listIslands(db, d.id, null).map((i) => i.slug),
        activeSession: activeSession(db, d.id),
        version: getViewState(db, d.id).version,
      };
    }),
  ),
);

// ---- island ----
const island = program.command("island").description("Islands and islets");
common(
  island.command("add")
    .option("--domain <slug>").option("--slug <slug>").option("--name <name>")
    .option("--summary <text>").option("--parent <slug>", "make this an islet of that island").option("--order <n>"),
).action(
  run((o) =>
    withDb((db) => {
      const input = islandInputSchema.parse(o);
      const d = requireDomain(db, input.domain);
      const parent = input.parent ? requireIsland(db, d.id, input.parent) : null;
      return upsertIsland(db, {
        domainId: d.id, slug: input.slug, name: input.name, summary: input.summary ?? null,
        parentId: parent ? parent.id : null, sortOrder: input.order ?? null,
      });
    }),
  ),
);
common(
  island.command("update").option("--domain <slug>").option("--slug <slug>").option("--name <name>").option("--summary <text>").option("--order <n>"),
).action(
  run((o) =>
    withDb((db) => {
      const input = islandUpdateSchema.parse(o);
      const d = requireDomain(db, input.domain);
      return updateIsland(db, d.id, input.slug, { name: input.name, summary: input.summary, sortOrder: input.order });
    }),
  ),
);
common(island.command("list").option("--domain <slug>").option("--parent <slug>", "list the islets of this island")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const parent = o.parent ? requireIsland(db, d.id, slugSchema.parse(o.parent)) : null;
      const islands = listIslands(db, d.id, parent ? parent.id : null);
      const verdicts = latestVerdicts(db, "island", islands.map((i) => i.id));
      return {
        scale: parent ? parent.slug : null,
        islands: islands.map((i) => ({ ...i, state: verdicts.get(i.id)?.state ?? null })),
      };
    }),
  ),
);
common(island.command("show").option("--domain <slug>").option("--slug <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const i = requireIsland(db, d.id, slugSchema.parse(o.slug));
      return {
        ...i,
        path: islandPath(db, i.id).map((p) => p.slug),
        children: listIslands(db, d.id, i.id).map((c) => c.slug),
        verdict: latestVerdict(db, "island", i.id),
        history: verdictHistory(db, "island", i.id),
      };
    }),
  ),
);

// ---- strait ----
const strait = program.command("strait").description("Straits between sibling islands");
common(strait.command("add").option("--domain <slug>").option("--from <slug>").option("--to <slug>").option("--name <name>").option("--summary <text>")).action(
  run((o) =>
    withDb((db) => {
      const input = straitInputSchema.parse(o);
      const d = requireDomain(db, input.domain);
      const a = requireIsland(db, d.id, input.from);
      const b = requireIsland(db, d.id, input.to);
      const s = upsertStrait(db, { domainId: d.id, fromIslandId: a.id, toIslandId: b.id, name: input.name ?? null, summary: input.summary ?? null });
      const from = getIslandById(db, s.fromIslandId)!;
      const to = getIslandById(db, s.toIslandId)!;
      return { ...s, from: from.slug, to: to.slug };
    }),
  ),
);
common(strait.command("list").option("--domain <slug>").option("--parent <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const parent = o.parent ? requireIsland(db, d.id, slugSchema.parse(o.parent)) : null;
      const straits = listStraits(db, d.id, parent ? parent.id : null);
      const verdicts = latestVerdicts(db, "strait", straits.map((s) => s.id));
      return {
        straits: straits.map((s) => ({
          ...s,
          from: getIslandById(db, s.fromIslandId)!.slug,
          to: getIslandById(db, s.toIslandId)!.slug,
          state: verdicts.get(s.id)?.state ?? null,
        })),
      };
    }),
  ),
);

// ---- verdict ----
const verdict = program.command("verdict").description("Append a verdict or read history");
common(
  verdict.command("set")
    .option("--domain <slug>").option("--target <target>", "island:<slug> or strait:<a>~<b>")
    .option("--state <state>", "sandbar | settled | mountainous | reef").option("--confidence <n>", "0..1")
    .option("--evidence <quote>", "the user's own words").option("--rationale <text>"),
).action(
  run((o) =>
    withDb((db) => {
      const input = verdictInputSchema.parse(o);
      const d = requireDomain(db, input.domain);
      const target = resolveVerdictTarget(db, d.id, input.target);
      const session = activeSession(db, d.id);
      const v = addVerdict(db, {
        targetType: target.targetType, targetId: target.targetId, state: input.state, confidence: input.confidence,
        evidence: input.evidence, rationale: input.rationale ?? null, sessionId: session ? session.id : null,
      });
      return { ...v, target: target.label };
    }),
  ),
);
common(verdict.command("history").option("--domain <slug>").option("--target <target>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const target = resolveVerdictTarget(db, d.id, String(o.target ?? ""));
      return { target: target.label, history: verdictHistory(db, target.targetType, target.targetId) };
    }),
  ),
);

// ---- session ----
const session = program.command("session").description("Charting sittings");
common(session.command("start").option("--domain <slug>")).action(
  run((o) => withDb((db) => startSession(db, requireDomain(db, slugSchema.parse(o.domain)).id))),
);
common(session.command("end").option("--domain <slug>").option("--summary <text>")).action(
  run((o) =>
    withDb((db) => {
      const input = sessionEndInputSchema.parse(o);
      return endSession(db, requireDomain(db, input.domain).id, input.summary);
    }),
  ),
);
common(session.command("show").option("--domain <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      return { active: activeSession(db, d.id), recent: listSessions(db, d.id).slice(0, 5) };
    }),
  ),
);

// ---- focus ----
const focus = program.command("focus").description("The island the map has selected");
common(focus.command("show").option("--domain <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const state = getViewState(db, d.id);
      const i = state.focusIslandId === null ? null : getIslandById(db, state.focusIslandId);
      return { focus: i ? i.slug : null, path: i ? islandPath(db, i.id).map((p) => p.slug) : [] };
    }),
  ),
);
common(focus.command("set").option("--domain <slug>").option("--island <slug>").option("--clear", "clear the focus")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const i = o.clear ? null : requireIsland(db, d.id, slugSchema.parse(o.island));
      const state = setFocus(db, d.id, i ? i.id : null);
      return { focus: i ? i.slug : null, version: state.version };
    }),
  ),
);

// ---- comment ----
const comment = program.command("comment").description("Comments the map sent back");
common(comment.command("list").option("--domain <slug>").option("--unread", "only unread")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      return { comments: listCommentViews(db, d.id, Boolean(o.unread)) };
    }),
  ),
);
common(
  comment.command("mark-read").option("--domain <slug>").option("--id <n...>", "comment ids").option("--all", "every unread comment"),
).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const ids = o.all ? ("all" as const) : (o.id as string[] | undefined)?.map(Number) ?? [];
      return { marked: markCommentsRead(db, d.id, ids) };
    }),
  ),
);

// ---- snapshot ----
common(program.command("snapshot").description("What the map shows at one scale").option("--domain <slug>").option("--scale <slug>", "island to look inside")).action(
  run((o) => withDb((db) => buildSnapshot(db, slugSchema.parse(o.domain), o.scale ? slugSchema.parse(o.scale) : null))),
);

// ---- serve ----
program
  .command("serve")
  .description("Start the map server and open the browser")
  .option("--port <n>", "port", "4480")
  .option("--domain <slug>", "domain to open")
  .option("--no-open", "do not open the browser")
  .action((o: { port: string; domain?: string; open: boolean }) => {
    const server = startServer({ port: Number(o.port) });
    const url = `http://127.0.0.1:${server.port}/${o.domain ? `?domain=${encodeURIComponent(o.domain)}` : ""}`;
    console.log(`Archipelago map: ${url}`);
    if (o.open) Bun.spawn(["open", url]);
  });

program.parseAsync(process.argv);
```

Note: `startServer` is written in Task 11. Until then, create `src/server/index.ts` with the Task 11 content in the same commit, or temporarily stub it:

```ts
// src/server/index.ts (temporary stub, replaced in Task 11)
export function startServer(_options: { port?: number } = {}): { port: number } {
  throw new Error("server not implemented yet");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/cli/cli.test.ts`
Expected: 4 pass. If `stdin` as a `Uint8Array` is rejected by `Bun.spawnSync`, wrap it: `stdin: new Blob([JSON.stringify(stdin)])`.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
chmod +x src/cli/index.ts          # bun link execs this file directly; the shebang needs the exec bit
git add src/core/targets.ts src/cli src/server/index.ts tests/cli
git commit -m "feat(cli): archipelago command surface"
```

---

### Task 11: Server and routes

**Files:**
- Create: `src/server/routes.ts`, replace stub `src/server/index.ts`
- Test: `tests/server/routes.test.ts`

**Interfaces:**
- Consumes: `buildSnapshot`, `listDomains`, `requireDomain`, `getViewState`, `setFocus`, `addComment`, `verdictHistory`, `resolveVerdictTarget`, `resolveCommentTarget`, validators.
- Produces: `handleRequest(req: Request, ctx: ServerContext): Promise<Response>`, `startServer({ port?, host?, dbPath?, staticRoot? }): Server`, `DEFAULT_STATIC_ROOT`.

Routes (spec §6, plus `history` for the island card):

| Route | Body / query | Response |
|---|---|---|
| `GET /api/domains` | | `{ domains: Domain[] }` |
| `GET /api/version?domain=` | | `{ version }` |
| `GET /api/snapshot?domain=&scale=` | | `Snapshot` |
| `GET /api/history?domain=&target=` | `target` = `island:<slug>` or `strait:<a>~<b>` | `{ target, history: Verdict[] }` |
| `POST /api/focus` | `{ domain, island: slug \| null }` | `{ focus, version }` |
| `POST /api/comment` | `{ domain, targetType, targetId, body, kind }` | `{ comment, version }` |
| anything else `GET` | | static file from `staticRoot`, `Cache-Control: no-cache` |

Errors: `NotFoundError` → 404, other `ArchipelagoError`/`ZodError` → 400, unknown → 500, all as `{ error, valid? }`.

- [ ] **Step 1: Write the failing test**

`tests/server/routes.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server/index.ts";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait } from "../../src/core/repositories/straitRepository.ts";
import { addVerdict } from "../../src/core/repositories/verdictRepository.ts";

let dir: string;
let server: ReturnType<typeof startServer>;
let base: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-srv-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>map</title>");
  const dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  const a = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const b = upsertIsland(db, { domainId, slug: "databases", name: "Databases" });
  upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id });
  addVerdict(db, { targetType: "island", targetId: a.id, state: "settled", confidence: 0.9, evidence: "q" });
  db.close();
  server = startServer({ port: 0, dbPath, staticRoot: dir });
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, json: await res.json() };
};
const post = async (path: string, body: unknown) => {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};

test("domains, version, snapshot", async () => {
  expect((await get("/api/domains")).json.domains.map((d: any) => d.slug)).toEqual(["sd"]);
  const v1 = (await get("/api/version?domain=sd")).json.version;
  expect(v1).toBeGreaterThan(0);
  const snap = (await get("/api/snapshot?domain=sd")).json;
  expect(snap.islands.map((i: any) => i.slug)).toEqual(["caching", "databases"]);
  expect(snap.nearestOpenWater).toEqual(["databases"]);
  expect((await get("/api/snapshot?domain=sd&scale=caching")).json.islands).toEqual([]);
});

test("focus and comment write rows and bump the version", async () => {
  const v1 = (await get("/api/version?domain=sd")).json.version;
  const focus = await post("/api/focus", { domain: "sd", island: "caching" });
  expect(focus.status).toBe(200);
  expect(focus.json.focus).toBe("caching");
  expect(focus.json.version).toBe(v1 + 1);
  const comment = await post("/api/comment", { domain: "sd", targetType: "strait", targetId: "databases~caching", body: "", kind: "probe_me" });
  expect(comment.status).toBe(200);
  expect(comment.json.comment.kind).toBe("probe_me");
  expect(comment.json.version).toBe(v1 + 2);
  const snap = (await get("/api/snapshot?domain=sd")).json;
  expect(snap.focus).toBe("caching");
  expect(snap.unreadComments).toBe(1);
});

test("history for the island card", async () => {
  const res = await get("/api/history?domain=sd&target=island:caching");
  expect(res.status).toBe(200);
  expect(res.json.history).toHaveLength(1);
  expect(res.json.history[0].state).toBe("settled");
});

test("errors map to status codes with { error }", async () => {
  expect((await get("/api/snapshot?domain=nope")).status).toBe(404);
  expect((await get("/api/snapshot?domain=nope")).json).toEqual({ error: 'no domain "nope"', valid: ["sd"] });
  expect((await post("/api/comment", { domain: "sd", targetType: "island", targetId: "caching", kind: "shout" })).status).toBe(400);
  expect((await post("/api/focus", { domain: "sd", island: "nope" })).status).toBe(404);
  expect((await get("/api/nothing")).status).toBe(404);
});

test("static files are served fresh and traversal is blocked", async () => {
  const res = await fetch(base + "/");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-cache");
  expect(await res.text()).toContain("map");
  expect((await fetch(base + "/../package.json")).status).toBe(404);
  expect((await fetch(base + "/missing.js")).status).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/routes.test.ts`
Expected: FAIL ("server not implemented yet" from the stub).

- [ ] **Step 3: Write routes.ts and index.ts**

`src/server/routes.ts`:

```ts
import type { Database } from "bun:sqlite";
import { normalize, resolve, sep } from "node:path";
import { z } from "zod";
import { openDatabase } from "../core/db.ts";
import { ArchipelagoError, NotFoundError } from "../core/errors.ts";
import { commentInputSchema, focusInputSchema, slugSchema } from "../core/validators.ts";
import { listDomains, requireDomain } from "../core/repositories/domainRepository.ts";
import { requireIsland } from "../core/repositories/islandRepository.ts";
import { verdictHistory } from "../core/repositories/verdictRepository.ts";
import { addComment } from "../core/repositories/commentRepository.ts";
import { getViewState, setFocus } from "../core/repositories/viewStateRepository.ts";
import { buildSnapshot } from "../core/view-model.ts";
import { resolveCommentTarget, resolveVerdictTarget } from "../core/targets.ts";

export type ServerContext = { dbPath?: string; staticRoot: string };

export async function handleRequest(req: Request, ctx: ServerContext): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, url, ctx);
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    return await serveStatic(url.pathname, ctx.staticRoot);
  } catch (error) {
    return errorResponse(error);
  }
}

function withDb<T>(ctx: ServerContext, fn: (db: Database) => T): T {
  const db = openDatabase(ctx.dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function handleApi(req: Request, url: URL, ctx: ServerContext): Promise<Response> {
  const route = `${req.method} ${url.pathname}`;
  const q = (name: string) => url.searchParams.get(name);

  if (route === "GET /api/domains") return json({ domains: withDb(ctx, listDomains) });

  if (route === "GET /api/version") {
    const slug = slugSchema.parse(q("domain"));
    return json(withDb(ctx, (db) => ({ version: getViewState(db, requireDomain(db, slug).id).version })));
  }

  if (route === "GET /api/snapshot") {
    const slug = slugSchema.parse(q("domain"));
    const scale = q("scale");
    return json(withDb(ctx, (db) => buildSnapshot(db, slug, scale ? slugSchema.parse(scale) : null)));
  }

  if (route === "GET /api/history") {
    const slug = slugSchema.parse(q("domain"));
    const target = q("target") ?? "";
    return json(
      withDb(ctx, (db) => {
        const d = requireDomain(db, slug);
        const t = resolveVerdictTarget(db, d.id, target);
        return { target: t.label, history: verdictHistory(db, t.targetType, t.targetId) };
      }),
    );
  }

  if (route === "POST /api/focus") {
    const input = focusInputSchema.parse(await req.json());
    return json(
      withDb(ctx, (db) => {
        const d = requireDomain(db, input.domain);
        const island = input.island === null ? null : requireIsland(db, d.id, input.island);
        const state = setFocus(db, d.id, island ? island.id : null);
        return { focus: island ? island.slug : null, version: state.version };
      }),
    );
  }

  if (route === "POST /api/comment") {
    const input = commentInputSchema.parse(await req.json());
    return json(
      withDb(ctx, (db) => {
        const d = requireDomain(db, input.domain);
        const target = resolveCommentTarget(db, d, input.targetType, input.targetId);
        const comment = addComment(db, { domainId: d.id, ...target, body: input.body, kind: input.kind });
        return { comment, version: getViewState(db, d.id).version };
      }),
    );
  }

  return json({ error: `no route ${route}` }, 404);
}

async function serveStatic(pathname: string, staticRoot: string): Promise<Response> {
  const rootPath = resolve(staticRoot);
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(rootPath, normalize(requested));
  if (!filePath.startsWith(rootPath + sep)) return new Response("Not found", { status: 404 });
  const file = Bun.file(filePath);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, { headers: { "Cache-Control": "no-cache" } });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function errorResponse(error: unknown): Response {
  if (error instanceof NotFoundError) return json(error.toJSON(), 404);
  if (error instanceof ArchipelagoError) return json(error.toJSON(), 400);
  if (error instanceof z.ZodError) {
    return json({ error: error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, 400);
  }
  if (error instanceof SyntaxError) return json({ error: "invalid JSON body" }, 400);
  return json({ error: error instanceof Error ? error.message : String(error) }, 500);
}
```

`src/server/index.ts` (replaces the stub):

```ts
import { fileURLToPath } from "node:url";
import { openDatabase } from "../core/db.ts";
import { handleRequest, type ServerContext } from "./routes.ts";

export const DEFAULT_STATIC_ROOT = fileURLToPath(new URL("../web/", import.meta.url));

export type ServerOptions = { port?: number; host?: string; dbPath?: string; staticRoot?: string };

/** Migrates the database up front (a broken migration fails here, not on first request), then serves. */
export function startServer(options: ServerOptions = {}) {
  const ctx: ServerContext = { dbPath: options.dbPath, staticRoot: options.staticRoot ?? DEFAULT_STATIC_ROOT };
  openDatabase(ctx.dbPath).close();
  return Bun.serve({
    hostname: options.host ?? "127.0.0.1",
    port: options.port ?? 4480,
    idleTimeout: 120,
    fetch: (req) => handleRequest(req, ctx),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/routes.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Smoke the launcher**

Run (in one terminal, then Ctrl-C):

```bash
mkdir -p src/web && printf '<!doctype html><title>Archipelago</title><p>map goes here</p>' > src/web/index.html
bun run src/cli/index.ts serve --no-open
```

Expected: prints `Archipelago map: http://127.0.0.1:4480/`; `curl -s http://127.0.0.1:4480/api/domains` returns `{"domains":[]}` (the real page arrives in Task 12; keep this placeholder file only until then).

- [ ] **Step 6: Run the whole suite and typecheck, then commit**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass.

```bash
git add src/server tests/server src/web/index.html
git commit -m "feat(server): JSON API, static serving and launcher"
```

---

### Task 12: Map page — rendering and live refresh

**Files:**
- Create: `src/web/index.html` (replaces the Task 11 placeholder), `src/web/styles.css`, `src/web/view-model.js`, `src/web/layout.js`, `src/web/camera.js`, `src/web/draw.js`, `src/web/app.js`
- Test: `tests/web/view-model.test.js`

**Interfaces:**
- Consumes: `GET /api/domains`, `GET /api/version`, `GET /api/snapshot` from Task 11.
- Produces (for Task 13): `app.js` exports `app` (state object), `api(path, init)`, `refresh()`, `setScale(slug | null)`, `hitTest(px, py)`; `app.listeners` is a `Set` of callbacks invoked with each new snapshot. `view-model.js` exports `buildNodes`, `buildLinks`, `hashSeed`, `seededRandom`, `islandState`, `rollupMass`, `STATE_MASS`. `camera.js` exports `createCamera()` with `state`, `apply`, `toWorld`, `panBy`, `zoomAt`, `animateTo`, `tick`, `framing`. `layout.js` exports `createSimulation()` with `tick`, `setGraph(nodes, links, heat = 1)`, `setCenter`, `reheat`, `alpha`. `draw.js` exports `clear`, `drawIsland`, `drawStrait`, `PALETTE`.

No framework, no bundler: the server serves these files as-is. Node shape: `{ slug, name, island, state, mass, radius, seed, x, y, vx, vy, pinned, changedAt }`. Link shape: `{ source, target, strait, state }`.

- [ ] **Step 1: Write the failing test for the pure module**

`tests/web/view-model.test.js`:

```js
import { test, expect } from "bun:test";
import { hashSeed, seededRandom, rollupMass, buildNodes, buildLinks, STATE_MASS } from "../../src/web/view-model.js";

const island = (slug, verdict = null, byState = { sandbar: 0, settled: 0, mountainous: 0, reef: 0, open: 0 }) => ({
  slug, name: slug, summary: null, hasChildren: Object.values(byState).some(Boolean), verdict,
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

test("rollupMass uses own verdict, else the heaviest child state, else open", () => {
  expect(rollupMass(island("a", { state: "mountainous" }))).toBe(STATE_MASS.mountainous);
  expect(rollupMass(island("a", null, { sandbar: 1, settled: 2, mountainous: 0, reef: 0, open: 3 }))).toBe(STATE_MASS.settled);
  expect(rollupMass(island("a"))).toBe(STATE_MASS.open);
});

test("buildNodes seeds positions stably and keeps previous positions", () => {
  const first = buildNodes(snapshot([island("caching"), island("queues")]), 1000, 800);
  const again = buildNodes(snapshot([island("caching"), island("queues")]), 1000, 800);
  expect(first.map((n) => [n.x, n.y])).toEqual(again.map((n) => [n.x, n.y]));
  const previous = new Map(first.map((n) => [n.slug, { ...n, x: 5, y: 6, state: "open" }]));
  const next = buildNodes(snapshot([island("caching", { state: "settled" }), island("queues")]), 1000, 800, previous);
  expect(next[0].x).toBe(5);
  expect(next[0].state).toBe("settled");
  expect(next[0].changedAt).toBeGreaterThan(0);
  expect(next[1].changedAt).toBe(previous.get("queues").changedAt);
});

test("buildLinks joins nodes by slug and skips unknown ends", () => {
  const nodes = buildNodes(snapshot([island("a"), island("b")]), 800, 600);
  const links = buildLinks(snapshot([], [{ from: "a", to: "b", name: null, verdict: { state: "reef" } }, { from: "a", to: "zzz", name: null, verdict: null }]), nodes);
  expect(links).toHaveLength(1);
  expect(links[0].source.slug).toBe("a");
  expect(links[0].state).toBe("reef");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/web/view-model.test.js`
Expected: FAIL, cannot resolve `view-model.js`.

- [ ] **Step 3: Write view-model.js**

`src/web/view-model.js`:

```js
// Pure helpers: snapshot → drawable nodes and links. No DOM.

export const STATE_MASS = { open: 1, sandbar: 1.5, settled: 2.5, mountainous: 4, reef: 2.5 };

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

/** Own verdict wins; a parent with none takes the heaviest child state; otherwise open. */
export function rollupMass(island) {
  if (island.verdict) return STATE_MASS[island.verdict.state];
  let mass = STATE_MASS.open;
  for (const s of ["sandbar", "settled", "mountainous", "reef"]) {
    if (island.children.byState[s] > 0) mass = Math.max(mass, STATE_MASS[s]);
  }
  return mass;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function buildNodes(snapshot, width, height, previous = new Map()) {
  return snapshot.islands.map((island) => {
    const prev = previous.get(island.slug);
    const rnd = seededRandom(hashSeed(snapshot.domain.slug + "/" + island.slug));
    const mass = rollupMass(island);
    const state = islandState(island);
    return {
      slug: island.slug,
      name: island.name,
      island,
      state,
      mass,
      radius: 22 + 9 * mass,
      seed: hashSeed(island.slug),
      x: prev ? prev.x : width * (0.25 + 0.5 * rnd()),
      y: prev ? prev.y : height * (0.25 + 0.5 * rnd()),
      vx: prev ? prev.vx : 0,
      vy: prev ? prev.vy : 0,
      pinned: prev ? prev.pinned : false,
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
Expected: 4 pass.

- [ ] **Step 5: Write layout.js and camera.js**

`src/web/layout.js`:

```js
// Force layout in the spirit of mindgraph's gravity-field model:
// mass-scaled repulsion, strait springs, soft centre gravity. Runs while alpha > 0.

const REPULSION = 2600;
const SPRING = 0.03;
const CENTER = 0.005;
const DAMPING = 0.8;
const MIN_GAP = 48;
const REST_GAP = 110;

export function createSimulation() {
  let nodes = [];
  let links = [];
  let alpha = 0;
  const center = { x: 0, y: 0 };

  /** Replace the graph. `heat` is the starting alpha: 1 for a new scale, lower for a quiet refresh. */
  function setGraph(newNodes, newLinks, heat = 1) {
    nodes = newNodes;
    links = newLinks;
    alpha = heat;
  }
  function setCenter(x, y) {
    center.x = x;
    center.y = y;
  }
  function reheat(value = 0.5) {
    alpha = Math.max(alpha, value);
  }

  function tick() {
    if (alpha <= 0.002) {
      alpha = 0;
      return false;
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = 1;
          dy = 0;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const gap = a.radius + b.radius + MIN_GAP;
        let f = (REPULSION * a.mass * b.mass) / d2;
        if (d < gap) f += (gap - d) * 0.6;
        const fx = (dx / d) * f * alpha;
        const fy = (dy / d) * f * alpha;
        a.vx -= fx / a.mass;
        a.vy -= fy / a.mass;
        b.vx += fx / b.mass;
        b.vy += fy / b.mass;
      }
    }
    for (const l of links) {
      const a = l.source;
      const b = l.target;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = a.radius + b.radius + REST_GAP;
      const f = (d - rest) * SPRING * alpha;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx / a.mass;
      a.vy += fy / a.mass;
      b.vx -= fx / b.mass;
      b.vy -= fy / b.mass;
    }
    let movement = 0;
    for (const n of nodes) {
      n.vx += (center.x - n.x) * CENTER * alpha;
      n.vy += (center.y - n.y) * CENTER * alpha;
      if (n.pinned) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
      movement += Math.abs(n.vx) + Math.abs(n.vy);
    }
    alpha *= 0.99;
    if (nodes.length && movement / nodes.length < 0.03) alpha = 0;
    return true;
  }

  return {
    tick,
    setGraph,
    setCenter,
    reheat,
    get alpha() {
      return alpha;
    },
  };
}
```

`src/web/camera.js`:

```js
// Pan/zoom camera with a short eased animation. World → screen is (x * scale + cam.x).

export function createCamera() {
  const cam = { x: 0, y: 0, scale: 1 };
  let anim = null;

  return {
    state: cam,
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
      const next = Math.min(4, Math.max(0.3, cam.scale * factor));
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
    /** The camera state that centres world point (wx, wy) in a (w × h) viewport at `scale`. */
    framing(wx, wy, w, h, scale) {
      return { x: w / 2 - wx * scale, y: h / 2 - wy * scale, scale };
    },
  };
}
```

- [ ] **Step 6: Write draw.js**

`src/web/draw.js`:

```js
import { seededRandom } from "./view-model.js";

export const PALETTE = {
  water: "#1a1816",
  text: "#ede8e3",
  muted: "#8f877f",
  sand: "#d9c7a3",
  land: "#c9a87c",
  ridge: "#8a6e4b",
  reef: "#a3452e",
  spotlight: "#f2d9a8",
  channel: "#4a4038",
};

const RISE_MS = 600;

export function clear(ctx, w, h) {
  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(0, 0, w, h);
}

/** A blobby coastline: 14 points at seeded radii, always the same shape for the same island. */
function outline(node, scale) {
  const rnd = seededRandom(node.seed);
  const pts = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const r = node.radius * scale * (0.78 + 0.32 * rnd());
    pts.push({ x: node.x + Math.cos(angle) * r, y: node.y + Math.sin(angle) * r });
  }
  return pts;
}

function tracePath(ctx, pts) {
  const n = pts.length;
  const mid = (i) => ({ x: (pts[i % n].x + pts[(i + 1) % n].x) / 2, y: (pts[i % n].y + pts[(i + 1) % n].y) / 2 });
  ctx.beginPath();
  const m0 = mid(0);
  ctx.moveTo(m0.x, m0.y);
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    const m = mid(i);
    ctx.quadraticCurveTo(p.x, p.y, m.x, m.y);
  }
  ctx.closePath();
}

export function drawIsland(ctx, node, { dim = false, spotlight = false, now = 0 } = {}) {
  const t = node.changedAt ? Math.min(1, (now - node.changedAt) / RISE_MS) : 1;
  const ease = 1 - Math.pow(1 - t, 3);
  const grow = 0.6 + 0.4 * ease;
  const state = node.state;
  const hasOwnVerdict = Boolean(node.island.verdict);

  ctx.save();
  ctx.globalAlpha = (dim ? 0.28 : 1) * (0.35 + 0.65 * ease);
  if (spotlight) {
    ctx.shadowColor = PALETTE.spotlight;
    ctx.shadowBlur = 24;
  }

  if (state === "open") {
    tracePath(ctx, outline(node, grow));
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = PALETTE.muted;
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (state === "sandbar") {
    tracePath(ctx, outline(node, grow * 0.8));
    ctx.fillStyle = PALETTE.sand;
    const keep = ctx.globalAlpha;
    ctx.globalAlpha = keep * 0.6;
    ctx.fill();
    ctx.globalAlpha = keep;
  } else {
    tracePath(ctx, outline(node, grow));
    ctx.fillStyle = PALETTE.land;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (state === "mountainous") {
      for (const s of [0.66, 0.4]) {
        tracePath(ctx, outline(node, grow * s));
        ctx.strokeStyle = PALETTE.ridge;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      tracePath(ctx, outline(node, grow * 0.22));
      ctx.fillStyle = PALETTE.ridge;
      ctx.fill();
    }
    if (state === "reef") drawReef(ctx, node, grow);
  }
  ctx.shadowBlur = 0;

  if (!hasOwnVerdict && node.island.children.total > 0) drawRollup(ctx, node, grow);
  drawLabel(ctx, node, grow, hasOwnVerdict);
  ctx.restore();
}

/** A jagged reef line across the land plus a hazard glyph: never mistakable for open water. */
function drawReef(ctx, node, grow) {
  const r = node.radius * grow;
  ctx.beginPath();
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const x = node.x - r * 1.1 + (2.2 * r * i) / steps;
    const y = node.y + (i % 2 ? -1 : 1) * r * 0.16 - r * 0.1;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = PALETTE.reef;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.stroke();

  const gx = node.x + r * 0.85;
  const gy = node.y - r * 0.85;
  ctx.beginPath();
  ctx.moveTo(gx, gy - 8);
  ctx.lineTo(gx + 7, gy + 5);
  ctx.lineTo(gx - 7, gy + 5);
  ctx.closePath();
  ctx.fillStyle = PALETTE.reef;
  ctx.fill();
  ctx.fillStyle = PALETTE.water;
  ctx.font = "bold 9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", gx, gy + 1);
}

/** Ring of dots around a parent with no verdict of its own: one dot per islet, coloured by state. */
function drawRollup(ctx, node, grow) {
  const by = node.island.children.byState;
  const dots = [];
  for (const s of ["mountainous", "settled", "sandbar", "reef", "open"]) for (let i = 0; i < by[s]; i++) dots.push(s);
  const r = node.radius * grow + 9;
  const fill = { reef: PALETTE.reef, sandbar: PALETTE.sand, mountainous: PALETTE.ridge, settled: PALETTE.land };
  dots.forEach((s, i) => {
    const a = -Math.PI / 2 + (i / dots.length) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(node.x + Math.cos(a) * r, node.y + Math.sin(a) * r, 3, 0, Math.PI * 2);
    if (s === "open") {
      ctx.strokeStyle = PALETTE.muted;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = fill[s];
      ctx.fill();
    }
  });
}

function drawLabel(ctx, node, grow, hasOwnVerdict) {
  ctx.font = "13px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = node.state === "open" ? PALETTE.muted : PALETTE.text;
  const offset = !hasOwnVerdict && node.island.children.total > 0 ? 18 : 8;
  ctx.fillText(node.name, node.x, node.y + node.radius * grow + offset);
}

export function drawStrait(ctx, link, { dim = false } = {}) {
  const a = link.source;
  const b = link.target;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const x1 = a.x + ux * a.radius * 0.9;
  const y1 = a.y + uy * a.radius * 0.9;
  const x2 = b.x - ux * b.radius * 0.9;
  const y2 = b.y - uy * b.radius * 0.9;

  ctx.save();
  ctx.globalAlpha = dim ? 0.2 : 0.9;
  ctx.lineCap = "round";
  if (link.state === "reef") {
    const steps = Math.max(6, Math.floor(d / 14));
    const nx = -uy;
    const ny = ux;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const off = (i % 2 ? 1 : -1) * 4;
      const x = x1 + (x2 - x1) * t + nx * off;
      const y = y1 + (y2 - y1) * t + ny * off;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = PALETTE.reef;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    if (link.state === "open") {
      ctx.setLineDash([4, 8]);
      ctx.strokeStyle = PALETTE.channel;
      ctx.lineWidth = 1.2;
    } else if (link.state === "sandbar") {
      ctx.strokeStyle = PALETTE.sand;
      ctx.lineWidth = 1.2;
    } else if (link.state === "settled") {
      ctx.strokeStyle = PALETTE.land;
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = PALETTE.land;
      ctx.lineWidth = 3.5;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
```

- [ ] **Step 7: Write index.html and styles.css**

`src/web/index.html` (overwrite the placeholder):

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Archipelago</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<canvas id="map"></canvas>

<header class="chrome top">
  <nav id="breadcrumb" class="breadcrumb" aria-label="Scale"></nav>
  <div id="status" class="status"></div>
</header>

<aside id="card" class="card" hidden></aside>

<footer class="chrome bottom">
  <div class="legend">
    <span class="open">open water</span>
    <span class="sandbar">sandbar</span>
    <span class="settled">settled</span>
    <span class="mountainous">mountainous</span>
    <span class="reef">reef</span>
  </div>
  <div id="strip" class="strip"></div>
</footer>

<script type="module" src="/app.js"></script>
</body>
</html>
```

`src/web/styles.css`:

```css
:root {
  --water: #1a1816; --text: #ede8e3; --muted: #8f877f;
  --sand: #d9c7a3; --land: #c9a87c; --ridge: #8a6e4b; --reef: #a3452e;
  --panel: #221f1c; --line: #3a342f;
}
html, body { margin: 0; height: 100%; background: var(--water); color: var(--text);
  font: 14px/1.5 system-ui, -apple-system, sans-serif; overflow: hidden; }
#map { position: fixed; inset: 0; display: block; cursor: grab; }
#map.dragging { cursor: grabbing; }
#map.hover { cursor: pointer; }

.chrome { position: fixed; left: 0; right: 0; display: flex; justify-content: space-between;
  padding: 16px 20px; pointer-events: none; }
.chrome > * { pointer-events: auto; }
.top { top: 0; align-items: flex-start; }
.bottom { bottom: 0; align-items: flex-end; }

.breadcrumb { display: flex; align-items: center; gap: 8px; font-family: Georgia, serif; font-size: 18px; }
.crumb { background: none; border: 0; color: var(--muted); font: inherit; cursor: pointer; padding: 0; }
.crumb:hover { color: var(--text); }
.crumb:disabled { color: var(--text); cursor: default; }
.sep { color: var(--line); }
.status { font-size: 12px; color: var(--muted); }
.status.off { color: var(--reef); }

.legend { display: flex; gap: 14px; font-size: 12px; color: var(--muted); }
.legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 50%;
  margin-right: 6px; vertical-align: middle; box-sizing: border-box; }
.legend .open::before { border: 1px dashed var(--muted); }
.legend .sandbar::before { background: var(--sand); opacity: .7; }
.legend .settled::before { background: var(--land); }
.legend .mountainous::before { background: var(--ridge); }
.legend .reef::before { background: var(--land); box-shadow: inset 0 -3px 0 var(--reef); }

.strip { display: flex; gap: 24px; font-size: 12px; }
.strip-item { display: flex; flex-direction: column; gap: 2px; text-align: right; }
.strip-label { color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-size: 10px; }

.card { position: fixed; top: 64px; right: 20px; width: 320px; max-height: calc(100vh - 160px); overflow: auto;
  background: var(--panel); border-radius: 10px; padding: 18px 20px; box-shadow: 0 12px 32px rgba(0, 0, 0, .4); }
.card h2 { margin: 0 0 4px; font: 20px Georgia, serif; }
.card .state { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); margin-bottom: 12px; }
.card .state.reef { color: var(--reef); }
.card blockquote { margin: 8px 0; padding-left: 12px; border-left: 2px solid var(--line); font-family: Georgia, serif; font-style: italic; }
.card .muted { color: var(--muted); font-size: 12px; }
.card .actions { display: flex; gap: 8px; margin: 14px 0; flex-wrap: wrap; }
.card button { background: var(--land); color: var(--water); border: 0; border-radius: 6px; padding: 6px 10px;
  font: inherit; font-size: 12px; cursor: pointer; }
.card button.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
.card .note { display: flex; gap: 6px; margin-top: 8px; }
.card .note input { flex: 1; background: var(--water); border: 1px solid var(--line); border-radius: 6px;
  color: var(--text); padding: 6px 8px; font: inherit; font-size: 12px; }
.card .note select { background: var(--water); color: var(--text); border: 1px solid var(--line); border-radius: 6px; font-size: 12px; }
.card .history { margin: 12px 0 0; padding-left: 16px; font-size: 12px; color: var(--muted); }
.card .history li { margin: 2px 0; }
.card .sent { color: var(--sand); font-size: 12px; margin-top: 6px; }
```

- [ ] **Step 8: Write app.js**

`src/web/app.js`:

```js
import { buildNodes, buildLinks } from "./view-model.js";
import { createSimulation } from "./layout.js";
import { createCamera } from "./camera.js";
import { clear, drawIsland, drawStrait } from "./draw.js";

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const params = new URLSearchParams(location.search);

export const app = {
  domain: params.get("domain"),
  scale: params.get("scale"),
  snapshot: null,
  nodes: [],
  links: [],
  hover: null,      // slug under the pointer
  selected: null,   // slug with the card open
  connected: true,
  version: null,
  sim: createSimulation(),
  camera: createCamera(),
  size: { w: 0, h: 0, dpr: 1 },
  listeners: new Set(), // called with each new snapshot (Task 13 subscribes the card)
};

export async function api(path, init) {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  app.size = { w: window.innerWidth, h: window.innerHeight, dpr };
  canvas.width = Math.round(app.size.w * dpr);
  canvas.height = Math.round(app.size.h * dpr);
  canvas.style.width = app.size.w + "px";
  canvas.style.height = app.size.h + "px";
  app.sim.setCenter(app.size.w / 2, app.size.h / 2);
  app.sim.reheat(0.3);
}

/** Change scale (null = top level), update the URL, and refetch. */
export function setScale(slug) {
  app.scale = slug;
  app.selected = null;
  app.hover = null;
  const url = new URL(location.href);
  if (slug) url.searchParams.set("scale", slug);
  else url.searchParams.delete("scale");
  history.replaceState(null, "", url);
  app.version = null;
  return refresh();
}

export async function refresh() {
  const query = `domain=${encodeURIComponent(app.domain)}${app.scale ? `&scale=${encodeURIComponent(app.scale)}` : ""}`;
  applySnapshot(await api(`/api/snapshot?${query}`));
}

function samePath(a, b) {
  return a.scale.path.map((p) => p.slug).join("/") === b.scale.path.map((p) => p.slug).join("/");
}

function applySnapshot(snapshot) {
  const sameScale = app.snapshot !== null && samePath(app.snapshot, snapshot);
  const previous = sameScale ? new Map(app.nodes.map((n) => [n.slug, n])) : new Map();
  app.snapshot = snapshot;
  app.version = snapshot.version;
  app.nodes = buildNodes(snapshot, app.size.w, app.size.h, previous);
  app.links = buildLinks(snapshot, app.nodes);
  app.sim.setGraph(app.nodes, app.links, sameScale ? 0.25 : 1);
  if (!sameScale) app.camera.animateTo({ x: 0, y: 0, scale: 1 }, 400);
  renderChrome();
  for (const fn of app.listeners) fn(snapshot);
}

async function poll() {
  try {
    const { version } = await api(`/api/version?domain=${encodeURIComponent(app.domain)}`);
    app.connected = true;
    if (version !== app.version) await refresh();
  } catch {
    app.connected = false;
  }
  renderStatus();
}

/** The node under a screen point, or null. */
export function hitTest(px, py) {
  const { x, y } = app.camera.toWorld(px, py);
  let best = null;
  let bestD = Infinity;
  for (const n of app.nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < n.radius + 6 && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

function renderChrome() {
  renderBreadcrumb();
  renderStrip();
  renderStatus();
}

function renderBreadcrumb() {
  const nav = document.getElementById("breadcrumb");
  const s = app.snapshot;
  if (!s) return;
  const parts = [{ slug: null, name: s.domain.name }, ...s.scale.path];
  nav.replaceChildren();
  parts.forEach((p, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "›";
      nav.append(sep);
    }
    const b = document.createElement("button");
    b.className = "crumb";
    b.textContent = p.name;
    b.disabled = i === parts.length - 1;
    b.addEventListener("click", () => setScale(p.slug));
    nav.append(b);
  });
}

function stripItem(label, value) {
  const el = document.createElement("div");
  el.className = "strip-item";
  const l = document.createElement("span");
  l.className = "strip-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.textContent = value;
  el.append(l, v);
  return el;
}

function renderStrip() {
  const strip = document.getElementById("strip");
  const s = app.snapshot;
  if (!s) return;
  const nameOf = (slug) => s.islands.find((i) => i.slug === slug)?.name ?? slug;
  const open = s.nearestOpenWater.slice(0, 4).map(nameOf);
  const reefs = s.reefs.map((r) => (r.startsWith("island:") ? nameOf(r.slice(7)) : r.replace("strait:", "strait ")));
  strip.replaceChildren(
    stripItem("Nearest open water", open.length ? open.join(" · ") : "none at this scale"),
    stripItem("Reefs", reefs.length ? reefs.join(" · ") : "none charted"),
  );
  if (s.unreadComments) strip.append(stripItem("Unread", `${s.unreadComments} for Claude`));
}

function renderStatus() {
  const el = document.getElementById("status");
  el.textContent = app.connected ? "" : "disconnected — showing the last chart";
  el.classList.toggle("off", !app.connected);
}

function frame(now) {
  app.sim.tick();
  app.camera.tick(now);
  const { w, h, dpr } = app.size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clear(ctx, w, h);
  app.camera.apply(ctx, dpr);

  const focusSlug = app.hover || app.selected;
  const near = new Set();
  if (focusSlug) {
    near.add(focusSlug);
    for (const l of app.links) {
      if (l.source.slug === focusSlug) near.add(l.target.slug);
      if (l.target.slug === focusSlug) near.add(l.source.slug);
    }
  }
  for (const l of app.links) {
    drawStrait(ctx, l, { dim: Boolean(focusSlug) && !(near.has(l.source.slug) && near.has(l.target.slug)) });
  }
  for (const n of app.nodes) {
    drawIsland(ctx, n, { dim: Boolean(focusSlug) && !near.has(n.slug), spotlight: n.slug === focusSlug, now });
  }
  requestAnimationFrame(frame);
}

async function boot() {
  if (!app.domain) {
    const { domains } = await api("/api/domains");
    if (domains.length === 0) {
      document.getElementById("breadcrumb").textContent = "No domains yet — run: archipelago domain add --slug <slug> --name <name>";
      return;
    }
    app.domain = domains[0].slug;
    const url = new URL(location.href);
    url.searchParams.set("domain", app.domain);
    history.replaceState(null, "", url);
  }
  resize();
  window.addEventListener("resize", resize);
  try {
    await refresh();
  } catch (error) {
    app.connected = false;
    renderStatus();
    console.error(error);
  }
  setInterval(poll, 2000);
  requestAnimationFrame(frame);
}

boot();
```

- [ ] **Step 9: Seed a sample archipelago and look at it**

```bash
A="bun run src/cli/index.ts"
$A domain add --slug sd --name "System Design"
$A island add --domain sd --slug caching --name Caching --summary "Keeping hot data close." --order 1
$A island add --domain sd --slug databases --name Databases --order 2
$A island add --domain sd --slug queues --name Queues --order 3
$A island add --domain sd --slug load-balancing --name "Load balancing" --order 4
$A island add --domain sd --slug consensus --name Consensus --order 5
$A island add --domain sd --slug cache-eviction --name Eviction --parent caching
$A island add --domain sd --slug cache-invalidation --name Invalidation --parent caching
$A strait add --domain sd --from caching --to databases --name cache-aside
$A strait add --domain sd --from databases --to queues
$A strait add --domain sd --from queues --to load-balancing
$A session start --domain sd
$A verdict set --domain sd --target island:databases --state mountainous --confidence 0.9 --evidence "explained why B-trees favour range scans"
$A verdict set --domain sd --target island:queues --state reef --confidence 0.8 --evidence "exactly-once delivery is a broker setting"
$A verdict set --domain sd --target island:cache-eviction --state settled --confidence 0.85 --evidence "LRU vs LFU trade-off"
$A verdict set --domain sd --target strait:caching~databases --state sandbar --confidence 0.6 --evidence "cache-aside, roughly"
$A serve --domain sd
```

Expected in the browser:
- Five islands at the top scale. Databases is a large landmass with contour rings. Queues shows the jagged reef line and hazard glyph. Caching has no fill of its own but a ring of two dots (one land for Eviction, one open outline for Invalidation) and is labelled below. Load balancing and Consensus are dashed outlines.
- The caching–databases strait is a thin pale line; the two other straits are dashed.
- Breadcrumb reads "System Design". Strip reads "Nearest open water: Caching · Load balancing · Consensus" (caching neighbours the mountainous databases so it comes first) and "Reefs: Queues".
- In another terminal run `$A verdict set --domain sd --target island:consensus --state sandbar --confidence 0.6 --evidence "raft has a leader"`; within two seconds Consensus fills as sand and rises.
- Stop the server; within two seconds the top-right shows "disconnected — showing the last chart". Restart it; the message clears.

- [ ] **Step 10: Run the whole suite and commit**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass.

```bash
git add src/web tests/web
git commit -m "feat(web): canvas archipelago with live refresh"
```

---

### Task 13: Map page — interactions, island card, comments, zoom

**Files:**
- Create: `src/web/interactions.js`, `src/web/card.js`
- Modify: `src/web/app.js` (two imports, two calls in `boot()`)

**Interfaces:**
- Consumes: `app`, `api`, `hitTest`, `setScale` from `app.js`; `POST /api/focus`, `POST /api/comment`, `GET /api/history`.
- Produces: `installInteractions(canvas)` and `select(slug | null)` in `interactions.js`; `installCard()` in `card.js`.

Behaviour (spec §7):
- Hover spotlights an island and dims the rest (already drawn by `frame()`; this task sets `app.hover`).
- Click selects: sets `app.selected`, posts focus, opens the card. Click on water or Escape clears both.
- Drag on water pans. Drag an island moves it (pinned while dragging). Wheel zooms around the pointer.
- Double-click an island that has islets sails in (`setScale`).
- Card: name, state, summary, evidence quote, rationale, confidence and date, roll-up counts for a parent, buttons **Probe this** (`probe_me`) and either **Sail in** (has islets) or **Sail closer** (`sail_closer`), a note box posting `note` or `dispute`, and earlier verdicts from `/api/history`.
- The card survives refreshes: the note draft and the last "sent" line are kept in module state and restored on re-render.

- [ ] **Step 1: Write interactions.js**

`src/web/interactions.js`:

```js
import { app, api, hitTest, setScale } from "./app.js";

/** Selects an island (or null), re-renders listeners, and posts focus so "this one" works in the terminal. */
export async function select(slug) {
  if (slug === app.selected) return;
  app.selected = slug;
  for (const fn of app.listeners) fn(app.snapshot);
  try {
    await api("/api/focus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: app.domain, island: slug }),
    });
  } catch (error) {
    console.error(error);
  }
}

export function installInteractions(canvas) {
  let drag = null; // { kind: "pan" | "node", node, lastX, lastY, moved }

  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 0) drag.moved = true;
      if (drag.kind === "pan") {
        app.camera.panBy(dx, dy);
      } else {
        const w = app.camera.toWorld(e.clientX, e.clientY);
        drag.node.x = w.x;
        drag.node.y = w.y;
        drag.node.pinned = true;
        app.sim.reheat(0.4);
      }
      return;
    }
    const hit = hitTest(e.clientX, e.clientY);
    const slug = hit ? hit.slug : null;
    if (slug !== app.hover) {
      app.hover = slug;
      canvas.classList.toggle("hover", Boolean(slug));
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    const hit = hitTest(e.clientX, e.clientY);
    drag = { kind: hit ? "node" : "pan", node: hit, lastX: e.clientX, lastY: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
  });

  canvas.addEventListener("pointerup", (e) => {
    canvas.classList.remove("dragging");
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === "node") {
      d.node.pinned = false;
      app.sim.reheat(0.2);
    }
    if (d.moved) return;
    const hit = hitTest(e.clientX, e.clientY);
    void select(hit ? hit.slug : null);
  });

  canvas.addEventListener("pointerleave", () => {
    app.hover = null;
    canvas.classList.remove("hover");
  });

  canvas.addEventListener("dblclick", (e) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit && hit.island.hasChildren) void setScale(hit.slug);
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      app.camera.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") void select(null);
  });
}
```

- [ ] **Step 2: Write card.js**

`src/web/card.js`:

```js
import { app, api, setScale } from "./app.js";

const card = document.getElementById("card");
let draft = "";                 // note text survives re-renders
let lastSent = null;            // { slug, text } shown under the note box
let renderId = 0;               // guards the async history append against stale renders

export function installCard() {
  app.listeners.add(() => render());
  render();
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, className) {
  const b = el("button", className, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

const SENT_TEXT = {
  probe_me: "Asked Claude to probe this island next.",
  sail_closer: "Asked Claude to chart this island's coastline.",
  note: "Note sent. Claude reads it at the start of the next turn.",
  dispute: "Dispute sent. Claude will reopen this verdict.",
};

async function sendComment(island, kind, body) {
  try {
    await api("/api/comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: app.domain, targetType: "island", targetId: island.slug, body, kind }),
    });
    lastSent = { slug: island.slug, text: SENT_TEXT[kind] };
  } catch (error) {
    lastSent = { slug: island.slug, text: `Could not send: ${error.message}` };
  }
  render();
}

function render() {
  const s = app.snapshot;
  const island = s && app.selected ? s.islands.find((i) => i.slug === app.selected) : null;
  if (!island) {
    card.hidden = true;
    card.replaceChildren();
    return;
  }
  card.hidden = false;
  card.replaceChildren();

  card.append(el("h2", null, island.name));
  const stateText = island.verdict ? island.verdict.state : island.children.total ? "open water · islets below" : "open water";
  const state = el("div", "state", stateText);
  if (island.verdict && island.verdict.state === "reef") state.classList.add("reef");
  card.append(state);
  if (island.summary) card.append(el("p", "muted", island.summary));

  if (island.verdict) {
    card.append(el("blockquote", null, `“${island.verdict.evidence}”`));
    if (island.verdict.rationale) card.append(el("p", "muted", island.verdict.rationale));
    card.append(el("p", "muted", `confidence ${Math.round(island.verdict.confidence * 100)}% · ${island.verdict.at.slice(0, 10)}`));
  } else if (island.children.total) {
    const b = island.children.byState;
    card.append(
      el("p", "muted", `${island.children.total} islets: ${b.mountainous} mountainous, ${b.settled} settled, ${b.sandbar} sandbar, ${b.reef} reef, ${b.open} open`),
    );
  } else {
    card.append(el("p", "muted", "Unsurveyed. Ask Claude to probe it, or leave a note."));
  }

  const actions = el("div", "actions");
  actions.append(button("Probe this", () => sendComment(island, "probe_me", "")));
  if (island.hasChildren) actions.append(button("Sail in", () => setScale(island.slug), "ghost"));
  else actions.append(button("Sail closer", () => sendComment(island, "sail_closer", ""), "ghost"));
  card.append(actions);

  const note = el("form", "note");
  const input = el("input");
  input.placeholder = "a note or a dispute for Claude";
  input.value = draft;
  input.addEventListener("input", () => (draft = input.value));
  const kind = el("select");
  for (const k of ["note", "dispute"]) {
    const o = el("option", null, k);
    o.value = k;
    kind.append(o);
  }
  const send = button("Send", null);
  send.type = "submit";
  note.append(input, kind, send);
  note.addEventListener("submit", (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    draft = "";
    void sendComment(island, kind.value, body);
  });
  card.append(note);

  if (lastSent && lastSent.slug === island.slug) card.append(el("div", "sent", lastSent.text));

  void renderHistory(island, ++renderId);
}

async function renderHistory(island, id) {
  try {
    const { history } = await api(`/api/history?domain=${encodeURIComponent(app.domain)}&target=island:${encodeURIComponent(island.slug)}`);
    if (id !== renderId || app.selected !== island.slug || history.length < 2) return;
    const list = el("ul", "history");
    for (const v of history.slice(1)) {
      list.append(el("li", null, `earlier: ${v.state} · ${v.createdAt.slice(0, 10)} · “${v.evidence}”`));
    }
    card.append(list);
  } catch (error) {
    console.error(error);
  }
}
```

- [ ] **Step 3: Wire both into app.js**

In `src/web/app.js`, add after the existing imports:

```js
import { installInteractions } from "./interactions.js";
import { installCard } from "./card.js";
```

and in `boot()`, replace

```js
  resize();
  window.addEventListener("resize", resize);
```

with

```js
  resize();
  window.addEventListener("resize", resize);
  installInteractions(canvas);
  installCard();
```

(The import cycle `app.js ↔ interactions.js` is safe: both only use each other's exports inside functions called after module evaluation.)

- [ ] **Step 4: Verify by hand against the seeded domain**

Start `bun run src/cli/index.ts serve --domain sd` (seed from Task 12 step 9 if the database is empty) and check:

1. Hover Databases: it glows, others dim, the cursor is a pointer. Move away: everything returns.
2. Click Databases: card opens with "mountainous", the evidence quote, confidence and date. In the terminal `bun run src/cli/index.ts focus show --domain sd` prints `{"focus":"databases",...}`.
3. Click Queues: state line reads "reef" in reef colour. Click Probe this: the line "Asked Claude to probe this island next." appears; `comment list --domain sd --unread` shows a `probe_me` on `island:queues`; the bottom strip shows "Unread 1 for Claude" within two seconds and the card is still open with the sent line.
4. Type "not a reef, I meant at-least-once" with kind `dispute`, Send: a second unread comment with that body.
5. Click Caching (it has islets): card shows the roll-up counts and a Sail in button. Sail in: breadcrumb reads "System Design › Caching", the map shows Eviction (settled) and Invalidation (open). Click "System Design" in the breadcrumb: back to the top scale. Double-click Caching does the same as Sail in.
6. Click Consensus (no islets): Sail closer sends a `sail_closer` comment.
7. Drag water: the map pans. Wheel: zooms around the pointer. Drag an island: it follows and settles when released. Escape closes the card.
8. In the terminal, `verdict set --domain sd --target island:queues --state settled --confidence 0.9 --evidence "clarified at-least-once"`: within two seconds the reef line disappears, the island rises as land, and the card (if Queues is selected) shows the new verdict with the earlier reef listed under history.

- [ ] **Step 5: Run the whole suite and commit**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass.

```bash
git add src/web
git commit -m "feat(web): hover, select, card, comments and sail-in"
```

---

### Task 14: Charting skill, README, CLAUDE.md

**Files:**
- Create: `.claude/skills/archipelago-chart/SKILL.md`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the full CLI surface from Tasks 10–11.
- Produces: the protocol Claude follows in the terminal (spec §4), and the project orientation docs.

- [ ] **Step 1: Write the skill**

`.claude/skills/archipelago-chart/SKILL.md`:

````markdown
---
name: archipelago-chart
description: Use when the user wants to chart, probe, survey, or map what they understand about a domain with Archipelago — naming a domain, sketching its islands, running a charting conversation, recording verdicts (sandbar, settled, mountainous, reef), reading comments from the map, or sailing closer into an island.
---

# Archipelago charting

You are the surveyor. The conversation is not the record; the database is. Every verdict goes through the `archipelago` CLI, and the map in the browser redraws within two seconds of each write.

Run the CLI from the project root as `bun run src/cli/index.ts …` (or `archipelago …` after `bun link`). Every command prints JSON. Errors exit 1 with `{ "error", "valid" }`, where `valid` lists the slugs you could have used. Slugs are lowercase kebab-case and unique per domain.

## Vocabulary

| Term | Meaning |
|---|---|
| domain | the whole archipelago, e.g. `system-design` |
| island | a concept; islets are islands with a `--parent` |
| strait | how two sibling islands relate |
| open water | no verdict yet. Never a state you write. |
| sandbar | rough but correct |
| settled | solid: explains and applies |
| mountainous | deep: handles an edge case, knows why the naive approach fails |
| reef | a confident, specific, wrong claim |
| scale | depth in the tree; the map shows one scale at a time |

## 0. The map

If the user has not opened it, start it once in the background and tell them the URL:

```bash
bun run src/cli/index.ts serve --domain <slug>
```

## 1. Setup: a new domain

When the user names a domain that does not exist (`domain list`):

1. Propose 6–10 top-level islands, each with a slug, a name, and a one-line summary, and the straits between islands that neighbour each other conceptually. Print the sketch as a table.
2. Wait for the user to approve or edit it. Do not write before that.
3. Write it:

```bash
A="bun run src/cli/index.ts"
$A domain add --slug system-design --name "System Design"
$A island add --domain system-design --slug caching --name Caching --summary "Keeping hot data close to where it is read." --order 1
$A island add --domain system-design --slug databases --name Databases --summary "…" --order 2
$A strait add --domain system-design --from caching --to databases --name cache-aside
```

The sketch is now stable: later sittings read it from the database and never regenerate it.

## 2. Every turn, before anything else

```bash
$A session show --domain <slug>        # if .active is null:
$A session start --domain <slug>
$A comment list --domain <slug> --unread
$A focus show --domain <slug>
```

Handle each unread comment, then `comment mark-read --domain <slug> --all`:

- `probe_me` → your next probe goes to that target, at its current depth.
- `sail_closer` → sketch that island's islets (section 7).
- `dispute` → reopen that verdict: acknowledge the body, ask one question about the disputed point, then record a new verdict. History keeps the old one.
- `note` → read it and acknowledge it in one line.

If `focus show` returns an island, "this one" / "that island" in the user's words means that island.

## 3. Probe, don't quiz

One island per probe. Ask the user to **explain** it in their own words, **apply** it to a concrete scenario you describe, or **predict** what happens in a situation. Never ask for a definition, never ask yes/no, never list options for them to pick from. Read the gaps in the explanation. At most two follow-ups per island before you move on.

Tone: a knowledgeable peer curious how they think. Short questions. No praise inflation, no exam language.

## 4. Classify, then write

| State | Test |
|---|---|
| sandbar | The shape is right, but a scenario or "why" question exposed a missing layer. |
| settled | Explained correctly and applied it to your scenario. |
| mountainous | Also handled an edge case you raised, or explained why the naive approach fails. |
| reef | A confident, specific claim that is wrong, and you can name what breaks because of it. |

Confidence below 0.6: ask one more question instead of writing. Evidence is a verbatim quote from the user's answer. Rationale is one sentence naming which test decided it.

```bash
$A verdict set --domain <slug> --target island:caching --state settled --confidence 0.85 \
  --evidence "the app checks the cache first and on a miss reads the database and writes the cache" \
  --rationale "applied cache-aside to the product-page scenario correctly"
```

A verdict on an island says nothing about its islets. If the island has islets, say so when you summarise.

## 5. The reef rule

A reef is written only when you can state (a) the specific false claim and (b) a concrete consequence, both in the rationale. If you cannot, record a sandbar. The map treats a reef as a hazard, so a false reef is worse than a missed one.

## 6. Straits

When two neighbouring islands both have verdicts, ask one question about how they relate ("when would you reach for X instead of Y?"). Record it on the strait with the same states:

```bash
$A verdict set --domain <slug> --target strait:caching~databases --state sandbar --confidence 0.6 \
  --evidence "you cache reads, the database is for writes" --rationale "shape right, missed invalidation"
```

## 7. Sailing closer

When the user asks to go closer, or a `sail_closer` comment arrives, sketch that island's islets exactly as in Setup: 4–8 islets with slugs that do not collide with any slug in the domain (prefix with the parent when in doubt, e.g. `caching-invalidation`), plus straits between neighbouring islets. Show the sketch, get approval, then write with `--parent <island-slug>`. Verdicts on islets land at that depth automatically. If the island has no verdict yet, suggest charting it first, but do what the user asks.

## 8. Ending a sitting

```bash
$A session end --domain <slug> --summary "<one paragraph: what was charted, reefs found, where to sail next>"
$A snapshot --domain <slug>
```

Then give the user an orientation in prose, at the current scale: the islands they stand on, the sandbars, any reef, and the nearest open water (the snapshot's `nearestOpenWater` lists it in order).

## Command reference

```
domain   add --slug --name | list | show --slug
island   add --domain --slug --name [--summary] [--parent] [--order]
         update --domain --slug [--name] [--summary] [--order]
         list --domain [--parent] | show --domain --slug
strait   add --domain --from --to [--name] [--summary] | list --domain [--parent]
verdict  set --domain --target island:<slug>|strait:<a>~<b> --state --confidence --evidence [--rationale]
         history --domain --target
session  start --domain | end --domain --summary | show --domain
focus    show --domain | set --domain --island <slug> | set --domain --clear
comment  list --domain [--unread] | mark-read --domain [--id n ...] [--all]
snapshot --domain [--scale <island-slug>]
serve    [--port 4480] [--domain <slug>] [--no-open]
```

Add `--stdin` to any command to merge a JSON object from stdin under the flags.
````

- [ ] **Step 2: Write README.md and CLAUDE.md**

`README.md`:

```markdown
# Archipelago

A conversational tool for charting what you understand about a domain, shown as islands in open water.

You talk to Claude in the Claude Code terminal. A charting skill drives a CLI that records five-state verdicts into a local SQLite file. A map in the browser redraws within two seconds and can send comments back to the session.

Read `docs/BRIEF.md` for the idea and `docs/superpowers/specs/2026-09-03-archipelago-slice1-design.md` for how this slice is built.

## Quick start

Requires [Bun](https://bun.sh) and [Claude Code](https://claude.ai/code).

```bash
bun install
bun link                        # once: puts `archipelago` on your PATH
archipelago serve               # starts the map at http://127.0.0.1:4480 and opens it
```

Then in Claude Code, inside this directory:

> /archipelago-chart — I want to chart System Design.

Claude sketches the archipelago, you approve it, and the charting conversation begins. Watch the map fill in.

## The five states

| State | Meaning | On the map |
|---|---|---|
| open water | not yet assessed | dashed outline |
| sandbar | rough but correct | low sand |
| settled | solid | land |
| mountainous | deep | land with ridges |
| reef | a misconception | land broken by a jagged reef line and a hazard glyph |

Open water is never a low score. A reef never looks like a gap.

## From the map

Click an island to select it (the terminal then knows which one "this one" is). The card offers **Probe this**, **Sail closer** (or **Sail in** when the island already has islets), and a note box for notes and disputes. Claude reads them at the start of its next turn.

## Layout

```
src/core/      types, validators, migrations, repositories, view-model   (bun:sqlite)
src/cli/       the archipelago command
src/server/    Bun.serve JSON API + static files
src/web/       one-canvas map, plain ES modules
.claude/skills/archipelago-chart/SKILL.md   the charting protocol
```

## Development

```bash
bun test              # bun's test runner (Vitest cannot load bun:sqlite)
bunx tsc --noEmit     # typecheck
```

Data lives in `.archipelago/archipelago.sqlite` (gitignored). `ARCHIPELAGO_DB_PATH` overrides it.
```

`CLAUDE.md`:

```markdown
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
src/core/       types.ts, errors.ts, validators.ts, db.ts, migrate.ts, migrations/, repositories/, view-model.ts, targets.ts
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
```

- [ ] **Step 3: Check the skill is discoverable and the README commands work**

Run: `ls .claude/skills/archipelago-chart/SKILL.md && bun link && archipelago domain list`
Expected: the file exists, `bun link` registers `archipelago`, and `domain list` prints `{ "domains": [...] }`.

- [ ] **Step 4: Commit**

```bash
git add .claude README.md CLAUDE.md
git commit -m "docs: charting skill, README and CLAUDE.md"
```

---

## Plan self-review (done while writing)

- **Spec coverage.** §2 architecture → Tasks 1, 10, 11, 12. §3 data model → Tasks 1–9 (triggers in Task 1, roll-up and open-water-as-absence in Task 9). §4 protocol → Task 14. §5 CLI → Task 10 (+ `serve` in 10/11). §6 server → Task 11 (plus `/api/history` for the card). §7 map → Tasks 12–13. §8 errors → Tasks 2, 10, 11, 12 (disconnected mark). §9 tests → every task; `bun test` per the verified decision. §10 out of scope respected.
- **Type consistency.** `resolveCommentTarget` → `{ targetType, targetId }` spread into `addComment`; `formatTarget(db, targetType, targetId)`; `buildSnapshot(db, domainSlug, scaleSlug)`; `setGraph(nodes, links, heat)`; `app.listeners` is a `Set` of `(snapshot) => void`; `hitTest(px, py)`; `select(slug | null)`.
- **Known judgement calls.** Same-scale refreshes reheat the layout at 0.25 so a focus write from the page does not jiggle the map. `serve` lives in the CLI instead of a separate `cli.ts`. `/api/history` was added beyond spec §6 because the card shows verdict history. No domain switcher on the page: `GET /api/domains` only supplies a default when the URL has no `domain`, and switching means changing the URL or running `serve --domain`. The spec §7 hover "closer" hint is not drawn; the action lives in the card's **Sail closer** button only.
