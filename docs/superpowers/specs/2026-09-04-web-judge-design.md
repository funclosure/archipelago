# The web judge

**Date:** 2026-09-04
**Status:** approved design, awaiting plan
**Builds on:** slice 1 (`2026-09-03-archipelago-slice1-design.md`) and fixed positions (`2026-09-03-fixed-positions-design.md`)

## Why

Slice 1 has one brain: Claude Code in the terminal both draws the map and probes the user. The user wants the two jobs split. The terminal, with its full harness, is the **cartographer**: it decides what the islands are. The browser is the **judge and teacher**: it holds the conversation that reveals each island, records how well the user knows it, and then helps them explore it. This is the mindgraph shape (the CLI makes the graph, the Ask agent talks to it) applied to charting.

## Decisions

| Question | Decision |
|---|---|
| What powers the browser conversation | The Claude Agent SDK inside the archipelago server, logged in through Claude Code. No API key. Same as mindgraph, locus, and loupe. |
| When the judge teaches | Verdict first, then teach. The teaching in a thread never rewrites the verdict it just made; only a later re-probe can. |
| Verdict authority | Direct for sandbar, settled, and mountainous. A reef is proposed in the thread and written only when the user confirms it. |
| Where the conversation lives | SQLite, one thread per island. The cartographer reads threads before sketching islets. |
| How the map learns of a verdict | Through the existing version poll. Judge tools write through the same repositories as the CLI; the stream carries only text and progress. |

## Roles

**Cartographer** (Claude Code, `.claude/skills/archipelago-chart/SKILL.md`). Sketches domains, islands, islets, straits. Reads island threads before sketching a coastline. Handles `sail_closer` and `note` comments. Never writes verdicts.

**Judge** (Agent SDK in `src/server/judge/`). One thread per island. Probes as the brief says: explain, apply, predict; never a definition, never yes/no, never a list to pick from; at most two follow-ups. Classifies with the same four tests as today, writes the verdict, then teaches the gap it found, then names the nearest open water. Applies the reef rule by proposing, not writing.

**The protocol splits.** Sections 3 to 6 of the current skill (probe, classify, reef rule, straits) move verbatim into `src/server/judge/PROTOCOL.md`. The server reads that file at runtime and uses it as the judge's system prompt, the way mindgraph reads its skill. The charting skill keeps sections 0 to 2, 7, and 8, drops its verdict commands, and gains a step: read the island's thread (`thread show`) before sketching islets. CLAUDE.md keeps its rule: change behaviour in the protocol file before changing code.

**Comment fates.** "Probe this" opens the thread in the page, so the page stops offering the `probe_me` kind. The frozen `0001_initial.sql` check constraint still allows the value; nothing writes it. A dispute is a message in the thread, so the page's note box offers only `note`. `sail_closer` and `note` still post comments for the terminal. The skill's section 2 keeps handling `probe_me` and `dispute` if old rows exist, but says they are legacy.

**Straits.** When both islands of a strait have verdicts, the judge may ask its strait question inside either island's thread and record the verdict on the strait target.

## Data

`src/core/migrations/0003_threads.sql`:

```sql
create table messages (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  role text not null check (role in ('you', 'judge')),
  kind text not null check (kind in ('text', 'reef_proposal', 'system')),
  body text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index messages_island on messages(island_id, id);
create trigger messages_ai after insert on messages begin
  update view_state set version = version + 1;
end;
```

- `text`: a user or judge message, markdown allowed.
- `reef_proposal` (role `judge`): body is JSON `{ target, claim, consequence, evidence, confidence, rationale, status }` where `status` is `pending`, `confirmed`, or `disputed`. The status is updated in place when the user answers; that is the one `update` on this table, and it also bumps the version.
- `system` (role `judge`): a one-line record the page shows inline, such as `charted as settled` or `strait caching~databases charted as sandbar`. Written by the verdict tool after each successful write so the thread reads well on reload.

The snapshot gains `messages: number` per island so the page and the skill know where conversations exist. `Island` in `types.ts` is unchanged; the count lives on the view model only.

Repository `src/core/repositories/message.ts`: `listMessages(db, islandId)`, `addMessage(db, input)`, `getMessage(db, id)`, `setReefStatus(db, id, status)`.

## Server

**`POST /api/probe`.** Body `{ domain, island, message? }`. Behind `crossSitePostGuard`. Steps:

1. Resolve the island; 404 if unknown.
2. If `message` is present, store it as `you`/`text`.
3. If a turn is already running for this island, 409 `{ error: "turn in flight" }`.
4. Open a server-sent-event stream (`text/event-stream`, `Cache-Control: no-store`, a `: ping` comment every 20 s).
5. Build the judge's context and run one SDK turn (below). Emit `text` events for each text delta, `progress` events naming each tool call.
6. When the turn completes, store the judge's full reply as `judge`/`text` and emit `done`. On any failure emit one `error` event with the message and store nothing for the judge.

The turn is stateless: the stored thread is replayed into the prompt as `Reader:` / `Judge:` lines, the mindgraph shape. Threads are short (a probe is a handful of turns), so replay is cheap and the database stays the only state. A request with no `message` runs a turn on the thread as it stands: on an empty thread the prompt is "Open the probe on this island" so the judge asks first; on a non-empty thread (after a dispute, or a retry) the judge simply continues.

**Runner** (`src/server/judge/runner.ts`). Calls the SDK's `query()` with:

- system prompt = `PROTOCOL.md` + the island context block (island name, summary, current verdict and history, islets with their states, straits to neighbours with their verdicts, the domain's nearest open water).
- model `process.env.ARCHIPELAGO_MODEL ?? "claude-opus-5"`.
- `includePartialMessages: true` for streaming.
- an in-process MCP server (`createSdkMcpServer` + `tool()`, the locus shape) with exactly three tools; every other tool is denied by `canUseTool`.

**Tools** (each opens and closes the database per call, keeping the per-request rule):

| Tool | Input | Effect |
|---|---|---|
| `island_context` | none | Returns the same context block as JSON, refreshed. For when the judge needs to re-read after a write. |
| `record_verdict` | `target` (`island:<slug>` or `strait:<a>~<b>`), `state` (sandbar, settled, mountainous), `confidence`, `evidence`, `rationale` | Validates with the existing verdict schema minus reef, writes the verdict through `verdict` repository, writes a `system` message. Returns the stored verdict. |
| `propose_reef` | `target`, `claim`, `consequence`, `evidence`, `confidence`, `rationale` | Writes a `reef_proposal` message with status `pending`. Writes no verdict. Returns the message id. |

`record_verdict` with state `reef` is a validation error the tool returns to the model; the protocol tells the judge to use `propose_reef`.

**`POST /api/probe/reef`.** Body `{ id, answer: "confirm" | "dispute", note? }`. Confirm: writes the reef verdict from the proposal's fields, sets status `confirmed`, writes a `system` message. Dispute: sets status `disputed`, stores `note` (or "I dispute this") as a `you`/`text` message, and returns; the page then calls `/api/probe` without a message so the judge answers the dispute. Answering a proposal that is not `pending` is 409.

**`GET /api/thread?domain=&island=`.** Returns the island's messages in order. The page calls it when a card opens.

**Stub.** `serve --stub` (env `ARCHIPELAGO_STUB=1`) swaps the runner for `src/server/judge/stub.ts`: it emits a canned question on open, and on a message containing the word `settled` calls `record_verdict` with state settled, on `reef` calls `propose_reef`, otherwise replies with a canned follow-up. It exercises the tools through the same tool functions, so route tests cover the write path without the SDK. `bun test` never spawns the SDK.

**Dependency.** `@anthropic-ai/claude-agent-sdk` pinned to the version current at plan time (0.3.260 today). The plan checks the installed `query`, `tool`, and `createSdkMcpServer` signatures rather than copying them from the sibling projects, which pin three different versions.

## CLI

- `thread show --domain <slug> --island <slug>` prints the messages as JSON. The cartographer reads it before sketching a coastline.
- `verdict set` stays for repair and for tests, but the skill no longer uses it.
- `serve` gains `--stub`.

## Page

**Card.** Clicking an island opens the card as today: name, summary, state, islets summary. Below that the thread panel: the messages, then a text box and Send. When the thread is empty the panel shows one button, **Probe this**, which posts to `/api/probe` with no message. Reopening an island refetches its thread. The card's other actions stay: **Sail in** or **Sail closer**, and the note box, now `note` only.

**Streaming.** `src/web/stream.js` holds the pure SSE parser (mindgraph's `parseSseBuffer`) and `streamPost`. One turn in flight per page: Send and Probe this are disabled until `done` or `error`. The judge's message grows as `text` deltas arrive; a `progress` line under it names the tool in flight and disappears on the next text.

**Reveal.** A verdict written by a tool bumps the version; the poll redraws the island within two seconds, and the thread shows the `system` line in the same beat because the thread refetches on version change while a card is open. The judge's teaching follows in the same reply.

**Reef block.** A `reef_proposal` message renders as a distinct block: the claim, the consequence, and two buttons, **Confirm** and **Dispute**. Confirm posts to `/api/probe/reef`; the island turns hazard on the next poll. Dispute opens a one-line input for the objection, posts it, then opens a judge turn. A proposal that is `confirmed` or `disputed` renders without buttons and with its status.

**Errors.** An `error` event renders inline in the thread in the muted style, the box re-enables, and the user's last message stays in the thread so a retry needs no retyping. When the server reports the SDK is not installed or not logged in, the message says which and names the fix (`bun install`, or `claude login`).

**Unchanged.** Map, fixed positions, zoom, breadcrumb, state strip, focus posting on click.

## Failure rules

- A stream cut mid-turn discards the judge's partial reply. Any verdict already written by a tool stays, because the map is the record; the `system` line makes that visible on reload.
- Two tabs probing the same island: the second gets 409 and shows "a turn is already running".
- A reef proposal left pending is still pending on reload; the judge's context block lists pending proposals so it does not propose the same reef twice.
- The judge's context is built at turn start; it does not see writes made by other clients mid-turn except through `island_context`.

## Tests

- `tests/core/message.test.ts`: repository round trip, reef status transitions, version bump on insert and on status update.
- `tests/core/migrate.test.ts`: 0003 applies on a fresh and an existing database.
- `tests/cli/cli.test.ts`: `thread show` output and unknown-island error.
- `tests/server/routes.test.ts` with the stub runner: probe opens a thread and stores both messages; a message containing `settled` produces a verdict, a `system` message, and a version bump; `reef` produces a pending proposal and no verdict; confirm writes the reef; dispute stores the objection; 409 on a second in-flight turn; 415 and 403 from the guard; `GET /api/thread` order.
- `tests/web/stream.test.js`: `parseSseBuffer` on split frames, comments, and multi-line data.
- `tests/web/view-model.test.js`: snapshot `messages` count reaches the node.
- By hand before merge: one real probe on the System Design map against the live judge, including one reef proposal and its confirmation.

## Out of scope

- The judge choosing the next island on its own. It names the nearest open water; the user clicks.
- Multiple threads per island, or threads on straits.
- SDK session resume. Replay is enough at thread lengths a probe produces.
- Any change to the map drawing, positions, or the state strip.
