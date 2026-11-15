import { test, expect } from "bun:test";
import { FIT_MAX, wideMode, moreSides, pageStep } from "../../src/web/wide-model.js";

test("a drawing with room is left alone; a little too wide is drawn smaller; much too wide scrolls", () => {
  expect(wideMode(400, 500)).toBe("none");
  expect(wideMode(500, 500)).toBe("none");
  expect(wideMode(500.6, 500)).toBe("none"); // a rounding pixel is not too wide
  expect(wideMode(600, 500)).toBe("fit");
  expect(wideMode(500 * FIT_MAX, 500)).toBe("fit");
  expect(wideMode(500 * FIT_MAX + 2, 500)).toBe("scroll");
  expect(wideMode(1400, 500)).toBe("scroll");
});

test("nothing is decided before there is a size to decide from", () => {
  expect(wideMode(0, 500)).toBe("none");
  expect(wideMode(800, 0)).toBe("none");
  expect(wideMode(Number.NaN, 500)).toBe("none");
});

test("a scroller names the sides that still hide something", () => {
  expect(moreSides(0, 500, 500)).toBe("none");
  expect(moreSides(0, 500, 900)).toBe("end");
  expect(moreSides(200, 500, 900)).toBe("both");
  expect(moreSides(400, 500, 900)).toBe("start");
  expect(moreSides(399.5, 500, 900)).toBe("start"); // a fraction short of the end is the end
});

test("an arrow moves most of a boxful, never less than a nudge", () => {
  expect(pageStep(500)).toBe(400);
  expect(pageStep(60)).toBe(80);
});
