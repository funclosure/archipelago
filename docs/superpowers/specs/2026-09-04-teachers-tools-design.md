# Teacher's tools: diagrams, structured questions, and calls to action

**Date:** 2026-09-04
**Status:** approved design, awaiting plan
**Builds on:** chart-and-log (`2026-09-04-chart-and-log-design.md`), landmarks (`2026-09-04-landmarks-design.md`)
**Prototype:** https://claude.ai/code/artifact/a251c701-2f8a-4bd2-9e1c-090be3cfa9c0

## Why

Victor: "the teacher needs more skills: master on creating diagrams using Mermaid; can use AskUserQuestions to ask questions; the user interaction can be in the conversation, or on the bottom-centre area as calls to action." The prototype tried three placements. The decision is **both, by kind**: knowledge questions with options stay in the log under the judge's message; actions about the map (confirming a reef, sailing to the next island) come to a call-to-action card at the bottom centre of the map.

## Decisions

| Question | Decision |
|---|---|
| Diagrams | The judge writes ```` ```mermaid ```` fences in its replies; the page renders them. No new tool. The protocol says when a diagram earns its place. |
| Mermaid on the page | Vendored: `mermaid` becomes an npm dependency and the server serves `/vendor/mermaid.js` from `node_modules/mermaid/dist/mermaid.min.js`. No CDN at runtime. |
| Structured questions | A new judge tool `ask_reader({ question, options })`, 2–4 options. It ends the turn. The reader picks an option or types a free answer; either becomes the reader's next message. |
| Where options render | In the log, under the judge's message, as chips. Picked chips stay in the log, the picked one filled. |
| The call-to-action card | Bottom centre of the map area. Shows the pending reef (`Confirm the reef` / `Dispute below`) and, after a verdict, `Sail to <next>` / `Stay here`. Never shows a knowledge question. |
| Reef controls | Confirm moves from the foot to the card. Dispute stays in the foot with the objection box. |
| Pane width | Opens at 480px, resizable by dragging its left edge between 340 and 760px, remembered in `localStorage`. |

## The judge's protocol

`src/server/judge/PROTOCOL.md` gains two sections.

**Diagrams.** Draw when the thing being explained has three or more parts that relate (a request path, a scaling route, a state machine, a topology), at most one per reply, at most eight nodes, in a ```` ```mermaid ```` fence with `flowchart TB`, `sequenceDiagram`, or `stateDiagram-v2`. Never in the opening turn, never for a list, never to decorate. One sentence before it says what it shows; one sentence after says where the reader is on it.

**Asking with options.** Call `ask_reader` when a choice discriminates faster than a paragraph would: which resource saturates first, which of two designs is right, what happens next. Two to four options, all plausible, one of them what the reader would say if they already understood. At most one ask per two rounds, never in the opening turn, never as the deciding round's question. After the tool returns, stop: the reader is choosing. The picked option arrives as the reader's next message and counts as a round.

## Data

`src/core/migrations/0006_asks.sql`:

```sql
create table asks (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  message_id integer not null references messages(id) on delete cascade,  -- the judge's question
  options text not null,          -- JSON array of strings
  picked text,                    -- the option or free text the reader answered with
  picked_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index asks_island on asks(island_id, id);
create trigger asks_ai after insert on asks begin update view_state set version = version + 1 where domain_id = new.domain_id; end;
create trigger asks_au after update on asks begin update view_state set version = version + 1 where domain_id = new.domain_id; end;
```

The `messages.kind` check is untouched: the question is a normal judge `text` message; the ask row attaches the options to it. `GET /api/thread` returns `asks: [{ id, messageId, options, picked }]` beside `messages`.

## Tools

`ask_reader` (`src/server/judge/tools.ts`): validates `question` (non-empty) and `options` (2–4 trimmed unique strings), writes the judge message with the question as body and the ask row in one transaction, returns `{ askId, note: "the reader is choosing; end your turn" }`. `sdk.ts` adds it to `allowedTools`. The runner treats a turn that called `ask_reader` as complete after the model's next text block (the model is told to stop; the server does not need to enforce it, the reader's next message is the only way forward).

`POST /api/probe` accepts an optional `askId`; when present the server marks that ask `picked = message`, `picked_at = now` before running the turn (409 if already picked). The stub judge asks a canned question on the second round of any island (`stub: which of these is true?` with three options) and lights a landmark when the first option is picked.

`JudgeContext` includes the pending ask, if any, and the round rendering shows picked asks as `[asked: … → picked: …]` in the thread prompt.

## Page

- `markdown.js`: a closed ```` ```mermaid ```` fence becomes `<div class="diagram">` with a `diagram` caption and the SVG from `mermaid.render`, cached by source text so streaming re-renders never redraw; an open fence renders a `drawing a diagram…` placeholder; a render error shows the source as a code block. `mermaid.initialize` runs once with the map's palette (`theme: "dark"`, the sand line colour, the water background, `htmlLabels: false`, `useMaxWidth: false`). Diagrams draw at natural size and scroll sideways inside their box.
- `card.js`: a judge message that has an ask renders a `choices` block under it: the caption `choose one, or answer below` (or `you chose`), the options as chips, the picked one filled and the rest disabled. Clicking a chip sends it as the reader's message with `askId`. While an ask is pending the foot's placeholder reads `or answer in your own words`, and a typed answer also carries `askId`.
- `cta.js` (new): renders `<div id="cta">` at the bottom centre of the map area (between the outline and the pane). It shows one of: the pending reef proposal with `Confirm the reef` and `Dispute below` (the latter focuses the foot); after a verdict on the selected island, `Sail to <nearest open>` and `Stay here` (stay hides it until the selection changes). Hidden otherwise and during a turn. Confirm is one-shot as today.
- The foot in reef mode keeps the objection box and `Dispute`; `Confirm` is no longer there. Meta line: `Confirm at the bottom of the map · Dispute sends your objection`.
- Pane resize: a 10px grip on the pane's left edge; dragging sets `--pane-w` within 340–760px, shows the width while dragging, saves to `localStorage`, and reframes the map on release.

## Copy

- Choices caption: `choose one, or answer below`; after picking: `you chose`.
- Card labels: `reef?` with `Confirm the reef` / `Dispute below`; `charted` with `Sail to <name>` / `Stay here`.
- Diagram caption: `diagram`; placeholder `drawing a diagram…`.
- Foot placeholder while an ask is pending: `or answer in your own words`.

## Tests

- `tests/core/db.test.ts`: 0006 applies; triggers bump the version.
- `tests/core/askRepository.test.ts`: `addAsk`, `listAsks`, `pickAsk` (409 on a second pick), options validated.
- `tests/server/judge/tools.test.ts`: `ask_reader` writes message + ask atomically and rejects bad options; `tests/server/routes.test.ts`: `/api/thread` includes asks; `/api/probe` with `askId` marks it picked, 409 when picked twice; the stub's canned ask.
- `tests/web/thread.test.js`: `mdBlocks` carries the fence language and closed flag; `logItems` attaches asks to their message.
- By hand against the stub: the diagram renders in the pane and scrolls when wide; the ask chips appear and the pick becomes a message; the reef card at the bottom centre confirms once; `Sail to` selects the next island; the pane resizes and remembers.

## Out of scope

- The reader drawing diagrams. Editable diagrams.
- Multi-select questions, free-text-only asks (the free answer already covers it).
- Any other action in the call-to-action card.
