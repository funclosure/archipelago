import { describe, expect, test } from "bun:test";
import { pinchStep, pressAction, slopFor } from "../../src/web/gesture-model.js";

describe("gesture-model", () => {
  test("a long-press gathers an island, renames a sea, and names open water", () => {
    expect(pressAction({ island: { slug: "a" }, sea: null })).toBe("gather");
    expect(pressAction({ sea: { id: 1 } })).toBe("rename");
    expect(pressAction({})).toBe("name");
  });

  test("a finger gets more slack than a mouse before a press is a drag", () => {
    expect(slopFor("touch")).toBeGreaterThan(slopFor("mouse"));
    expect(slopFor("pen")).toBe(slopFor("touch"));
  });

  test("fingers spreading apart zoom in about their midpoint", () => {
    const s = pinchStep({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 });
    expect(s.factor).toBe(2);
    expect(s.at).toEqual({ x: 150, y: 100 });
    expect([s.dx, s.dy]).toEqual([0, 0]);
  });

  test("fingers moving together pan without zooming", () => {
    const s = pinchStep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 30, y: 40 }, { x: 130, y: 40 });
    expect(s.factor).toBe(1);
    expect([s.dx, s.dy]).toEqual([30, 40]);
  });
});
