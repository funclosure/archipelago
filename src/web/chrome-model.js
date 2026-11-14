// Pure, DOM-free: what the header says about the connection, where a strip cell's hint card stands, how the
// keyboard walks the header, and which control over the map a key belongs to.

/** The status pill's words as a strings key, or null when there is nothing to say (the page is connected). */
export function statusKey({ connected, hasChart }) {
  if (connected) return null;
  return hasChart ? "app.offlineLastChart" : "app.offline";
}

/** Why the first read failed, as a strings key: `kind` is toast-model's `failureKind`. */
export function failureKey(kind) {
  return kind === "offline" ? "app.whyOffline" : kind === "busy" ? "app.whyBusy" : "app.whyOther";
}

/**
 * A hint card's place in viewport px: under its cell, from the cell's left edge, moved left as far as it must to
 * stay inside `area` (the map between the outline and the pane), never past the area's left edge. `width` is what
 * the card may take there: its own, or the area's when that is narrower.
 */
export function hintPlace(cell, size, area, { gap = 8, margin = 8 } = {}) {
  const room = Math.max(0, area.right - area.left - 2 * margin);
  const width = Math.min(size.width, room);
  const left = Math.max(area.left + margin, Math.min(cell.left, area.right - margin - width));
  return { left: Math.round(left), top: Math.round(cell.bottom + gap), width: Math.round(width) };
}

/**
 * How far a dock label may slide out to the left, in px: the room between the bottom card's right edge and the
 * dock's icon (`rest` wide, the label's `margins` beside it, a `gap` kept clear of the card), never more than `max`
 * and never so little that nothing can be read. With no card in the way (`cardRight` null), `max`.
 */
export function dockLane(dockRight, cardRight, { rest = 32, margins = 14, gap = 12, min = 96, max = 340 } = {}) {
  if (cardRight === null || cardRight === undefined) return max;
  return Math.max(min, Math.min(max, Math.floor(dockRight - rest - margins - gap - cardRight)));
}

/** The header stop a key moves to from stop `index` of `count`, or null when the key is not a move. The ends do not wrap. */
export function roveTo(count, index, key) {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
      return Math.min(count - 1, index + 1);
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** A key press as the controls name it: `⌘↵` for Cmd- or Ctrl-Enter, else the key itself. Null for any other chord. */
export function keyName({ key, metaKey = false, ctrlKey = false, altKey = false }) {
  if (key === "Enter" && (metaKey || ctrlKey) && !altKey) return "⌘↵";
  if (metaKey || ctrlKey || altKey) return null;
  return key;
}

/**
 * Which control over the map a key presses, as `{ where: "cta" | "dock" | "header", key }`, or null. `cta` and
 * `dock` are the keys their enabled, visible buttons carry. The bottom card comes first (its `c` confirms a reef
 * where the dock's `c` is not on the page); nothing answers while the board is open, which has these letters for
 * its own cards; and `⌘↵` approves from the map or the outline only, since in the pane it sends.
 */
export function chromeTarget(name, { cta = [], dock = [], board = false, region = "map", header = true } = {}) {
  if (!name || board) return null;
  if (name === "⌘↵" && region === "pane") return null;
  if (cta.includes(name)) return { where: "cta", key: name };
  if (dock.includes(name)) return { where: "dock", key: name };
  if (name === HEADER_KEY && header) return { where: "header", key: name };
  return null;
}

/** The key that puts the keyboard in the header; from there the arrows walk it. */
export const HEADER_KEY = "h";

/** How long the pointer rests on a strip cell before its hint card shows. */
export const HINT_DELAY_MS = 400;
