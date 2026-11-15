// Dialogs: one behaviour for every modal surface of the page (New domain, Edit domain, About you, Images…, the image
// viewer, the cheat sheet, and the hosted build's welcome, Your key, import and take-over notice).
//
// A dialog's root stays in the page (index.html) and its module draws a card into it. While it is open:
//   - the rest of the page is inert (no pointer, no focus) and takes no key (keys.js asks `dialogOpen`);
//   - Tab and Shift-Tab stay inside it, ⌘↵ is its main action, Escape is the top rung of the page's Escape ladder;
//   - a press on the veil (the root itself, outside the card) asks to leave, like the close button;
//   - when it closes, focus goes back to what opened it, or to that region when the opener is gone.
// The module decides what leaving means (`close(why)`: "escape" is one step back, "veil" and "button" are all the
// way out), so words typed in a dialog are its own to keep. The pure half is dialog-model.js.
import { dialogKey, trapStep, pickInitial } from "./dialog-model.js";
import { exitFull } from "./full.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { tipKeys } from "./tip-model.js";
import { t } from "./i18n.js";

/** Open dialogs, the top one last: { root, close, submit, opener, region }. */
const stack = [];
let returnToRegion = null; // keys.js: puts the keyboard back in a region when the opener is gone

/** keys.js registers how focus returns to a region (it owns the regions); dialog.js never imports it. */
export function onFocusReturn(fn) {
  returnToRegion = fn;
}

export const dialogOpen = () => stack.length > 0;

const entryOf = (root) => stack.find((d) => d.root === root) ?? null;
const cardOf = (root) => root.querySelector(".dialog-card");

/** What stays live beside a dialog: a toast can still be read and dismissed, and the tooltip is the dialog's too. */
const staysLive = (node) => node.tagName === "SCRIPT" || node.classList.contains("toasts") || node.classList.contains("tip");

/** Everything in the page but the top dialog is inert while one is open; only what this made inert is given back. */
function quietRest() {
  const top = stack.at(-1)?.root ?? null;
  for (const node of document.body.children) {
    if (staysLive(node)) continue;
    const quiet = top !== null && node !== top;
    if (quiet && !node.inert) {
      node.inert = true;
      node.dataset.dialogQuiet = "";
    } else if (!quiet && node.dataset.dialogQuiet !== undefined) {
      node.inert = false;
      delete node.dataset.dialogQuiet;
    }
  }
}

/** The veil is the root itself: a press on it, outside the card, asks to leave. Wired once per root. */
function wireVeil(root) {
  if (root.dataset.dialogVeil !== undefined) return;
  root.dataset.dialogVeil = "";
  root.addEventListener("mousedown", (e) => {
    if (e.target !== root || e.button !== 0 || stack.at(-1)?.root !== root) return;
    if (e.clientX - root.getBoundingClientRect().left >= root.clientWidth) return; // the veil's own scrollbar
    e.preventDefault(); // focus stays where it is when the dialog does not close
    entryOf(root)?.close("veil");
  });
}

/**
 * Says whether `root` is open as a modal dialog. Safe to call on every draw: the first call with `open` records
 * what had focus and quiets the page; the first with `open` false gives both back. `close(why)` is the module's
 * own way out (why: "escape" | "veil" | "button"); `submit` is what ⌘↵ does.
 */
export function showDialog(root, open, handlers = {}) {
  const had = entryOf(root);
  if (open) {
    if (had) return void Object.assign(had, handlers);
    exitFull(); // nothing fills the window over a dialog
    const active = document.activeElement;
    stack.push({ root, close: () => {}, submit: null, ...handlers, opener: active && active !== document.body ? active : null, region: document.body.dataset.focus ?? null });
    root.setAttribute("aria-modal", "true");
    wireVeil(root);
    quietRest();
    return;
  }
  if (!had) return;
  stack.splice(stack.indexOf(had), 1);
  quietRest();
  const below = stack.at(-1);
  if (below) return void focusFirst(below.root); // a dialog under it has the keyboard again
  const opener = had.opener;
  if (opener?.isConnected && opener.getClientRects().length > 0 && !opener.closest("[inert]")) opener.focus({ preventScroll: true });
  else returnToRegion?.(had.region);
}

/** A dialog's tab stops in order: what is shown and enabled, a radio group counting once (its checked radio, as the browser's Tab does). */
function tabStops(root) {
  const all = [...root.querySelectorAll("a[href], button, input, textarea, select, summary, [tabindex]")].filter(
    (el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest("[inert]"),
  );
  return all.filter((el) => {
    if (el.type !== "radio") return true;
    const group = all.filter((o) => o.type === "radio" && o.name === el.name && o.form === el.form);
    return el === (group.find((o) => o.checked) ?? group[0]);
  });
}

const describe = (el) => ({
  auto: el.dataset.autofocus !== undefined,
  chosen: (el.type === "radio" && el.checked) || el.classList.contains("picked"),
  field: el.matches("textarea, select, input:not([type='radio'], [type='checkbox'], [type='file'])"),
  close: el.classList.contains("dialog-close"),
  danger: el.classList.contains("danger"),
});

/** Puts the keyboard where a dialog starts: the control it marked (`data-autofocus`), the chosen option, its first field, and the card itself when it is only read. */
export function focusFirst(root) {
  const stops = tabStops(root);
  const control = stops[pickInitial(stops.map(describe))] ?? null;
  if (control) control.focus(); // scrolled into view when the card is taller than the window
  else focusCard(root);
  return control ?? cardOf(root);
}

/** The card as a place for focus to rest (never a tab stop). */
function focusableCard(root) {
  const card = cardOf(root);
  if (card && !card.hasAttribute("tabindex")) card.tabIndex = -1;
  return card;
}

/** Rests the keyboard on the card itself: for a dialog that is still reading what it will show. */
export function focusCard(root) {
  focusableCard(root)?.focus({ preventScroll: true }); // a tall card stays at its head
}

/**
 * Notes which control of a dialog has the keyboard (by its id or `data-key`, since a redraw builds every control
 * again) and its caret. Returns `{ inside, restore }`: `inside` says focus was in the dialog, and `restore()` puts
 * it back on the same control, false when that control is gone or disabled.
 */
export function rememberFocus(root) {
  const was = document.activeElement;
  const inside = Boolean(was) && was !== root && root.contains(was);
  const find = !inside ? null : was.id ? `#${CSS.escape(was.id)}` : was.dataset.key ? `[data-key="${CSS.escape(was.dataset.key)}"]` : null;
  let caret = null;
  try {
    if (inside && typeof was.selectionStart === "number") caret = [was.selectionStart, was.selectionEnd];
  } catch {
    // this kind of input has no caret
  }
  const restore = () => {
    const again = find ? root.querySelector(find) : null;
    if (!again || again.disabled) return false;
    again.focus({ preventScroll: true });
    if (caret) {
      try {
        again.setSelectionRange(caret[0], caret[1]);
      } catch {
        // as above
      }
    }
    return true;
  };
  return { inside, restore };
}

/**
 * Draws a dialog's card again (`draw` rebuilds it) and keeps the keyboard where it was: the same control, with its
 * caret. When that control is gone or disabled, focus goes to the dialog's start, so a redraw never drops it to the
 * page behind.
 */
export function redraw(root, draw) {
  const focus = rememberFocus(root);
  draw();
  if (focus.inside && !root.hidden && !focus.restore()) focusFirst(root);
}

/**
 * A key pressed while a dialog is open (keys.js calls this first, from the page's one keydown listener).
 * Returns null when none is open, "escape" for the ladder to run, else "done": the key is the dialog's or nobody's.
 */
export function dialogKeydown(e) {
  const top = stack.at(-1);
  if (!top) return null;
  const act = dialogKey({ key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, inside: top.root.contains(e.target) });
  if (act === "escape") return "escape";
  if (act === "submit") {
    if (top.submit) {
      e.preventDefault();
      e.stopPropagation();
      top.submit();
    }
  } else if (act === "tab") {
    const stops = tabStops(top.root);
    const to = trapStep(stops.length, stops.indexOf(document.activeElement), e.shiftKey);
    if (to !== null) {
      e.preventDefault();
      if (stops[to]) stops[to].focus();
      else focusCard(top.root);
    }
  } else if (act === "block") e.stopPropagation();
  return "done";
}

/** The Escape ladder's top rung: one step back in the top dialog (its module decides what that is). */
export function escapeDialog() {
  stack.at(-1)?.close("escape");
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The close control every dialog shares: the × at the head's right, its tooltip naming Esc. */
export function closeButton(onClose) {
  const b = el("button", "btn icon quiet md dialog-close");
  b.type = "button";
  b.dataset.key = "close";
  b.append(icon("close"));
  tip(b, t("dialog.close"), "Esc");
  b.addEventListener("click", () => onClose("button"));
  return b;
}

/**
 * A dialog's head: its name as a small capitals label at the left (`title: true` sets it in the serif instead, for a
 * dialog whose sections carry the labels), the close control at the right (`onClose` null: a dialog with no way out).
 * `id` lets the root name itself by it (`aria-labelledby`).
 */
export function dialogHead(label, onClose, { title = false, id = null } = {}) {
  const head = el("div", "dialog-head");
  const name = title ? el("h2", "dialog-title", label) : el("div", "eyebrow", label);
  if (id) name.id = id;
  head.append(name);
  if (onClose) head.append(closeButton(onClose));
  return head;
}

/**
 * A dialog's foot: one order everywhere. `lead` sits at the far left (the way back, or the door to something
 * destructive); `actions` at the right, the secondary ones first and the main one last.
 */
export function dialogFoot(lead = [], actions = []) {
  const foot = el("div", "dialog-foot");
  const left = el("div", "lead");
  left.append(...lead);
  foot.append(left, ...actions);
  return foot;
}

/** Key caps for a hint, split as a tooltip splits it: "⌘↵" is two caps pressed together. */
export function keyCaps(hint) {
  const chord = el("span", "chord");
  for (const cap of tipKeys(hint)) chord.append(el("kbd", null, cap));
  return chord;
}

/** A button with its key after its label: the main action's shortcut, shown where the control is. */
export function withKey(button, keys) {
  button.append(keyCaps(keys));
  return button;
}

/**
 * The foot a dialog shows in place of its own when it is asked to leave with changed words: the question, Keep
 * editing, and Discard. Discard is focused, as in the board's editor, so Enter discards and Escape goes back.
 */
export function discardFoot(onDiscard, onKeep) {
  const keep = el("button", "btn ghost", t("dialog.keepEditing"));
  keep.type = "button";
  keep.dataset.key = "keep-editing";
  keep.addEventListener("click", onKeep);
  const drop = el("button", "btn danger", t("dialog.discard"));
  drop.type = "button";
  drop.dataset.key = "discard";
  drop.dataset.autofocus = "";
  drop.addEventListener("click", onDiscard);
  const foot = dialogFoot([el("span", "ask", t("dialog.discardAsk"))], [keep, drop]);
  foot.classList.add("asking");
  return foot;
}

/**
 * A field with its visible label: `<label>` over the control, tied by id. `aside` (a counter, a note) sits at the
 * label's right. Returns the wrapper.
 */
export function labelled(label, control, aside = null) {
  const wrap = el("div", "dialog-field");
  const row = el("div", "label-row");
  const name = el("label", "field-label", label);
  name.htmlFor = control.id;
  row.append(name);
  if (aside) row.append(aside);
  wrap.append(row, control);
  return wrap;
}
