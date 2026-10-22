import { describe, expect, test } from "bun:test";
import { boxBetween, emptyGroup, gatherBox, groupOffsets, groupSize, moveGroup, pruneGroup, toggleMember } from "../../src/web/group-model.js";

const nodes = () => [
  { slug: "a", x: 0, y: 0 },
  { slug: "b", x: 100, y: 50 },
  { slug: "c", x: 400, y: 400 },
  { slug: "d", x: 50, y: 20, draft: true },
];
const seas = () => [{ id: 1, x: 60, y: 60 }, { id: 2, x: 900, y: 900 }];

describe("group-model", () => {
  test("toggleMember adds, then takes out, without touching the original", () => {
    const g = emptyGroup();
    const one = toggleMember(g, "islands", "a");
    expect([...one.islands]).toEqual(["a"]);
    expect(g.islands.size).toBe(0);
    expect(toggleMember(one, "islands", "a").islands.size).toBe(0);
    expect(groupSize(toggleMember(one, "seas", 2))).toBe(2);
  });

  test("boxBetween is the same whichever corner the drag started from", () => {
    expect(boxBetween({ x: 10, y: 90 }, { x: 80, y: 5 })).toEqual({ x0: 10, y0: 5, x1: 80, y1: 90 });
  });

  test("gatherBox takes islands and sea names inside, never drafts, and keeps what was gathered", () => {
    const g = gatherBox(toggleMember(emptyGroup(), "islands", "c"), { x0: -10, y0: -10, x1: 120, y1: 80 }, nodes(), seas());
    expect([...g.islands].sort()).toEqual(["a", "b", "c"]);
    expect([...g.seas]).toEqual([1]);
  });

  test("pruneGroup drops members that left the scale", () => {
    const g = { islands: new Set(["a", "gone", "d"]), seas: new Set([1, 7]) };
    const p = pruneGroup(g, nodes(), seas());
    expect([...p.islands]).toEqual(["a"]);
    expect([...p.seas]).toEqual([1]);
  });

  test("a drag carries every member by the same amount and pins the islands", () => {
    const ns = nodes();
    const ss = seas();
    const g = { islands: new Set(["a", "b"]), seas: new Set([1]) };
    const offsets = groupOffsets(g, { x: 100, y: 50 }, ns, ss);
    moveGroup(offsets, { x: 130, y: 10 }, ns, ss);
    expect(ns[0]).toMatchObject({ x: 30, y: -40, pinned: true });
    expect(ns[1]).toMatchObject({ x: 130, y: 10, pinned: true });
    expect(ns[2]).toMatchObject({ x: 400, y: 400 });
    expect(ss[0]).toMatchObject({ x: 90, y: 20 });
    expect(ss[0].pinned).toBeUndefined();
  });
});
