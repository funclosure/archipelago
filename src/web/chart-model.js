// Pure, DOM-free: what the cartographer's pending sketch puts on the page. Drafts on the map, the lines of
// the sketch card, the pane's opening words. chart.js and view-model.js read these; nothing here fetches.
import { t } from "./i18n.js";

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
    landmarks: { total: i.landmarks.length, unlocked: 0, explored: 0, items: i.landmarks.map((l) => ({ slug: l.slug, name: l.name, lit: false, exploredAt: null, terms: l.terms ?? [] })) },
  }));
}

/** The sketch's straits in the snapshot's shape, `draft` set: they pull drafts toward their neighbours while the map lays them out. */
export function draftStraits(snapshot) {
  const sketch = snapshot?.sketch;
  if (!sketch) return [];
  return sketch.body.straits.map((s) => ({ from: s.from, to: s.to, name: s.name ?? null, verdict: null, draft: true }));
}

/** The seas the pending sketch suggests: `[{ name, islands }]` (a sketch from before seas has none). */
export function draftSeas(snapshot) {
  return snapshot?.sketch?.body.seas ?? [];
}

/** One line naming what the sketch would do, e.g. "named React Native · 6 islands · 5 straits · harbour Foundations". */
export function sketchSummary(body, islands = []) {
  const nameOf = (slug) => body.islands.find((i) => i.slug === slug)?.name ?? islands.find((i) => i.slug === slug)?.name ?? slug;
  const parts = [];
  if (body.name) parts.push(t("chartModel.named", { name: body.name }));
  if (body.islands.length) parts.push(t("chartModel.islands", { n: body.islands.length }));
  if (body.straits.length) parts.push(t("chartModel.straits", { n: body.straits.length }));
  if (body.updates.length) parts.push(t("chartModel.updates", { n: body.updates.length }));
  if (body.seas?.length) parts.push(t("chartModel.seas", { n: body.seas.length }));
  if (body.harbour) parts.push(t("chartModel.harbour", { name: nameOf(body.harbour) }));
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
    straits: body.straits.map((s) => t(s.name ? "chartModel.straitNamed" : "chartModel.strait", { a: nameOf(s.from), b: nameOf(s.to), name: s.name })),
    updates: body.updates.map((u) => {
      const was = islands.find((i) => i.slug === u.slug);
      const changes = [u.name !== undefined && t("chartModel.newName", { name: u.name }), u.summary !== undefined && t("chartModel.newSummary", { summary: u.summary })].filter(Boolean);
      return t("chartModel.update", { name: was?.name ?? u.slug, changes: changes.join(t("chartModel.changeSep")) });
    }),
    seas: (body.seas ?? []).map((s) => ({ name: s.name, islands: s.islands.map(nameOf).join(" · ") })),
    harbour: body.harbour && !body.islands.some((i) => i.slug === body.harbour) ? nameOf(body.harbour) : null,
  };
}

/** What the empty cartographer pane offers at a scale: the words, and the button that starts the first turn. */
export function chartOpening(snapshot) {
  const scale = snapshot.scale.path.at(-1) ?? null;
  const empty = snapshot.islands.length === 0;
  if (empty && !scale) {
    const name = snapshot.domain.name;
    return { text: t("chartModel.openingTop", { name }), action: t("chartModel.actionTop", { name }) };
  }
  if (empty) {
    return { text: t("chartModel.openingScale", { name: scale.name }), action: t("chartModel.actionScale", { name: scale.name }) };
  }
  return { text: t("chartModel.openingMore"), action: null };
}
