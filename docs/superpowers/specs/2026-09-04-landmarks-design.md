# Landmarks: a tighter judge loop

**Date:** 2026-09-04
**Status:** approved design, awaiting plan
**Builds on:** the web judge (`2026-09-04-web-judge-design.md`)

## Why

The first real sitting with the judge showed the loop is too loose. On Databases the reader wrote three long answers (about 3,800 characters) and got back three bare questions of under 220 characters each: no acknowledgement, nothing unlocked, and the island still open water after the exchange. The reader's words: each round should unlock something when a key concept is touched; the teacher should be inviting and acknowledge the answer; the feedback loop should be tighter on both the island and the response.

## Decisions

| Question | Decision |
|---|---|
| What a round unlocks | Landmarks: 4–6 named key concepts per island. The judge lights one the moment an answer covers it. |
| Who writes landmarks | The cartographer, at sketch time, with the CLI. For islands that have none (the whole existing chart), the judge derives them from the island's name and summary on the first probe, once. |
| Teaching inside a round | Acknowledge, unlock, one nudge, then ask. The full teaching paragraph still waits for the verdict. |
| Map before the verdict | The open-water dashed outline solidifies one arc per lit landmark. |
| When the verdict lands | When every landmark is lit, or a reef is clear, or after the fourth reader answer, whichever first. |
| Where the state lives | A `landmarks` table; one new judge tool per write; the snapshot carries counts and items; the reveal rides the version poll. |

## The judge's round

Every reply after a reader answer has this shape, in this order:

1. **Acknowledge**, one or two sentences, in the reader's own terms, quoting a phrase of theirs. Name the thing they got right; never "great answer".
2. **Unlock**: call `unlock_landmark` for each landmark the answer genuinely covered, then say so in one line ("that charts *transactions* and *contention*"). A landmark is covered when the reader explained or applied the concept, not when they merely named it.
3. **Nudge**: at most one sentence of correction or a pointed hint where they slipped. Never a paragraph.
4. **Ask**: one question, aimed at a landmark still dark, or one level deeper on one just lit.

Cap: about 120 words before the question. Plain prose, no lists, no headings.

**Opening turn** (empty thread): one line naming this island's landmarks ("Here the coastline has five points: …"), then one probe question. If the island has no landmarks, the judge first calls `set_landmarks` with 4–6 derived from the island's name and summary, then opens.

**Verdict rule.** The judge calls `record_verdict` (or `propose_reef`) when every landmark is lit, or when a reef is clear, or right after the fourth reader answer regardless of state. Tests: *sandbar* = some landmarks lit and the shape right; *settled* = all lit and applied to the scenario; *mountainous* = all lit plus an edge case handled or "why the naive way fails" explained by the reader. After the verdict: the teaching paragraph and where to sail next, as today. An island is never left open after four answers.

**Reef and dispute** are unchanged. The round count is the number of reader text messages in the thread, which the context block states.

The protocol text (`src/server/judge/PROTOCOL.md`) carries all of this; sections 1, 2 and 4 are rewritten accordingly.

## Data

`src/core/migrations/0004_landmarks.sql`:

```sql
create table landmarks (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  slug text not null,
  name text not null,
  sort_order integer not null default 0,
  unlocked_at text,
  evidence text,
  message_id integer references messages(id) on delete set null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (island_id, slug)
);
create index landmarks_island on landmarks(island_id, sort_order, id);
create trigger landmarks_ai after insert on landmarks begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger landmarks_au after update on landmarks begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger landmarks_ad after delete on landmarks begin
  update view_state set version = version + 1 where domain_id = old.domain_id;
end;
```

`unlocked_at` null means dark. `evidence` is the reader's quote that lit it; `message_id` the reader message it came from.

Repository `src/core/repositories/landmarkRepository.ts`:

- `upsertLandmark(db, { domainId, islandId, slug, name, sortOrder })` — insert or rename; never touches `unlocked_at`.
- `setLandmarks(db, domainId, islandId, items[{slug,name}])` — in one transaction: upserts the given items in order and deletes dark landmarks not in the list; lit ones are always kept. Used by the judge's `set_landmarks` (only when the island has none) and by the CLI when re-sketching.
- `unlockLandmark(db, islandId, slug, evidence, messageId | null)` — throws `NotFoundError` (with the island's landmark slugs as `valid`) for an unknown slug, `ConflictError` if already lit.
- `listLandmarks(db, islandId)`, `listLandmarksByIsland(db, islandIds) → Map<islandId, Landmark[]>` (the snapshot counts and lists from the same rows; a separate `countLandmarks` was folded into it).

`Landmark` type in `types.ts`; slugs validated by `slugSchema`, unique per island (not per domain: the same landmark name can recur on different islands).

Snapshot: each `IslandView` gains `landmarks: { total, unlocked, items: [{ slug, name, lit, evidence }] }`. The judge context gains `landmarks: Landmark[]` and `round: number` (count of reader text messages).

## Tools

| Tool | Input | Effect |
|---|---|---|
| `set_landmarks` | `items: [{ slug, name }]`, 4–6 | Allowed only when the island has no landmarks; otherwise `{ error }`. Writes them via `setLandmarks`. |
| `unlock_landmark` | `slug`, `evidence` | Lights the landmark, links the latest reader text message, appends a thread `system` message `landmark lit: <name>`. Unknown or already-lit → `{ error }`, nothing written. |

`record_verdict` and `propose_reef` are unchanged. `island_context` returns the landmarks and the round.

## CLI and skill

- `landmark add --domain --island --slug --name [--order]` (upsert), `landmark list --domain --island`.
- The cartographer's skill: the island sketch table gains a landmarks column (4–6 per island); after approval, write them with `landmark add`. Sailing closer also sketches landmarks for each islet.

## Page

- **Card header**: a chip row under the summary, in sort order. Dark chips: muted text, dashed border. Lit chips: sand fill, dark text; `title` carries the evidence quote. Under the chips: `3 of 5 charted · round 2 of 4` (round shown only while the island is open water and the thread is non-empty). Islands with zero landmarks show no row.
- **Thread**: a `system` message whose body starts with `landmark lit:` renders as an inline sand chip with the landmark name, not as the uppercase "charted as" line. The matching header chip gets a one-time `lit` animation when it changes from dark to lit while the card is open.
- **Map** (`draw.js`): for an open-water island with `landmarks.total > 0`, the 14-point outline is split into `total` runs of consecutive segments (pure helper `litSegments(segments, total, unlocked)` in `view-model.js`; `draw.js` rotates its result a quarter turn so the runs start at the top and go clockwise); segments in lit runs are drawn solid at the sandbar colour, dark runs keep the dash. A verdict fills the island as today. Nodes carry `landmarks` from the snapshot.
- Card and map both read from the snapshot; the poll reveals both within two seconds of a tool write, and the thread refetches as today.

## The answer dock

The reader's controls leave the card. A fixed **dock** sits at the bottom centre of the page (above the legend and strip, about 640px wide, narrower on small windows) and is shown only while an island is selected. It holds the answer box and **Send**. When the selected island's thread has a pending reef proposal, the dock switches to reef mode: the box's placeholder becomes "what is wrong with this reef", the buttons become **Confirm** and **Dispute** (Dispute sends the box's text as the objection, empty allowed). While a turn is in flight the dock is disabled and reads "the judge is thinking…". The card keeps the thread, chips, verdict, and the note-for-Claude box; the reef block in the thread shows the claim, the consequence, and its status, with no buttons of its own. Focus returns to the dock's box after a turn, as it did for the card's box. Escape still clears the selection only when the box is not focused.

## Stub

`serve --stub`: a reader message containing `unlock <slug>` lights that landmark; an empty thread on a landmark-less island calls `set_landmarks` with four canned items (`shape`, `scale`, `failure`, `tradeoff`) before the opening line. Other keywords unchanged.

## Failure rules

- `set_landmarks` when landmarks exist, or `unlock_landmark` on an unknown or lit slug: `{ error }` back to the model, nothing written.
- A first-open turn that fails after `set_landmarks` leaves the landmarks in place (they are cartography now); the next open probes normally.
- Deleting an island cascades its landmarks; deleting a message nulls `message_id`.

## Tests

- `tests/core/landmarkRepository.test.ts`: upsert, setLandmarks keeps lit and removes dark, unlock happy path and both errors, counts, version bumps on insert/update/delete.
- `tests/core/db.test.ts`: 0004 on fresh and pre-existing databases.
- `tests/core/view-model.test.ts`: snapshot landmark counts and items.
- `tests/server/tools.test.ts`: `set_landmarks` gate, `unlock_landmark` writes row + system line + message link, context carries landmarks and round.
- `tests/server/stub.test.ts`: `unlock <slug>` and first-open `set_landmarks`.
- `tests/server/protocol.test.ts`: the protocol names `unlock_landmark`, `set_landmarks`, "acknowledge", and the four-answer rule.
- `tests/cli/cli.test.ts`: `landmark add/list`.
- `tests/web/view-model.test.js`: `litSegments` splits 14 segments into `total` runs and marks the first `unlocked` lit.
- `tests/web/thread.test.js`: a `landmark lit:` system message is classified as `landmark`.
- By hand: the dock appears at the bottom centre when an island is selected, disappears when none is, switches to Confirm / Dispute on a pending reef, and is disabled during a turn.
- By hand on a scratch database against the real judge: an answer lights a chip and an arc mid-reply; the fourth answer produces a verdict.

## Out of scope

- Landmarks on straits.
- Un-lighting a landmark (a dispute reopens the verdict, not a landmark).
- Landmark-level verdict states; a landmark is dark or lit.
- No server-side backstop for the four-answer rule; it lives in the context line and the protocol.
