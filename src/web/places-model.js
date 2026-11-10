// Pure: which place a phone shows. A phone has room for one thing at a time, so the page there is four places
// (the islands' list, the map, the open island's pane, its board) and a bar that moves between them.

export const PLACES = ["islands", "map", "island", "board"];

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
