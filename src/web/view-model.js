// Pure helpers: snapshot → drawable nodes and links. No DOM.
// Coordinates are world units: a fixed 1000 × 1000 square per scale, origin top-left.

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

export const clampWorld = (v) => Math.min(WORLD, Math.max(0, v));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * A starting spot for an island the page has not placed yet: near the centroid of its placed
 * strait neighbours, else near the world centre, offset by a seeded angle so siblings never coincide.
 */
function provisionalPosition(snapshot, island, placedBySlug, radius) {
  const rnd = seededRandom(hashSeed(snapshot.domain.slug + "/" + island.slug));
  const angle = rnd() * Math.PI * 2;
  const offset = radius * (1.5 + rnd());
  const neighbours = snapshot.straits
    .filter((s) => s.from === island.slug || s.to === island.slug)
    .map((s) => placedBySlug.get(s.from === island.slug ? s.to : s.from))
    .filter(Boolean);
  let cx = WORLD / 2;
  let cy = WORLD / 2;
  if (neighbours.length) {
    cx = neighbours.reduce((sum, n) => sum + n.x, 0) / neighbours.length;
    cy = neighbours.reduce((sum, n) => sum + n.y, 0) / neighbours.length;
  }
  return { x: clampWorld(cx + Math.cos(angle) * offset), y: clampWorld(cy + Math.sin(angle) * offset) };
}

/** When each lit landmark lit: 0 for those already lit when the page first saw the island, now() for ones lit since. */
function litTimes(island, prev) {
  const litAt = new Map(prev ? prev.litAt : []);
  const lit = new Set((island.landmarks?.items ?? []).filter((l) => l.lit).map((l) => l.slug));
  for (const slug of lit) if (!litAt.has(slug)) litAt.set(slug, prev ? now() : 0);
  for (const slug of [...litAt.keys()]) if (!lit.has(slug)) litAt.delete(slug);
  return litAt;
}

export function buildNodes(snapshot, previous = new Map()) {
  const radius = islandRadius(snapshot.islands.length);
  const placedBySlug = new Map(snapshot.islands.filter((i) => i.x !== null && i.y !== null).map((i) => [i.slug, i]));
  return snapshot.islands.map((island) => {
    const prev = previous.get(island.slug);
    const state = islandState(island);
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
      ({ x, y } = provisionalPosition(snapshot, island, placedBySlug, radius));
    }
    return {
      slug: island.slug,
      name: island.name,
      island,
      state,
      mass: 1,
      radius,
      seed: hashSeed(island.slug),
      placed,
      x,
      y,
      vx: prev && !placed ? prev.vx : 0,
      vy: prev && !placed ? prev.vy : 0,
      pinned: placed,
      stateAt: prev ? (prev.state !== state ? now() : prev.stateAt) : 0,
      litAt: litTimes(island, prev),
    };
  });
}

export function buildLinks(snapshot, nodes) {
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  return snapshot.straits
    .filter((s) => bySlug.has(s.from) && bySlug.has(s.to))
    .map((s) => ({ source: bySlug.get(s.from), target: bySlug.get(s.to), strait: s, state: s.verdict ? s.verdict.state : "open" }));
}
