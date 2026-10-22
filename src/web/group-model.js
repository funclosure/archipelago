// A gathered group: islands and sea names the reader picked up together, by shift-click or by a box drawn with
// shift-drag on the water, so one drag moves them all. Pure: the page keeps the group in app.group.

/** An empty group. */
export const emptyGroup = () => ({ islands: new Set(), seas: new Set() });

export const groupSize = (g) => g.islands.size + g.seas.size;

/** The group with one island (`kind` "islands") or sea (`kind` "seas") added, or taken out if it was in. */
export function toggleMember(g, kind, id) {
  const next = { islands: new Set(g.islands), seas: new Set(g.seas) };
  if (next[kind].has(id)) next[kind].delete(id);
  else next[kind].add(id);
  return next;
}

/** The box between two world points, whichever way it was drawn. */
export function boxBetween(a, b) {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

const inside = (box, p) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;

/** The group plus every island whose centre and every sea whose name point lies in `box`. Drafts are not islands yet. */
export function gatherBox(g, box, nodes, seas) {
  const next = { islands: new Set(g.islands), seas: new Set(g.seas) };
  for (const n of nodes) if (!n.draft && inside(box, n)) next.islands.add(n.slug);
  for (const s of seas) if (inside(box, s)) next.seas.add(s.id);
  return next;
}

/** The group with members that no longer exist at this scale dropped (a refresh, a removed sea). */
export function pruneGroup(g, nodes, seas) {
  const slugs = new Set(nodes.filter((n) => !n.draft).map((n) => n.slug));
  const ids = new Set(seas.map((s) => s.id));
  return { islands: new Set([...g.islands].filter((s) => slugs.has(s))), seas: new Set([...g.seas].filter((id) => ids.has(id))) };
}

/**
 * Where each member was relative to the pointer when the drag began, so `moveGroup` can carry them all at once.
 * Returns [{ kind, id, dx, dy }].
 */
export function groupOffsets(g, at, nodes, seas) {
  const out = [];
  for (const n of nodes) if (g.islands.has(n.slug)) out.push({ kind: "islands", id: n.slug, dx: n.x - at.x, dy: n.y - at.y });
  for (const s of seas) if (g.seas.has(s.id)) out.push({ kind: "seas", id: s.id, dx: s.x - at.x, dy: s.y - at.y });
  return out;
}

/** Puts every member back at its offset from the pointer's world point `at`. Mutates the nodes and seas it finds. */
export function moveGroup(offsets, at, nodes, seas) {
  for (const o of offsets) {
    const item = o.kind === "islands" ? nodes.find((n) => n.slug === o.id) : seas.find((s) => s.id === o.id);
    if (!item) continue;
    item.x = at.x + o.dx;
    item.y = at.y + o.dy;
    if (o.kind === "islands") item.pinned = true;
  }
}
