// Pure helpers: snapshot → drawable nodes and links. No DOM.

export const STATE_MASS = { open: 1, sandbar: 1.5, settled: 2.5, mountainous: 4, reef: 2.5 };

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

/** Own verdict wins; a parent with none takes the heaviest child state; otherwise open. */
export function rollupMass(island) {
  if (island.verdict) return STATE_MASS[island.verdict.state];
  let mass = STATE_MASS.open;
  for (const s of ["sandbar", "settled", "mountainous", "reef"]) {
    if (island.children.byState[s] > 0) mass = Math.max(mass, STATE_MASS[s]);
  }
  return mass;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function buildNodes(snapshot, width, height, previous = new Map()) {
  return snapshot.islands.map((island) => {
    const prev = previous.get(island.slug);
    const rnd = seededRandom(hashSeed(snapshot.domain.slug + "/" + island.slug));
    const mass = rollupMass(island);
    const state = islandState(island);
    return {
      slug: island.slug,
      name: island.name,
      island,
      state,
      mass,
      radius: 22 + 9 * mass,
      seed: hashSeed(island.slug),
      x: prev ? prev.x : width * (0.25 + 0.5 * rnd()),
      y: prev ? prev.y : height * (0.25 + 0.5 * rnd()),
      vx: prev ? prev.vx : 0,
      vy: prev ? prev.vy : 0,
      pinned: prev ? prev.pinned : false,
      changedAt: prev ? (prev.state !== state ? now() : prev.changedAt) : now(),
    };
  });
}

export function buildLinks(snapshot, nodes) {
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  return snapshot.straits
    .filter((s) => bySlug.has(s.from) && bySlug.has(s.to))
    .map((s) => ({ source: bySlug.get(s.from), target: bySlug.get(s.to), strait: s, state: s.verdict ? s.verdict.state : "open" }));
}
