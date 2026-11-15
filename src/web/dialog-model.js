// Pure, DOM-free: how a modal dialog behaves. What a key does while one is open, where Tab goes at its edges, which
// control the keyboard starts on, and what a request to leave does when words were typed. dialog.js is the DOM half.

/**
 * What a key does while a modal dialog is open:
 * "escape" runs the page's Escape ladder (its top rung is the dialog), "submit" is ⌘↵ or Ctrl-↵ (the dialog's main
 * action, wherever focus is), "tab" is the trap's to place, "native" is a key typed inside the dialog (the browser's
 * and the dialog's own), "ignore" leaves a browser shortcut alone, "block" keeps a page key from the page behind.
 */
export function dialogKey({ key, meta = false, ctrl = false, alt = false, inside = false }) {
  if (key === "Escape") return "escape";
  if (key === "Enter" && (meta || ctrl)) return "submit";
  if (key === "Tab" && !meta && !ctrl && !alt) return "tab";
  if (inside) return "native";
  if (meta || ctrl || alt) return "ignore";
  return "block";
}

/**
 * Where Tab goes from the `index`-th of a dialog's `count` tab stops (`back` for Shift-Tab): the other end when the
 * next stop would be outside the dialog, an end when focus is on none of them (index -1), and null in between, where
 * the browser's own Tab is right. -1 when there is no stop at all: focus stays where it is.
 */
export function trapStep(count, index, back = false) {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return back ? count - 1 : 0;
  if (!back && index === count - 1) return 0;
  if (back && index === 0) return count - 1;
  return null;
}

/**
 * The control the keyboard starts on, as an index into `controls` (a dialog's tab stops in document order, each
 * `{ auto, chosen, field, close, danger }`): the one the dialog marked, else the chosen option, else the first
 * field, else the first control that is neither the close button nor the way to something destructive. -1 when
 * there is none of these: the card itself takes focus, so a dialog that is only read (the cheat sheet, a picture)
 * never opens with its close button lit, and Enter never lands on a delete.
 */
export function pickInitial(controls) {
  for (const test of [(c) => c.auto, (c) => c.chosen, (c) => c.field, (c) => !c.close && !c.danger]) {
    const i = controls.findIndex((c) => Boolean(test(c)));
    if (i >= 0) return i;
  }
  return -1;
}

/** Whether a field's words differ from what it opened on. Space at either end is not a change. */
export function isDirty(now, origin) {
  return String(now ?? "").trim() !== String(origin ?? "").trim();
}

/**
 * What a request to leave a dialog does (Escape, Cancel, the close button, a press on the veil):
 * "stay" while it is locked or a save is in flight; "resume" when the Discard question is showing (any way out of
 * the question goes back to editing); "ask" when words were changed (the dialog shows Discard / Keep editing rather
 * than dropping them); else "close".
 */
export function leaveStep({ locked = false, busy = false, confirming = false, dirty = false } = {}) {
  if (locked || busy) return "stay";
  if (confirming) return "resume";
  if (dirty) return "ask";
  return "close";
}
