// The model the personas answer on, as the server names it (`GET /api/judge`): shown quietly in each pane's foot.
// Null for the stub. Read at start, after every turn, and when the hosted settings change (a `settings` event).
// On the hosted build's free start it also says what is left of the free credit (`GET /hosted/credit`).
import { api } from "./app.js";
import { t } from "./i18n.js";
import { request } from "./transport.js";
import { setVoices } from "./voice.js";
import { creditLabel } from "./credit-model.js";

let current = null;
let credit = null; // US dollars left of the free credit; null when there is none to show

export function judgeModel() {
  return current;
}

async function readCredit() {
  if (globalThis.ARCHIPELAGO_HOSTED !== true) return null;
  try {
    const { balanceUsd } = await (await request("/hosted/credit")).json();
    return typeof balanceUsd === "number" ? balanceUsd : null;
  } catch {
    return null;
  }
}

/** Re-reads the model; resolves true when it changed, so the caller knows to redraw. A failed read keeps the last one. */
export async function refreshJudgeModel() {
  try {
    const [{ model, voices }, left] = await Promise.all([api("/api/judge"), readCredit()]);
    setVoices(voices);
    const changed = (model ?? null) !== current || left !== credit;
    current = model ?? null;
    credit = left;
    return changed;
  } catch {
    return false;
  }
}

/** The model in a pane's foot, quiet, beside the key hints; null for the stub. */
export function modelEl() {
  if (!current) return null;
  const span = document.createElement("span");
  span.className = "model";
  const label = creditLabel(current, credit);
  span.textContent = label.key ? t(label.key, label.vars) : current;
  span.title = label.key ? t("card.creditTitle") : t("card.modelTitle");
  return span;
}
