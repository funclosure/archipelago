# Shared maps

The maps on <https://archipelago.school/maps> and under **New domain → Start from a shared map…**. Each file is one subject as a map file (the format is in the repository README under *Sharing a map*): structure only, free for anyone to take.

## Adding a map

1. Export a domain (**Export this map** in the domain menu, or `archipelago map export --domain <slug>`), or have another AI write one with the prompt under **New domain → Import a map**.
2. Add `"by": "Your name"` and `"icon": "🧭"` (one emoji, drawn on the map's island in the gallery) to the file, and `"language": "zh-TW"` if it is in Traditional Chinese. Remove any `x` / `y` positions, so each reader arranges their own.
3. Save it here as `<slug>.archipelago.json` (English) or `<slug>.zh-TW.archipelago.json`, where `<slug>` is the file's own `slug`. A translation keeps every slug of the original.
4. Run `bun run gallery:index`, which checks every map and rewrites `index.json`, then `bun test tests/web/gallery.test.js`.
5. Open a pull request.

## What a shared map needs

- 6 to 12 islands at the top, each with a one-line summary and 3 to 8 landmarks: the ideas someone must be able to explain to say they understand the island.
- `"harbour": true` on the one island a newcomer starts from (usually the first).
- 2 to 4 seas, with every island in exactly one.
- A description: one or two sentences on what the map is for and who it is for.
- Accurate, and your own work. A map is read by people who do not yet know the subject.
- By adding a file you share it under the repository's MIT License.
