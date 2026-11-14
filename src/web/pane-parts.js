// What the island's pane (card.js) and the cartographer's and the guide's pane (chart.js) both draw: the answer box
// as one composer, the rows of a thread's trail, a notice where something failed, the bars shown while a thread
// loads, a log that follows its end, and the keyboard's place kept across a redraw. Pure parts are in pane-model.js.
import { t } from "./i18n.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { isImeKey, isTyping } from "./keys-model.js";
import { failureKind } from "./toast-model.js";
import { canSend, followsAfterScroll, stepFocus } from "./pane-model.js";
import { attachButton, pastedImages, trayEl } from "./images.js";

const STICK_PX = 40; // within this of the bottom, a scroll by the reader still means "follow"

export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export function button(label, onClick, className = "btn") {
  const b = el("button", className, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

/** A translated sentence with one of its placeholders filled by an element, so that part can be styled or pressed. */
export function slotted(key, slot, node, vars = {}) {
  const [before, after = ""] = t(key, { ...vars, [slot]: "\u0001" }).split("\u0001");
  const frag = document.createDocumentFragment();
  frag.append(before, node, after);
  return frag;
}

/** A failure in plain words: no connection, another reply still under way here, or the server's own sentence. */
export function failureWords(error) {
  const kind = failureKind(error);
  return kind === "offline" ? t("paneParts.offline") : kind === "busy" ? t("paneParts.busy") : String(error?.message ?? error);
}

// ---- the answer box ----

function grow(ta) {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
}

/** Send is ready only with something to send; a box that is empty, off, or still sending an image leaves it inert. */
export function syncSend(form, tray = null) {
  const ta = form?.querySelector("#answer");
  const send = form?.querySelector(".send");
  if (!ta || !send) return;
  send.disabled = !canSend({ text: ta.value, images: tray ? tray.ready().length : 0, busy: tray ? tray.busy() : false, disabled: ta.disabled });
}

/** Puts `value` in the answer box when the page changed the draft itself (a quoted question, words given back). */
export function syncAnswer(form, value, tray = null) {
  const ta = form?.querySelector("#answer");
  if (!ta) return;
  if (ta.value !== value) ta.value = value;
  grow(ta);
  syncSend(form, tray);
}

/**
 * The answer box as one composer: the draft's images, the words, attach, and the one action (Send; Stop while a
 * reply streams; Dispute while a reef waits), in a single bordered box that takes the focus ring as a whole.
 * `action` is "send", "stop" or "dispute"; `tray` (images.js) is left out where a message is words only. The
 * callbacks: `onInput(value)` on every edit, `onSubmit(trimmed)`, `onStop()`, and `onCompose(on)` around an input
 * method's composition, whose Enter is never a send.
 */
export function composerEl({ value = "", placeholder = "", disabled = false, tray = null, action = "send", actionLabel, actionDisabled = false, onInput, onSubmit, onStop, onCompose }) {
  const form = el("form", "composer");
  form.id = "answer-form";
  const ta = el("textarea");
  ta.id = "answer";
  ta.rows = 1;
  ta.disabled = disabled;
  ta.placeholder = placeholder;
  ta.setAttribute("aria-label", placeholder);
  ta.value = value;
  ta.addEventListener("input", () => {
    onInput(ta.value);
    grow(ta);
    syncSend(form, tray);
  });
  ta.addEventListener("compositionstart", () => onCompose?.(true));
  ta.addEventListener("compositionend", () => {
    onInput(ta.value);
    onCompose?.(false);
  });
  ta.addEventListener("keydown", (e) => {
    if (isImeKey(e)) return; // Enter picking a Zhuyin candidate is the input method's, never a send
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  // A pasted screenshot joins the draft's images.
  if (tray) ta.addEventListener("paste", (e) => {
    const files = pastedImages(e);
    if (files.length) tray.add(files);
  });
  const row = el("div", "composer-row");
  row.append(ta);
  if (tray) row.append(attachButton(tray, disabled || action === "stop"));
  if (action === "stop") {
    const stop = button(actionLabel ?? t("paneParts.stop"), () => onStop?.(), "btn ghost stop");
    stop.id = "stop";
    tip(stop, t("paneParts.stopTip"), "Esc");
    row.append(stop);
  } else {
    const go = button(actionLabel ?? t("paneParts.send"), null, action === "dispute" ? "btn ghost dispute" : "btn send");
    go.type = "submit";
    go.dataset.fk = action;
    go.disabled = actionDisabled;
    tip(go, action === "dispute" ? t("paneParts.disputeTip") : t("paneParts.sendTip"), "↵");
    row.append(go);
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    onSubmit(ta.value.trim());
  });
  // The whole box is the field: a press on its edge or beside the buttons lands in the words.
  form.addEventListener("mousedown", (e) => {
    if (e.target !== form && e.target !== row) return;
    e.preventDefault();
    if (!ta.disabled) ta.focus();
  });
  const shelf = tray ? trayEl(tray) : null;
  if (shelf) form.append(shelf);
  form.append(row);
  if (action === "send") syncSend(form, tray);
  return form;
}

/**
 * The line under the answer box: on the left what the keys do (one sentence while the box has the keyboard,
 * another while it does not), on the right whatever the pane adds (the model, Read aloud).
 */
export function footMetaEl({ typing, idle = typing }, right = []) {
  const meta = el("div", "meta");
  const hint = el("span", "hint");
  if (idle === typing) hint.textContent = typing;
  else hint.append(el("span", "when-idle", idle), el("span", "when-typing", typing));
  meta.append(hint);
  const shown = right.filter(Boolean);
  if (shown.length) {
    const side = el("span", "meta-r");
    side.append(...shown);
    meta.append(side);
  }
  return meta;
}

// ---- the trail: what happened between the words ----

/**
 * One row of a thread's trail: a mark in the margin, then what happened. `kind` is its class (lit, explored, reef,
 * loose, board, model, note); `key` links it to the reader's words it rests on and to the landmark's chip, which
 * light together under the pointer (`lightLandmark` in card.js). Returns the row and the body to fill.
 */
export function eventEl(kind, glyph = null, key = null, tag = "div") {
  const row = el(tag, `event ${kind}`);
  if (tag === "button") row.type = "button";
  if (key) row.dataset.lm = key;
  const mark = el("span", "event-mark");
  mark.setAttribute("aria-hidden", "true");
  if (glyph) mark.append(glyph);
  const body = el("span", "event-body");
  row.append(mark, body);
  return { row, body };
}

/** "from your words: “…”" under a row: the reader's phrase it rests on, cut to the row, whole under the pointer. */
export function fromWordsEl(quote) {
  const line = el("span", "event-from");
  line.append(slotted("paneParts.fromWords", "quote", el("span", "event-quote", quote)));
  line.addEventListener("pointerover", () => {
    if (line.scrollWidth > line.clientWidth + 1 || line.scrollHeight > line.clientHeight + 1) tip(line, t("paneParts.quoted", { quote }));
    else delete line.dataset.tip;
  });
  return line;
}

/** One line where something failed or stopped, with the one thing to do about it: `action` is `{ label, run, keys }`. */
export function noticeEl(text, { action = null, alert = true } = {}) {
  const box = el("div", `notice${alert ? " bad" : ""}`);
  box.setAttribute("role", alert ? "alert" : "status");
  box.append(icon("info"), el("span", "notice-text", text));
  if (action) {
    const b = button(action.label, action.run, "btn quiet sm");
    b.dataset.fk = "retry";
    if (action.keys) tip(b, action.label, action.keys);
    box.append(b);
  }
  return box;
}

/** A thread that could not be read at all: what happened, why in plain words, and Retry. */
export function failedEl(title, why, retry) {
  const box = el("div", "pane-state");
  box.setAttribute("role", "alert");
  box.append(el("h3", null, title), el("p", null, why));
  const b = button(t("paneParts.retry"), retry, "btn ghost");
  b.dataset.fk = "retry";
  tip(b, t("paneParts.retryTip"), "r");
  box.append(b);
  return box;
}

/** Three bars where a thread's words will be. They appear only after a moment, so a quick load shows nothing. */
export function skeletonEl() {
  const box = el("div", "skeleton");
  box.setAttribute("role", "status");
  box.setAttribute("aria-label", t("paneParts.loading"));
  for (let i = 0; i < 3; i++) box.append(el("i"));
  return box;
}

/** A persona's mark for a briefing: the Keeper's lamp, the mentor's compass needle, the cartographer's dashed coast. Built as SVG nodes, never markup. */
export function personaGlyph(who) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 56 56");
  svg.setAttribute("class", "glyph");
  svg.setAttribute("aria-hidden", "true");
  const add = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
  };
  add("circle", { cx: 28, cy: 28, r: 26, class: "ring" });
  if (who === "mentor") {
    add("path", { d: "M28 9 L33 28 L28 47 L23 28 Z", class: "needle" });
    add("path", { d: "M28 9 L33 28 L23 28 Z", class: "fill" });
  } else if (who === "cartographer") {
    add("path", { d: "M15.5 31c-2.4-7 1.8-14.6 9.8-16.2 7-1.4 14.4 1.6 16.6 8.2 2.2 6.8-2.4 14-10 15.6-7.2 1.6-14.2-1.4-16.4-7.6z", class: "beam" });
    add("circle", { cx: 34, cy: 24, r: 3, class: "fill" });
  } else {
    add("circle", { cx: 28, cy: 28, r: 17, class: "beam" });
    add("circle", { cx: 28, cy: 28, r: 6, class: "fill" });
  }
  return svg;
}

// ---- a log that follows its end ----

/**
 * A log that follows its end by intent. Only the reader's own scroll changes whether it follows (`followsAfterScroll`
 * tells theirs from the browser's); the page's scrolls (`toEnd`) do not, and whatever grows by itself (a diagram
 * drawn late, an image arriving, a demo's frame finding its height, the head or the answer box taking room) keeps a
 * followed log at its end: every child and the log's own box are watched for a change of size.
 */
export function logFollower() {
  let log = null;
  let following = true;
  let ownTop = -1; // where toEnd last put the log, so its own scroll event is not read as the reader's
  let lastTop = 0; // where the log stood at its last scroll: a scroll up from there is the reader leaving the end
  const seen = new Set();
  const toEnd = () => {
    if (!log) return;
    log.scrollTop = log.scrollHeight;
    ownTop = lastTop = log.scrollTop;
  };
  const watcher = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    if (following) toEnd();
  });
  return {
    get following() {
      return following;
    },
    /** The reader asked to watch the end (they sent something). */
    follow() {
      following = true;
    },
    toEnd,
    /** Takes `node` as the log to follow. One it has not seen opens at its latest words; returns whether it is new. */
    adopt(node) {
      if (node === log) return false;
      watcher?.disconnect();
      seen.clear();
      log = node;
      following = true;
      ownTop = -1;
      lastTop = node.scrollTop;
      node.addEventListener("scroll", () => {
        if (node !== log) return;
        const top = node.scrollTop;
        const from = lastTop;
        lastTop = top;
        // A scroll the page made itself says nothing about the reader: by the time its event arrives the content
        // may have grown again, and reading that as "scrolled away" would stop the log following.
        if (Math.abs(top - ownTop) < 2) return;
        following = followsAfterScroll(following, { top, lastTop: from, max: node.scrollHeight - node.clientHeight, stick: STICK_PX });
      });
      watcher?.observe(node);
      return true;
    },
    /** After the log's children were redrawn: watches the new ones, forgets the ones that left. */
    watch() {
      if (!log || !watcher) return;
      for (const child of seen) {
        if (child.parentNode === log) continue;
        watcher.unobserve(child);
        seen.delete(child);
      }
      for (const child of log.children) {
        if (seen.has(child)) continue;
        watcher.observe(child);
        seen.add(child);
      }
    },
  };
}

// ---- the keyboard's place ----

/** How to find a control again after its part of the pane is drawn anew: its id, or its `data-fk`. */
function focusKey(node) {
  if (node.id) return `#${CSS.escape(node.id)}`;
  return node.dataset?.fk ? `[data-fk="${CSS.escape(node.dataset.fk)}"]` : null;
}

/**
 * Runs `paint` (a redraw of the pane) and keeps the keyboard where it was. A control the redraw kept still has it.
 * One that was drawn anew gets it back by its id or `data-fk`, with the caret where it stood in a text field; one
 * that is gone or now disabled hands the keyboard to the pane, never to the page behind it.
 */
export function keepFocus(pane, paint) {
  const active = document.activeElement;
  const inside = active && active !== pane && pane.contains(active) ? active : null;
  const key = inside ? focusKey(inside) : null;
  const caret = inside && isTyping(inside) && typeof inside.selectionStart === "number" ? [inside.selectionStart, inside.selectionEnd] : null;
  paint();
  if (!inside || inside.isConnected) return;
  const again = key ? pane.querySelector(key) : null;
  if (again && !again.disabled) {
    again.focus({ preventScroll: true });
    if (caret && typeof again.setSelectionRange === "function") again.setSelectionRange(caret[0], caret[1]);
  } else if (!pane.hidden) pane.focus({ preventScroll: true });
}

// A text field is not a stop: inside one the arrows are the caret's, so the walk could never leave it. The answer
// box has its own keys (/ and Enter), the note its own (n).
const STOPS = "button:not(:disabled), [tabindex='0']";

/**
 * ← and →: moves the keyboard to the pane's previous or next control (`stepFocus` says which), so every button in
 * it can be reached without a pointer while Tab keeps moving between regions. Returns whether it moved.
 */
export function roveFocus(pane, dir) {
  const log = pane.querySelector(":scope > .log");
  const view = log?.getBoundingClientRect();
  const nodes = [...pane.querySelectorAll(STOPS)].filter((n) => n.getClientRects().length > 0);
  const stops = nodes.map((n) => {
    const inLog = Boolean(log) && log.contains(n);
    const r = n.getBoundingClientRect();
    return { zone: inLog ? "log" : n.closest(".foot") ? "foot" : "head", inView: !inLog || (r.bottom > view.top && r.top < view.bottom) };
  });
  const next = stepFocus(stops, nodes.indexOf(document.activeElement), dir);
  if (next < 0) return false;
  nodes[next].focus({ preventScroll: true });
  nodes[next].scrollIntoView({ block: "nearest" });
  return true;
}
