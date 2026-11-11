// Pure: how the free credit reads beside the model in a pane's foot.

/** Dollars to two places, never rounding a little up to more than is there, and never "$0.00" while some is left. */
export function amountOf(usd) {
  const cents = Math.floor(usd * 100 + 1e-9);
  return (Math.max(cents, 1) / 100).toFixed(2);
}

/** The string key and its vars for a model with `usd` of free credit left; `{ key: null }` when there is no credit to show. */
export function creditLabel(model, usd) {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return { key: null };
  if (usd <= 0) return { key: "card.modelCreditOut", vars: { model } };
  return { key: "card.modelCredit", vars: { model, amount: amountOf(usd) } };
}
