// The model the personas answer on, as the server names it (`GET /api/judge`): shown quietly in each pane's foot.
// Null for the stub. Read at start, after every turn, and when the hosted settings change (a `settings` event).
// On the hosted build's free start it also says what is left of the free credit (`GET /hosted/credit`).
import { api } from "./app.js";
import { t } from "./i18n.js";
import { request } from "./transport.js";
import { setVoices } from "./voice.js";
import { creditLabel } from "./credit-model.js";
import { openYourKey } from "./hosted.js";
import { tip } from "./tip.js";

let current = null;
let credit = null; // { balanceUsd, purchased, packs } on the hosted build's own server; null when there is no credit to show

export function judgeModel() {
  return current;
}

async function readCredit() {
  if (globalThis.ARCHIPELAGO_HOSTED !== true) return null;
  try {
    const view = await (await request("/hosted/credit")).json();
    return typeof view.balanceUsd === "number" ? { balanceUsd: view.balanceUsd, purchased: view.purchased === true, packs: view.packs ?? [] } : null;
  } catch {
    return null;
  }
}

/** Re-reads the model; resolves true when it changed, so the caller knows to redraw. A failed read keeps the last one. */
export async function refreshJudgeModel() {
  try {
    const [{ model, voices }, left] = await Promise.all([api("/api/judge"), readCredit()]);
    setVoices(voices);
    const changed = (model ?? null) !== current || JSON.stringify(left) !== JSON.stringify(credit);
    current = model ?? null;
    credit = left;
    return changed;
  } catch {
    return false;
  }
}

/** Everything `modelEl` is drawn from, as a string: a pane's foot is drawn again only when this changes. */
export function modelSig() {
  return JSON.stringify([current, credit]);
}

/** The model in a pane's foot, quiet, beside the key hints; null for the stub. */
export function modelEl() {
  if (!current) return null;
  const span = document.createElement("span");
  span.className = "model";
  const label = creditLabel(current, credit?.balanceUsd, credit?.purchased);
  span.textContent = label.key ? t(label.key, label.vars) : current;
  tip(span, label.key ? t(credit.packs.length ? "card.creditTitleBuy" : "card.creditTitle") : t("card.modelTitle"));
  if (label.key && credit.packs.length) {
    span.dataset.fk = "credit";
    // Where credit is on sale, the balance is the way to more of it.
    span.classList.add("buy");
    span.setAttribute("role", "button");
    span.tabIndex = 0;
    span.addEventListener("click", openYourKey);
    span.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openYourKey()));
  }
  return span;
}
