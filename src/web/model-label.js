// The model the personas answer on, as the server names it (`GET /api/judge`): shown quietly in each pane's foot,
// on the hosted build by the name Your key lists it by (`GET /hosted/settings`).
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
let names = new Map(); // hosted: each listed model's id → the name Your key shows it by ("Sonnet 5.5"); empty locally

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

/** Hosted: the names Your key lists its models by, so the foot says the same; a model it does not list keeps its id. */
async function readNames() {
  if (globalThis.ARCHIPELAGO_HOSTED !== true) return names;
  try {
    const view = await (await request("/hosted/settings")).json();
    const active = view.providers?.find((p) => p.id === view.provider);
    // The chosen provider's names last, so they win where two providers list one id.
    return new Map([...(view.providers ?? []).flatMap((p) => p.models ?? []), ...(active?.models ?? [])].map((m) => [m.id, m.name]));
  } catch {
    return names;
  }
}

/** Re-reads the model; resolves true when it changed, so the caller knows to redraw. A failed read keeps the last one. */
export async function refreshJudgeModel() {
  try {
    const [{ model, voices }, left, named] = await Promise.all([api("/api/judge"), readCredit(), readNames()]);
    setVoices(voices);
    const changed = (model ?? null) !== current || JSON.stringify(left) !== JSON.stringify(credit) || named.get(model) !== names.get(model);
    current = model ?? null;
    credit = left;
    names = named;
    return changed;
  } catch {
    return false;
  }
}

/** Everything `modelEl` is drawn from, as a string: a pane's foot is drawn again only when this changes. */
export function modelSig() {
  return JSON.stringify([current, names.get(current) ?? null, credit]);
}

/** The model in a pane's foot, quiet, beside the key hints; null for the stub. */
export function modelEl() {
  if (!current) return null;
  const span = document.createElement("span");
  span.className = "model";
  const name = names.get(current) ?? current;
  const label = creditLabel(name, credit?.balanceUsd, credit?.purchased);
  span.textContent = label.key ? t(label.key, label.vars) : name;
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
