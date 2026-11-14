import { describe, expect, test } from "bun:test";
import { statusKey, failureKey, hintPlace, dockLane, roveTo, keyName, chromeTarget, HEADER_KEY, HINT_DELAY_MS } from "../../src/web/chrome-model.js";
import { failureKind } from "../../src/web/toast-model.js";
import { t } from "../../src/web/i18n.js";

describe("the status pill", () => {
  test("says nothing while the page is connected", () => {
    expect(statusKey({ connected: true, hasChart: true })).toBeNull();
    expect(statusKey({ connected: true, hasChart: false })).toBeNull();
  });

  test("never claims a chart is shown when there is none", () => {
    expect(t(statusKey({ connected: false, hasChart: true }))).toBe("Disconnected · showing the last chart");
    expect(t(statusKey({ connected: false, hasChart: false }))).toBe("Disconnected");
  });
});

describe("a first read that failed", () => {
  test("is told in plain words by kind, and only an unknown failure quotes the error", () => {
    expect(t(failureKey(failureKind(new TypeError("Failed to fetch"))))).toBe("The server is not answering.");
    expect(t(failureKey(failureKind(Object.assign(new Error("turn in flight"), { status: 409 }))))).toBe("The chart is busy with something else.");
    expect(t(failureKey(failureKind(new Error("database is locked"))), { error: "database is locked" })).toBe("Reading it failed: database is locked");
  });
});

describe("hintPlace", () => {
  const area = { left: 232, right: 1600 };
  const size = { width: 280 };

  test("stands under its cell, from the cell's left edge", () => {
    expect(hintPlace({ left: 436, bottom: 90 }, size, area)).toEqual({ left: 436, top: 98, width: 280 });
  });

  test("moves left to stay inside the map area: never under the pane", () => {
    const beside = { left: 232, right: 800 }; // a pane covers the rest
    expect(hintPlace({ left: 700, bottom: 90 }, size, beside)).toEqual({ left: 512, top: 98, width: 280 });
  });

  test("never slides under the outline, even from a cell that scrolled there", () => {
    expect(hintPlace({ left: 100, bottom: 90 }, size, area).left).toBe(240);
  });

  test("narrows to a map area smaller than the card", () => {
    expect(hintPlace({ left: 252, bottom: 134 }, size, { left: 232, right: 450 })).toEqual({ left: 240, top: 142, width: 202 });
    expect(hintPlace({ left: 12, bottom: 80 }, { width: 366 }, { left: 0, right: 390 })).toEqual({ left: 12, top: 88, width: 366 }); // a phone
  });
});

describe("dockLane", () => {
  test("a label slides out in full when no card is in its way", () => {
    expect(dockLane(1584, null)).toBe(340);
    expect(dockLane(1584, undefined)).toBe(340);
  });

  test("it stops short of the bottom card, with a gap", () => {
    expect(dockLane(1584, 1139)).toBe(340); // room to spare
    expect(dockLane(1264, 1031)).toBe(1264 - 32 - 14 - 12 - 1031);
  });

  test("it keeps enough to read a few words however near the card comes", () => {
    expect(dockLane(1084, 1040)).toBe(96);
  });
});

describe("walking the header", () => {
  test("left and right step, and stop at the ends", () => {
    expect(roveTo(5, 0, "ArrowRight")).toBe(1);
    expect(roveTo(5, 4, "ArrowRight")).toBe(4);
    expect(roveTo(5, 2, "ArrowLeft")).toBe(1);
    expect(roveTo(5, 0, "ArrowLeft")).toBe(0);
  });

  test("Home and End jump", () => {
    expect(roveTo(5, 3, "Home")).toBe(0);
    expect(roveTo(5, 1, "End")).toBe(4);
  });

  test("other keys are not moves, and an empty header has nowhere to go", () => {
    expect(roveTo(5, 2, "ArrowDown")).toBeNull();
    expect(roveTo(5, 2, "j")).toBeNull();
    expect(roveTo(0, 0, "ArrowRight")).toBeNull();
  });

  test("from outside the header, a move lands on its first stop", () => {
    expect(roveTo(5, -1, "ArrowRight")).toBe(0);
    expect(roveTo(5, -1, "ArrowLeft")).toBe(0);
  });
});

describe("keyName", () => {
  test("names Cmd- or Ctrl-Enter as the controls show it", () => {
    expect(keyName({ key: "Enter", metaKey: true })).toBe("⌘↵");
    expect(keyName({ key: "Enter", ctrlKey: true })).toBe("⌘↵");
  });

  test("a plain key is itself; any other chord is no key of the page's", () => {
    expect(keyName({ key: "g" })).toBe("g");
    expect(keyName({ key: "1" })).toBe("1");
    expect(keyName({ key: "c", metaKey: true })).toBeNull();
    expect(keyName({ key: "Enter", metaKey: true, altKey: true })).toBeNull();
  });
});

describe("chromeTarget", () => {
  const bare = { dock: ["g", "c"], cta: ["1", "2"], region: "map" };

  test("the dock's keys and the bottom card's keys press their buttons", () => {
    expect(chromeTarget("g", bare)).toEqual({ where: "dock", key: "g" });
    expect(chromeTarget("c", bare)).toEqual({ where: "dock", key: "c" });
    expect(chromeTarget("2", bare)).toEqual({ where: "cta", key: "2" });
  });

  test("the card comes first: beside a pane its c confirms a reef and there is no dock", () => {
    expect(chromeTarget("c", { cta: ["c", "d"], dock: [], region: "map" })).toEqual({ where: "cta", key: "c" });
    expect(chromeTarget("c", { cta: ["⌘↵", "c"], dock: ["g", "c"], region: "outline" })).toEqual({ where: "cta", key: "c" });
  });

  test("nothing answers while the board is open: those letters add its cards", () => {
    expect(chromeTarget("c", { ...bare, board: true })).toBeNull();
    expect(chromeTarget(HEADER_KEY, { ...bare, board: true })).toBeNull();
  });

  test("⌘↵ approves a sketch from the map or the outline, never from the pane, where it sends", () => {
    expect(chromeTarget("⌘↵", { cta: ["⌘↵"], region: "map" })).toEqual({ where: "cta", key: "⌘↵" });
    expect(chromeTarget("⌘↵", { cta: ["⌘↵"], region: "outline" })).toEqual({ where: "cta", key: "⌘↵" });
    expect(chromeTarget("⌘↵", { cta: ["⌘↵"], region: "pane" })).toBeNull();
  });

  test("the header's key goes to the header, unless it has nothing to stand on", () => {
    expect(chromeTarget(HEADER_KEY, bare)).toEqual({ where: "header", key: HEADER_KEY });
    expect(chromeTarget(HEADER_KEY, { ...bare, header: false })).toBeNull();
  });

  test("a key no control carries, or no key at all, is nobody's", () => {
    expect(chromeTarget("x", bare)).toBeNull();
    expect(chromeTarget(null, bare)).toBeNull();
    expect(chromeTarget("g", { cta: [], dock: [] })).toBeNull();
  });
});

test("the hint card waits about as long as a tooltip", () => {
  expect(HINT_DELAY_MS).toBeGreaterThanOrEqual(300);
  expect(HINT_DELAY_MS).toBeLessThanOrEqual(600);
});
