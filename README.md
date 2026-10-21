# Archipelago

A conversational tool for charting what you understand about a domain, shown as islands in open water.

The cartographer sketches islands and straits, either Claude in the terminal (a skill driving a CLI) or the cartographer in the map's own pane; either way you approve the sketch before it is drawn, into a local SQLite file. The judge lives in the browser: click an island, press **Make landfall**, and a conversation runs inside the map server on the Claude Agent SDK, through your Claude Code login. Verdicts land on the map within two seconds.

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

## In the browser, with your own key

The hosted build is the same map as a static site, with nothing to install. Open it, paste an Anthropic API key (or choose **Try without a key** to see how a turn goes on a scripted stand-in), and press **New domain…**. The cartographer sketches the islands and the judge runs in the page, on your key, with Sonnet 5.5 by default and Opus 5.5 one click away under **Your key** in the domain menu. Your key stays in that browser and is sent only to `api.anthropic.com`; every turn is billed to it.

Charts live in that browser's private storage, one tab at a time (a second tab offers **Use it here**). **Export database** in the domain menu downloads them as one `.sqlite` file, and **Import database…** replaces them with one. The two forms are the same file: `archipelago export` writes one from `~/.archipelago` that the browser imports, and an export from the browser opens locally with `ARCHIPELAGO_DB_PATH`.

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

The outline on the left lists the whole domain as a tree, every island at every scale with its state and lit landmarks; click one to go there, press `[` to collapse it to a rail of dashes that peeks on hover, and use the domain name at its top to switch domains. Click an island to select it. An anchor under the coast marks the harbour, the island to set out from; the strip at the top leads with it as **Set out from** until it is charted and **Home port** after. The map frames the island beside a pane on the right that holds everything about it: the head (name, state, landmark chips, **Sail closer** or **Sail in**, and **Note to cartographer**), the log, and the answer box. **Make landfall** starts the thread (**Explore it** on an island that already has a verdict); the judge asks first, each answer lights the landmarks it covers as a lit line in the log and a firm arc and a lit lamp on the coastline, and each verdict lands as a card in the log while the island fills in on the map. Messages render as markdown. The judge can ask with options: they appear as chips under its question, and a chip or your own words becomes your next message. It can also draw: a Mermaid diagram in a reply renders in the log. **Sail closer** takes you inside an island with no islets and opens the **Cartographer** pane, which sketches 4–8 islets for you to approve; a **Note to cartographer** goes to the same pane at the island's scale. The strip's last cell, **Cartographer**, opens it at any scale, and **New domain…** in the domain menu (or `n` in the outline) makes a domain and lets it sketch the first islands. A sketch shows as dashed *draft* islands on the map and as a card in the pane; nothing is written until you press **Approve sketch** (or `⌘↵` in the pane); reply to change it, or **Discard** it. Actions about the map sit in a card at the bottom centre: while a sketch is pending it offers **Approve sketch**; while a reef proposal is pending it offers **Confirm the reef** (the foot keeps **Dispute** with your objection), and after a verdict it offers **Sail to** the nearest open water. Drag the pane's left edge to resize it. Escape closes the pane and pans the map home.

Islands keep their place. The map lays out new islands once, around the ones already there, and stores the positions; verdicts never move anything. Drag an island to rearrange, and it stays where you put it. `archipelago island update --domain <slug> --slug <island> --x <0..1000> --y <0..1000>` sets a position by hand.

## The judge

`archipelago serve` runs the judge one of two ways. With `ANTHROPIC_API_KEY` set in the server's environment it runs on the Messages API (`--judge api`, default model `claude-opus-5-5` at effort `high`; `ARCHIPELAGO_EFFORT` changes the effort). Without a key it runs on `@anthropic-ai/claude-agent-sdk` through your Claude Code login (`--judge sdk`, default model `claude-opus-5`). `--judge` or `ARCHIPELAGO_JUDGE` picks one explicitly, and the startup line names the judge and model in use. Set `ARCHIPELAGO_MODEL` to change the model for either. A turn that runs past 180 s is cancelled and the island released; set `ARCHIPELAGO_TURN_TIMEOUT_MS` (milliseconds) to change that. `archipelago serve --stub` (or `ARCHIPELAGO_STUB=1`) runs a canned judge with no login, for development: a message containing `settled` charts the island, `reef` proposes a reef, `unlock <slug>` lights a landmark, `fail` errors; an island with no landmarks gets four canned ones (`shape`, `scale`, `failure`, `tradeoff`) on the first open. The stub also asks a three-option question on your second answer.

Every island carries 4–6 **landmarks**, the key concepts on it. The cartographer sketches them (`archipelago landmark add`); on an island that has none, the judge names them on the first probe. `archipelago harbour set --domain <slug> --island <slug>` marks the island to set out from at that scale. Each answer that covers a landmark lights it: a chip fills in the pane and one arc of the island's dotted coastline turns firm and its lamp lights on the map, before any verdict. The judge acknowledges what you got right, lights what you covered, nudges once at most, and asks the next question; the verdict lands when every landmark is lit, when a reef is clear, or after your fourth answer.

## Layout

```
src/core/      types, validators, migrations, repositories, view-model   (bun:sqlite)
src/cli/       the archipelago command
src/server/    Bun.serve JSON API + static files
src/hosted/    the same API in a Web Worker, on SQLite-WASM, for the static web build
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
bun run test:wasm     # the same tests on the WebAssembly SQLite
bunx tsc --noEmit     # typecheck
bun run build:web     # the hosted build, a static site in dist/web/ (with _headers for Cloudflare Pages)
bun run deploy:web    # build, then deploy dist/web to Cloudflare Pages (needs `wrangler login`)
```

Data lives in `~/.archipelago/archipelago.sqlite` unless `ARCHIPELAGO_DB_PATH` says otherwise.
