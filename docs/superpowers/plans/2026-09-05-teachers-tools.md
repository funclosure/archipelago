# Teacher's Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the judge two more skills, Mermaid diagrams in its replies and structured questions with options, and give the page a bottom-centre call-to-action card for map actions, a resizable pane, and diagram rendering.

**Architecture:** An `asks` table (migration 0006) attaches 2–4 options to a judge message; the `ask_reader` tool records the ask and the route links it to the reply it stores, so the judge's acknowledgement still comes before the question. The reader's pick, or typed answer, arrives through `POST /api/probe` with `askId` and becomes the next reader message. Mermaid is an npm dependency served by the map server at `/vendor/mermaid.js`; `markdown.js` renders closed ```` ```mermaid ```` fences to SVG through `DOMParser` (never `innerHTML`). `cta.js` renders the card from state `card.js` hands it. Spec: `docs/superpowers/specs/2026-09-04-teachers-tools-design.md`; prototype: https://claude.ai/code/artifact/a251c701-2f8a-4bd2-9e1c-090be3cfa9c0.

**Tech Stack:** Bun, `bun:sqlite`, zod, `@anthropic-ai/claude-agent-sdk` tools, plain ES modules, mermaid 11 UMD.

## Global Constraints

- `bun test` only (never spawns the SDK); `bunx tsc --noEmit` clean. Migrations `0001`–`0005` frozen; the change is `src/core/migrations/0006_asks.sql`. snake_case aliased to camelCase in every select. No framework, no bundler, no `innerHTML` (SVG from Mermaid goes through `DOMParser`).
- `asks` row: `id, domain_id, island_id, message_id (nullable, → messages on delete cascade), question, options (JSON array), picked, picked_at, created_at`; index on `(island_id, id)`; insert and update triggers bump `view_state.version`. `Ask.options` is `string[]` in TypeScript.
- `ask_reader({ question, options })`: 2–4 trimmed unique non-empty options; writes the ask with `message_id` null in one transaction; returns `{ askId, note }`. When the route stores the turn's reply it attaches every unattached ask on that island to the reply message; if the reply is empty it stores the ask's question as the judge message instead. `GET /api/thread` returns `asks: Ask[]`. `POST /api/probe` accepts `askId`; with it, `message` is required and the ask is marked picked before the turn runs; a second pick → 409; unknown ask → 404.
- The judge's tool surface stays closed by `tools: []` plus `allowedTools`; `ask_reader` is added to both the MCP server and `TOOL_NAMES`.
- Protocol additions verbatim in Task 3: the Diagrams section and the Asking-with-options section; the Tools list gains `ask_reader`. Diagrams: ```` ```mermaid ```` fences with `flowchart TB`, `sequenceDiagram`, or `stateDiagram-v2`, at most one per reply, at most eight nodes, never in the opening turn. Asks: at most one per two rounds, never in the opening turn, never as the deciding round's question; after the tool returns, end the reply with the question and stop.
- Stub judge: on the reader's second answer, if no ask exists yet, asks `Stub check: which of these is true?` with options `the first option`, `the second option`, `the third option` and replies with exactly that question; a later answer equal to `the first option` lights the `shape` landmark when it exists.
- Page copy, verbatim: choices caption `choose one, or answer below` / `you chose`; foot placeholder while an ask is pending `or answer in your own words`; reef card `reef?` with `Confirm the reef` / `Dispute below`; charted card `charted` with `Sail to <name>` / `Stay here`; diagram caption `diagram`; placeholder `drawing a diagram…`; foot meta in reef mode `Confirm at the bottom of the map · Dispute sends your objection`.
- Pane: opens at 480px, grip on its left edge, drag between 340 and 760px, width shown while dragging, saved to `localStorage` under `pane-w` (try/catch), map reframed on release. `paneInset()` keeps reading the rendered width.
- Mermaid palette: `theme: "dark"`, `themeVariables` with `background #1B3F5B`, `primaryColor #245069`, `primaryTextColor #FFFFFF`, `primaryBorderColor rgba(255,255,255,.3)`, `lineColor #F5C242`, `secondaryColor #163449`, `tertiaryColor #163449`, `noteBkgColor #245069`, `noteTextColor #FFFFFF`, `actorBkg #245069`, `actorBorder rgba(255,255,255,.3)`, `actorTextColor #FFFFFF`, `signalColor #F5C242`, `signalTextColor #FFFFFF`, `edgeLabelBackground #1B3F5B`, `fontFamily system-ui, sans-serif`, `fontSize 13px`; `flowchart: { htmlLabels: false, useMaxWidth: false }`, `sequence: { useMaxWidth: false }`, `securityLevel: "strict"`.
- Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq`.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/core/migrations/0006_asks.sql`, `src/core/types.ts`, `src/core/repositories/askRepository.ts`, `src/core/validators.ts` | the ask row | 1 |
| `src/server/judge/tools.ts`, `context.ts`, `sdk.ts`, `stub.ts` | `ask_reader`, context, stub | 1 |
| `tests/core/db.test.ts`, `tests/core/askRepository.test.ts`, `tests/server/tools.test.ts`, `tests/server/stub.test.ts` | tests | 1 |
| `src/server/routes.ts`, `tests/server/routes.test.ts` | thread asks, probe askId, attach on reply | 2 |
| `src/server/judge/PROTOCOL.md`, `tests/server/protocol.test.ts`; `package.json`, `src/server/routes.ts` (vendor route), `src/web/index.html` | protocol; mermaid vendored | 3 |
| `src/web/thread.js`, `tests/web/thread.test.js`, `src/web/markdown.js`, `src/web/card.js`, `src/web/cta.js` (new), `src/web/styles.css`, `src/web/app.js` | diagrams, choices, CTA card, resize | 4 |
| `README.md`, `CLAUDE.md`, spec status and addendum | docs | 5 |

---

### Task 1: The ask row and the `ask_reader` tool

**Files:**
- Create: `src/core/migrations/0006_asks.sql`, `src/core/repositories/askRepository.ts`, `tests/core/askRepository.test.ts`
- Modify: `src/core/types.ts`, `src/core/validators.ts`, `src/server/judge/tools.ts`, `src/server/judge/context.ts`, `src/server/judge/sdk.ts`, `src/server/judge/stub.ts`
- Test: `tests/core/db.test.ts`, `tests/server/tools.test.ts`, `tests/server/stub.test.ts`

**Interfaces:**
- Produces: `Ask` type; `addAsk(db, { domainId, islandId, question, options })`, `listAsks(db, islandId)`, `requireAsk(db, domainId, id)`, `pickAsk(db, domainId, id, picked)` (ConflictError when picked), `attachAsks(db, islandId, messageId)` (returns rows attached), `pendingAsk(db, islandId)`; `askInputSchema`; `probeInputSchema.askId?`; `askReader(deps, input)`; `JudgeContext.asks`; `renderThreadPrompt(thread, asks = [])`; the `ask_reader` SDK tool; the stub's canned ask.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/db.test.ts`:

```ts
test("0006 adds asks with insert and update version triggers", () => {
  const db = openDatabase(":memory:");
  db.run("insert into domains (slug, name) values ('sd', 'System Design')");
  const domainId = db.query<{ id: number }, []>("select id from domains where slug = 'sd'").get()!.id;
  db.run("insert into islands (domain_id, slug, name) values (?, 'caching', 'Caching')", [domainId]);
  const islandId = db.query<{ id: number }, []>("select id from islands where slug = 'caching'").get()!.id;
  const version = () => db.query<{ version: number }, [number]>("select version from view_state where domain_id = ?").get(domainId)!.version;
  const v0 = version();
  db.run("insert into asks (domain_id, island_id, question, options) values (?, ?, 'which?', '[\"a\",\"b\"]')", [domainId, islandId]);
  expect(version()).toBe(v0 + 1);
  db.run("update asks set picked = 'a' where island_id = ?", [islandId]);
  expect(version()).toBe(v0 + 2);
  expect(db.query<{ message_id: number | null }, []>("select message_id from asks").get()!.message_id).toBeNull();
});
```

Create `tests/core/askRepository.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import { addAsk, listAsks, requireAsk, pickAsk, attachAsks, pendingAsk } from "../../src/core/repositories/askRepository.ts";
import { ConflictError, NotFoundError } from "../../src/core/errors.ts";

let db: Database;
let domainId: number;
let islandId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  islandId = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
});

test("an ask is stored unattached, attaches to the reply message, is picked once, and lists in order", () => {
  const a = addAsk(db, { domainId, islandId, question: "Which resource saturates first?", options: ["CPU", "Memory", "Disk"] });
  expect(a.options).toEqual(["CPU", "Memory", "Disk"]);
  expect(a.messageId).toBeNull();
  expect(a.picked).toBeNull();
  expect(pendingAsk(db, islandId)).toBeNull(); // not shown until it has a message
  const reply = addMessage(db, { domainId, islandId, role: "judge", kind: "text", body: "Before the next move: which resource saturates first?" });
  expect(attachAsks(db, islandId, reply.id)).toBe(1);
  expect(attachAsks(db, islandId, reply.id)).toBe(0);
  expect(pendingAsk(db, islandId)?.id).toBe(a.id);
  expect(requireAsk(db, domainId, a.id).messageId).toBe(reply.id);
  const picked = pickAsk(db, domainId, a.id, "Memory");
  expect(picked.picked).toBe("Memory");
  expect(picked.pickedAt).not.toBeNull();
  expect(pendingAsk(db, islandId)).toBeNull();
  expect(() => pickAsk(db, domainId, a.id, "CPU")).toThrow(ConflictError);
  expect(() => requireAsk(db, domainId, 999)).toThrow(NotFoundError);
  const other = upsertDomain(db, { slug: "other", name: "Other" }).id;
  expect(() => requireAsk(db, other, a.id)).toThrow(NotFoundError);
  const b = addAsk(db, { domainId, islandId, question: "Again?", options: ["x", "y"] });
  expect(listAsks(db, islandId).map((x) => x.id)).toEqual([a.id, b.id]);
});
```

Append to `tests/server/tools.test.ts` (extend the tools import with `askReader`, and add `import { listAsks } from "../../src/core/repositories/askRepository.ts";`):

```ts
test("ask_reader records the options unattached and rejects bad option lists", () => {
  const deps = { dbPath, domain: "sd", island: "caching" };
  const out = askReader(deps, { question: "Which resource saturates first?", options: [" CPU ", "Memory", "Disk"] });
  expect(out.askId).toBeGreaterThan(0);
  expect(out.note).toContain("choosing");
  const db = openDatabase(dbPath);
  const asks = listAsks(db, ids.caching);
  expect(asks).toHaveLength(1);
  expect(asks[0].options).toEqual(["CPU", "Memory", "Disk"]);
  expect(asks[0].messageId).toBeNull();
  expect(listMessages(db, ids.caching).filter((m) => m.role === "judge" && m.body.includes("saturates"))).toHaveLength(0); // the route stores the question with the reply
  db.close();
  expect(() => askReader(deps, { question: "?", options: ["only one"] })).toThrow();
  expect(() => askReader(deps, { question: "?", options: ["a", "a"] })).toThrow();
  expect(() => askReader(deps, { question: "?", options: ["a", "b", "c", "d", "e"] })).toThrow();
  expect(() => askReader(deps, { question: "", options: ["a", "b"] })).toThrow();
});

test("the context carries a pending ask and the thread prompt shows the options after the question", () => {
  const deps = { dbPath, domain: "sd", island: "caching" };
  askReader(deps, { question: "Which first?", options: ["a", "b"] });
  const db = openDatabase(dbPath);
  const reply = addMessage(db, { domainId: ids.domain, islandId: ids.caching, role: "judge", kind: "text", body: "Which first?" });
  attachAsks(db, ids.caching, reply.id);
  db.close();
  const ctx = islandContext(deps);
  expect(ctx.asks.map((a) => a.messageId)).toEqual([reply.id]);
  expect(renderContext(ctx)).toContain("Pending question");
  expect(renderThreadPrompt(ctx.thread, ctx.asks)).toContain("[options: a | b]");
});
```

(Also add `attachAsks` to that file's askRepository import.)

Append to `tests/server/stub.test.ts`:

```ts
test("the second answer gets a canned ask; picking the first option lights 'shape'", async () => {
  const events: JudgeEvent[] = [];
  const run = (msg?: string) => {
    if (msg) {
      const db = openDatabase(dbPath);
      addMessage(db, { domainId, islandId: caching, role: "you", kind: "text", body: msg });
      db.close();
    }
    return stubRunner({ dbPath, domain: "sd", island: "caching", emit: (e) => events.push(e) });
  };
  await run(); // opening: sets the canned landmarks
  await run("first answer");
  const asked = await run("second answer");
  expect(asked).toBe("Stub check: which of these is true?");
  const db = openDatabase(dbPath);
  const asks = listAsks(db, caching);
  expect(asks).toHaveLength(1);
  expect(asks[0].options).toEqual(["the first option", "the second option", "the third option"]);
  addMessage(db, { domainId, islandId: caching, role: "judge", kind: "text", body: asked });
  attachAsks(db, caching, listMessages(db, caching).at(-1)!.id);
  db.close();
  await run("the first option");
  const db2 = openDatabase(dbPath);
  expect(listLandmarks(db2, caching).find((l) => l.slug === "shape")?.unlockedAt).not.toBeNull();
  db2.close();
});
```

(Add `import { listAsks, attachAsks } from "../../src/core/repositories/askRepository.ts";` there.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/core/db.test.ts tests/core/askRepository.test.ts tests/server/tools.test.ts tests/server/stub.test.ts`
Expected: FAIL — no `asks` table, module not found, `askReader` not exported.

- [ ] **Step 3: Migration, type, repository, validators**

Create `src/core/migrations/0006_asks.sql`:

```sql
-- Asks: a judge question with 2–4 options. Unattached (message_id null) until the route stores the reply that carries it.
create table asks (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  message_id integer references messages(id) on delete cascade,
  question text not null,
  options text not null,
  picked text,
  picked_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index asks_island on asks(island_id, id);
create trigger asks_ai after insert on asks begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger asks_au after update on asks begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
```

In `src/core/types.ts` add:

```ts
export type Ask = {
  id: number;
  domainId: number;
  islandId: number;
  messageId: number | null;
  question: string;
  options: string[];
  picked: string | null;
  pickedAt: string | null;
  createdAt: string;
};
```

Create `src/core/repositories/askRepository.ts`:

```ts
import type { Database } from "bun:sqlite";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { Ask } from "../types.ts";

type Row = Omit<Ask, "options"> & { options: string };
const COLS = "id, domain_id as domainId, island_id as islandId, message_id as messageId, question, options, picked, picked_at as pickedAt, created_at as createdAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const parse = (r: Row): Ask => ({ ...r, options: JSON.parse(r.options) as string[] });

export type AskInsert = { domainId: number; islandId: number; question: string; options: string[] };

/** Records a question with its options, unattached: the route attaches it to the reply it stores. */
export function addAsk(db: Database, input: AskInsert): Ask {
  const row = db
    .query<Row, Record<string, string | number>>(`insert into asks (domain_id, island_id, question, options) values ($domainId, $islandId, $question, $options) returning ${COLS}`)
    .get({ $domainId: input.domainId, $islandId: input.islandId, $question: input.question, $options: JSON.stringify(input.options) })!;
  return parse(row);
}

export function listAsks(db: Database, islandId: number): Ask[] {
  return db.query<Row, [number]>(`select ${COLS} from asks where island_id = ? order by id`).all(islandId).map(parse);
}

export function requireAsk(db: Database, domainId: number, id: number): Ask {
  const row = db.query<Row, [number, number]>(`select ${COLS} from asks where id = ? and domain_id = ?`).get(id, domainId);
  if (!row) throw new NotFoundError(`no ask ${id} in this domain`);
  return parse(row);
}

/** The latest ask on the island that has a message and no pick, or null. */
export function pendingAsk(db: Database, islandId: number): Ask | null {
  const row = db
    .query<Row, [number]>(`select ${COLS} from asks where island_id = ? and message_id is not null and picked is null order by id desc limit 1`)
    .get(islandId);
  return row ? parse(row) : null;
}

/** Attaches every unattached ask on the island to the reply message. Returns how many rows changed. */
export function attachAsks(db: Database, islandId: number, messageId: number): number {
  return db.query<{ id: number }, [number, number]>(`update asks set message_id = ? where island_id = ? and message_id is null returning id`).all(messageId, islandId).length;
}

/** Records the reader's pick (an option or their own words). A second pick is a conflict. */
export function pickAsk(db: Database, domainId: number, id: number, picked: string): Ask {
  const ask = requireAsk(db, domainId, id);
  if (ask.picked !== null) throw new ConflictError(`ask ${id} was already answered`);
  return parse(db.query<Row, [string, number]>(`update asks set picked = ?, picked_at = ${NOW} where id = ? returning ${COLS}`).get(picked, id)!);
}
```

In `src/core/validators.ts` add:

```ts
export const askInputSchema = z.object({
  question: z.string().trim().min(1),
  options: z
    .array(z.string().trim().min(1))
    .min(2)
    .max(4)
    .refine((o) => new Set(o).size === o.length, { message: "options must be distinct" }),
});
```

and add to `probeInputSchema`: `askId: numberInput.pipe(z.number().int().positive()).optional(),` (`numberInput` is already defined for `reefAnswerInputSchema`).

- [ ] **Step 4: Tool, context, SDK, stub**

`src/server/judge/tools.ts`: import `askInputSchema` and `addAsk`; append:

```ts
/** Records a question with 2–4 options for the reader to choose from. The route attaches it to the reply this turn ends with. */
export function askReader(deps: ToolDeps, input: unknown): { askId: number; note: string } {
  const parsed = askInputSchema.parse(input);
  return withDb(deps.dbPath, (db) => {
    const domain = requireDomain(db, deps.domain);
    const island = requireIsland(db, domain.id, deps.island);
    const ask = addAsk(db, { domainId: domain.id, islandId: island.id, question: parsed.question, options: parsed.options });
    return { askId: ask.id, note: "the reader is choosing; end your reply with the question and stop" };
  });
}
```

`src/server/judge/context.ts`: add `asks: Ask[];` to `JudgeContext` (import `Ask` and `listAsks`); in `islandContext`'s builder set `asks: listAsks(db, island.id)`. In `renderContext`, after the pending reefs block:

```ts
  const pending = ctx.asks.find((a) => a.messageId !== null && a.picked === null);
  if (pending) lines.push(``, `Pending question (wait for the reader's choice; do not ask again): ${pending.question} — options: ${pending.options.join(" | ")}`);
```

Change `renderThreadPrompt` to `export function renderThreadPrompt(thread: Message[], asks: Ask[] = []): string` and, for a judge text message, append the options line when an ask points at it:

```ts
    const ask = asks.find((a) => a.messageId === m.id);
    const line = `${m.role === "you" ? "Reader" : "Judge"}: ${indent(m.body)}`;
    return ask ? `${line}\n  [options: ${ask.options.join(" | ")}]${ask.picked !== null ? ` [picked: ${indent(ask.picked)}]` : ""}` : line;
```

`src/server/judge/sdk.ts`: import `askReader`; add to `TOOL_NAMES`; pass `renderThreadPrompt(context.thread, context.asks)`; add to the tools array:

```ts
      sdk.tool(
        "ask_reader",
        "Ask the reader to choose: a question and 2–4 short options, one of them what they would say if they already understood. The options appear under your reply; end the reply with the question and stop.",
        { question: z.string(), options: z.array(z.string()).min(2).max(4) },
        async (args) => guard(() => askReader(deps, args)),
      ),
```

`src/server/judge/stub.ts`: import `askReader` and `listAsks`; after the `unlock` branch and before `fail`:

```ts
  const answers = ctx.thread.filter((m) => m.role === "you" && m.kind === "text").length;
  if (text === "the first option" && ctx.landmarks.some((l) => l.slug === "shape" && l.unlockedAt === null)) {
    emit({ type: "progress", message: "unlock_landmark" });
    const lit = unlockLandmark(deps, { slug: "shape", evidence: last.body });
    return say(`You chose "${last.body}". That charts ${lit.name}: ${lit.unlocked} of ${lit.total}.`);
  }
  if (answers === 2 && withDb(dbPath, (db) => listAsks(db, ctx.islandId).length) === 0) {
    emit({ type: "progress", message: "ask_reader" });
    askReader(deps, { question: "Stub check: which of these is true?", options: ["the first option", "the second option", "the third option"] });
    return say("Stub check: which of these is true?");
  }
```

For that, `JudgeContext` needs the island id: add `islandId: number` to `JudgeContext.island`? Simpler: extend `JudgeContext` with `islandId: number` set in `islandContext`, and import `withDb` from `../../core/db.ts` in the stub (check how `tools.ts` imports it and mirror). Place the `text === "the first option"` branch before the generic canned reply and after `unlock`.

- [ ] **Step 5: Run the tests to verify they pass**

Run the four files → PASS; `bunx tsc --noEmit && bun test` → green (the existing `renderThreadPrompt(thread)` calls still work with the default).

- [ ] **Step 6: Commit**

```bash
git add src/core/migrations/0006_asks.sql src/core/types.ts src/core/repositories/askRepository.ts src/core/validators.ts src/server/judge/tools.ts src/server/judge/context.ts src/server/judge/sdk.ts src/server/judge/stub.ts tests/core/db.test.ts tests/core/askRepository.test.ts tests/server/tools.test.ts tests/server/stub.test.ts
git commit -m "feat(judge): ask_reader — a question with options, attached to the reply

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

### Task 2: Asks through the routes

**Files:**
- Modify: `src/server/routes.ts`
- Test: `tests/server/routes.test.ts`

**Interfaces:**
- Consumes: `listAsks`, `pickAsk`, `attachAsks`, `pendingAsk`, `probeInputSchema.askId` from Task 1.
- Produces: `GET /api/thread` → `{ island, messages, asks }`; `POST /api/probe` with `askId`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/routes.test.ts` (add `import { addAsk } from "../../src/core/repositories/askRepository.ts";` and `import { addMessage } from "../../src/core/repositories/messageRepository.ts";` if absent; the file already has a `post`/`get` helper and `parseSse`):

```ts
test("an ask attaches to the reply, shows in the thread, is picked through probe once", async () => {
  // the stub asks on the second answer
  await post("/api/probe", { domain: "sd", island: "databases" });
  await post("/api/probe", { domain: "sd", island: "databases", message: "one" });
  const r = await post("/api/probe", { domain: "sd", island: "databases", message: "two" });
  expect(r.status).toBe(200);
  const thread = (await get("/api/thread?domain=sd&island=databases")).json;
  expect(thread.asks).toHaveLength(1);
  const ask = thread.asks[0];
  expect(ask.picked).toBeNull();
  expect(ask.messageId).toBe(thread.messages.at(-1).id);
  expect(thread.messages.at(-1).body).toBe("Stub check: which of these is true?");
  const pick = await post("/api/probe", { domain: "sd", island: "databases", message: "the first option", askId: ask.id });
  expect(pick.status).toBe(200);
  const after = (await get("/api/thread?domain=sd&island=databases")).json;
  expect(after.asks[0].picked).toBe("the first option");
  const again = await post("/api/probe", { domain: "sd", island: "databases", message: "the second option", askId: ask.id });
  expect(again.status).toBe(409);
  const missing = await post("/api/probe", { domain: "sd", island: "databases", askId: ask.id });
  expect(missing.status).toBe(400);
  expect((await post("/api/probe", { domain: "sd", island: "databases", message: "x", askId: 999 })).status).toBe(404);
});
```

(`post` here must consume the SSE body before returning; if the file's helper for probe does that under another name, use it. Reading the existing probe test at the bottom of the file shows the pattern.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/server/routes.test.ts` → FAIL (`asks` undefined; askId ignored).

- [ ] **Step 3: Implement**

`src/server/routes.ts`: import `attachAsks, listAsks, pickAsk` from the ask repository. In `GET /api/thread` return `{ island: i.slug, messages: listMessages(db, i.id), asks: listAsks(db, i.id) }`. In `POST /api/probe`, replace the `withDb` block that stores the reader message with:

```ts
    if (input.askId !== undefined && !input.message) throw new ArchipelagoError("a pick needs a message");
    withDb(ctx, (db) => {
      const d = requireDomain(db, input.domain);
      const i = requireIsland(db, d.id, input.island);
      if (input.askId !== undefined) pickAsk(db, d.id, input.askId, input.message!);
      if (input.message) addMessage(db, { domainId: d.id, islandId: i.id, role: "you", kind: "text", body: input.message });
    });
```

(`ArchipelagoError` maps to 400 in the error handler; check `toResponse` at the bottom of the file and confirm. `ConflictError` → 409, `NotFoundError` → 404 already.) Then where the reply is stored, replace the block with:

```ts
        withDb(ctx, (db) => {
          const d = requireDomain(db, input.domain);
          const i = requireIsland(db, d.id, input.island);
          // An ask recorded this turn rides on the reply; a silent turn still shows its question.
          const unattached = listAsks(db, i.id).find((a) => a.messageId === null);
          const body = reply || (unattached ? unattached.question : "");
          if (!body) return;
          const stored = addMessage(db, { domainId: d.id, islandId: i.id, role: "judge", kind: "text", body });
          attachAsks(db, i.id, stored.id);
        });
```

and drop the surrounding `if (reply) { … }` so the block always runs.

- [ ] **Step 4: Verify and commit**

Run: `bun test tests/server/routes.test.ts` → PASS; `bunx tsc --noEmit && bun test` green.

```bash
git add src/server/routes.ts tests/server/routes.test.ts
git commit -m "feat(server): asks ride the reply; probe accepts a pick

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

### Task 3: The protocol and Mermaid on the server

**Files:**
- Modify: `src/server/judge/PROTOCOL.md`, `tests/server/protocol.test.ts`
- Modify: `package.json` (via `bun add mermaid@^11`), `src/server/routes.ts`, `src/web/index.html`
- Test: `tests/server/routes.test.ts`

- [ ] **Step 1: Protocol**

In `PROTOCOL.md`'s Tools list add after `propose_reef`:

```
- `ask_reader` — asks the reader to choose between 2–4 options. Use it when a choice discriminates faster than a paragraph would: which resource saturates first, which of two designs is right, what happens next. All options plausible, one of them what they would say if they already understood. The options appear under your reply; after the tool returns, end the reply with the question and stop. The pick arrives as the reader's next message and counts as a round.
```

Append two sections before `## 6. Straits`... no: append at the end of the file:

```
## 7. Diagrams

Draw when the thing you are explaining has three or more parts that relate: a request path, a scaling route, a state machine, a topology. At most one diagram per reply and at most eight nodes, in a fenced block marked `mermaid`, using `flowchart TB`, `sequenceDiagram`, or `stateDiagram-v2`. Never in the opening turn, never for a list, never to decorate. One sentence before it says what it shows; one sentence after says where the reader is on it. The §2 ban on markdown does not apply to this one fence.

## 8. Asking with options

Call `ask_reader` at most once per two rounds, never in the opening turn, and never as the deciding round's question (§3). Two to four options, short, all plausible, one right. When the tool returns, finish the reply with the question itself and stop; the reader is choosing. Their pick, or their own words instead, arrives as the next reader message and counts as a round.
```

Also in §2's first paragraph, change `no lists, no headings, no markdown` to `no lists, no headings, no markdown (except a diagram fence, §7)`.

In `tests/server/protocol.test.ts`, extend whatever assertion lists the tool names or section headings so it also expects `ask_reader`, `## 7. Diagrams`, and `## 8. Asking with options` (read the file first; add to its existing `toContain` checks).

- [ ] **Step 2: Mermaid vendored**

Run `bun add mermaid@^11` and confirm `ls node_modules/mermaid/dist/mermaid.min.js`. In `src/server/routes.ts` add near the top:

```ts
import { fileURLToPath } from "node:url";
const MERMAID_PATH = fileURLToPath(import.meta.resolve("mermaid/dist/mermaid.min.js"));
```

and in `handleRequest`, before the static fallback:

```ts
  if (route === "GET /vendor/mermaid.js") {
    return new Response(Bun.file(MERMAID_PATH), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
  }
```

Append to `tests/server/routes.test.ts`:

```ts
test("mermaid is served from the vendor route", async () => {
  const r = await fetch(`${base}/vendor/mermaid.js`);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("javascript");
  expect((await r.text()).length).toBeGreaterThan(100000);
});
```

In `src/web/index.html`, before the `app.js` module script add `<script src="/vendor/mermaid.js"></script>`.

- [ ] **Step 3: Verify and commit**

`bun test` green; `bunx tsc --noEmit` clean.

```bash
git add src/server/judge/PROTOCOL.md tests/server/protocol.test.ts package.json bun.lock src/server/routes.ts src/web/index.html tests/server/routes.test.ts
git commit -m "feat: protocol for diagrams and asks; mermaid vendored at /vendor/mermaid.js

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

### Task 4: Diagrams, choices, the card, the grip

**Files:**
- Modify: `src/web/thread.js`, `tests/web/thread.test.js`, `src/web/markdown.js`, `src/web/card.js`, `src/web/styles.css`, `src/web/app.js`
- Create: `src/web/cta.js`

**Interfaces:**
- Consumes: `/api/thread` `asks`; `/api/probe` `askId`; `window.mermaid` from the vendor script.
- Produces: `mdBlocks` code blocks carry `lang` and `closed`; `renderMarkdown` renders closed mermaid fences; `card.js` exports nothing new but calls `renderCta(model)` from `cta.js`; `cta.js` exports `renderCta({ island, pendingReef, verdict, inFlight, answering, stay, nearest, onConfirm, onDispute, onSail, onStay })`.

- [ ] **Step 1: `mdBlocks` fences carry their language and whether they closed**

In `tests/web/thread.test.js`, change the two fence expectations: `{ type: "code", text: "let x = 1;" }` → `{ type: "code", lang: "", text: "let x = 1;", closed: true }` and `{ type: "code", text: "still open" }` → `{ type: "code", lang: "js", text: "still open", closed: false }`. Append:

```js
test("a mermaid fence is a code block with its language, closed only once the fence ends", () => {
  expect(mdBlocks("```mermaid\nflowchart TB\n  A --> B\n```")).toEqual([{ type: "code", lang: "mermaid", text: "flowchart TB\n  A --> B", closed: true }]);
  expect(mdBlocks("```mermaid\nflowchart TB").at(-1)).toMatchObject({ lang: "mermaid", closed: false });
});
```

Run: `bun test tests/web/thread.test.js` → FAIL. In `src/web/thread.js` `mdBlocks`: change the fence open test to `const f = line.match(/^\s*```(\w*)/); if (f) { flushPara(); flushList(); fence = { type: "code", lang: f[1], text: "", closed: false }; continue; }`, and on the closing fence set `fence.closed = true` before pushing. Run again → PASS.

- [ ] **Step 2: `markdown.js` renders diagrams**

Replace the `code` branch of `renderMarkdown` and add the helpers:

```js
const svgCache = new Map(); // diagram source → SVG markup; streaming re-renders never redraw
let mermaidReady = false;
let diagramSeq = 0;

function mermaidInit() {
  if (mermaidReady || typeof window === "undefined" || !window.mermaid) return Boolean(window.mermaid);
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "dark",
    flowchart: { htmlLabels: false, useMaxWidth: false },
    sequence: { useMaxWidth: false },
    themeVariables: {
      background: "#1B3F5B", primaryColor: "#245069", primaryTextColor: "#FFFFFF", primaryBorderColor: "rgba(255,255,255,.3)",
      lineColor: "#F5C242", secondaryColor: "#163449", tertiaryColor: "#163449", noteBkgColor: "#245069", noteTextColor: "#FFFFFF",
      actorBkg: "#245069", actorBorder: "rgba(255,255,255,.3)", actorTextColor: "#FFFFFF", signalColor: "#F5C242", signalTextColor: "#FFFFFF",
      edgeLabelBackground: "#1B3F5B", fontFamily: "system-ui, sans-serif", fontSize: "13px",
    },
  });
  mermaidReady = true;
  return true;
}

/** SVG markup → an element, without innerHTML. */
function svgElement(markup) {
  return new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
}

function sourceBlock(text) {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = text;
  pre.append(code);
  return pre;
}

/** A closed mermaid fence: rendered once per source, cached, with the source as the fallback. */
function diagramElement(source) {
  const box = document.createElement("div");
  box.className = "diagram";
  const cap = document.createElement("div");
  cap.className = "cap";
  cap.textContent = "diagram";
  box.append(cap);
  const holder = document.createElement("div");
  box.append(holder);
  if (svgCache.has(source)) {
    holder.append(svgElement(svgCache.get(source)));
    return box;
  }
  if (!mermaidInit()) {
    holder.append(sourceBlock(source));
    return box;
  }
  holder.textContent = "drawing a diagram…";
  window.mermaid
    .render(`diagram-${++diagramSeq}`, source)
    .then(({ svg }) => {
      svgCache.set(source, svg);
      holder.replaceChildren(svgElement(svg));
    })
    .catch(() => holder.replaceChildren(sourceBlock(source)));
  return box;
}
```

and in the loop:

```js
    } else if (b.type === "code" && b.lang === "mermaid" && b.closed) {
      frag.append(diagramElement(b.text));
    } else if (b.type === "code") {
      frag.append(sourceBlock(b.lang === "mermaid" ? "drawing a diagram…" : b.text));
    }
```

- [ ] **Step 3: `cta.js`**

Create `src/web/cta.js`:

```js
// The call-to-action card at the bottom centre of the map: actions about the map, never knowledge questions.
// card.js hands it a model each render; it keeps no state of its own.

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

function button(label, onClick, className = "") {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** Renders the card into #cta from the model, or hides it when there is nothing to do. */
export function renderCta(model) {
  const wrap = document.getElementById("cta");
  if (!wrap) return;
  const { island, pendingReef, verdict, inFlight, answering, stay, nearest } = model;
  const showReef = island && pendingReef && !inFlight;
  const showNext = island && verdict && !inFlight && !pendingReef && !stay && nearest;
  wrap.replaceChildren();
  if (!showReef && !showNext) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const card = el("div", "cta-card");
  if (showReef) {
    card.append(el("div", "lbl", "reef?"), el("div", "q", pendingReef.proposal.claim));
    const row = el("div", "row");
    const confirm = button("Confirm the reef", model.onConfirm, "reefy");
    const dispute = button("Dispute below", model.onDispute);
    confirm.disabled = dispute.disabled = Boolean(answering);
    row.append(confirm, dispute);
    card.append(row);
  } else {
    card.append(el("div", "lbl", "charted"));
    const row = el("div", "row");
    row.append(button(`Sail to ${nearest.name}`, () => model.onSail(nearest.slug), "primary"), button("Stay here", model.onStay));
    card.append(row);
  }
  wrap.append(card);
}
```

- [ ] **Step 4: `card.js`**

Imports: add `import { renderCta } from "./cta.js";` and `import { select } from "./interactions.js";` (the same cycle shape as `outline.js`; nothing is read at module evaluation).

State: add `asks: [],` and `stay: false,` to `thread` and to `resetThread`'s reset object. In `loadThread` store `thread.asks = asks ?? [];` from the response (`const { messages, asks } = await api(...)`).

`runTurn(slug, message, askId)`: include `...(askId ? { askId } : {})` in the `streamPost` body. Add a helper:

```js
const pendingAskOf = () => thread.asks.find((a) => a.messageId !== null && a.picked === null) ?? null;

/** The reader chose an option, or typed instead of choosing: either way it is the next message. */
function answerAsk(slug, ask, body) {
  if (thread.inFlight || thread.slug !== slug) return;
  thread.draft = "";
  void runTurn(slug, body, ask.id);
}
```

In `itemEl`, for a text message from the judge, append the choices when an ask points at it:

```js
  const m = el("div", `msg ${item.role}`);
  m.append(renderMarkdown(item.text));
  const ask = item.role === "judge" ? thread.asks.find((a) => a.messageId === item.id) : null;
  if (ask) m.append(choicesEl(ask));
  return m;
```

with:

```js
function choicesEl(ask) {
  const box = el("div", "choices");
  box.append(el("div", "q", ask.picked !== null ? "you chose" : "choose one, or answer below"));
  for (const option of ask.options) {
    const b = button(option, () => answerAsk(thread.slug, ask, option), "choice");
    if (ask.picked !== null) {
      b.disabled = true;
      if (ask.picked === option) b.classList.add("picked");
    } else if (thread.inFlight) {
      b.disabled = true;
    }
    box.append(b);
  }
  return box;
}
```

`itemEl` needs `item.id`: `logItems` spreads the message, so `id` is there.

In `footEl`: compute `const ask = thread.loaded && !pending ? pendingAskOf() : null;` and use placeholder `ask ? "or answer in your own words" : "your answer"` in the non-empty case. In the Send submit handler, call `ask ? answerAsk(island.slug, ask, body) : (thread.draft = "", void runTurn(island.slug, body))` — write it as an `if`. In reef mode remove the `Confirm` button from the foot (keep `Dispute` as the submit button) and change the meta text to `Confirm at the bottom of the map · Dispute sends your objection`.

At the end of `render()` (after `thread.litSeen = …`) and in the `!island` branch (before `return`), call:

```js
  renderCta({
    island,
    pendingReef: island && thread.loaded ? logItems(thread.messages, island).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending") ?? null : null,
    verdict: island ? island.verdict : null,
    inFlight: thread.inFlight,
    answering: thread.answering,
    stay: thread.stay,
    nearest: nearestOpen(),
    onConfirm: () => {
      const p = logItems(thread.messages, island).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending");
      if (p) void answerReef(island.slug, p.id, "confirm");
    },
    onDispute: () => focusAnswer(),
    onSail: (slug) => void select(slug),
    onStay: () => {
      thread.stay = true;
      render();
    },
  });
```

with

```js
/** The first island in nearest open water at this scale, as { slug, name }, or null. */
function nearestOpen() {
  const s = app.snapshot;
  if (!s || !s.nearestOpenWater.length) return null;
  const slug = s.nearestOpenWater[0];
  const i = s.islands.find((x) => x.slug === slug);
  return i ? { slug, name: i.name } : null;
}
```

Pane resize: in `render()`, right after `pane.hidden = false; pane.replaceChildren(headEl(island), logEl(island), footEl(island));` add `pane.prepend(gripEl());` with:

```js
const PANE_MIN = 340;
const PANE_MAX = 760;

function gripEl() {
  const grip = el("div", "grip");
  grip.title = "drag to resize";
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    pane.classList.add("resizing");
    const badge = el("div", "width");
    pane.append(badge);
    const move = (ev) => {
      const w = Math.min(PANE_MAX, Math.max(PANE_MIN, window.innerWidth - ev.clientX));
      document.documentElement.style.setProperty("--pane-w", `${w}px`);
      badge.textContent = `${Math.round(w)}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      pane.classList.remove("resizing");
      badge.remove();
      try {
        localStorage.setItem("pane-w", getComputedStyle(pane).width);
      } catch {
        /* storage unavailable */
      }
      frameSelection();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  return grip;
}
```

and in `installCard()` before the first render:

```js
  try {
    const saved = localStorage.getItem("pane-w");
    if (saved) document.documentElement.style.setProperty("--pane-w", saved);
  } catch {
    /* storage unavailable */
  }
```

(`frameSelection` is exported by `app.js`; add it to the import.) Also toggle `document.body.classList.toggle("pane-open", Boolean(island))` in `render()` so the card's right edge follows the pane.

- [ ] **Step 5: Markup and styles**

`src/web/index.html`: add `<div id="cta" class="cta" hidden></div>` after the `#pane` aside.

`src/web/styles.css`: add `--pane-w: 480px;` to `:root`; change `.pane { … width: clamp(340px, 38vw, 440px); …}` to `width: var(--pane-w);`. Append:

```css
/* ---- pane grip ---- */
.pane .grip { position: absolute; top: 0; bottom: 0; left: -5px; width: 10px; cursor: col-resize; z-index: 3; }
.pane .grip::after { content: ""; position: absolute; top: 50%; left: 4px; width: 2px; height: 36px; margin-top: -18px; border-radius: 2px; background: var(--line); }
.pane .grip:hover::after, .pane.resizing .grip::after { background: var(--lamp); }
.pane .width { position: absolute; top: 8px; left: 12px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); pointer-events: none; }
.pane.resizing { transition: none; user-select: none; }

/* ---- diagrams ---- */
.diagram { margin: 6px 0 8px; padding: 10px 8px; background: var(--water); border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; }
.diagram svg { max-width: none; height: auto; display: block; margin: 0 auto; }
.diagram .cap { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }

/* ---- choices under a judge message ---- */
.choices { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.choices .q { width: 100%; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
.choice { background: transparent; border: 1px solid var(--lamp); color: var(--lamp); border-radius: 999px; padding: 5px 12px; font: 12px system-ui, sans-serif; cursor: pointer; }
.choice:hover { background: var(--lamp); color: var(--sea); }
.choice:disabled { opacity: .4; cursor: default; }
.choice.picked { background: var(--lamp); color: var(--sea); opacity: 1; }

/* ---- the call to action over the map ---- */
.cta { position: fixed; bottom: 56px; left: var(--outline-w); right: 0; display: flex; justify-content: center; pointer-events: none; z-index: 1; }
body.pane-open .cta { right: var(--pane-w); }
.cta[hidden] { display: none; }
.cta-card { pointer-events: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; box-shadow: 0 12px 32px rgba(0, 0, 0, .45); max-width: min(560px, 90%); display: grid; gap: 8px; }
.cta-card .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--lamp); }
.cta-card .q { font-family: Georgia, serif; font-size: 14px; }
.cta-card .row { display: flex; flex-wrap: wrap; gap: 6px; }
.cta-card .row button { background: transparent; border: 1px solid var(--lamp); color: var(--lamp); border-radius: 999px; padding: 6px 12px; font: 12px system-ui, sans-serif; cursor: pointer; }
.cta-card .row button:hover { background: var(--lamp); color: var(--sea); }
.cta-card .row button.primary { background: var(--lamp); color: var(--sea); }
.cta-card .row button.reefy { border-color: var(--reef); color: var(--reef); }
.cta-card .row button.reefy:hover { background: var(--reef); color: var(--text); }
.cta-card .row button:disabled { opacity: .5; cursor: default; }
```

- [ ] **Step 6: Verify**

`bun test tests/web/thread.test.js` → PASS; `bunx tsc --noEmit && bun test` → green; `grep -n "innerHTML" src/web/*.js` → only the `markdown.js` comment.

By hand against the stub (`serve --stub`): Make landfall on an island, answer twice: the second reply is the stub's question with three chips under it and the foot says `or answer in your own words`; the card at the bottom centre shows nothing (knowledge question). Click a chip: it becomes your message, the chips stay with the picked one filled, the judge answers and `shape` lights. Type `reef`: the reef card appears at the bottom centre with `Confirm the reef` / `Dispute below`; the foot shows only `Dispute`; a double click on Confirm posts once; after the verdict the card shows `Sail to <next>` / `Stay here`, Sail selects the next island, Stay hides the card. Paste a reply containing a ```` ```mermaid ```` fence through the note? (Not possible with the stub.) Instead check the diagram path by opening the browser console and running `renderMarkdown` on a fence — or trust the unit-tested `mdBlocks` plus one manual check with the real judge later. Drag the pane's grip: the width badge shows, the map reframes on release, a reload keeps the width. Record results, or say no browser was available.

- [ ] **Step 7: Commit**

```bash
git add src/web/thread.js tests/web/thread.test.js src/web/markdown.js src/web/card.js src/web/cta.js src/web/styles.css src/web/app.js src/web/index.html
git commit -m "feat(web): diagrams in the log, choices under a question, the call-to-action card, a resizable pane

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

### Task 5: Docs

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-04-teachers-tools-design.md`

- [ ] **Step 1: README**

In "The judge" paragraph, after the stub sentence add: `The stub also asks a three-option question on your second answer.` In "From the map", replace `While a reef proposal is pending the box switches to **Confirm** and **Dispute**, and you answer the proposal — its false claim and its consequence — before the reef is written.` with `The judge can ask with options: they appear as chips under its question, and a chip or your own words becomes your next message. It can also draw: a Mermaid diagram in a reply renders in the log. Actions about the map sit in a card at the bottom centre: while a reef proposal is pending it offers **Confirm the reef** (the foot keeps **Dispute** with your objection), and after a verdict it offers **Sail to** the nearest open water. Drag the pane's left edge to resize it.` In the landmarks paragraph, no change. In the Layout block add `src/web/cta.js   the call-to-action card` after the outline lines.

- [ ] **Step 2: CLAUDE.md**

Architecture listing: migrations list gains `0006_asks.sql`; `src/web/` gains `cta.js`. Conventions: change `The judge writes only through its five tools: … and propose_reef write.` to name six tools with `ask_reader` (`records a question with 2–4 options, attached by the route to the reply`). Add a bullet: `- Asks: \`asks\` rows attach to the judge message the route stores after the turn (\`attachAsks\`); a pick goes through \`POST /api/probe\` with \`askId\` and becomes the next reader message. Mermaid is served at \`/vendor/mermaid.js\` from node_modules; the page renders closed mermaid fences through DOMParser, never innerHTML. The bottom-centre card (\`cta.js\`) carries map actions only: reef confirm, sail next.`

- [ ] **Step 3: Spec status and addendum**

Status → `implemented (plan: docs/superpowers/plans/2026-09-05-teachers-tools.md)`. Append:

```
## Addendum

The judge's acknowledgement is streamed before it calls `ask_reader`, so an ask cannot write its own message first without landing above the words that led to it. Instead the ask row carries the `question` and a nullable `message_id`; the route attaches unattached asks to the reply message it stores at the end of the turn, and stores the question itself when the reply is empty. `asks_ad` is unnecessary: asks are never deleted except by cascade.
```

- [ ] **Step 4: Commit**

`bun test` green.

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-09-04-teachers-tools-design.md
git commit -m "docs: the teacher's tools

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

## Self-review

- Spec coverage: diagrams (T3 protocol, T3 vendor, T4 markdown), `ask_reader` and the asks table (T1), thread and probe routes (T2), stub ask (T1), choices in the log (T4), CTA card with reef and sail (T4), Confirm moved out of the foot (T4), pane resize (T4), copy (T4), tests (T1–T4), docs (T5). Deviation from the spec's Data section (question column, nullable message id) is recorded in T5's addendum.
- Types: `Ask.options: string[]` parsed in the repository; `renderThreadPrompt(thread, asks)` with a default keeps old callers; `probeInputSchema.askId` optional; `renderCta` model fields match what `card.js` passes.
- Placeholders: none. Every code step carries its code.
