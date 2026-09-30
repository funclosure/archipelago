# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the defects the 2026-09-30 review confirmed at the edges where two writers or two turns overlap, before mentor mode doubles the turn traffic through them.

**Architecture:** Small, independent fixes in place: one pragma and a locked migration check in `src/core`, target scoping in the judge's tools, a round counter anchored on the last verdict line, a turn lifecycle in `routes.ts` that aborts on disconnect and keeps the lock until the runner settles, a Host check on every API route, and a per-turn token and honest error path on the page.

**Tech Stack:** Bun, `bun:sqlite`, `bun test`, TypeScript on the server, plain ES modules on the page.

## Global Constraints

- Run tests with `bun test` (never vitest); typecheck with `bunx tsc --noEmit`.
- `bun test` never spawns the SDK: server tests use `stub: true` or an injected `runner`.
- Page: no framework, no bundler, no `innerHTML`.
- `0001_initial.sql` is frozen; no schema change in this plan.
- Behaviour lives in protocol text before code: the round wording in `context.ts` must stay consistent with PROTOCOL §3 ("the fourth reader answer").
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: The database waits instead of failing, and migrations re-check under a write lock

**Files:**
- Modify: `src/core/db.ts:17-19`
- Modify: `src/core/migrate.ts:17-25`
- Test: `tests/core/db.test.ts`

**Interfaces:**
- Produces: `openDatabase()` connections carry `busy_timeout = 5000`. `migrateDatabase(db)` signature unchanged.

- [ ] **Step 1: Write the failing tests** (append to `tests/core/db.test.ts`; reuse its existing imports of `openDatabase` / `migrateDatabase`, `mkdtempSync`, `tmpdir`, `join`, `rmSync`, adding any that are missing)

```ts
test("every connection waits on a busy database instead of failing at once", () => {
  const db = openDatabase(":memory:");
  expect(db.query<{ timeout: number }, []>("pragma busy_timeout").get()!.timeout).toBe(5000);
  db.close();
});

test("a migration another connection applied first is skipped, not run twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "archipelago-mig-"));
  const path = join(dir, "t.sqlite");
  try {
    const a = openDatabase(path);
    const b = openDatabase(path);
    // b's pass sees everything applied by a and runs nothing
    expect(migrateDatabase(b)).toEqual([]);
    a.close();
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify the first fails**

Run: `bun test tests/core/db.test.ts`
Expected: FAIL on `busy_timeout` (received 0). The second passes already; it guards the refactor.

- [ ] **Step 3: Implement**

`src/core/db.ts`, after the foreign keys line:

```ts
  db.exec("pragma foreign_keys = on;");
  // The CLI and the server write the same file; wait for the other writer rather than fail with "database is locked".
  db.exec("pragma busy_timeout = 5000;");
  if (path !== ":memory:") db.exec("pragma journal_mode = wal;");
```

`src/core/migrate.ts`, replace the loop body's transaction:

```ts
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // Immediate: take the write lock first, then re-check, so a server and a CLI opening together
    // cannot both run the same migration.
    const ranNow = db.transaction(() => {
      if (db.query("select 1 from schema_migrations where version = ?").get(version)) return false;
      db.exec(sql);
      db.run("insert into schema_migrations (version) values (?)", [version]);
      return true;
    }).immediate();
    if (ranNow) ran.push(version);
  }
```

- [ ] **Step 4: Run to verify**

Run: `bun test tests/core && bunx tsc --noEmit`
Expected: all pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/db.ts src/core/migrate.ts tests/core/db.test.ts
git commit -m "fix(core): wait on a busy database, and re-check a migration under the write lock"
```

---

### Task 2: A thread charts only its own island and the straits that touch it

**Files:**
- Modify: `src/server/judge/tools.ts:50-92`
- Test: `tests/server/tools.test.ts`

**Interfaces:**
- Consumes: `resolveVerdictTarget(db, domainId, target)` → `{ targetType, targetId, label }` from `src/core/targets.ts`; the strait row is re-read by id (`straits.from_island_id`, `to_island_id`).
- Produces: private `requireOwnTarget(db, domainId, island, target, tool)` in `tools.ts`; `recordVerdict` and `proposeReef` both call it. Error text: `this thread charts island:<slug>; <tool> cannot chart <label>`.

- [ ] **Step 1: Write the failing tests** (append to `tests/server/tools.test.ts`)

```ts
test("propose_reef and record_verdict refuse another island and a strait that does not touch this one", () => {
  const db = openDatabase(dbPath);
  const queues = upsertIsland(db, { domainId: ids.domain, slug: "queues", name: "Queues" }).id;
  upsertStrait(db, { domainId: ids.domain, fromIslandId: ids.databases, toIslandId: queues });
  db.close();
  const reef = (target: string) => ({ target, claim: "c", consequence: "c", evidence: "e", confidence: 0.5, rationale: "r" });
  expect(() => proposeReef(deps(), reef("island:databases"))).toThrow(
    "this thread charts island:caching; propose_reef cannot chart island:databases",
  );
  expect(() => proposeReef(deps(), reef("strait:databases~queues"))).toThrow(
    "this thread charts island:caching; propose_reef cannot chart strait:databases~queues",
  );
  expect(() => recordVerdict(deps(), { target: "strait:databases~queues", state: "sandbar", confidence: 0.5, evidence: "x", rationale: "y" })).toThrow(
    "this thread charts island:caching; record_verdict cannot chart strait:databases~queues",
  );
  // its own island and a strait it sits on still work
  expect(proposeReef(deps(), reef("island:caching")).target).toBe("island:caching");
  // straits store the lower island id first, so the label is caching~databases however the caller names it
  expect(proposeReef(deps(), reef("strait:databases~caching")).target).toBe("strait:caching~databases");
});
```

Also update the existing expectation at `tests/server/tools.test.ts:123-125` to the new wording:

```ts
  expect(() => recordVerdict(deps(), { target: "island:databases", state: "settled", confidence: 0.9, evidence: "x", rationale: "y" })).toThrow(
    "this thread charts island:caching; record_verdict cannot chart island:databases",
  );
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/server/tools.test.ts`
Expected: FAIL — `proposeReef` accepts `island:databases`; both accept `strait:databases~queues`.

- [ ] **Step 3: Implement** in `src/server/judge/tools.ts`

Add above `recordVerdict`:

```ts
/** A thread charts its own island, and a strait only when this island is one of its two ends. */
function requireOwnTarget(db: Database, domainId: number, island: Island, target: string, tool: string) {
  const resolved = resolveVerdictTarget(db, domainId, target);
  const own =
    resolved.targetType === "island"
      ? resolved.targetId === island.id
      : (() => {
          const s = db.query<{ from: number; to: number }, [number]>(
            "select from_island_id as \"from\", to_island_id as \"to\" from straits where id = ?",
          ).get(resolved.targetId)!;
          return s.from === island.id || s.to === island.id;
        })();
  if (!own) throw new ArchipelagoError(`this thread charts island:${island.slug}; ${tool} cannot chart ${resolved.label}`);
  return resolved;
}
```

In `recordVerdict`, replace the resolve line and the island-only check with:

```ts
      const target = requireOwnTarget(db, domain.id, island, parsed.target, "record_verdict");
```

In `proposeReef`, replace `const target = resolveVerdictTarget(db, domain.id, parsed.target);` with:

```ts
    const target = requireOwnTarget(db, domain.id, island, parsed.target, "propose_reef");
```

Import `Island` from `../../core/types.ts` and `Database` from `bun:sqlite` if not already imported.

- [ ] **Step 4: Run to verify**

Run: `bun test tests/server && bunx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/judge/tools.ts tests/server/tools.test.ts
git commit -m "fix(judge): a thread charts only its own island and the straits that touch it"
```

---

### Task 3: The round counts answers since the last verdict on this thread

**Files:**
- Modify: `src/server/judge/context.ts:31-32, 75, 111-115`
- Test: `tests/server/tools.test.ts`

**Interfaces:**
- Produces: `JudgeContext.round` = reader text messages after the latest `system` message whose body is `charted as <state>` (the line both `record_verdict` and a reef confirmation write for this thread's island). With no such line, every reader text message counts.

- [ ] **Step 1: Write the failing test** (append to `tests/server/tools.test.ts`)

```ts
test("the round restarts after this island is charted, and the fourth answer since then forces a decision", () => {
  const db = openDatabase(dbPath);
  const say = (role: "you" | "judge", kind: "text" | "system", body: string) =>
    addMessage(db, { domainId: ids.domain, islandId: ids.caching, role, kind, body });
  for (const n of [1, 2, 3, 4]) say("you", "text", `answer ${n}`);
  say("judge", "system", "charted as sandbar");
  say("you", "text", "a new probe, answer 1");
  db.close();
  expect(islandContext(deps()).round).toBe(1);
  expect(renderContext(islandContext(deps()))).toContain("Round: 1 of 4");
  const db2 = openDatabase(dbPath);
  for (const n of [2, 3, 4]) addMessage(db2, { domainId: ids.domain, islandId: ids.caching, role: "you", kind: "text", body: `answer ${n}` });
  db2.close();
  // four answers since the last charting: the forcing line fires even though the island already has a verdict line
  expect(renderContext(islandContext(deps()))).toContain("This is the fourth answer: decide now");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/server/tools.test.ts -t "round restarts"`
Expected: FAIL — round is 5.

- [ ] **Step 3: Implement** in `src/server/judge/context.ts`

Change the type comment:

```ts
  /** Reader answers since this island was last charted in this thread (all of them if it never was). */
  round: number;
```

Replace the `round:` line in `buildJudgeContext`:

```ts
    round: roundOf(thread),
```

Add below `buildJudgeContext`:

```ts
/** Reader text messages after the last `charted as …` line: a re-probe starts its own four answers. */
export function roundOf(thread: Message[]): number {
  const last = thread.findLast((m) => m.kind === "system" && m.body.startsWith("charted as "));
  return thread.filter((m) => m.role === "you" && m.kind === "text" && (!last || m.id > last.id)).length;
}
```

Replace the round block in `renderContext`:

```ts
  if (ctx.round >= 4) {
    lines.push(`Round: ${ctx.round} of 4. This is the fourth answer: decide now with record_verdict or propose_reef before writing anything else.`);
  } else {
    lines.push(`Round: ${ctx.round} of 4 (reader answers since this island was last charted here; the verdict lands after the fourth at the latest)`);
  }
```

- [ ] **Step 4: Run to verify**

Run: `bun test tests/server && bunx tsc --noEmit`
Expected: all pass, including the existing "Round: 2 of 4" test.

- [ ] **Step 5: Commit**

```bash
git add src/server/judge/context.ts tests/server/tools.test.ts
git commit -m "fix(judge): the round counts answers since the island was last charted"
```

---

### Task 4: A turn stops when the reader leaves, and holds the island until it has stopped

**Files:**
- Modify: `src/server/routes.ts` (the `POST /api/probe` block, `POST /api/probe/reef`, `sseResponse`)
- Modify: `src/server/judge/runner.ts:14` (doc comment only)
- Test: `tests/server/routes.test.ts`

**Interfaces:**
- Produces: `sseResponse(run, onCancel?: () => void)`. Constant `TURN_SETTLE_MS = 5_000`: after a timeout or abort, the lock waits at most this long for the runner to settle. `POST /api/probe/reef` answers 409 `a turn is running on this island; answer when it ends` while the reef's island has a turn in flight.

- [ ] **Step 1: Write the failing tests** (append to `tests/server/routes.test.ts`)

```ts
test("a reader who leaves mid-turn aborts the runner and frees the island", async () => {
  let aborted = false;
  const hung: JudgeRunner = ({ signal }) =>
    new Promise<string>((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      });
    });
  const other = startServer({ port: 0, dbPath: join(dir, "test.sqlite"), staticRoot: dir, runner: hung });
  const otherBase = `http://127.0.0.1:${other.port}`;
  const client = new AbortController();
  try {
    const res = await fetch(otherBase + "/api/probe", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "databases" }), signal: client.signal,
    });
    expect(res.status).toBe(200);
    client.abort();
    for (let i = 0; i < 50 && !aborted; i++) await Bun.sleep(20);
    expect(aborted).toBe(true);
    await Bun.sleep(20);
    const again = await fetch(otherBase + "/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "databases" }) });
    expect(again.status).toBe(200);
    again.body?.cancel();
  } finally {
    other.stop(true);
  }
});

test("after a timeout the island stays locked until the runner has actually stopped", async () => {
  let settled = false;
  const slowToStop: JudgeRunner = ({ signal }) =>
    new Promise<string>((resolve) => {
      signal?.addEventListener("abort", () => setTimeout(() => { settled = true; resolve(""); }, 150));
    });
  const other = startServer({ port: 0, dbPath: join(dir, "test.sqlite"), staticRoot: dir, runner: slowToStop, turnTimeoutMs: 50 });
  const otherBase = `http://127.0.0.1:${other.port}`;
  try {
    const first = await fetch(otherBase + "/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "databases" }) });
    const events = parseSse(await first.text()); // the stream closes only once the lock is released
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(settled).toBe(true);
  } finally {
    other.stop(true);
  }
});

test("a reef cannot be confirmed while a turn is running on its island", async () => {
  await probe({ domain: "sd", island: "databases", message: "reef: indexes make every write faster" });
  const proposal = (await thread("databases")).messages.find((m: any) => m.kind === "reef_proposal");
  let release!: () => void;
  const slow: JudgeRunner = () => new Promise((resolve) => { release = () => resolve("ok"); });
  const other = startServer({ port: 0, dbPath: join(dir, "test.sqlite"), staticRoot: dir, runner: slow });
  const otherBase = `http://127.0.0.1:${other.port}`;
  const postTo = (path: string, body: unknown) =>
    fetch(otherBase + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const turn = await postTo("/api/probe", { domain: "sd", island: "databases", message: "more" });
    const confirm = await postTo("/api/probe/reef", { domain: "sd", id: proposal.id, answer: "confirm" });
    expect(confirm.status).toBe(409);
    expect(await confirm.json()).toEqual({ error: "a turn is running on this island; answer when it ends" });
    release();
    await turn.text();
    expect((await postTo("/api/probe/reef", { domain: "sd", id: proposal.id, answer: "confirm" })).status).toBe(200);
  } finally {
    release?.();
    other.stop(true);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/server/routes.test.ts`
Expected: the three new tests FAIL (runner never aborted; `settled` false when the stream closes; confirm returns 200).

- [ ] **Step 3: Implement** in `src/server/routes.ts`

Add beside `PING_MS`:

```ts
/** After a timeout or a departed reader, how long the island stays locked waiting for the runner to stop. */
const TURN_SETTLE_MS = 5_000;
```

Replace the `inFlight.add(key); return sseResponse(async (emit) => { … });` section of `POST /api/probe` with:

```ts
    inFlight.add(key);
    const abort = new AbortController();
    return sseResponse(async (emit) => {
      // A hung turn would wedge this island until the server restarts: cap it, and cancel the runner.
      const ms = ctx.turnTimeoutMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let turn: Promise<string> | undefined;
      const expiry = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Reject before aborting: a runner that rejects on abort would otherwise win the race and
          // report its own cancellation instead of the timeout the reader needs to see.
          reject(new ArchipelagoError(`the judge did not answer within ${ms / 1000} s`));
          abort.abort();
        }, ms);
      });
      try {
        turn = ctx.runner({ dbPath: ctx.dbPath, domain: input.domain, island: input.island, emit, signal: abort.signal });
        const reply = (await Promise.race([turn, expiry])).trim();
        if (abort.signal.aborted) return; // the reader left: a reply nobody asked to keep is not stored
        withDb(ctx, (db) => {
          const d = requireDomain(db, input.domain);
          const i = requireIsland(db, d.id, input.island);
          // An ask recorded this turn rides on the reply; a silent turn still shows its question.
          // Only an ask created since this turn started counts: one left unattached from an earlier,
          // unrelated reply must never latch onto this one.
          const unattached = listAsks(db, i.id).find((a) => a.messageId === null && a.id > askFloor);
          const body = reply || (unattached ? unattached.question : "");
          if (!body) return;
          const stored = addMessage(db, { domainId: d.id, islandId: i.id, role: "judge", kind: "text", body });
          attachAsks(db, i.id, stored.id, askFloor);
        });
        emit({ type: "done" });
      } catch (error) {
        emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        clearTimeout(timer);
        // An abandoned runner can still land tool writes: keep the island until it has stopped, within a bound.
        if (turn) await Promise.race([turn.then(() => {}, () => {}), Bun.sleep(TURN_SETTLE_MS)]);
        inFlight.delete(key);
      }
    }, () => abort.abort());
```

In `POST /api/probe/reef`, right after `const island = getIslandById(db, message.islandId)!;`:

```ts
        if (inFlight.has(`${input.domain}/${island.slug}`)) throw new ConflictError("a turn is running on this island; answer when it ends");
```

Change `sseResponse`:

```ts
function sseResponse(run: (emit: (event: JudgeEvent) => void) => Promise<void>, onCancel?: () => void): Response {
```

and its `cancel()`:

```ts
    cancel() {
      // the client went away: stop the keep-alive now, and tell the turn so it stops spending
      open = false;
      clearInterval(ping);
      onCancel?.();
    },
```

In `src/server/judge/runner.ts`, update the `signal` comment:

```ts
  /** Aborted when the turn times out or the reader disconnects; the SDK runner cancels on it, the stub ignores it. */
```

- [ ] **Step 4: Run to verify**

Run: `bun test tests/server && bunx tsc --noEmit`
Expected: all pass, including the existing timeout and 409 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.ts src/server/judge/runner.ts tests/server/routes.test.ts
git commit -m "fix(server): a turn stops when the reader leaves and holds its island until it has stopped"
```

---

### Task 5: Every API route checks the Host, not only writes

**Files:**
- Modify: `src/server/routes.ts` (`handleRequest`, `crossSitePostGuard`)
- Test: `tests/server/routes.test.ts`

**Interfaces:**
- Produces: `hostGuard(req): Response | null` runs on every `/api/` request; `crossSitePostGuard` keeps the content type and Origin checks. The 403 body stays `{ error: "cross-origin writes are not allowed" }` for POSTs and is `{ error: "unknown host" }` for a rebinding Host.

- [ ] **Step 1: Write the failing test**

```ts
test("a read through a rebinding hostname is refused", async () => {
  const res = await fetch(base + "/api/domains", { headers: { host: `evil.example:${server.port}` } });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "unknown host" });
  expect((await fetch(base.replace("127.0.0.1", "localhost") + "/api/domains")).status).toBe(200);
});
```

If Bun's `fetch` drops a custom `host` header, call the handler directly instead: `import { handleRequest } from "../../src/server/routes.ts"` and pass `new Request(base + "/api/domains", { headers: { host: "evil.example" } })` with a context `{ dbPath: join(dir, "test.sqlite"), staticRoot: dir, runner: async () => "", turnTimeoutMs: 1000 }`.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/server/routes.test.ts -t "rebinding"`
Expected: FAIL — 200.

- [ ] **Step 3: Implement**

In `handleRequest`:

```ts
    if (url.pathname.startsWith("/api/")) {
      const host = hostGuard(req);
      if (host) return host;
      if (req.method === "POST") {
        const guard = crossSitePostGuard(req, url);
        if (guard) return guard;
      }
      return await handleApi(req, url, ctx);
    }
```

Add:

```ts
/** DNS rebinding: a page on another name that resolves here must not read the threads. */
function hostGuard(req: Request): Response | null {
  const host = req.headers.get("host");
  if (host === null) return null;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return json({ error: "unknown host" }, 403);
  }
  return hostname === "127.0.0.1" || hostname === "localhost" ? null : json({ error: "unknown host" }, 403);
}
```

Remove the Host block from `crossSitePostGuard` (the lines from `const host = req.headers.get("host");` to the end of that `if`) and update its doc comment to: `Blocks cross-site writes: a POST must carry an application/json body, and if it names an Origin, that must be this server (127.0.0.1/localhost on the request's own port).` If an existing test asserts a POST with a bad Host returns `cross-origin writes are not allowed`, change its expected body to `{ error: "unknown host" }`.

- [ ] **Step 4: Run to verify**

Run: `bun test tests/server && bunx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.ts tests/server/routes.test.ts
git commit -m "fix(server): every API route refuses a rebinding Host, not only writes"
```

---

### Task 6: The page owns one turn at a time and never loses a typed answer

**Files:**
- Modify: `src/web/stream.js` (`streamPost`)
- Modify: `src/web/card.js` (`resetThread`, `runTurn`, imports)
- Test: `tests/web/stream.test.js`

**Interfaces:**
- Produces: `streamPost(url, body, onEvent)` now **throws** `Error(message)` when the response is not OK (the server stored nothing), and throws an error with `midStream = true` when the connection breaks after the stream opened (the server may have stored the message). `card.js` keeps a module `turnGen`; `resetThread` bumps it, so a stream from a previous visit to the same island is ignored.
- Consumes: `region()` from `./keys.js`.

- [ ] **Step 1: Write the failing tests** (append to `tests/web/stream.test.js`; add `streamPost` to the import)

```js
test("a refused request throws the server's error, so the caller can give the draft back", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "a turn is already running for this island" }), { status: 409 });
  try {
    const events = [];
    await expect(streamPost("/api/probe", {}, (e) => events.push(e))).rejects.toThrow("a turn is already running for this island");
    expect(events).toEqual([]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a stream that breaks after opening throws marked midStream", async () => {
  const realFetch = globalThis.fetch;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('event: text\ndata: {"type":"text","text":"Hi"}\n\n'));
      c.error(new Error("connection reset"));
    },
  });
  globalThis.fetch = async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  try {
    const events = [];
    const error = await streamPost("/api/probe", {}, (e) => events.push(e)).catch((e) => e);
    expect(error.midStream).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["text"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/web/stream.test.js`
Expected: FAIL — the 409 resolves and emits an `error` event; the broken stream's error has no `midStream`.

- [ ] **Step 3: Implement `streamPost`**

```js
/**
 * POSTs JSON and calls onEvent({ type, data }) for each SSE event as it arrives. Resolves when the stream ends.
 * Throws when the server refused the request (nothing was stored), and throws with `midStream` set when the
 * connection broke after the stream opened (the message may be stored).
 */
export async function streamPost(url, body, onEvent) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    let message = `request failed (${res.status})`;
    try {
      const json = await res.json();
      if (json && json.error) message = json.error;
    } catch {
      // not JSON; keep the status message
    }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseBuffer(buffer);
      buffer = rest;
      for (const e of events) onEvent(e);
    }
  } catch (error) {
    const broken = error instanceof Error ? error : new Error(String(error));
    broken.midStream = true;
    throw broken;
  }
  buffer += decoder.decode(); // flush any bytes the decoder held back mid-character
  const { events } = parseSseBuffer(buffer);
  for (const e of events) onEvent(e);
}
```

- [ ] **Step 4: Implement the turn token in `card.js`**

Change the keys import:

```js
import { registerRegion, region } from "./keys.js";
```

Add beside the other module state (near `let loadGen`):

```js
/** Bumped whenever the thread is reset or a turn starts: a stream only writes into the turn that started it. */
let turnGen = 0;
```

At the top of `resetThread`, before `Object.assign`:

```js
  turnGen += 1; // a stream still running from an earlier visit to this island is no longer ours
```

Replace `runTurn`:

```js
/** One judge turn. `message` null opens or continues the thread without a new reader message. */
async function runTurn(slug, message, askId) {
  if (thread.inFlight || thread.slug !== slug) return;
  const gen = ++turnGen;
  const mine = () => thread.slug === slug && gen === turnGen;
  const regionAtSend = region();
  thread.inFlight = true;
  thread.live = "";
  thread.progress = null;
  thread.error = null;
  if (message) thread.messages = [...thread.messages, { id: `local-${Date.now()}`, role: "you", kind: "text", body: message }];
  render();
  if (message) {
    const log = pane.querySelector(".log");
    if (log) log.scrollTop = log.scrollHeight; // sending is a request to watch the reply arrive
  }
  try {
    await streamPost("/api/probe", { domain: app.domain, island: slug, ...(message ? { message } : {}), ...(askId ? { askId } : {}) }, (e) => {
      if (!mine()) return;
      if (e.type === "text") {
        thread.live += e.data.text;
        thread.progress = null;
        scheduleLive();
      } else if (e.type === "progress") {
        thread.progress = e.data.message;
        scheduleLive();
      } else if (e.type === "error") {
        thread.error = e.data.message;
      }
    });
  } catch (error) {
    if (!mine()) return; // the reader moved on; nothing here is theirs
    thread.error = error.message;
    // Refused or never sent: the server stored nothing, so the words go back in the box.
    // Broken mid-stream: the server may have stored them, and the refetch will show it.
    if (message && !error.midStream) thread.draft = message;
  }
  if (!mine()) return;
  cancelLive();
  thread.inFlight = false;
  thread.live = "";
  thread.progress = null;
  thread.version = null; // the stored reply and any system lines come back with the refetch
  render();
  // Focus the answer only if the reader is still where they sent from; Tab away mid-turn is a choice.
  if (region() !== regionAtSend) return;
  // The opening turn renders the box disabled until the refetched thread arrives: focus it then.
  if (!focusAnswer()) thread.focusPending = true;
}
```

- [ ] **Step 5: Run to verify**

Run: `bun test tests/web && bun test`
Expected: all pass.

- [ ] **Step 6: Check by hand** (`bun run src/cli/index.ts serve --stub`)
  1. Start a turn on island A, click B, click A, send while A's first turn streams: the box is not cleared by the old stream, and a 409 puts the typed text back in the box with the error shown.
  2. Send, press Tab to the outline before the reply ends: focus stays in the outline (the lamp line and the caret agree).
  3. Reload mid-turn, then send again on the same island: accepted (Task 4).

- [ ] **Step 7: Commit**

```bash
git add src/web/stream.js src/web/card.js tests/web/stream.test.js
git commit -m "fix(web): one turn owns the pane, a refused send keeps its words, focus stays where the reader went"
```

---

### Task 7: The map shows the scale it was last asked for

**Files:**
- Modify: `src/web/app.js` (`refresh`, `poll`)

**Interfaces:**
- Produces: module `refreshGen` in `app.js`; `refresh()` drops a response that a later `refresh()` superseded. `poll()` does not overlap itself.

- [ ] **Step 1: Implement**

Replace `refresh`:

```js
let refreshGen = 0;

export async function refresh() {
  const gen = ++refreshGen;
  const query = `domain=${encodeURIComponent(app.domain)}${app.scale ? `&scale=${encodeURIComponent(app.scale)}` : ""}`;
  const [snapshot, outline] = await Promise.all([api(`/api/snapshot?${query}`), api(`/api/outline?domain=${encodeURIComponent(app.domain)}`)]);
  if (gen !== refreshGen) return; // a later refresh (a scale change, a newer version) owns the map now
  app.outline = outline;
  applySnapshot(snapshot);
}
```

Replace `poll`:

```js
let polling = false;

async function poll() {
  if (polling) return; // a slow refresh must not stack another behind it
  polling = true;
  try {
    const { version } = await api(`/api/version?domain=${encodeURIComponent(app.domain)}`);
    app.connected = true;
    if (version !== app.version) await refresh();
  } catch {
    app.connected = false;
  } finally {
    polling = false;
  }
  renderStatus();
}
```

- [ ] **Step 2: Run to verify**

Run: `bun test`
Expected: all pass (no web test covers `app.js`; it is checked by hand).

- [ ] **Step 3: Check by hand**: with the server running, throttle the network in devtools to "Slow 3G", run `bun run src/cli/index.ts island update --domain <slug> --slug <island> --name "<same name>"` to bump the version, and immediately sail into another island. The map, breadcrumb, and URL agree on the new scale once both responses land.

- [ ] **Step 4: Commit**

```bash
git add src/web/app.js
git commit -m "fix(web): a superseded refresh never paints over the scale the reader chose"
```

---

### Task 8: `comment mark-read` rejects an id that is not a number

**Files:**
- Modify: `src/cli/index.ts:339`
- Test: `tests/cli/cli.test.ts`

- [ ] **Step 1: Write the failing test** (append; `cli(args)` is the file's helper returning `{ code, json, stdout, stderr }`)

```ts
test("comment mark-read refuses an id that is not a positive integer", () => {
  const r = cli(["comment", "mark-read", "--domain", "sd", "--id", "abc"]);
  expect(r.code).toBe(1);
  expect(r.json.error).toBe("--id takes positive integers, got abc");
});
```

The domain `sd` must exist in that test's fixture; if the file creates domains per test, add `cli(["domain", "add", "--slug", "sd", "--name", "SD"])` first.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/cli/cli.test.ts -t "not a positive integer"`
Expected: FAIL — exit 0 with `{ marked: 0 }`.

- [ ] **Step 3: Implement**

```ts
      const raw = (o.id as string[] | undefined) ?? [];
      const bad = raw.find((s) => !/^[1-9]\d*$/.test(s));
      if (!o.all && bad !== undefined) throw new ArchipelagoError(`--id takes positive integers, got ${bad}`);
      const ids = o.all ? ("all" as const) : raw.map(Number);
```

- [ ] **Step 4: Run to verify**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts tests/cli/cli.test.ts
git commit -m "fix(cli): mark-read refuses an id that is not a positive integer"
```

---

## Not in this plan (recorded for later)

- Length caps on reader messages, cards, and comments, and summarising long threads in the context.
- Reparenting: orphaned strait comments and verdicts; no way back to the top level.
- The pane rebuilding on every snapshot (caret jump, IME), and refetching history each render.
- The snapshot's N+1 `latestVerdicts`.
- The outline menu's stale `{ once: true }` listener; Enter's `preventDefault` over focused buttons; `pointercancel`.
- Splitting `card.js`; the mentor-mode plan touches it and is the natural place to pull the turn and thread state out.
