// Pure, DOM-free: what a drawing wider than its box does about it (wide.js draws it).

/** How far a drawing may be drawn smaller to fit its box: past this its lettering is too small to read, so it scrolls. */
export const FIT_MAX = 1.3;

/** What a drawing `natural` px wide does in a box `room` px wide: "none" (it has room), "fit" (drawn smaller) or "scroll". */
export function wideMode(natural, room) {
  if (!(natural > 0) || !(room > 0) || natural <= room + 1) return "none";
  return natural / room <= FIT_MAX ? "fit" : "scroll";
}

/** The sides of a sideways scroller that still hide something: "none", "start", "end" or "both". */
export function moreSides(scrollLeft, clientWidth, scrollWidth) {
  const start = scrollLeft > 1;
  const end = scrollLeft + clientWidth < scrollWidth - 1;
  if (start && end) return "both";
  return start ? "start" : end ? "end" : "none";
}

/** How far one press of an arrow moves the scroller: most of what is on show, so some of it stays as a landmark. */
export function pageStep(clientWidth) {
  return Math.max(80, Math.round(clientWidth * 0.8));
}
