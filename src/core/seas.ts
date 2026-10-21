// The membership rule of `src/web/sea-model.js` for the server side: each island belongs to its nearest sea name
// within REACH island radii. The cartographer reads seas through this, so it sees the grouping the reader sees.
import type { Sea } from "./types.ts";

/** Mirrors REACH in src/web/sea-model.js. */
export const REACH = 7.5;

/** Mirrors islandRadius in src/web/view-model.js: every island at a scale shares one radius. */
export function islandRadius(count: number): number {
  return Math.min(88, Math.max(48, 220 / Math.sqrt(Math.max(1, count))));
}

/** Each sea's island slugs, in the islands' order. Unplaced islands (no position yet) belong to no sea. */
export function seaMembers(seas: Pick<Sea, "id" | "x" | "y">[], islands: { slug: string; x: number | null; y: number | null }[]): Map<number, string[]> {
  const radius = islandRadius(islands.length);
  const out = new Map(seas.map((s) => [s.id, [] as string[]]));
  for (const i of islands) {
    if (i.x === null || i.y === null) continue;
    let best: number | null = null;
    let bestD = REACH * radius;
    for (const s of seas) {
      const d = Math.hypot(i.x - s.x, i.y - s.y);
      if (d < bestD) {
        best = s.id;
        bestD = d;
      }
    }
    if (best !== null) out.get(best)!.push(i.slug);
  }
  return out;
}
