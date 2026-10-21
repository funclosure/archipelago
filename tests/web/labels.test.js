import { test, expect } from "bun:test";
import { layoutLabels, wrapName, LINE_H, DRAFT_H, WRAP } from "../../src/web/labels.js";
import { CENTRE, LAMP_R, NAME_Y } from "../../src/web/contour.js";

/** Ten box units a character: easy to reason about. */
const measure = (t) => t.length * 10;
const scale = () => 1;
const node = (slug, x, y, name = slug, extra = {}) => ({ slug, x, y, name, radius: 62, ...extra });

test("wrapName breaks at spaces within the width, and ends the last allowed line in an ellipsis", () => {
  expect(wrapName("State", measure)).toEqual(["State"]);
  expect(wrapName("JavaScript & TypeScript for Swift Developers", measure)).toEqual(["JavaScript &", "TypeScript for Swift", "Developers"]);
  expect(wrapName("one two three four five six seven eight nine ten eleven twelve thirteen", measure, 60, 2)).toEqual(["one", "two…"]);
  expect(wrapName("Supercalifragilisticexpialidociously-long", measure)).toEqual(["Supercalifragilisticexpialidociously-long"]); // one word never breaks
  expect(WRAP).toBeGreaterThan(124); // wider than the coast, so most names keep one line
});

test("islands far apart keep their names below, one line each", () => {
  const out = layoutLabels([node("a", 0, 0), node("b", 1000, 0)], { measure, scale });
  expect(out.get("a")).toEqual({ lines: ["a"], place: "below", cx: CENTRE, top: NAME_Y, hidden: false });
  expect(out.get("b").place).toBe("below");
});

test("a name that would run into the island below it goes above its own coast", () => {
  // b sits right under a: a's name below would cross b's lamps, so it moves above a
  const out = layoutLabels([node("a", 0, 0, "Networking, Data & Storage"), node("b", 0, 200)], { measure, scale });
  expect(out.get("a").place).toBe("above");
  expect(out.get("a").top).toBe(CENTRE - LAMP_R - 10 - 2 * LINE_H);
  expect(out.get("b").place).toBe("below");
});

test("two names side by side never overlap: the second finds another spot", () => {
  const out = layoutLabels([node("a", 0, 0, "Networking, Data & Storage"), node("b", 120, 20, "Performance & Animation")], { measure, scale });
  expect(out.get("a")).toMatchObject({ place: "below", hidden: false });
  expect(out.get("b").place).not.toBe("below");
  expect(out.get("b").hidden).toBe(false);
});

test("a side spot puts the label beside the lamps, centred on the island's height", () => {
  // islands right above and right below: only the sides are clear
  const out = layoutLabels([node("a", 0, 0, "Tools"), node("up", 0, -160), node("down", 0, 160)], { measure, scale, focus: "up" });
  const a = out.get("a");
  expect(a.place).toBe("right");
  expect(a.cx - 25).toBeGreaterThan(CENTRE + LAMP_R); // its left edge clears the lamps
  expect(a.top + LINE_H / 2).toBeCloseTo(CENTRE);
});

test("with no clear spot a name hides, until the island is hovered or selected", () => {
  const ring = [node("a", 0, 0, "Middle"), node("n", 0, -150), node("s", 0, 150), node("e", 150, 0), node("w", -150, 0)];
  expect(layoutLabels(ring, { measure, scale, focus: "n" }).get("a").hidden).toBe(true);
  expect(layoutLabels(ring, { measure, scale, hover: "a" }).get("a")).toMatchObject({ hidden: false, place: "below" });
});

test("the selection and the hovered island are placed first and never fade", () => {
  const crowd = [node("a", 0, 0, "Alpha alpha alpha"), node("b", 150, 0, "Beta beta beta"), node("c", 75, 160, "Gamma gamma"), node("d", 75, -160, "Delta delta")];
  for (const focus of ["a", "b", "c", "d"]) {
    const out = layoutLabels(crowd, { measure, scale, focus });
    expect(out.get(focus).hidden).toBe(false);
  }
  expect(layoutLabels(crowd, { measure, scale, hover: "b" }).get("b").hidden).toBe(false);
});

test("a draft's label counts its draft line, so the space under it stays clear", () => {
  // c sits just below where a draft's name and "draft" line would end
  const draft = node("a", 0, 0, "Tools", { draft: true });
  const below = NAME_Y - CENTRE + LINE_H + DRAFT_H;
  const out = layoutLabels([draft, node("c", 0, below + LAMP_R + 4)], { measure, scale });
  expect(out.get("a").place).toBe("above");
});
