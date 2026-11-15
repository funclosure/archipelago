// Pure, DOM-free: where a tooltip goes, when it shows, and how a key hint is split into keys.

export const TIP_DELAY_MS = 450; // the pointer must rest this long before the first tip
export const TIP_WARM_MS = 500; // a tip shown this soon after another one hid shows at once

/**
 * A tip's place beside its control, in viewport px. `side` is where it is asked for ("top", "bottom", or "right");
 * it flips when there is no room, and is kept inside the viewport by `margin`. "right" is for a control in a column
 * of rows (the outline, a menu): beside the column, centred on the row, so it covers no neighbour above or below;
 * where the window has no room on the right it goes left, and with room on neither, to whichever side has more.
 */
export function tipPlace(anchor, size, viewport, { side = "bottom", gap = 6, margin = 8 } = {}) {
  const clampTop = (top) => Math.min(Math.max(margin, top), Math.max(margin, viewport.height - margin - size.height));
  if (side === "right") {
    const right = anchor.right + gap;
    const left = anchor.left - gap - size.width;
    const roomRight = viewport.width - margin - right;
    const roomLeft = left - margin;
    const placed = roomRight >= size.width || roomRight >= roomLeft ? "right" : "left";
    const x = placed === "right" ? Math.min(right, viewport.width - margin - size.width) : Math.max(margin, left);
    return { left: Math.round(Math.max(margin, x)), top: Math.round(clampTop((anchor.top + anchor.bottom) / 2 - size.height / 2)), side: placed };
  }
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const fitsBelow = below + size.height + margin <= viewport.height;
  const fitsAbove = above >= margin;
  const placed = side === "top" ? (fitsAbove || !fitsBelow ? "top" : "bottom") : fitsBelow || !fitsAbove ? "bottom" : "top";
  const centre = (anchor.left + anchor.right) / 2;
  const maxLeft = Math.max(margin, viewport.width - margin - size.width);
  const left = Math.min(maxLeft, Math.max(margin, centre - size.width / 2));
  const top = Math.min(Math.max(margin, placed === "top" ? above : below), Math.max(margin, viewport.height - margin - size.height));
  return { left: Math.round(left), top: Math.round(top), side: placed };
}

/** How long to wait before showing a tip: none when one was up a moment ago, so moving along a toolbar reads at once. */
export function tipDelay(now, lastHiddenAt) {
  return lastHiddenAt !== null && now - lastHiddenAt <= TIP_WARM_MS ? 0 : TIP_DELAY_MS;
}

/** "⌘K" → ["⌘", "K"]; "⇧J" → ["⇧", "J"]; "Esc" → ["Esc"]; "g then i" stays words between keys. Space separates alternatives' keys. */
export function tipKeys(hint) {
  if (!hint) return [];
  const out = [];
  for (const word of String(hint).trim().split(/\s+/)) {
    const m = /^([⌘⇧⌥⌃]+)(.+)$/u.exec(word);
    if (m) out.push(...[...m[1]], m[2]);
    else out.push(word);
  }
  return out;
}

export const PRESS_SLOP_PX = 6;
/** Whether the pointer is still where it was pressed (within a few px): a redraw under a resting pointer is not a hover. */
export function isNearPress(press, point, slop = PRESS_SLOP_PX) {
  return Math.hypot(point.clientX - press.x, point.clientY - press.y) <= slop;
}
