# Archipelago

A conversational tool for charting what you understand about a domain, shown as islands in open water.

Claude in the terminal is the cartographer: a skill drives a CLI that sketches islands and straits into a local SQLite file. The judge lives in the browser: click an island, press **Make landfall**, and a conversation runs inside the map server on the Claude Agent SDK, through your Claude Code login. Verdicts land on the map within two seconds.

Read `docs/BRIEF.md` for the idea and `docs/superpowers/specs/2026-09-03-archipelago-slice1-design.md` for how this slice is built.

## Quick start

Requires [Bun](https://bun.sh) and [Claude Code](https://claude.ai/code).

Install it as a Claude Code plugin:

```
/plugin install archipelago --marketplace funclosure/archipelago
```

(or `/plugin marketplace add funclosure/archipelago`, then `/plugin install archipelago@archipelago`). The plugin brings the charting skill and puts the `archipelago` command on Claude's PATH; Claude Code installs its dependencies. Then, in any directory:

> /archipelago-chart — I want to chart System Design.

Claude sketches the archipelago and you approve it in the terminal. It starts the map (`archipelago serve`, http://127.0.0.1:4480); click an island and probe it: the judge asks, you answer, and the map fills in.

Data lives in `~/.archipelago/archipelago.sqlite`, one database per user. Set `ARCHIPELAGO_DB_PATH` to use another file (for both the CLI and the server).

From a clone instead: `bun install`, then `bun link` puts `archipelago` on your PATH, and the skill loads as a project skill inside the repo.

## The five states

| State | Meaning | On the map |
|---|---|---|
| open water | not yet assessed | dotted coast, one arc per landmark, hollow lamps |
| sandbar | rough but correct | one contour ring, sand fill |
| settled | solid | two rings, grass fill |
| mountainous | deep | three rings and a snow cap |
| reef | a misconception | sandbar's ring and fill under a red hatch |

Open water is never a low score. A reef is a hatch over an elevation, never a separate shape. Elevation is countable: nobody needs a legend.

## From the map

The outline on the left lists the whole domain as a tree, every island at every scale with its state and lit landmarks; click one to go there, press `[` to collapse it to a rail of dashes that peeks on hover, and use the domain name at its top to switch domains. Click an island to select it. An anchor under the coast marks the harbour, the island to set out from; the strip at the top leads with it as **Set out from** until it is charted and **Home port** after. The map frames the island beside a pane on the right that holds everything about it: the head (name, state, landmark chips, **Sail closer** or **Sail in**, and **Note to cartographer**), the log, and the answer box. **Make landfall** starts the thread (**Explore it** on an island that already has a verdict); the judge asks first, each answer lights the landmarks it covers as a lit line in the log and a firm arc and a lit lamp on the coastline, and each verdict lands as a card in the log while the island fills in on the map. Messages render as markdown. The judge can ask with options: they appear as chips under its question, and a chip or your own words becomes your next message. It can also draw: a Mermaid diagram in a reply renders in the log. Actions about the map sit in a card at the bottom centre: while a reef proposal is pending it offers **Confirm the reef** (the foot keeps **Dispute** with your objection), and after a verdict it offers **Sail to** the nearest open water. Drag the pane's left edge to resize it. Escape closes the pane and pans the map home.

Islands keep their place. The map lays out new islands once, around the ones already there, and stores the positions; verdicts never move anything. Drag an island to rearrange, and it stays where you put it. `archipelago island update --domain <slug> --slug <island> --x <0..1000> --y <0..1000>` sets a position by hand.

## The judge

`archipelago serve` runs the judge on `@anthropic-ai/claude-agent-sdk`: with `ANTHROPIC_API_KEY` set in the server's environment it uses that key, otherwise your Claude Code login. Set `ARCHIPELAGO_MODEL` to change the model (default `claude-opus-5`). A turn that runs past 180 s is cancelled and the island released; set `ARCHIPELAGO_TURN_TIMEOUT_MS` (milliseconds) to change that. `archipelago serve --stub` (or `ARCHIPELAGO_STUB=1`) runs a canned judge with no login, for development: a message containing `settled` charts the island, `reef` proposes a reef, `unlock <slug>` lights a landmark, `fail` errors; an island with no landmarks gets four canned ones (`shape`, `scale`, `failure`, `tradeoff`) on the first open. The stub also asks a three-option question on your second answer.

Every island carries 4–6 **landmarks**, the key concepts on it. The cartographer sketches them (`archipelago landmark add`); on an island that has none, the judge names them on the first probe. `archipelago harbour set --domain <slug> --island <slug>` marks the island to set out from at that scale. Each answer that covers a landmark lights it: a chip fills in the pane and one arc of the island's dotted coastline turns firm and its lamp lights on the map, before any verdict. The judge acknowledges what you got right, lights what you covered, nudges once at most, and asks the next question; the verdict lands when every landmark is lit, when a reef is clear, or after your fourth answer.

## Layout

```
src/core/      types, validators, migrations, repositories, view-model   (bun:sqlite)
src/cli/       the archipelago command
src/server/    Bun.serve JSON API + static files
src/web/       one-canvas map and the conversation pane, plain ES modules
src/web/contour.js   the island geometry, box units, pure
src/web/outline.js   the outline panel
src/web/outline-model.js  the outline's pure row helpers, tested
src/web/cta.js   the call-to-action card
.claude/skills/archipelago-chart/SKILL.md   the cartographer's protocol
src/server/judge/PROTOCOL.md   the judge's protocol (system prompt), read at runtime
```

## Development

```bash
bun test              # bun's test runner (Vitest cannot load bun:sqlite)
bunx tsc --noEmit     # typecheck
```

Data lives in `~/.archipelago/archipelago.sqlite` unless `ARCHIPELAGO_DB_PATH` says otherwise.
