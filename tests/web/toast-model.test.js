import { describe, expect, test } from "bun:test";
import { toastMs, pushToast, failureKind, TOAST_MAX } from "../../src/web/toast-model.js";

describe("toastMs", () => {
  test("more words stay longer, an error twice as long, never past ten seconds", () => {
    expect(toastMs("Copied")).toBeLessThan(toastMs("The map was exported to your downloads folder"));
    expect(toastMs("Copied", { kind: "error" })).toBe(toastMs("Copied") * 2);
    expect(toastMs("x".repeat(2000))).toBe(10000);
  });
  test("a toast with an action stays at least six seconds", () => {
    expect(toastMs("Removed", { action: true })).toBe(6000);
  });
});

describe("pushToast", () => {
  const a = { text: "a", kind: "info" }, b = { text: "b", kind: "info" }, c = { text: "c", kind: "info" }, d = { text: "d", kind: "info" };
  test("keeps the newest few", () => {
    expect(TOAST_MAX).toBe(3);
    expect(pushToast([a, b, c], d)).toEqual([b, c, d]);
  });
  test("the same words twice are one toast, at the end", () => {
    const again = { text: "a", kind: "info" };
    expect(pushToast([a, b], again)).toEqual([b, again]);
    expect(pushToast([a], { text: "a", kind: "error" })).toHaveLength(2);
  });
});

describe("failureKind", () => {
  test("a request that never arrived is offline, whatever the browser calls it", () => {
    expect(failureKind(new TypeError("Failed to fetch"))).toBe("offline");
    expect(failureKind(new Error("Load failed"))).toBe("offline");
    expect(failureKind(new Error("NetworkError when attempting to fetch resource."))).toBe("offline");
  });
  test("a 409 is busy; anything else speaks for itself", () => {
    expect(failureKind(Object.assign(new Error("a turn is running"), { status: 409 }))).toBe("busy");
    expect(failureKind(new Error("slug taken"))).toBe("other");
    expect(failureKind("plain")).toBe("other");
  });
});
