// Pure, DOM-free: which region is next, what Escape does, where the outline cursor goes, what the cheat sheet says.
import { t } from "./i18n.js";
import { tipKeys } from "./tip-model.js";

export const REGIONS = ["outline", "map", "pane"];

export function nextRegion(region, backwards = false) {
  const i = Math.max(0, REGIONS.indexOf(region));
  return REGIONS[(i + (backwards ? REGIONS.length - 1 : 1)) % REGIONS.length];
}

/** Whether keystrokes at this target are text entry. */
export function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(target.isContentEditable);
}

/**
 * The one thing Escape does this press, top rung first: the innermost thing always goes first. `dialog` is any modal
 * dialog (dialog.js: New domain, About you, Images…, the viewer, the cheat sheet, the hosted build's), which steps
 * back or closes by its own rule; `hint` a strip hint pinned open by a click; `editor` the board's editor, `board`
 * the board itself; `loose` a landmark's loose ends unfolded in the pane; `chart` the cartographer's pane; `group`
 * islands gathered with shift. To add a rung, add its flag here in its place and its act in keys.js's `escape`.
 */
export function escapeRung({ dialog = false, menuOpen = false, hint = false, turn = false, typing = false, editor = false, board = false, loose = false, cursor = false, chart = false, group = false, sea = false, selected = false }) {
  if (dialog) return "dialog";
  if (menuOpen) return "menu";
  if (hint) return "hint"; // a pinned hint card folds before anything under it changes
  if (turn) return "stop"; // a reply is streaming: Escape stops it, wherever focus is
  if (typing) return "blur";
  if (editor) return "editor";
  if (board) return "board";
  if (loose) return "loose"; // the unfolded loose ends fold before the pane closes
  if (cursor) return "cursor";
  if (chart) return "chart"; // the cartographer's pane closes as an island's does
  if (group) return "group"; // a gathered group lets go first
  if (sea) return "sea"; // a selected sea's name lets go before the island does
  if (selected) return "deselect";
  return null;
}

/**
 * The outline cursor after `key`, over the rows `visibleRows` produced.
 * Returns { cursor: slug } to move, { toggle: slug } to expand or collapse, or null for nothing.
 */
export function moveCursor(rows, cursorSlug, key) {
  if (rows.length === 0) return null;
  const i = rows.findIndex((r) => r.node.slug === cursorSlug);
  const at = (j) => ({ cursor: rows[j].node.slug });
  if (i < 0) {
    if (key === "ArrowDown" || key === "j" || key === "ArrowUp" || key === "k" || key === "Home" || key === "End") return at(key === "End" ? rows.length - 1 : 0);
    return null;
  }
  const row = rows[i];
  switch (key) {
    case "ArrowDown":
    case "j":
      return i + 1 < rows.length ? at(i + 1) : null;
    case "ArrowUp":
    case "k":
      return i > 0 ? at(i - 1) : null;
    case "Home":
      return at(0);
    case "End":
      return at(rows.length - 1);
    case "ArrowRight":
      if (!row.hasChildren) return null;
      return row.open ? at(i + 1) : { toggle: row.node.slug };
    case "ArrowLeft": {
      if (row.hasChildren && row.open) return { toggle: row.node.slug };
      for (let j = i - 1; j >= 0; j--) if (rows[j].depth < row.depth) return at(j);
      return null;
    }
    default:
      return null;
  }
}

const k = (key) => t(`keysModel.${key}`);

/**
 * The cheat sheet's data: the page's map of keys. One entry per section; a row is [keys, what they do]. `keys` is a
 * string of caps separated by spaces ("↑ ↓ j k" is four caps, "⇧Tab" one). A row with "gesture" as its third element
 * is something done with the pointer, shown as words instead of caps. To list a new key, add a row to its section
 * here and its words to strings/keys-model.js (both languages); the sheet draws whatever is here.
 */
export const KEY_SECTIONS = {
  everywhere: {
    title: k("everywhere"),
    rows: [["Tab ⇧Tab", k("nextRegion")], ["[", k("outlineKey")], ["/", k("answer")], ["b", k("boardKey")], ["m", k("mode")], ["t", k("theme")], ["?", k("keys")], ["Esc", k("back")]],
  },
  outline: {
    title: k("outline"),
    rows: [["↑ ↓ j k", k("move")], ["↵", k("select")], ["→ ←", k("expandCollapse")], ["Home End", k("firstLast")], ["n", k("newDomain")], ["d", k("domainMenu")]],
  },
  map: {
    title: k("map"),
    rows: [
      ["↵", k("selectNearest")],
      ["← → ↑ ↓", k("pan")],
      ["+ −", k("zoom")],
      ["0", k("home")],
      ["g", k("guideKey")],
      ["c", k("cartographerKey")],
      ["1 2", k("beginWith")],
      ["s", k("sailNext")],
      ["h ← →", k("headerKey")],
      ["Esc", k("deselect")],
      ["Del", k("removeSea")],
      [k("doubleClickWater"), k("nameSea"), "gesture"],
      [k("shiftClick"), k("gather"), "gesture"],
      [k("shiftDragWater"), k("gatherBox"), "gesture"],
      [k("dragGathered"), k("moveTogether"), "gesture"],
    ],
  },
  board: {
    title: k("board"),
    rows: [["↑ ↓ j k", k("move")], ["↵", k("edit")], ["⇧J ⇧K", k("moveCard")], ["d n c p", k("addCard")], ["x", k("remove")], ["u", k("undo")], ["⌘↵", k("save")], ["b", k("mapKey")]],
  },
  pane: {
    title: k("pane"),
    rows: [["↵ /", k("answer")], ["l", k("landfall")], ["n", k("note")], ["1–4", k("pickOption")], ["c", k("confirmReef")], ["d", k("dispute")], ["s", k("sailCloser")], ["g", k("followPointer")], ["r", k("retry")], ["↑ ↓", k("scroll")], ["← →", k("controls")], ["⌘↵", k("send")]],
  },
  chart: {
    title: k("cartographer"),
    rows: [["↵ /", k("answer")], ["l", k("startSketch")], ["⌘↵", k("approveSketch")], ["g", k("followPointer")], ["↑ ↓", k("scroll")], ["← →", k("controls")], ["Esc", k("close")]],
  },
};

/** The key the command palette opens with. The sheet names it at its foot; the palette itself wires the key. */
export const PALETTE_KEY = "⌘K";

const section = (id, here) => {
  const { title, rows } = KEY_SECTIONS[id];
  return { id, title, here, rows: rows.map(([keys, label, kind]) => (kind === "gesture" ? { keys: [], gesture: keys, label } : { keys: keys.split(" ").map((key) => tipKeys(key)), gesture: null, label })) };
};

/**
 * The cheat sheet: every section of where the page is now, in the order of the regions. With `board`, the map's
 * slot holds the board's keys; with `chart`, the pane's holds the cartographer's. `here` marks the section of the
 * region that has the keyboard. Each row is { keys, gesture, label }: `keys` is one entry per alternative, each the
 * caps pressed together as a tooltip splits them ("⇧J ⇧K" → [["⇧", "J"], ["⇧", "K"]]); `gesture` is words or null.
 */
export function cheatSheet(region, { board = false, chart = false } = {}) {
  const at = REGIONS.includes(region) ? region : "outline";
  return [section("everywhere", false), section("outline", at === "outline"), section(board ? "board" : "map", at === "map"), section(chart ? "chart" : "pane", at === "pane")];
}

/**
 * A key the input method owns, never the page's: one pressed mid-composition (Enter picking a Zhuyin
 * candidate, Escape dismissing it), or Safari's confirming Enter, which arrives just after compositionend
 * with isComposing false but keyCode 229. shuttle's Loomy panel guards its Enter the same way.
 */
export function isImeKey(e) {
  return Boolean(e.isComposing) || e.keyCode === 229;
}
