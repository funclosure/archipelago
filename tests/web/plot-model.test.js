// The plot fence's body → the library's options. Pure: the library is never imported here.
import { test, expect } from "bun:test";
import { PLOT_LANGS, SERIES_KEYS, parsePlot, plotSize, rgba, plotColours, plotOptions } from "../../src/web/plot-model.js";

const PALETTE = { sea: "#1B3F5B", line: "#FFFFFF", lamp: "#F5C242", reef: "#D9473A", sand: "#E7D39A", grass: "#6FAF5E", snow: "#F2F4F1" };

test("the three fence tags are shuttle's, and series colours have an order", () => {
  expect([...PLOT_LANGS].sort()).toEqual(["function-plot", "math-plot", "plot"]);
  expect(SERIES_KEYS).toEqual(["lamp", "grass", "snow", "reef"]);
});

test("one expression per line, comments and blank lines dropped", () => {
  expect(parsePlot("x^2")).toEqual({ options: { data: [{ fn: "x^2" }] } });
  expect(parsePlot("  x^2  \n\nsin(x)\n")).toEqual({ options: { data: [{ fn: "x^2" }, { fn: "sin(x)" }] } });
  expect(parsePlot("// the naive one\nx^2\n# and the good one\nx*log(x)")).toEqual({
    options: { data: [{ fn: "x^2" }, { fn: "x*log(x)" }] },
  });
});

test("an empty body, or one that is only comments, is an error and never an empty plot", () => {
  expect(parsePlot("").error).toBeTruthy();
  expect(parsePlot("   \n  ").error).toBeTruthy();
  expect(parsePlot("// nothing to draw").error).toBeTruthy();
  expect(parsePlot(null).error).toBeTruthy();
});

test("a body that starts with a brace is a function-plot options object", () => {
  const body = '{ "data": [{ "fn": "x^2" }], "xAxis": { "domain": [1, 50] } }';
  expect(parsePlot(body)).toEqual({ options: { data: [{ fn: "x^2" }], xAxis: { domain: [1, 50] } } });
});

test("malformed JSON is an error carrying a message, and a JSON array is not a config", () => {
  const bad = parsePlot('{ "data": [ }');
  expect(bad.options).toBeUndefined();
  expect(typeof bad.error).toBe("string");
  expect(bad.error.length).toBeGreaterThan(0);
  expect(parsePlot('[{ "fn": "x^2" }]').error).toBeTruthy();
});

test("plotSize fills the box, keeps 4:3, and stays inside the caps", () => {
  expect(plotSize(400)).toEqual({ width: 384, height: 288 });
  expect(plotSize(2000).width).toBe(560);
  expect(plotSize(2000).height).toBe(380);
  expect(plotSize(40).width).toBe(180);
});

test("rgba reads a six-digit token, and the colours come off the palette", () => {
  expect(rgba("#FFFFFF", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  expect(rgba("#1B3F5B", 1)).toBe("rgba(27, 63, 91, 1)");
  const c = plotColours(PALETTE);
  expect(c.ground).toBe("#1B3F5B");
  expect(c.axis).toBe("rgba(255, 255, 255, 0.65)");
  expect(c.grid).toBe("rgba(255, 255, 255, 0.16)");
  expect(c.text).toBe("rgba(255, 255, 255, 0.8)");
});

test("series take palette colours in order and wrap past the fourth; an explicit colour is kept", () => {
  const parsed = parsePlot("a\nb\nc\nd\ne").options;
  const out = plotOptions(parsed, { target: "T", width: 10, height: 20, palette: PALETTE });
  expect(out.data.map((d) => d.color)).toEqual(["#F5C242", "#6FAF5E", "#F2F4F1", "#D9473A", "#F5C242"]);
  const kept = plotOptions({ data: [{ fn: "x", color: "#123456" }] }, { target: "T", width: 10, height: 20, palette: PALETTE });
  expect(kept.data[0].color).toBe("#123456");
});

test("the body keeps its own axis options", () => {
  const parsed = parsePlot('{ "data": [{ "fn": "x^2" }], "xAxis": { "domain": [1, 50] }, "yAxis": { "domain": [0, 2500] } }').options;
  const out = plotOptions(parsed, { target: "T", width: 10, height: 20, palette: PALETTE });
  expect(out.xAxis).toEqual({ domain: [1, 50] });
  expect(out.yAxis).toEqual({ domain: [0, 2500] });
});

test("a body cannot move the plot, resize it, or take the wheel: the fixed options land last", () => {
  const parsed = parsePlot('{ "data": [{ "fn": "x" }], "target": "#elsewhere", "width": 9999, "height": 9999, "disableZoom": false, "grid": false }').options;
  const out = plotOptions(parsed, { target: "T", width: 300, height: 225, palette: PALETTE });
  expect(out.target).toBe("T");
  expect(out.width).toBe(300);
  expect(out.height).toBe(225);
  expect(out.disableZoom).toBe(true);
  expect(out.grid).toBe(true);
});

test("a config without data still yields a drawable options object", () => {
  const out = plotOptions({ xAxis: { domain: [0, 1] } }, { target: "T", width: 10, height: 20, palette: PALETTE });
  expect(out.data).toEqual([]);
});
