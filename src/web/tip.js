// Tooltips: a control names itself, and its key, when the pointer rests on it or the keyboard lands on it. One element
// for the page, moved from control to control; it listens at the document, so a control only needs `data-tip` (and
// `data-keys`), which `tip()` sets. Nothing shows under a finger.
import { tipPlace, tipDelay, tipKeys } from "./tip-model.js";

let box = null; // the one tooltip element
let shownFor = null; // the control it is showing for
let pending = null; // the control the timer is waiting on
let timer = 0;
let watch = 0;
let lastHiddenAt = null;

/**
 * Gives a control its tip: `text` (already translated) and, if it has one, its key (`"b"`, `"⌘K"`, `"⇧J"`).
 * The native `title` goes, so two tooltips never show; a control with no words of its own takes the text as its name.
 */
export function tip(el, text, keys) {
  if (!el) return el;
  el.dataset.tip = text;
  if (keys) el.dataset.keys = keys;
  else delete el.dataset.keys;
  el.removeAttribute("title");
  if (!el.getAttribute("aria-label") && !el.textContent.trim()) el.setAttribute("aria-label", text);
  return el;
}

function ensure() {
  if (box) return box;
  box = document.createElement("div");
  box.className = "tip";
  box.setAttribute("role", "tooltip");
  box.hidden = true;
  document.body.append(box);
  return box;
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
  b.classList.remove("arrive");
  const r = el.getBoundingClientRect();
  const place = tipPlace(r, { width: b.offsetWidth, height: b.offsetHeight }, { width: innerWidth, height: innerHeight }, { side: el.dataset.tipSide || "bottom" });
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
  if (box) box.hidden = true;
  lastHiddenAt = performance.now();
}

function ask(el) {
  if (el === shownFor || el === pending) return;
  clearTimeout(timer);
  if (shownFor) hide();
  pending = el;
  timer = setTimeout(() => {
    pending = null;
    show(el);
  }, tipDelay(performance.now(), lastHiddenAt));
}

const tipped = (target) => (target instanceof Element ? target.closest("[data-tip]") : null);

document.addEventListener("pointerover", (e) => {
  if (e.pointerType === "touch") return;
  const el = tipped(e.target);
  if (el) ask(el);
  else if (pending || shownFor) hide();
});
document.addEventListener("pointerdown", hide, true);
document.addEventListener("keydown", hide, true);
document.addEventListener("wheel", hide, { capture: true, passive: true });
document.addEventListener("focusin", (e) => {
  const el = tipped(e.target);
  if (el && el.matches(":focus-visible")) ask(el);
});
document.addEventListener("focusout", hide);
addEventListener("blur", hide);
