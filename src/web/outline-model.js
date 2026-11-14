// The outline's pure helpers: no DOM, no app state. Tested in tests/web/outline.test.js.
import { t } from "./i18n.js";

export const FULL_W = 232;
export const RAIL_W = 44;
/** The open outline's width runs between these while the reader drags its grip. */
export const OUTLINE_MIN = 200;
export const OUTLINE_MAX = 480;

/** The open outline's width from a stored or dragged value: clamped, and FULL_W when there is none. */
export function outlineWidth(value) {
  const w = typeof value === "string" ? parseFloat(value) : value;
  if (typeof w !== "number" || !Number.isFinite(w)) return FULL_W;
  return Math.round(Math.min(OUTLINE_MAX, Math.max(OUTLINE_MIN, w)));
}

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
 * `count` is null on an island nothing has touched in that lens: open water is the absence of a verdict,
 * so it never shows a "0/3". An island with a verdict keeps its count even at zero.
 */
export function rowMarks(node, lens = "judge") {
  const { total, unlocked, explored = 0 } = node.landmarks;
  if (lens === "mentor") {
    const dot = explored === 0 ? "dot open" : explored === total ? "dot explored all" : "dot explored";
    return { dot, open: explored === 0, count: explored === 0 ? null : `${explored}/${total}` };
  }
  const open = node.state === "open";
  return { dot: `dot ${node.state}${open && unlocked ? " lit" : ""}`, open, count: open && unlocked === 0 ? null : `${unlocked}/${total}` };
}

const TIP_KEYS = { sandbar: "rowSandbar", settled: "rowSettled", mountainous: "rowMountainous", reef: "rowReef" };

/**
 * A row's tooltip: what its dot and count mean in this lens ("Sandbar · 1 of 3 landmarks lit"), led by the
 * island's whole name when the row cuts it (`cut`), so a name that reads in full is not said twice.
 */
export function rowTip(node, lens = "judge", cut = false) {
  const { total, unlocked, explored = 0 } = node.landmarks;
  const vars = { lit: unlocked, explored, total };
  const what =
    lens === "mentor" ? t(explored === 0 ? "outlineModel.rowUnexplored" : "outlineModel.rowExplored", vars)
    : node.state === "open" ? t(unlocked === 0 ? "outlineModel.rowOpen" : "outlineModel.rowLit", vars)
    : t(`outlineModel.${TIP_KEYS[node.state] ?? "rowLit"}`, vars);
  return cut ? t("outlineModel.rowNamed", { name: node.name, what: unbroken(what) }) : what;
}

/**
 * A phrase that stays on one line: no-break spaces, and a word joiner between characters (Chinese breaks anywhere).
 * A long name wraps a tip to two lines; this way the break falls after the name, never inside what the dot means.
 */
function unbroken(text) {
  return [...text].map((ch) => (ch === " " ? "\u00A0" : ch)).join("\u2060");
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

/**
 * Where the keyboard's cursor goes when a key first moves it. With an island selected the cursor starts from that
 * row, so the key moves on from it; with none it appears on the harbour, else the first row (End: the last), and
 * the key moves nothing more. Returns the slug to start from and whether the key should still be applied.
 */
export function cursorStart(rows, selected, key) {
  if (rows.length === 0) return null;
  if (rows.some((r) => r.node.slug === selected)) return { cursor: selected, apply: true };
  if (key === "End") return { cursor: rows[rows.length - 1].node.slug, apply: false };
  if (key === "Home") return { cursor: rows[0].node.slug, apply: false };
  return { cursor: (rows.find((r) => r.node.harbour) ?? rows[0]).node.slug, apply: false };
}

// ---- the domain menu ----

/**
 * The menu's keyboard cursor after `key`, over `count` rows: Down / j and Up / k step and wrap, Home and End jump.
 * `index` is -1 when nothing in the menu has focus. Returns the new index, or null when the key is not a move.
 */
export function menuMove(count, index, key) {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
    case "j":
      return index < 0 ? 0 : (index + 1) % count;
    case "ArrowUp":
    case "k":
      return index < 0 ? count - 1 : (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** The rows that open a list under themselves. */
const SUBS = ["theme", "language"];

/**
 * The domain menu as data, top to bottom: groups of rows, each row with the key `k` the page draws and focuses it
 * by. `sub` is the list open under its row ("theme" | "language" | null). A domain whose name another domain
 * shares carries its description (`desc`), so the two can be told apart. The hosted build adds its three rows.
 */
export function menuGroups({ domains, current, hosted = false, sub = null, themes = [], theme = null, languages = [], language = null }) {
  const shared = (name) => domains.filter((d) => d.name === name).length > 1;
  const list = (id, items, chosen) => [
    { k: id, value: items.find((i) => i.id === chosen)?.name ?? "", chosen, open: sub === id },
    ...(sub === id ? items.map((i) => ({ k: `${id}:${i.id}`, parent: id, id: i.id, name: i.name, on: i.id === chosen })) : []),
  ];
  return [
    { id: "domains", rows: [...domains.map((d) => ({ k: `domain:${d.slug}`, slug: d.slug, name: d.name, on: d.slug === current, desc: shared(d.name) ? (d.description ?? null) : null })), { k: "new" }] },
    { id: "domain", rows: [{ k: "export" }, { k: "images" }, { k: "edit" }] },
    { id: "appearance", rows: [...list("theme", themes, theme), ...list("language", languages, language)] },
    { id: "you", rows: [{ k: "about" }, ...(hosted ? [{ k: "key" }, { k: "backup" }, { k: "restore" }] : [])] },
  ];
}

/** Every row's key in the order the keyboard walks them. */
export function menuKeys(groups) {
  return groups.flatMap((g) => g.rows.map((r) => r.k));
}

/**
 * What a key does in the open menu while the row `k` has the keyboard: `{ focus }` names the row to go to, and
 * `sub` (when the property is there) is the list to open, or null to close the open one, first. Right opens the
 * list under Theme or Language and lands on its chosen row; Left closes it, from its row or from inside it.
 * Null when the key does nothing here.
 */
export function menuStep(groups, k, key) {
  const rows = groups.flatMap((g) => g.rows);
  const row = rows.find((r) => r.k === k);
  if (key === "ArrowRight") {
    if (!row || !SUBS.includes(row.k)) return null;
    const focus = `${row.k}:${row.chosen}`;
    return row.open ? { focus } : { sub: row.k, focus };
  }
  if (key === "ArrowLeft") {
    if (row?.parent) return { sub: null, focus: row.parent };
    if (row?.open) return { sub: null, focus: row.k };
    return null;
  }
  const keys = rows.map((r) => r.k);
  const to = menuMove(keys.length, keys.indexOf(k), key);
  return to === null ? null : { focus: keys[to] };
}
