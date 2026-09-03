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
