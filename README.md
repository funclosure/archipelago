# Archipelago

A conversational tool for charting what you understand about a domain, shown as islands in open water.

Claude in the terminal is the cartographer: a skill drives a CLI that sketches islands and straits into a local SQLite file. The judge lives in the browser: click an island, press **Make landfall**, and a conversation runs inside the map server on the Claude Agent SDK, through your Claude Code login. Verdicts land on the map within two seconds.

Read `docs/BRIEF.md` for the idea and `docs/superpowers/specs/2026-09-03-archipelago-slice1-design.md` for how this slice is built.

## Quick start

Requires [Bun](https://bun.sh) and [Claude Code](https://claude.ai/code).

```bash
bun install
bun link                        # once: puts `archipelago` on your PATH
archipelago serve               # starts the map at http://127.0.0.1:4480 and opens it
```

Data lives in `.archipelago/` under the **current working directory**, so run `archipelago serve` and the Claude Code session from the same directory (or set `ARCHIPELAGO_DB_PATH` for both).

Then in Claude Code, inside this directory:

> /archipelago-chart — I want to chart System Design.

Claude sketches the archipelago and you approve it in the terminal. Then open the map, click an island and probe it: the judge asks, you answer, and the map fills in.

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

Click an island to select it. The map frames the island beside a pane on the right that holds everything about it: the head (name, state, landmark chips, **Sail closer** or **Sail in**, and **Note to cartographer**), the log, and the answer box. **Make landfall** starts the thread (**Explore it** on an island that already has a verdict); the judge asks first, each answer lights the landmarks it covers as a lit line in the log and a solid arc on the coastline, and each verdict lands as a card in the log while the island fills in on the map. Messages render as markdown. While a reef proposal is pending the box switches to **Confirm** and **Dispute**, and you answer the proposal — its false claim and its consequence — before the reef is written. Escape closes the pane and pans the map home.

Islands keep their place. The map lays out new islands once, around the ones already there, and stores the positions; verdicts never move anything. Drag an island to rearrange, and it stays where you put it. `archipelago island update --domain <slug> --slug <island> --x <0..1000> --y <0..1000>` sets a position by hand.

## The judge

`archipelago serve` runs the judge on `@anthropic-ai/claude-agent-sdk`, which uses your Claude Code login; there is no API key. Set `ARCHIPELAGO_MODEL` to change the model (default `claude-opus-5`). A turn that runs past 180 s is cancelled and the island released; set `ARCHIPELAGO_TURN_TIMEOUT_MS` (milliseconds) to change that. `archipelago serve --stub` (or `ARCHIPELAGO_STUB=1`) runs a canned judge with no login, for development: a message containing `settled` charts the island, `reef` proposes a reef, `unlock <slug>` lights a landmark, `fail` errors; an island with no landmarks gets four canned ones (`shape`, `scale`, `failure`, `tradeoff`) on the first open.

Every island carries 4–6 **landmarks**, the key concepts on it. The cartographer sketches them (`archipelago landmark add`); on an island that has none, the judge names them on the first probe. Each answer that covers a landmark lights it: a chip fills in the pane and one arc of the island's dashed coastline turns solid on the map, before any verdict. The judge acknowledges what you got right, lights what you covered, nudges once at most, and asks the next question; the verdict lands when every landmark is lit, when a reef is clear, or after your fourth answer.

## Layout

```
src/core/      types, validators, migrations, repositories, view-model   (bun:sqlite)
src/cli/       the archipelago command
src/server/    Bun.serve JSON API + static files
src/web/       one-canvas map and the conversation pane, plain ES modules
.claude/skills/archipelago-chart/SKILL.md   the cartographer's protocol
src/server/judge/PROTOCOL.md   the judge's protocol (system prompt), read at runtime
```

## Development

```bash
bun test              # bun's test runner (Vitest cannot load bun:sqlite)
bunx tsc --noEmit     # typecheck
```

Data lives in `.archipelago/archipelago.sqlite` (gitignored, per working directory).
