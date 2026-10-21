import { test, expect } from "bun:test";
import { THEMES, DEFAULT_THEME, PALETTE_TOKENS, storedTheme, nextTheme, mermaidVariables } from "../../src/web/theme-model.js";

test("the registry: unique ids, the first is the default", () => {
  expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
  expect(THEMES[0].id).toBe(DEFAULT_THEME);
  expect(THEMES.map((t) => t.id)).toEqual(["night", "ink", "tide", "chart"]);
  expect(Object.keys(PALETTE_TOKENS)).toEqual(["sea", "line", "lamp", "reef", "sand", "grass", "snow", "explore"]);
});

test("storedTheme keeps a known id and falls back otherwise", () => {
  expect(storedTheme("chart")).toBe("chart");
  expect(storedTheme(null)).toBe("night");
  expect(storedTheme("")).toBe("night");
  expect(storedTheme("solarized")).toBe("night");
});

test("nextTheme walks the list and wraps", () => {
  expect(nextTheme("night")).toBe("ink");
  expect(nextTheme("tide")).toBe("chart");
  expect(nextTheme("chart")).toBe("night");
  expect(nextTheme("nope")).toBe("night");
});

test("mermaidVariables reads the tokens", () => {
  const tokens = { "--sea": "#1B3F5B", "--panel": "#0E2233", "--panel-2": "#245069", "--text": "rgba(255, 255, 255, .92)", "--line-03": "rgba(255, 255, 255, .45)", "--lamp": "#F5C242" };
  const v = mermaidVariables(tokens, true);
  expect(v).toMatchObject({ darkMode: true, background: "#1B3F5B", primaryColor: "#245069", primaryTextColor: "rgba(255, 255, 255, .92)", primaryBorderColor: "rgba(255, 255, 255, .45)", lineColor: "#F5C242", secondaryColor: "#0E2233", tertiaryColor: "#0E2233", noteBkgColor: "#245069", noteTextColor: "rgba(255, 255, 255, .92)", actorBkg: "#245069", actorBorder: "rgba(255, 255, 255, .45)", actorTextColor: "rgba(255, 255, 255, .92)", signalColor: "#F5C242", signalTextColor: "rgba(255, 255, 255, .92)", edgeLabelBackground: "#1B3F5B", fontFamily: "system-ui, sans-serif", fontSize: "13px" });
  expect(mermaidVariables(tokens, false).darkMode).toBe(false);
});
