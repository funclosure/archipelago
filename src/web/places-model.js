// Pure: which place a phone shows. A phone has room for one thing at a time, so the page there is four places
// (the islands' list, the map, the open island's pane, its board) and a bar that moves between them.

import { boxScale } from "./contour.js";
import { startIsland } from "./view-model.js";

export const PLACES = ["islands", "map", "island", "board"];

/** The width at which the page is a phone's: the same query styles.css switches at. */
export const NARROW = "(max-width: 720px)";

// ---- the map at home ----

/** An island's name is drawn this many box units tall (draw.js, NAME_FONT). */
export const NAME_BOX = 20;
/** The smallest an island's name may be at home on a phone, in screen px. */
export const NAME_MIN_PX = 11;

/**
 * The furthest out a phone's home may be, as a camera scale: the one at which the islands' names (they share one
 * `radius` at a scale) are NAME_MIN_PX tall. A whole domain fitted to a phone's width draws them at 4 or 5px and
 * the islands under 30px across; at this scale an island is some 65px across, the size of a thumb.
 */
export function homeFloor(radius, namePx = NAME_MIN_PX) {
  return namePx / (NAME_BOX * boxScale(radius));
}

/**
 * The island a phone's home is framed round when the whole scale does not fit, as a slug or null: where the
 * bottom card says to begin while nothing here has a thread, then the nearest open water (where the reader goes
 * next), then the harbour. Null leaves home on the islands' middle.
 */
export function homeFocus(snapshot) {
  if (!snapshot) return null;
  return startIsland(snapshot)?.slug ?? snapshot.nearestOpenWater?.[0] ?? snapshot.harbour ?? null;
}

// ---- the keyboard ----

/** How much shorter than the tallest it has been the visible window must be before a keyboard is taken to be up, in px. */
export const KEYBOARD_MIN = 120;

/** Whether an element takes typed words (and so raises a phone's keyboard): `{ tag, type, editable }`. */
export function takesKeyboard({ tag = "", type = "", editable = false } = {}) {
  if (editable || tag === "TEXTAREA") return true;
  return tag === "INPUT" && !["checkbox", "radio", "range", "file", "button", "submit", "reset", "color", "image", "hidden"].includes(String(type).toLowerCase());
}

/**
 * Whether a phone's keyboard is up: a field has the keyboard (`typing`) and the visible part of the window
 * (`visual`, the visual viewport's height) is well short of the tallest it has been at this width (`tallest`).
 * Both are asked for: a field with a hardware keyboard attached loses no height, and a browser's own bars
 * coming and going take less than a keyboard does. `zoomed` (the reader has pinched the page larger) is never a
 * keyboard: the visible part is small then for another reason.
 */
export function keyboardUp({ typing = false, visual = 0, tallest = 0, zoomed = false, min = KEYBOARD_MIN } = {}) {
  return Boolean(typing) && !zoomed && tallest - visual >= min;
}

/**
 * What the keyboard leaves of the window, for the stylesheet, or null while it is down: `top` and `height` of the
 * part that can be seen (a browser that lays the keyboard over the page pans it too, so the top is not always 0),
 * and `under`, how much of the layout's foot the keyboard covers (0 where the browser shrinks the layout itself).
 */
export function keyboardRoom({ up = false, layout = 0, visualTop = 0, visual = 0 } = {}) {
  if (!up) return null;
  return { top: Math.max(0, Math.round(visualTop)), height: Math.round(visual), under: Math.max(0, Math.round(layout - visualTop - visual)) };
}

// ---- the places ----

/**
 * The place after something happened. `event` is one of:
 *   { type: "tab", place }   the reader tapped the bar
 *   { type: "select", slug } an island was picked (from the list or the map), or let go (null)
 *   { type: "pane", open }   the pane opened or closed by itself (the cartographer's pane, a deselect)
 *   { type: "board", open }  the board opened or closed by itself (its ×, Escape, a persona's line)
 * `has` says what there is to show: { pane, island }. A place with nothing to show falls back to the map.
 */
export function nextPlace(place, event, has) {
  let next = place;
  if (event.type === "tab") next = event.place;
  else if (event.type === "select") next = event.slug ? "island" : place === "island" || place === "board" ? "map" : place;
  else if (event.type === "pane") next = event.open ? (place === "board" ? "board" : "island") : place === "island" || place === "board" ? "map" : place;
  else if (event.type === "board") next = event.open ? "board" : place === "board" ? "island" : place;
  return settle(next, has);
}

/** `place`, or the map when there is nothing to show there. */
export function settle(place, has) {
  if (!PLACES.includes(place)) return "map";
  if (place === "island" && !has.pane) return "map";
  if (place === "board" && !has.island) return has.pane ? "island" : "map";
  return place;
}

/** Which tabs can be tapped. */
export function tabsEnabled(has) {
  return { islands: true, map: true, island: Boolean(has.pane), board: Boolean(has.island) };
}
