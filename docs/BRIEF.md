# Archipelago — Project Brief

*Draft 2 · September 2026*

## One-line

Archipelago is a conversational tool for exploring a knowledge landscape with Claude. It charts what you understand about a domain, at whatever scale you're looking, and shows it as a map of islands in open water.

## The idea

Knowledge is a landscape, and like a coastline it is fractal: at every scale there is always more detail beneath. "iOS Development" contains "Swift Concurrency," which contains "actors," which contains "reentrancy," and so on down. No view is the final one.

But a knowledge landscape is not a continent. Most of it, for any one person, is water. What you actually understand shows up as islands — some large and settled, some tiny outcrops you've touched once — and the interesting questions are about the sea between them: is that strait narrow enough to bridge? Is there a submerged ridge connecting two islands you didn't realize you already understood?

Archipelago takes this seriously in two ways:

1. **Scale is always explicit.** The user is always *somewhere* — looking at the whole archipelago, a single island, or one bay on that island — and the tool knows which. Sail closer and an island reveals its own coastline, its own headlands, its own offshore islets. Sail away and it collapses back into a single shape.
2. **Well-roundedness is judged per scale.** The question is never "do you know everything?" but "at this level of zoom, which islands are charted and where is the open water?" A user can be well-rounded across the archipelago while having deep, narrow expertise on one island.

## Core loop

1. **Setup.** The user names a domain they want to explore (e.g. iOS Development, System Design). Claude sketches the archipelago at the top scale: the major islands and the waters between them.
2. **Charting.** Through conversation, Claude probes the user's understanding. This is the heart of the product and is designed around a specific insight: understanding is not binary. A user might
   - have a rough but correct mental model,
   - have the right shape but be missing a deeper layer,
   - be confidently wrong about a detail,
   - or have never encountered the concept at all.
   Archipelago must distinguish these, because each calls for a different next step.
3. **Map.** Each charting pass updates the visual map at the current scale. Proficiency is encoded visually (elevation, size, density, color, or style — to be designed).
4. **Orient.** At a glance the user can see, for the scale they're at, which islands are charted and where the nearest open water is. Then they choose: sail closer to one island, or widen out and cross a strait.

## Charting principles

- **Probe, don't quiz.** The conversation should feel like talking to a knowledgeable peer who's curious how you think, not like an exam. Claude asks the user to explain, apply, or predict — and reads the gaps in the explanation.
- **Capture nuance.** The proficiency model must represent at minimum: open water (unexplored), sandbar (rough but correct), settled island (solid), mountainous island (deep), and reef (misconception present).
- **Open water is not a low score.** It is unsurveyed sea. The UI must never make "unknown" look like "beginner."
- **Reefs are their own thing.** A misconception looks like solid ground from a distance and will wreck you. It must be visually distinct from a gap, because the fix is different: a gap needs landfall, a reef needs to be charted and avoided.
- **Straits count.** Knowing two neighboring islands without knowing how they relate is a real gap. The map should show channels, not just islands.
- **Scale-aware verdicts.** Every assessment is tagged with the scale it was made at. Deep understanding at one zoom does not imply coverage at the next.

## The map

- Shows the archipelago at the current scale, with the user's proficiency layered on.
- Immediately legible: large, elevated islands are known ground; open water is where to sail next.
- Zoomable. Approaching an island reveals its internal structure; leaving it summarizes it.
- Reefs are marked distinctly from open water.
- Straits between neighboring islands are visible and can themselves be charted.

## Working vocabulary

| Term | Meaning |
|------|---------|
| Archipelago | A whole domain the user is exploring |
| Scale | The current zoom level |
| Island | A concept or cluster the user has some footing on |
| Elevation | Depth of understanding on an island |
| Open water | Unsurveyed — not yet assessed |
| Sandbar | Rough but correct understanding |
| Reef | A misconception — looks solid, isn't |
| Strait | The relationship between two neighboring islands |
| Charting | A conversational assessment pass |
| Landfall | First contact with a previously unexplored concept |

## Form factor

- A web app that runs locally.
- Interacts directly with a Claude session; Claude is both the surveyor and the cartographer.
- Technology choices (framework, storage, rendering, how the Claude session is wired) are deliberately left open for a later decision.

## Success looks like

A user opens Archipelago, says "System Design," has a fifteen-minute conversation, and walks away able to say: *here are the islands I actually stand on, here is where I only had a sandbar, here is the one reef I'd have hit, and here is the open water I should sail into next.* And they could say the same thing again at any depth they chose to zoom into.

## Open questions

- How does Claude generate the initial archipelago for a domain, and how stable should it be across sessions?
- How much of the map is pre-structured vs. emergent from conversation?
- How are the five proficiency states inferred from free conversation with enough reliability to be trusted?
- What does "sailing closer" look like in conversation — a change of topic, or a change of questioning style?
- How are reefs detected? A confident wrong answer looks, in text, a lot like a confident right one.
