import { test, expect } from "bun:test";
import { MODES, DEFAULT_MODE, PERSONA_NAMES, MODE_LABELS, MODE_ROLES, MODE_HINTS, modeKey, storedMode, nextMode, headPill } from "../../src/web/mode-model.js";

test("two modes, the judge's first and the default, each named and explained", () => {
  expect(MODES).toEqual(["judge", "mentor"]);
  expect(DEFAULT_MODE).toBe("judge");
  for (const m of MODES) {
    expect(typeof PERSONA_NAMES[m]).toBe("string");
    expect(typeof MODE_LABELS[m]).toBe("string");
    expect(MODE_HINTS[m].length).toBeGreaterThan(20);
    expect(MODE_ROLES[m].split(" ").length).toBeLessThanOrEqual(3); // fits under the name in the switch
  }
  expect(PERSONA_NAMES.judge).toBe("the Keeper");
});

test("the stored mode is per domain, and anything unknown falls back to the judge", () => {
  expect(modeKey("sd")).toBe("mode:sd");
  expect(storedMode("mentor")).toBe("mentor");
  expect(storedMode(null)).toBe("judge");
  expect(storedMode("tutor")).toBe("judge");
  expect(nextMode("judge")).toBe("mentor");
  expect(nextMode("mentor")).toBe("judge");
});

test("the head pill is the verdict in the Keeper's lens and what was explored in the mentor's", () => {
  const island = (extra) => ({ verdict: null, children: { total: 0 }, landmarks: { total: 5, unlocked: 5, explored: 0 }, ...extra });
  const settled = island({ verdict: { state: "settled", confidence: 0.82 } });
  expect(headPill(settled, "judge")).toEqual({ cls: "pill", text: "settled · 82%" });
  expect(headPill(island({ verdict: { state: "reef", confidence: 0.9 } }), "judge")).toEqual({ cls: "pill reef", text: "reef · 90%" });
  expect(headPill(island({ children: { total: 3 } }), "judge")).toEqual({ cls: "pill open", text: "open water · islets below" });
  expect(headPill(settled, "mentor")).toEqual({ cls: "pill open", text: "open water" }); // the verdict never shows here
  expect(headPill(island({ verdict: { state: "settled", confidence: 0.82 }, landmarks: { total: 5, unlocked: 5, explored: 2 } }), "mentor"))
    .toEqual({ cls: "pill explore", text: "explored · 2 of 5" });
});
