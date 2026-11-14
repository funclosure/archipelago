// Pure, DOM-free: the small decisions a pane's answer box makes, and where the arrow keys take the keyboard in it.

/** Whether Send has anything to send: words or a ready image, in a box that takes them, with no image still on its way. */
export function canSend({ text = "", images = 0, busy = false, disabled = false } = {}) {
  return !disabled && !busy && (String(text).trim().length > 0 || images > 0);
}

/**
 * The draft after a message that never reached the server comes back to the box. The reader may have typed on while
 * the turn ran, so the returned words go above what is there instead of replacing it.
 */
export function withRestored(draft, message) {
  if (!message) return draft;
  return String(draft).trim() ? `${message}\n${draft}` : message;
}

/**
 * The draft once a refetch shows the server stored a message after all (`restored`, among the reader's stored
 * `bodies`): those words leave the box, and whatever was typed since stays.
 */
export function withoutStored(draft, restored, bodies) {
  if (restored === null || restored === undefined || !bodies.includes(restored)) return draft;
  if (draft === restored) return "";
  return draft.startsWith(`${restored}\n`) ? draft.slice(restored.length + 1) : draft;
}

/**
 * Whether a log still follows its end after a scroll the page did not make itself. `top` is where it stands now,
 * `lastTop` where it stood before, `max` its end. Within `stick` of the end it follows. Away from the end, only a
 * scroll up leaves it: a scroll down that stops short is the browser keeping the reader's place while a diagram or
 * an image above finds its size (scroll anchoring), and reading that as the reader would stop a thread that is
 * still arriving a screen short of its last words.
 */
export function followsAfterScroll(following, { top, lastTop, max, stick = 40 }) {
  if (max - top < stick) return true;
  return top < lastTop - 1 ? false : following;
}

/**
 * Where ← and → move the keyboard among a pane's controls. `stops` are the controls in page order, each
 * `{ zone: "head" | "log" | "foot", inView }`; `index` is the one focused now (-1 when the pane itself is).
 * From the pane, → takes the first control and ← the last. Stepping into the log from the head or the foot skips
 * what is scrolled out of sight, so the log never jumps to its top; inside the log every control is a stop.
 * Returns the index to focus, or -1 to stay.
 */
export function stepFocus(stops, index, dir) {
  const n = stops.length;
  const shown = (i) => stops[i].zone !== "log" || stops[i].inView;
  if (index < 0 || index >= n) {
    for (let k = 0; k < n; k++) {
      const i = dir > 0 ? k : n - 1 - k;
      if (shown(i)) return i;
    }
    return -1;
  }
  let next = index + dir;
  if (next < 0 || next >= n) return -1;
  if (stops[next].zone === "log" && stops[index].zone !== "log") {
    while (next >= 0 && next < n && stops[next].zone === "log" && !stops[next].inView) next += dir;
    if (next < 0 || next >= n) return -1;
  }
  return next;
}
