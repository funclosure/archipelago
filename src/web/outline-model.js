// The outline's pure helpers: no DOM, no app state. Tested in tests/web/outline.test.js.
import { t } from "./i18n.js";

export const FULL_W = 232;
export const RAIL_W = 44;

/** Whether `slug` is `node` or one of its descendants. */
function holds(node, slug) {
  if (!slug) return false;
  if (node.slug === slug) return true;
  return node.children.some((c) => holds(c, slug));
}

/** The rows to draw: each island, and the islets of islands that are expanded or hold the selection. */
export function visibleRows(islands, expanded, selected, depth = 0) {
  const rows = [];
  for (const node of islands) {
    const hasChildren = node.children.length > 0;
    const open = hasChildren && (expanded.has(node.slug) || holds(node, selected));
    rows.push({ node, depth, hasChildren, open });
    if (open) rows.push(...visibleRows(node.children, expanded, selected, depth + 1));
  }
  return rows;
}

/**
 * Whether collapsing `slug` would actually hide rows. An island that holds the selection stays
 * open however `expanded` reads, so Left on it must ascend rather than flip a flag no one can see.
 */
export function collapsible(islands, expanded, selected, slug) {
  if (!expanded.has(slug)) return false;
  const without = new Set(expanded);
  without.delete(slug);
  return visibleRows(islands, without, selected).length !== visibleRows(islands, expanded, selected).length;
}

/**
 * One row's marks in a lens. The Keeper's lens shows the verdict and lit landmarks; the mentor's shows
 * only what was explored, so nothing explored reads as open water whatever the verdict is.
 */
export function rowMarks(node, lens = "judge") {
  const { total, unlocked, explored = 0 } = node.landmarks;
  if (lens === "mentor") {
    const dot = explored === 0 ? "dot open" : explored === total ? "dot explored all" : "dot explored";
    return { dot, open: explored === 0, count: `${explored}/${total}` };
  }
  return { dot: `dot ${node.state}${node.state === "open" && unlocked ? " lit" : ""}`, open: node.state === "open", count: `${unlocked}/${total}` };
}

/** The rail dash's class for a top-level island. */
export function dashClass(node, selected, lens = "judge") {
  if (node.slug === selected) return "dash on";
  if (lens === "mentor") return node.landmarks.explored ? "dash explored" : "dash";
  if (node.state === "reef") return "dash reef";
  if (node.state !== "open") return "dash done";
  if (node.landmarks.unlocked > 0) return "dash lit";
  return "dash";
}

export function countNodes(islands) {
  return islands.reduce((n, i) => n + 1 + countNodes(i.children), 0);
}

export function summaryLine(outline, lens = "judge") {
  const total = countNodes(outline.islands);
  if (lens === "mentor") return t("outlineModel.summaryMentor", { islands: outline.exploredIslands, total, explored: outline.explored });
  return t("outlineModel.summary", { charted: outline.charted, total, lit: outline.lit });
}
