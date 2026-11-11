// Pure: how the free credit reads beside the model in a pane's foot.

/** Dollars to two places, never rounding a little up to more than is there, and never "$0.00" while some is left. */
export function amountOf(usd) {
  const cents = Math.floor(usd * 100 + 1e-9);
  return (Math.max(cents, 1) / 100).toFixed(2);
}

/**
 * The string key and its vars for a model with `usd` of credit left; `{ key: null }` when there is no credit to show.
 * Credit is "free" until the reader has bought some (`purchased`).
 */
export function creditLabel(model, usd, purchased = false) {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return { key: null };
  if (usd <= 0) return { key: purchased ? "card.modelPaidOut" : "card.modelCreditOut", vars: { model } };
  return { key: purchased ? "card.modelPaid" : "card.modelCredit", vars: { model, amount: amountOf(usd) } };
}

/** How long after coming back from the checkout the balance is read again, in ms: the payment reaches us a little after the page does. */
export const PAID_CHECKS_MS = [2000, 5000, 10_000, 20_000, 40_000];
