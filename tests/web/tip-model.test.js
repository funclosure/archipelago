import { describe, expect, test } from "bun:test";
import { tipPlace, tipDelay, tipKeys, isNearPress, TIP_DELAY_MS, TIP_WARM_MS } from "../../src/web/tip-model.js";
import { ICONS, ICON_NAMES } from "../../src/web/icons.js";

const viewport = { width: 1000, height: 600 };
const size = { width: 120, height: 28 };

describe("tipPlace", () => {
  test("sits centred under its control", () => {
    expect(tipPlace({ left: 400, right: 440, top: 100, bottom: 130 }, size, viewport)).toEqual({ left: 360, top: 136, side: "bottom" });
  });
  test("flips above when there is no room below, and below when asked above with no room", () => {
    expect(tipPlace({ left: 400, right: 440, top: 560, bottom: 590 }, size, viewport).side).toBe("top");
    expect(tipPlace({ left: 400, right: 440, top: 560, bottom: 590 }, size, viewport).top).toBe(560 - 6 - 28);
    expect(tipPlace({ left: 400, right: 440, top: 10, bottom: 30 }, size, viewport, { side: "top" }).side).toBe("bottom");
  });
  test("stays inside the viewport at either edge", () => {
    expect(tipPlace({ left: 0, right: 20, top: 100, bottom: 130 }, size, viewport).left).toBe(8);
    expect(tipPlace({ left: 980, right: 1000, top: 100, bottom: 130 }, size, viewport).left).toBe(1000 - 8 - 120);
  });
  test("a tip wider than the window still starts at the margin", () => {
    expect(tipPlace({ left: 10, right: 30, top: 100, bottom: 130 }, { width: 2000, height: 28 }, viewport).left).toBe(8);
  });
});

describe("tipDelay", () => {
  test("waits at first, and not at all just after another tip", () => {
    expect(tipDelay(1000, null)).toBe(TIP_DELAY_MS);
    expect(tipDelay(1000, 1000 - TIP_WARM_MS)).toBe(0);
    expect(tipDelay(1000, 1000 - TIP_WARM_MS - 1)).toBe(TIP_DELAY_MS);
  });
});

describe("tipKeys", () => {
  test("splits modifiers from their key and keeps words whole", () => {
    expect(tipKeys("b")).toEqual(["b"]);
    expect(tipKeys("⌘K")).toEqual(["⌘", "K"]);
    expect(tipKeys("⇧⌘P")).toEqual(["⇧", "⌘", "P"]);
    expect(tipKeys("⌘↵")).toEqual(["⌘", "↵"]);
    expect(tipKeys("Esc")).toEqual(["Esc"]);
    expect(tipKeys("↑ ↓")).toEqual(["↑", "↓"]);
    expect(tipKeys("")).toEqual([]);
    expect(tipKeys(undefined)).toEqual([]);
  });
});

describe("isNearPress", () => {
  test("a pointer resting where it pressed is not hovering anew; one that moved away is", () => {
    expect(isNearPress({ x: 100, y: 100 }, { clientX: 103, clientY: 104 })).toBe(true);
    expect(isNearPress({ x: 100, y: 100 }, { clientX: 100, clientY: 107 })).toBe(false);
  });
});

describe("icons", () => {
  test("every icon is path data on the 16-unit grid", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(20);
    for (const name of ICON_NAMES) {
      const d = ICONS[name];
      expect(d.startsWith("M")).toBe(true);
      expect(d).toMatch(/^[MmLlHhVvCcSsAaZz0-9 .,-]+$/);
      const numbers = d.match(/-?\d*\.?\d+/g).map(Number);
      // absolute coordinates stay in the box; a relative step or an arc flag is always smaller still
      expect(Math.max(...numbers)).toBeLessThanOrEqual(16);
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(-16);
    }
  });
});
