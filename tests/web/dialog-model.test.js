import { test, expect } from "bun:test";
import { dialogKey, trapStep, pickInitial, isDirty, leaveStep } from "../../src/web/dialog-model.js";

test("dialogKey: an open dialog is modal; Escape, Cmd-Enter and Tab are its own, the page gets nothing", () => {
  const k = (key, o = {}) => dialogKey({ key, ...o });
  expect(k("Escape")).toBe("escape");
  expect(k("Escape", { inside: true })).toBe("escape");
  expect(k("Enter", { meta: true })).toBe("submit");
  expect(k("Enter", { ctrl: true, inside: true })).toBe("submit");
  expect(k("Tab")).toBe("tab"); // from outside too: the trap pulls focus in, never to another region
  expect(k("Tab", { inside: true })).toBe("tab");
  expect(k("Tab", { meta: true })).toBe("ignore"); // ⌘⇥ stays the browser's
  for (const key of ["t", "m", "b", "j", "k", "Enter", "?", "[", "/", "ArrowDown"]) expect(k(key)).toBe("block");
  for (const key of ["t", "Enter", " ", "ArrowDown", "?"]) expect(k(key, { inside: true })).toBe("native"); // typing in its fields, Enter on its buttons
  expect(k("r", { meta: true })).toBe("ignore");
  expect(k("ArrowLeft", { alt: true })).toBe("ignore");
});

test("trapStep: Tab wraps at the dialog's ends and is the browser's in between", () => {
  expect(trapStep(4, 3)).toBe(0);
  expect(trapStep(4, 0, true)).toBe(3);
  expect(trapStep(4, 1)).toBeNull();
  expect(trapStep(4, 2, true)).toBeNull();
  expect(trapStep(4, 0)).toBeNull();
  expect(trapStep(4, 3, true)).toBeNull();
  expect(trapStep(1, 0)).toBe(0);
  expect(trapStep(1, 0, true)).toBe(0);
});

test("trapStep: focus on none of the stops goes to an end; no stops, focus stays", () => {
  expect(trapStep(4, -1)).toBe(0);
  expect(trapStep(4, -1, true)).toBe(3);
  expect(trapStep(4, 9)).toBe(0);
  expect(trapStep(0, -1)).toBe(-1);
  expect(trapStep(0, -1, true)).toBe(-1);
});

test("pickInitial: the marked control, then the chosen option, then the first field, then anything but the close button", () => {
  const close = { close: true };
  const field = { field: true };
  const button = {};
  expect(pickInitial([close, field, button, { auto: true }])).toBe(3);
  expect(pickInitial([close, button, { chosen: true }, field])).toBe(2);
  expect(pickInitial([close, button, field])).toBe(2);
  expect(pickInitial([close, button])).toBe(1);
  expect(pickInitial([{ chosen: false }, { chosen: true }])).toBe(1);
});

test("pickInitial: a dialog with nothing but its close button starts on no control", () => {
  expect(pickInitial([{ close: true }])).toBe(-1);
  expect(pickInitial([])).toBe(-1);
});

test("pickInitial: never the way to something destructive, unless the dialog marks it", () => {
  expect(pickInitial([{ close: true }, { danger: true }])).toBe(-1); // the viewer: a picture and Remove image
  expect(pickInitial([{ close: true }, { danger: true }, {}])).toBe(2);
  expect(pickInitial([{ close: true }, { danger: true, auto: true }])).toBe(1); // Discard, where the board's precedent focuses it
});

test("isDirty: only a change of words counts", () => {
  expect(isDirty("a note", "a note")).toBe(false);
  expect(isDirty("a note \n", "a note")).toBe(false);
  expect(isDirty("", null)).toBe(false);
  expect(isDirty("a longer note", "a note")).toBe(true);
  expect(isDirty("", "a note")).toBe(true);
});

test("leaveStep: typed words are never dropped silently", () => {
  expect(leaveStep()).toBe("close");
  expect(leaveStep({ dirty: true })).toBe("ask");
  expect(leaveStep({ dirty: true, confirming: true })).toBe("resume"); // Escape on the question goes back to editing
  expect(leaveStep({ confirming: true })).toBe("resume");
  expect(leaveStep({ dirty: true, busy: true })).toBe("stay"); // a save in flight is let finish
  expect(leaveStep({ locked: true })).toBe("stay"); // the welcome gate has no way out but a choice
});
