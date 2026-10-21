// Pure helpers: snapshot → drawable nodes and links. No DOM.
import { draftIslands, draftStraits, sketchSummary } from "./chart-model.js";
// Coordinates are world units: a fixed 1000 × 1000 square per scale, origin top-left.

/** The unit of the map, not its edge: a fresh scale is laid out around WORLD / 2, and islands may go anywhere. */
export const WORLD = 1000;

export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function islandState(island) {
  return island.verdict ? island.verdict.state : "open";
}

/** Fixed footprint: every island at a scale shares one radius, set by how many islands share the scale. */
export function islandRadius(count) {
  return Math.min(88, Math.max(48, 220 / Math.sqrt(Math.max(1, count))));
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * A starting spot for an island the page has not placed yet, offset by a seeded angle so siblings never coincide:
 * beside the centroid of its placed strait neighbours; else just outside the islands already placed, in open water
 * beside the reader's arrangement rather than in the middle of it; else around the centre of a fresh scale.
 */
function provisionalPosition(snapshot, island, placedBySlug, radius) {
  const rnd = seededRandom(hashSeed(snapshot.domain.slug + "/" + island.slug));
  const angle = rnd() * Math.PI * 2;
  const offset = radius * (1.5 + rnd());
  const neighbours = snapshot.straits
    .filter((s) => s.from === island.slug || s.to === island.slug)
    .map((s) => placedBySlug.get(s.from === island.slug ? s.to : s.from))
    .filter(Boolean);
  const centroid = (list) => ({ x: list.reduce((sum, n) => sum + n.x, 0) / list.length, y: list.reduce((sum, n) => sum + n.y, 0) / list.length });
  if (neighbours.length) {
    const c = centroid(neighbours);
    return { x: c.x + Math.cos(angle) * offset, y: c.y + Math.sin(angle) * offset };
  }
  const placed = [...placedBySlug.values()];
  if (placed.length) {
    const c = centroid(placed);
    const reach = Math.max(...placed.map((p) => Math.hypot(p.x - c.x, p.y - c.y))) + radius * 2.5;
    return { x: c.x + Math.cos(angle) * reach, y: c.y + Math.sin(angle) * reach };
  }
  return { x: WORLD / 2 + Math.cos(angle) * offset, y: WORLD / 2 + Math.sin(angle) * offset };
}

// ---- lenses: the judge's (what you have demonstrated) and the mentor's (where you have explored) ----

/** Whether a landmark is lit in a lens: lit by the judge, or explored with the mentor. */
export function landmarkLit(item, lens = "judge") {
  return lens === "mentor" ? item.exploredAt != null : Boolean(item.lit);
}

/** The state a lens draws. The mentor lens draws no elevation and no reef: there, every island is open water. */
export function lensState(island, lens = "judge") {
  return lens === "mentor" ? "open" : islandState(island);
}

/** The coast's marks in a lens: one per landmark, in order, lit or dark. */
export function lensMarks(island, lens = "judge") {
  const items = (island.landmarks?.items ?? []).map((l) => ({ slug: l.slug, lit: landmarkLit(l, lens) }));
  return { total: items.length, items };
}

/** Every landmark on the island explored with the mentor: the moment to hand off to the Keeper. False with no landmarks. */
export function allExplored(island) {
  const items = island?.landmarks?.items ?? [];
  return items.length > 0 && items.every((l) => landmarkLit(l, "mentor"));
}

/** When each lit mark lit: 0 for those already lit when the page first saw the island in this lens, now() for ones lit since. */
function litTimes(marks, prev) {
  const litAt = new Map(prev ? prev.litAt : []);
  const lit = new Set(marks.items.filter((l) => l.lit).map((l) => l.slug));
  for (const slug of lit) if (!litAt.has(slug)) litAt.set(slug, prev ? now() : 0);
  for (const slug of [...litAt.keys()]) if (!lit.has(slug)) litAt.delete(slug);
  return litAt;
}

/**
 * The snapshot's islands, then the pending sketch's drafts. Drafts are laid out like unplaced islands but never
 * saved; they share the scale's radius so the map shows what it will look like once approved.
 */
export function buildNodes(snapshot, previous = new Map(), lens = "judge") {
  const drafts = draftIslands(snapshot);
  const radius = islandRadius(snapshot.islands.length + drafts.length);
  const placedBySlug = new Map(snapshot.islands.filter((i) => i.x !== null && i.y !== null).map((i) => [i.slug, i]));
  const withDrafts = { ...snapshot, straits: [...snapshot.straits, ...draftStraits(snapshot)] };
  return [...snapshot.islands, ...drafts].map((island) => {
    const prev = previous.get(island.slug);
    // A lens switch is not a write: a node last seen in the other lens starts with nothing animating.
    const seen = prev && prev.lens === lens ? prev : null;
    const state = lensState(island, lens);
    const marks = lensMarks(island, lens);
    const placed = island.x !== null && island.y !== null;
    let x;
    let y;
    if (placed) {
      x = island.x;
      y = island.y;
    } else if (prev) {
      x = prev.x;
      y = prev.y;
    } else {
      ({ x, y } = provisionalPosition(withDrafts, island, placedBySlug, radius));
    }
    return {
      slug: island.slug,
      name: island.name,
      island,
      draft: Boolean(island.draft),
      state,
      lens,
      marks,
      lamp: lens === "mentor" ? "explore" : "lamp", // the PALETTE key a lit mark's lamp is drawn in
      rollup: lens === "judge" && !island.verdict && island.children.total > 0,
      mass: 1,
      radius,
      seed: hashSeed(island.slug),
      placed,
      x,
      y,
      vx: prev && !placed ? prev.vx : 0,
      vy: prev && !placed ? prev.vy : 0,
      pinned: placed,
      stateAt: seen ? (seen.state !== state ? now() : seen.stateAt) : 0,
      litAt: litTimes(marks, seen),
    };
  });
}

/** Straits are verdict marks: the mentor lens hides them. A draft's straits only pull it into place; they are never drawn. */
export function buildLinks(snapshot, nodes, lens = "judge") {
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  return [...snapshot.straits, ...draftStraits(snapshot)]
    .filter((s) => bySlug.has(s.from) && bySlug.has(s.to))
    .map((s) => ({ source: bySlug.get(s.from), target: bySlug.get(s.to), strait: s, state: s.verdict ? s.verdict.state : "open", hidden: lens === "mentor" || Boolean(s.draft) }));
}

// ---- the strip: what the chrome says about this scale, each cell with a hint that explains it ----
export const HINTS = {
  harbour: "The harbour: where to set out from at this scale. The cartographer sets it; the anchor marks it on the map.",
  homePort: "The harbour, already charted. Sail on from here to the nearest open water.",
  openWater: "Islands with no verdict yet, nearest first. Select one and make landfall to chart it with the Keeper.",
  reefs: "A reef is a confident claim the Keeper found wrong. Open the island and answer the Keeper to clear it.",
  explored: "Landmarks you have explored with the mentor at this scale. Exploring is not charting: the Keeper still probes every one.",
  unexplored: "Islands where you have explored nothing yet, in map order. Select one and press Explore with the mentor.",
  cartographer: "The cartographer sketches the islands at this scale. Click to open it: ask for a new island, a split, or a better summary. A sketch it proposes shows as drafts on the map and is drawn only when you approve it.",
};

/** The strip's cells for a snapshot in a lens: `[{ label, value, hint }]`. */
export function stripItems(s, lens = "judge") {
  const nameOf = (slug) => s.islands.find((i) => i.slug === slug)?.name ?? slug;
  const items = [];
  if (s.harbour) {
    const h = s.islands.find((i) => i.slug === s.harbour);
    const charted = Boolean(h && h.verdict);
    items.push({ label: charted ? "Home port" : "Set out from", value: nameOf(s.harbour), hint: charted ? HINTS.homePort : HINTS.harbour });
  }
  if (lens === "mentor") {
    const total = s.islands.reduce((n, i) => n + (i.landmarks?.total ?? 0), 0);
    const explored = s.islands.reduce((n, i) => n + (i.landmarks?.explored ?? 0), 0);
    items.push({ label: "Explored", value: total ? `${explored} of ${total} landmarks` : "no landmarks yet", hint: HINTS.explored });
    const fresh = s.islands.filter((i) => !(i.landmarks?.explored > 0)).slice(0, 4).map((i) => i.name);
    items.push({ label: "Not yet explored", value: fresh.length ? fresh.join(" · ") : "none at this scale", hint: HINTS.unexplored });
  } else {
    const open = s.nearestOpenWater.slice(0, 4).map(nameOf);
    items.push({ label: "Nearest open water", value: open.length ? open.join(" · ") : "none at this scale", hint: HINTS.openWater });
    const reefs = s.reefs.map((r) => (r.startsWith("island:") ? nameOf(r.slice(7)) : r.replace("strait:", "strait ")));
    items.push({ label: "Reefs", value: reefs.length ? reefs.join(" · ") : "none charted", hint: HINTS.reefs });
  }
  // The last cell opens the cartographer at this scale; it names a pending sketch when there is one.
  const sketch = s.sketch ? sketchSummary(s.sketch.body, s.islands) : null;
  items.push({ label: "Cartographer", value: sketch ? `sketch to approve · ${sketch}` : "ask to sketch or change", hint: HINTS.cartographer, action: "chart" });
  return items;
}
