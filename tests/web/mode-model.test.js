import { test, expect } from "bun:test";
import { MODES, DEFAULT_MODE, PERSONA_NAMES, MODE_LABELS, MODE_HINTS, modeKey, storedMode, nextMode } from "../../src/web/mode-model.js";

test("two modes, the judge's first and the default, each named and explained", () => {
  expect(MODES).toEqual(["judge", "mentor"]);
  expect(DEFAULT_MODE).toBe("judge");
  for (const m of MODES) {
    expect(typeof PERSONA_NAMES[m]).toBe("string");
    expect(typeof MODE_LABELS[m]).toBe("string");
    expect(MODE_HINTS[m].length).toBeGreaterThan(20);
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
