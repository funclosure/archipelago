// Full screen, in place. An element fills the window from the top layer (a popover) without moving in the
// document, so whatever runs inside it keeps running: a demo's frame never reloads, an editor keeps its caret.
// One element at a time; Escape (keys.js) leaves it first.

let leave = null; // brings the element that fills the window back, while one does

/** Brings the element that fills the window back to its place. True when there was one. */
export function exitFull() {
  if (!leave) return false;
  leave();
  return true;
}

export function isFull(box) {
  return box.classList.contains("full");
}

/**
 * Makes `box` fill the window, or brings it back. `onChange(on)` runs after either. Returns whether it now fills
 * the window; false also in a browser without popovers, where it stays where it is.
 */
export function setFull(box, on, onChange = () => {}) {
  if (on === isFull(box)) return on;
  if (on) {
    exitFull();
    try {
      box.setAttribute("popover", "manual");
      box.showPopover();
    } catch {
      box.removeAttribute("popover");
      return false;
    }
    leave = () => setFull(box, false, onChange);
  } else {
    try {
      box.hidePopover();
    } catch {
      /* already hidden: it left the page while it was full */
    }
    box.removeAttribute("popover");
    leave = null;
  }
  box.classList.toggle("full", on);
  onChange(on);
  return on;
}
