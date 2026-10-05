// The plot fence's body → the library's options. Pure: the library is never imported here.
import { test, expect } from "bun:test";
import { PLOT_LANGS, SERIES_KEYS, parsePlot, plotSize, rgba, plotColours, plotOptions, plotLegend } from "../../src/web/plot-model.js";

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
  expect(plotSize(400)).toEqual({ width: 400, height: 300 });
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

// This pins current behaviour, not desired behaviour: a `{}` body draws empty axes instead of falling
// back to the source, which is a known defect. Whoever fixes the `{}` case should flip this test.
test("a config without data still yields a drawable options object", () => {
  const out = plotOptions({ xAxis: { domain: [0, 1] } }, { target: "T", width: 10, height: 20, palette: PALETTE });
  expect(out.data).toEqual([]);
});

test("an expression cannot carry code: a bracket, a quote, or a backtick is rejected", () => {
  const payload = "['(window.__PWNED=1,x)']";
  expect(parsePlot(payload).error).toBeTruthy();
  expect(parsePlot(payload).options).toBeUndefined();

  // the same payload as one line among plain expression lines — the line-based path must check it too
  expect(parsePlot(`x^2\n${payload}`).error).toBeTruthy();

  // the same payload as a `fn` inside a JSON body
  const jsonBody = JSON.stringify({ data: [{ fn: payload }] });
  expect(parsePlot(jsonBody).error).toBeTruthy();
  expect(parsePlot(jsonBody).options).toBeUndefined();

  // legitimate expressions still parse
  for (const fn of ["x^2", "x*log(x)", "2*x*log(x)", "1000000/x", "x^2/4"]) {
    expect(parsePlot(fn)).toEqual({ options: { data: [{ fn }] } });
  }

  // a parametric datum in a JSON body is checked the same way, on both x and y
  const safeParametric = JSON.stringify({ data: [{ x: "cos(t)", y: "sin(t)" }] });
  expect(parsePlot(safeParametric).error).toBeUndefined();
  const unsafeParametric = JSON.stringify({ data: [{ x: "cos(t)", y: payload }] });
  expect(parsePlot(unsafeParametric).error).toBeTruthy();

  // function-plot compiles a datum's `derivative.fn` through the same evaluator, so it is checked too
  const unsafeDerivative = JSON.stringify({ data: [{ fn: "x^2", derivative: { fn: payload } }] });
  expect(parsePlot(unsafeDerivative).error).toBeTruthy();
  const safeDerivative = JSON.stringify({ data: [{ fn: "x^2", derivative: { fn: "2*x" } }] });
  expect(parsePlot(safeDerivative).error).toBeUndefined();
});

test("the legend names each curve in its own colour: its title, else its expression", () => {
  const two = parsePlot('{"data":[{"fn":"2*x","title":"×2 policy"},{"fn":"x^2/2"}]}').options;
  expect(plotLegend(two, PALETTE)).toEqual([
    { label: "×2 policy", color: PALETTE.lamp },
    { label: "x^2/2", color: PALETTE.grass },
  ]);
  // the colours are the ones plotOptions gives the library, so swatch and line always match
  const drawn = plotOptions(two, { target: null, width: 300, height: 200, palette: PALETTE }).data.map((d) => d.color);
  expect(plotLegend(two, PALETTE).map((e) => e.color)).toEqual(drawn);
  expect(plotLegend(parsePlot("x^2\nx*log(x)").options, PALETTE).map((e) => e.label)).toEqual(["x^2", "x*log(x)"]);
});

test("one curve with no title has no legend; a title earns one", () => {
  expect(plotLegend(parsePlot("x^2").options, PALETTE)).toEqual([]);
  expect(plotLegend(parsePlot('{"data":[{"fn":"x^2","title":"  quadratic  "}]}').options, PALETTE)).toEqual([{ label: "quadratic", color: PALETTE.lamp }]);
  expect(plotLegend(parsePlot('{"data":[{"fn":"x^2","title":"   "}]}').options, PALETTE)).toEqual([]); // a blank title is no title
});

test("legend labels for parametric, polar, unnamed, and over-long curves; an explicit colour is honoured", () => {
  const options = { data: [
    { x: "cos(t)", y: "sin(t)", fnType: "parametric" },
    { r: "2*sin(4*theta)", fnType: "polar" },
    { points: [[1, 2]], fnType: "points" },
    { fn: "x", title: "a".repeat(60), color: "#123456" },
  ] };
  const legend = plotLegend(options, PALETTE);
  expect(legend.map((e) => e.label)).toEqual(["(cos(t), sin(t))", "r = 2*sin(4*theta)", "series 3", `${"a".repeat(39)}…`]);
  expect(legend[3].color).toBe("#123456");
  expect(plotLegend({}, PALETTE)).toEqual([]);
});
