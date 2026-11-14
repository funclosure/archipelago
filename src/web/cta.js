import { ctaView, ctaAction } from "./cta-model.js";
import { tip } from "./tip.js";
import { t } from "./i18n.js";
// The call-to-action card at the bottom of the map: actions about the map, never knowledge questions. card.js hands
// it a model each render. The card is drawn from that model's view (cta-model.js) and drawn again only when the view
// changes, so a snapshot that changes nothing leaves it alone: a focused button keeps its focus and a press in
// flight lands. Its buttons act on the newest model, whichever render built them.

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};

/** The family's classes for a button's tone: one filled action a card, the rest outlines. */
const TONES = { primary: "btn", mentor: "btn mentor", danger: "btn ghost danger reefy", ghost: "btn ghost" };

let current = null; // the newest model: what a button pressed now acts on
let drawn = ""; // the view the card on the page was drawn from, as JSON
let kind = null; // which card that is

function press(id) {
  const act = current && ctaAction(current, id);
  if (act) current[act[0]]?.(...act.slice(1));
}

function buttonEl(b) {
  const node = el("button", TONES[b.tone] ?? TONES.ghost, b.label);
  node.type = "button";
  node.dataset.id = b.id;
  if (b.key) node.dataset.key = b.key;
  node.disabled = Boolean(b.disabled);
  if (b.tip) tip(node, b.tip, b.key);
  node.addEventListener("click", () => press(b.id));
  return node;
}

/** Renders the card into #cta from the model, or hides it when there is nothing to do. */
export function renderCta(model) {
  const wrap = document.getElementById("cta");
  if (!wrap) return;
  current = model;
  const view = ctaView(model);
  const sig = view ? JSON.stringify(view) : "";
  if (sig === drawn) return;
  drawn = sig;
  if (!view) {
    kind = null;
    wrap.hidden = true;
    wrap.replaceChildren();
    return;
  }
  // A card redrawn under the keyboard (its buttons disabled while an answer is sent) gives focus back to the same button.
  const held = wrap.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  const card = el("div", `cta-card ${view.kind}`);
  if (view.kind !== kind) card.classList.add("arrive"); // only a card that was not there a moment ago arrives
  kind = view.kind;
  card.append(el("div", "lbl", view.label));
  if (view.text) card.append(el("div", "q", view.text));
  const row = el("div", "row");
  row.append(...view.buttons.map(buttonEl));
  card.append(row);
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-live", "polite");
  wrap.setAttribute("aria-label", t("cta.regionLabel"));
  wrap.hidden = false;
  wrap.replaceChildren(card);
  if (held) wrap.querySelector(`button[data-id="${held}"]:not(:disabled)`)?.focus({ preventScroll: true });
}

/** The keys the card's buttons answer to right now (none while it is hidden, or for a disabled button). */
export function ctaKeys() {
  const wrap = document.getElementById("cta");
  if (!wrap || wrap.hidden || getComputedStyle(wrap).display === "none") return [];
  return [...wrap.querySelectorAll("button[data-key]:not(:disabled)")].map((b) => b.dataset.key);
}

/** Presses the card's button for a key (`c`, `d`, `s`, `1`, `2`, `⌘↵`), as a click would. Returns whether one took it. */
export function pressCtaKey(key) {
  if (!ctaKeys().includes(key)) return false;
  document.querySelector(`#cta button[data-key="${CSS.escape(key)}"]:not(:disabled)`)?.click();
  return true;
}
