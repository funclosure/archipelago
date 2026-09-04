# Archipelago

A conversational tool for charting what you understand about a domain, shown as islands in open water.

Claude in the terminal is the cartographer: a skill drives a CLI that sketches islands and straits into a local SQLite file. The judge lives in the browser: click an island, press **Probe this**, and a conversation runs inside the map server on the Claude Agent SDK, through your Claude Code login. Verdicts land on the map within two seconds.

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

Click an island to select it. The card holds the island's thread: **Probe this** starts it, the judge asks first, and each verdict shows as a line in the thread while the island fills in on the map. A reef is proposed with the false claim and its consequence; you **Confirm** or **Dispute** it before it is written. **Sail closer** (or **Sail in** when the island has islets) and the note box still go to Claude in the terminal.

Islands keep their place. The map lays out new islands once, around the ones already there, and stores the positions; verdicts never move anything. Drag an island to rearrange, and it stays where you put it. `archipelago island update --domain <slug> --slug <island> --x <0..1000> --y <0..1000>` sets a position by hand.

## The judge

`archipelago serve` runs the judge on `@anthropic-ai/claude-agent-sdk`, which uses your Claude Code login; there is no API key. Set `ARCHIPELAGO_MODEL` to change the model (default `claude-opus-5`). `archipelago serve --stub` (or `ARCHIPELAGO_STUB=1`) runs a canned judge with no login, for development: a message containing `settled` charts the island, `reef` proposes a reef, `fail` errors.

## Layout

```
src/core/      types, validators, migrations, repositories, view-model   (bun:sqlite)
src/cli/       the archipelago command
src/server/    Bun.serve JSON API + static files
src/web/       one-canvas map, plain ES modules
.claude/skills/archipelago-chart/SKILL.md   the charting protocol
src/server/judge/PROTOCOL.md   the judge's protocol (system prompt), read at runtime
```

## Development

```bash
bun test              # bun's test runner (Vitest cannot load bun:sqlite)
bunx tsc --noEmit     # typecheck
```

Data lives in `.archipelago/archipelago.sqlite` (gitignored, per working directory).
