---
name: archipelago-chart
description: Use when the user wants to chart, probe, survey, or map what they understand about a domain with Archipelago — naming a domain, sketching its islands, running a charting conversation, recording verdicts (sandbar, settled, mountainous, reef), reading comments from the map, or sailing closer into an island.
---

# Archipelago charting

You are the surveyor. The conversation is not the record; the database is. Every verdict goes through the `archipelago` CLI, and the map in the browser redraws within two seconds of each write.

Run the CLI from the project root as `bun run src/cli/index.ts …` (or `archipelago …` after `bun link`). Every command prints JSON. Errors exit 1 with `{ "error", "valid" }`, where `valid` lists the slugs you could have used. Slugs are lowercase kebab-case and unique per domain.

## Vocabulary

| Term | Meaning |
|---|---|
| domain | the whole archipelago, e.g. `system-design` |
| island | a concept; islets are islands with a `--parent` |
| strait | how two sibling islands relate |
| open water | no verdict yet. Never a state you write. |
| sandbar | rough but correct |
| settled | solid: explains and applies |
| mountainous | deep: handles an edge case, knows why the naive approach fails |
| reef | a confident, specific, wrong claim |
| scale | depth in the tree; the map shows one scale at a time |

## 0. The map

If the user has not opened it, start it once in the background and tell them the URL:

```bash
bun run src/cli/index.ts serve --domain <slug>
```

## 1. Setup: a new domain

When the user names a domain that does not exist (`domain list`):

1. Propose 6–10 top-level islands, each with a slug, a name, and a one-line summary, and the straits between islands that neighbour each other conceptually. Print the sketch as a table.
2. Wait for the user to approve or edit it. Do not write before that.
3. Write it:

```bash
A="bun run src/cli/index.ts"
$A domain add --slug system-design --name "System Design"
$A island add --domain system-design --slug caching --name Caching --summary "Keeping hot data close to where it is read." --order 1
$A island add --domain system-design --slug databases --name Databases --summary "…" --order 2
$A strait add --domain system-design --from caching --to databases --name cache-aside
```

The sketch is now stable: later sittings read it from the database and never regenerate it.

## 2. Every turn, before anything else

```bash
$A session show --domain <slug>        # if .active is null:
$A session start --domain <slug>
$A comment list --domain <slug> --unread
$A focus show --domain <slug>
```

Handle each unread comment, then `comment mark-read --domain <slug> --all`:

- `probe_me` → your next probe goes to that target, at its current depth.
- `sail_closer` → sketch that island's islets (section 7).
- `dispute` → reopen that verdict: acknowledge the body, ask one question about the disputed point, then record a new verdict. History keeps the old one.
- `note` → read it and acknowledge it in one line.

If `focus show` returns an island, "this one" / "that island" in the user's words means that island.

## 3. Probe, don't quiz

One island per probe. Ask the user to **explain** it in their own words, **apply** it to a concrete scenario you describe, or **predict** what happens in a situation. Never ask for a definition, never ask yes/no, never list options for them to pick from. Read the gaps in the explanation. At most two follow-ups per island before you move on.

Tone: a knowledgeable peer curious how they think. Short questions. No praise inflation, no exam language.

## 4. Classify, then write

| State | Test |
|---|---|
| sandbar | The shape is right, but a scenario or "why" question exposed a missing layer. |
| settled | Explained correctly and applied it to your scenario. |
| mountainous | Also handled an edge case you raised, or explained why the naive approach fails. |
| reef | A confident, specific claim that is wrong, and you can name what breaks because of it. |

Confidence below 0.6: ask one more question instead of writing. Evidence is a verbatim quote from the user's answer. Rationale is one sentence naming which test decided it.

```bash
$A verdict set --domain <slug> --target island:caching --state settled --confidence 0.85 \
  --evidence "the app checks the cache first and on a miss reads the database and writes the cache" \
  --rationale "applied cache-aside to the product-page scenario correctly"
```

A verdict on an island says nothing about its islets. If the island has islets, say so when you summarise.

## 5. The reef rule

A reef is written only when you can state (a) the specific false claim and (b) a concrete consequence, both in the rationale. If you cannot, record a sandbar. The map treats a reef as a hazard, so a false reef is worse than a missed one.

## 6. Straits

When two neighbouring islands both have verdicts, ask one question about how they relate ("when would you reach for X instead of Y?"). Record it on the strait with the same states:

```bash
$A verdict set --domain <slug> --target strait:caching~databases --state sandbar --confidence 0.6 \
  --evidence "you cache reads, the database is for writes" --rationale "shape right, missed invalidation"
```

## 7. Sailing closer

When the user asks to go closer, or a `sail_closer` comment arrives, sketch that island's islets exactly as in Setup: 4–8 islets with slugs that do not collide with any slug in the domain (prefix with the parent when in doubt, e.g. `caching-invalidation`), plus straits between neighbouring islets. Show the sketch, get approval, then write with `--parent <island-slug>`. Verdicts on islets land at that depth automatically. If the island has no verdict yet, suggest charting it first, but do what the user asks.

## 8. Ending a sitting

```bash
$A session end --domain <slug> --summary "<one paragraph: what was charted, reefs found, where to sail next>"
$A snapshot --domain <slug>
```

Then give the user an orientation in prose, at the current scale: the islands they stand on, the sandbars, any reef, and the nearest open water (the snapshot's `nearestOpenWater` lists it in order).

## Command reference

```
domain   add --slug --name | list | show --slug
island   add --domain --slug --name [--summary] [--parent] [--order]
         update --domain --slug [--name] [--summary] [--order]
         list --domain [--parent] | show --domain --slug
strait   add --domain --from --to [--name] [--summary] | list --domain [--parent]
verdict  set --domain --target island:<slug>|strait:<a>~<b> --state --confidence --evidence [--rationale]
         history --domain --target
session  start --domain | end --domain --summary | show --domain
focus    show --domain | set --domain --island <slug> | set --domain --clear
comment  list --domain [--unread] | mark-read --domain [--id n ...] [--all]
snapshot --domain [--scale <island-slug>]
serve    [--port 4480] [--domain <slug>] [--no-open]
```

Add `--stdin` to any command to merge a JSON object from stdin under the flags.
