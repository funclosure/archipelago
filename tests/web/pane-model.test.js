import { test, expect } from "bun:test";
import { canSend, withRestored, withoutStored, stepFocus, followsAfterScroll } from "../../src/web/pane-model.js";

test("Send has something to send only with words or a ready image, in a box that takes them", () => {
  expect(canSend({ text: "", images: 0 })).toBe(false);
  expect(canSend({ text: "   \n", images: 0 })).toBe(false);
  expect(canSend({ text: "a column", images: 0 })).toBe(true);
  expect(canSend({ text: "", images: 2 })).toBe(true); // images alone are a message
  expect(canSend({ text: "a column", busy: true })).toBe(false); // an image still on its way goes with the message
  expect(canSend({ text: "a column", disabled: true })).toBe(false);
});

test("words that never reached the server come back above what was typed since", () => {
  expect(withRestored("", "my answer")).toBe("my answer");
  expect(withRestored("  ", "my answer")).toBe("my answer");
  expect(withRestored("and another thing", "my answer")).toBe("my answer\nand another thing");
  expect(withRestored("kept", null)).toBe("kept");
});

test("words the server stored after all leave the box; what was typed since stays", () => {
  expect(withoutStored("my answer", "my answer", ["hello", "my answer"])).toBe("");
  expect(withoutStored("my answer\nand another thing", "my answer", ["my answer"])).toBe("and another thing");
  expect(withoutStored("my answer", "my answer", ["hello"])).toBe("my answer"); // never stored: still the reader's to send
  expect(withoutStored("edited since", "my answer", ["my answer"])).toBe("edited since");
  expect(withoutStored("draft", null, ["draft"])).toBe("draft");
});

test("a log leaves its end only when the reader scrolls up, and takes it up again on reaching it", () => {
  // the reader scrolls up from the end: no longer following
  expect(followsAfterScroll(true, { top: 900, lastTop: 1400, max: 1400 })).toBe(false);
  // the browser keeps the place as a diagram above grows (down by 80) while more arrives below: still following
  expect(followsAfterScroll(true, { top: 1485, lastTop: 1405, max: 1539 })).toBe(true);
  // scrolled away, then down a little, short of the end: still away
  expect(followsAfterScroll(false, { top: 1000, lastTop: 900, max: 1400 })).toBe(false);
  // back within reach of the end: following again
  expect(followsAfterScroll(false, { top: 1380, lastTop: 1000, max: 1400 })).toBe(true);
  // a wobble of a pixel is not a scroll up
  expect(followsAfterScroll(true, { top: 1299.5, lastTop: 1300, max: 1400 })).toBe(true);
});

test("← and → walk a pane's controls, and step into the log only where it is in view", () => {
  const head = { zone: "head", inView: true };
  const foot = { zone: "foot", inView: true };
  const hidden = { zone: "log", inView: false };
  const seen = { zone: "log", inView: true };
  const stops = [head, head, hidden, hidden, seen, seen, foot, foot];
  // from the pane itself: the first control, or the last
  expect(stepFocus(stops, -1, 1)).toBe(0);
  expect(stepFocus(stops, -1, -1)).toBe(7);
  expect(stepFocus(stops, 0, 1)).toBe(1);
  // out of the head into the log: past what is scrolled away
  expect(stepFocus(stops, 1, 1)).toBe(4);
  expect(stepFocus(stops, 4, 1)).toBe(5);
  expect(stepFocus(stops, 5, 1)).toBe(6);
  // back from the foot into the log, then up through it, scrolled away or not
  expect(stepFocus(stops, 6, -1)).toBe(5);
  expect(stepFocus(stops, 4, -1)).toBe(3);
  expect(stepFocus(stops, 2, -1)).toBe(1);
  // the ends stay put
  expect(stepFocus(stops, 7, 1)).toBe(-1);
  expect(stepFocus(stops, 0, -1)).toBe(-1);
  // a log wholly out of view is stepped over
  expect(stepFocus([head, hidden, hidden, foot], 0, 1)).toBe(3);
  expect(stepFocus([head, hidden, hidden, foot], 3, -1)).toBe(0);
  expect(stepFocus([hidden, hidden], -1, 1)).toBe(-1);
  expect(stepFocus([], -1, 1)).toBe(-1);
});
