// The plot bundle the page loads: function-plot's default export, given a name so the page can import it.
// Built once per process by `vendorBundle("plot")` and served at /vendor/plot.js. The library's own ESM
// spans eleven packages (a d3 subset, an interval-arithmetic evaluator), which is why it is bundled at all.
import functionPlot from "function-plot";

export { functionPlot };
