// Tooltips: a control names itself, and its key, when the pointer rests on it or the keyboard lands on it. One element
// for the page, moved from control to control; it listens at the document, so a control only needs `data-tip` (and
// `data-keys`), which `tip()` sets. Nothing shows under a finger.
import { tipPlace, tipDelay, tipKeys, isNearPress } from "./tip-model.js";

let box = null; // the one tooltip element
let shownFor = null; // the control it is showing for
let pending = null; // the control the timer is waiting on
let timer = 0;
let watch = 0;
let lastHiddenAt = null;
let askedAt = -Infinity; // when the pending tip was asked for
let pressedAt = null; // where the pointer was last pressed: no tip until it has moved away from there
const noHover = typeof matchMedia === "function" ? matchMedia("(hover: none)") : null;

const words = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Gives a control its tip: `text` (already translated) and, if it has one, its key (`"b"`, `"⌘K"`, `"⇧J"`).
 * The native `title` goes, so two tooltips never show. Assistive technology hears what the title used to say: a
 * control with no words of its own takes the text as its name; one with words takes it as its description
 * (`aria-description`), unless its name already says it, so nothing is read twice. `describe` is the description
 * when it should be other than the text (a row whose tip leads with the name it already has); null for none.
 */
export function tip(el, text, keys, { describe } = {}) {
  if (!el) return el;
  el.dataset.tip = text;
  if (keys) el.dataset.keys = keys;
  else delete el.dataset.keys;
  el.removeAttribute("title");
  const named = el.getAttribute("aria-label") ?? el.textContent;
  if (!words(named)) {
    el.setAttribute("aria-label", text);
    el.removeAttribute("aria-description");
    return el;
  }
  const said = describe === undefined ? text : describe;
  if (said && !words(named).includes(words(said))) el.setAttribute("aria-description", said);
  else el.removeAttribute("aria-description");
  return el;
}

function ensure() {
  if (box) return box;
  box = document.createElement("div");
  box.className = "tip";
  box.setAttribute("role", "tooltip");
  // The top layer, so a tip shows over a demo or an editor that fills the window (full.js) and over the palette.
  box.setAttribute("popover", "manual");
  box.hidden = true;
  document.body.append(box);
  return box;
}

/** Puts a popover at the top of the top layer: shown again, it stands over whatever was promoted since (full.js). */
export function raise(node) {
  try {
    if (node.matches(":popover-open")) {
      if (node.contains(document.activeElement)) return; // hiding it would take the keyboard out of it
      node.hidePopover();
    }
    node.showPopover();
  } catch {
    // no popovers in this browser: the z-index keeps it over the page
  }
}

function show(el) {
  if (!el.isConnected || !el.dataset.tip) return;
  const b = ensure();
  b.replaceChildren();
  const words = document.createElement("span");
  words.textContent = el.dataset.tip;
  b.append(words);
  const keys = tipKeys(el.dataset.keys);
  if (keys.length > 0) {
    const row = document.createElement("span");
    row.className = "tip-keys";
    for (const k of keys) {
      const cap = document.createElement("kbd");
      cap.textContent = k;
      row.append(cap);
    }
    b.append(row);
  }
  b.hidden = false;
  raise(b);
  b.classList.remove("arrive");
  const side = el.dataset.tipSide || "bottom";
  let r = el.getBoundingClientRect();
  // Beside a column of rows (the outline, a menu), the tip clears the column's edge, not just the row's.
  const column = side === "right" ? el.closest("[data-tip-column]") : null;
  if (column) {
    const c = column.getBoundingClientRect();
    r = { left: c.left, right: c.right, top: r.top, bottom: r.bottom };
  }
  const place = tipPlace(r, { width: b.offsetWidth, height: b.offsetHeight }, { width: innerWidth, height: innerHeight }, { side });
  b.style.left = `${place.left}px`;
  b.style.top = `${place.top}px`;
  b.dataset.side = place.side;
  if (lastHiddenAt === null || performance.now() - lastHiddenAt > 80) b.classList.add("arrive");
  shownFor = el;
  clearInterval(watch);
  // the control may be redrawn away, or the pointer may leave without an event (a rebuild under it)
  watch = setInterval(() => {
    if (!shownFor) return;
    if (!shownFor.isConnected || !(shownFor.matches(":hover") || shownFor.matches(":focus-visible"))) hide();
  }, 200);
}

function hide() {
  clearTimeout(timer);
  pending = null;
  if (!shownFor) return;
  shownFor = null;
  clearInterval(watch);
  if (box) {
    try {
      box.hidePopover();
    } catch {
      // not shown as a popover
    }
    box.hidden = true;
  }
  lastHiddenAt = performance.now();
}

function ask(el) {
  if (el === shownFor || el === pending) return;
  if (noHover?.matches) return; // nothing shows under a finger
  if (el.getAttribute("aria-expanded") === "true") return; // its own menu or popover is open: the tip would sit on it
  clearTimeout(timer);
  if (shownFor) hide();
  pending = el;
  askedAt = performance.now();
  timer = setTimeout(() => {
    pending = null;
    show(el);
  }, tipDelay(performance.now(), lastHiddenAt));
}

const tipped = (target) => (target instanceof Element ? target.closest("[data-tip]") : null);

document.addEventListener("pointerover", (e) => {
  if (e.pointerType === "touch") return;
  // A press usually redraws what is under the pointer (a menu opens, a row is rebuilt), and the browser then reports
  // the pointer "entering" the new element though it never moved. A tip there would cover what the press opened.
  if (pressedAt && isNearPress(pressedAt, e)) return;
  pressedAt = null;
  const el = tipped(e.target);
  if (el) ask(el);
  else if (pending || shownFor) hide();
});
document.addEventListener("pointerdown", (e) => {
  pressedAt = { x: e.clientX, y: e.clientY };
  hide();
}, true);
// A key hides the tip, except the one it just asked for: keys.js handles keys on the window, ahead of this listener,
// and a key that moves focus (a menu's arrows) has already asked for the tip of the control it landed on.
document.addEventListener("keydown", (e) => {
  if (pending && askedAt >= e.timeStamp) return;
  hide();
}, true);
document.addEventListener("wheel", hide, { capture: true, passive: true });
document.addEventListener("focusin", (e) => {
  const el = tipped(e.target);
  if (el && el.matches(":focus-visible")) ask(el);
});
document.addEventListener("focusout", hide);
addEventListener("blur", hide);
