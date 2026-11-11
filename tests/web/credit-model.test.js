import { test, expect } from "bun:test";
import { amountOf, creditLabel } from "../../src/web/credit-model.js";

test("the free credit reads beside the model, to the cent, never more than is there", () => {
  expect(creditLabel("claude-sonnet-5-5", 0.5)).toEqual({ key: "card.modelCredit", vars: { model: "claude-sonnet-5-5", amount: "0.50" } });
  expect(amountOf(0.4299)).toBe("0.42");
  expect(amountOf(0.29)).toBe("0.29"); // 0.29 × 100 is 28.999… in floating point
  expect(amountOf(0.004)).toBe("0.01"); // some is left: never "$0.00"
  expect(creditLabel("m", 0)).toEqual({ key: "card.modelCreditOut", vars: { model: "m" } });
  expect(creditLabel("m", -0.004)).toEqual({ key: "card.modelCreditOut", vars: { model: "m" } });
});

test("with no balance to show, the model stands alone", () => {
  expect(creditLabel("m", null)).toEqual({ key: null });
  expect(creditLabel("m", undefined)).toEqual({ key: null });
  expect(creditLabel("m", NaN)).toEqual({ key: null });
});

test("credit that was bought is no longer called free", () => {
  expect(creditLabel("m", 9.5, true)).toEqual({ key: "card.modelPaid", vars: { model: "m", amount: "9.50" } });
  expect(creditLabel("m", 0, true)).toEqual({ key: "card.modelPaidOut", vars: { model: "m" } });
  expect(creditLabel("m", null, true)).toEqual({ key: null });
});
