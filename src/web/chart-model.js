// Pure, DOM-free: what the cartographer's pending sketch puts on the page. Drafts on the map, the lines of
// the sketch card, the pane's opening words. chart.js and view-model.js read these; nothing here fetches.

/** The sketch's new islands as island views the map can lay out and draw: no verdict, no position, `draft` set. */
export function draftIslands(snapshot) {
  const sketch = snapshot?.sketch;
  if (!sketch) return [];
  return sketch.body.islands.map((i) => ({
    slug: i.slug,
    name: i.name,
    summary: i.summary,
    draft: true,
    hasChildren: false,
    verdict: null,
    children: { total: 0, byState: { sandbar: 0, settled: 0, mountainous: 0, reef: 0, open: 0 } },
    x: null,
    y: null,
    harbour: sketch.body.harbour === i.slug,
    messages: 0,
    landmarks: { total: i.landmarks.length, unlocked: 0, explored: 0, items: i.landmarks.map((l) => ({ slug: l.slug, name: l.name, lit: false, exploredAt: null })) },
  }));
}

/** The sketch's straits in the snapshot's shape, `draft` set: they pull drafts toward their neighbours while the map lays them out. */
export function draftStraits(snapshot) {
  const sketch = snapshot?.sketch;
  if (!sketch) return [];
  return sketch.body.straits.map((s) => ({ from: s.from, to: s.to, name: s.name ?? null, verdict: null, draft: true }));
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line naming what the sketch would do, e.g. "named React Native · 6 islands · 5 straits · harbour Foundations". */
export function sketchSummary(body, islands = []) {
  const nameOf = (slug) => body.islands.find((i) => i.slug === slug)?.name ?? islands.find((i) => i.slug === slug)?.name ?? slug;
  const parts = [];
  if (body.name) parts.push(`named ${body.name}`);
  if (body.islands.length) parts.push(plural(body.islands.length, "island"));
  if (body.straits.length) parts.push(plural(body.straits.length, "strait"));
  if (body.updates.length) parts.push(plural(body.updates.length, "update"));
  if (body.harbour) parts.push(`harbour ${nameOf(body.harbour)}`);
  return parts.join(" · ");
}

/**
 * The sketch card's rows: each new island with its summary and landmark names, each strait by island names,
 * each update by what it changes. `islands` are the islands already at this scale, for their names.
 */
export function sketchRows(body, islands = []) {
  const nameOf = (slug) => body.islands.find((i) => i.slug === slug)?.name ?? islands.find((i) => i.slug === slug)?.name ?? slug;
  return {
    islands: body.islands.map((i) => ({ name: i.name, summary: i.summary, landmarks: i.landmarks.map((l) => l.name).join(" · "), harbour: body.harbour === i.slug })),
    straits: body.straits.map((s) => `${nameOf(s.from)} ~ ${nameOf(s.to)}${s.name ? ` (${s.name})` : ""}`),
    updates: body.updates.map((u) => {
      const was = islands.find((i) => i.slug === u.slug);
      const changes = [u.name !== undefined && `name → ${u.name}`, u.summary !== undefined && `summary → ${u.summary}`].filter(Boolean);
      return `${was?.name ?? u.slug}: ${changes.join("; ")}`;
    }),
    harbour: body.harbour && !body.islands.some((i) => i.slug === body.harbour) ? nameOf(body.harbour) : null,
  };
}

/** What the empty cartographer pane offers at a scale: the words, and the button that starts the first turn. */
export function chartOpening(snapshot) {
  const scale = snapshot.scale.path.at(-1) ?? null;
  const empty = snapshot.islands.length === 0;
  if (empty && !scale) {
    return { text: `No islands yet. The cartographer sketches ${snapshot.domain.name} as 6–10 islands; you approve the sketch before anything is drawn.`, action: `Sketch ${snapshot.domain.name}` };
  }
  if (empty) {
    return { text: `${scale.name} has no islets yet. The cartographer reads its threads and board, then sketches 4–8 islets for you to approve.`, action: `Sketch the islets of ${scale.name}` };
  }
  return { text: "Ask for a change at this scale: a missing island, a split, a better summary, a harbour.", action: null };
}
