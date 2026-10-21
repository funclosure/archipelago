// Pure, DOM-free: which region is next, what Escape does, where the outline cursor goes, what the cheat sheet says.

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

/** The one thing Escape does this press, top rung first. `about` is the learner note editor, `editor` the board's editor, `board` the board itself, `chart` the cartographer's pane. */
export function escapeRung({ sheetOpen, about = false, menuOpen, turn = false, typing, editor = false, board = false, cursor, chart = false, selected }) {
  if (sheetOpen) return "sheet";
  if (about) return "about";
  if (menuOpen) return "menu";
  if (turn) return "stop"; // a reply is streaming: Escape stops it, wherever focus is
  if (typing) return "blur";
  if (editor) return "editor";
  if (board) return "board";
  if (cursor) return "cursor";
  if (chart) return "chart"; // the cartographer's pane closes as an island's does
  if (selected) return "deselect";
  return null;
}

/**
 * What a key does while the About you editor is open (it is modal for page keys):
 * "escape" runs the Escape ladder, "save" is Cmd-Enter, "native" leaves Tab to the browser inside the editor,
 * "enter" pulls focus into the editor, "ignore" leaves browser shortcuts alone, "block" stops region keys.
 */
export function aboutKey({ key, meta = false, ctrl = false, alt = false, inAbout = false }) {
  if (key === "Escape") return "escape";
  if (key === "Enter" && meta) return "save";
  if (key === "Tab" && !meta && !ctrl && !alt) return inAbout ? "native" : "enter";
  if (key === "Tab" || meta || alt) return "ignore";
  return "block";
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

const EVERYWHERE = [["Tab", "next region"], ["⇧Tab", "previous region"], ["[", "outline"], ["/", "answer"], ["b", "board"], ["m", "keeper / mentor"], ["t", "theme"], ["?", "keys"], ["Esc", "back"]];
const CHART_KEYS = { title: "Cartographer", keys: [["↵ /", "answer"], ["l", "start the sketch"], ["⌘↵", "approve sketch"], ["↑ ↓", "scroll"], ["Esc", "close"]] };
const REGION_KEYS = {
  outline: { title: "Outline", keys: [["↓ j", "move"], ["↑ k", "move"], ["↵", "select"], ["→ ←", "expand / collapse"], ["Home End", "first / last"], ["n", "new domain"]] },
  map: { title: "Map", keys: [["↵", "select"], ["← → ↑ ↓", "pan"], ["+ −", "zoom"], ["0", "home"], ["Esc", "deselect"]] },
  pane: { title: "Pane", keys: [["↵ /", "answer"], ["l", "make landfall"], ["n", "note"], ["1–4", "pick option"], ["c", "confirm reef"], ["d", "dispute"], ["↑ ↓", "scroll"], ["⌘↵", "send"]] },
  board: { title: "Board", keys: [["↓ j", "move"], ["↑ k", "move"], ["↵", "edit"], ["d n c", "add diagram / note / code"], ["x", "remove"], ["⌘↵", "save"], ["b", "map"]] },
};

/** The cheat sheet's sections for a region. With `board`, the map's slot shows the board's keys; with `chart`, the pane's shows the cartographer's. */
export function cheatSheet(region, { board = false, chart = false } = {}) {
  if (region === "pane" && chart) return [{ title: "Everywhere", keys: EVERYWHERE }, CHART_KEYS];
  const key = region === "map" && board ? "board" : region;
  return [{ title: "Everywhere", keys: EVERYWHERE }, REGION_KEYS[key] ?? REGION_KEYS.outline];
}

/**
 * A key the input method owns, never the page's: one pressed mid-composition (Enter picking a Zhuyin
 * candidate, Escape dismissing it), or Safari's confirming Enter, which arrives just after compositionend
 * with isComposing false but keyCode 229. shuttle's Loomy panel guards its Enter the same way.
 */
export function isImeKey(e) {
  return Boolean(e.isComposing) || e.keyCode === 229;
}
