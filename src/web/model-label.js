// The model the personas answer on, as the server names it (`GET /api/judge`): shown quietly in each pane's foot.
// Null for the stub. Read at start, after every turn, and when the hosted settings change (a `settings` event).
import { api } from "./app.js";
import { t } from "./i18n.js";

let current = null;

export function judgeModel() {
  return current;
}

/** Re-reads the model; resolves true when it changed, so the caller knows to redraw. A failed read keeps the last one. */
export async function refreshJudgeModel() {
  try {
    const { model } = await api("/api/judge");
    const changed = (model ?? null) !== current;
    current = model ?? null;
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
  span.textContent = current;
  span.title = t("card.modelTitle");
  return span;
}
