// The plot bundle the page loads: function-plot's default export, given a name so the page can import it.
// Built once per process by `vendorBundle("plot")` and served at /vendor/plot.js. The library's own ESM
// spans eleven packages (a d3 subset, an interval-arithmetic evaluator), which is why it is bundled at all.
import functionPlot from "function-plot";

// function-plot's main is CommonJS whose exports object is itself a transpiled ESM namespace,
// so the default import is that namespace and the callable is its `default`. Unwrap here, once.
const plot = functionPlot.default ?? functionPlot;

export { plot as functionPlot };
