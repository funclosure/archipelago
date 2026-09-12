// Plot fences in the log: a function-plot drawing from the bundle the server builds (/vendor/plot.js).
// Static by design — zoom and pan are off, so the log keeps the wheel. Colours are read from the canvas
// palette at draw time, and a plot is redrawn rather than cached, so a resize or a theme switch (which
// rebuilds the pane and the board) comes back in the right tokens with nothing to invalidate.
import { PALETTE } from "./draw.js";
import { parsePlot, plotSize, plotOptions, plotColours } from "./plot-model.js";

let plotter = null;
let loading = null;

/** Imports the bundle once. Resolves false when it cannot be had, and the fence stays as its source. */
function load() {
  if (plotter) return Promise.resolve(true);
  if (!loading) {
    loading = import("/vendor/plot.js")
      .then((m) => {
        plotter = m.functionPlot;
        return true;
      })
      .catch((error) => {
        console.warn("plots unavailable:", error);
        loading = null; // a later fence may try again
        return false;
      });
  }
  return loading;
}

/** The source, with the reason it did not draw above it. */
function fallback(source, message) {
  const frag = document.createDocumentFragment();
  const err = document.createElement("div");
  err.className = "error";
  err.textContent = message;
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = source;
  pre.append(code);
  frag.append(err, pre);
  return frag;
}

/** function-plot writes attributes and classes, so the palette goes on as inline styles: nothing outbids them. */
function paint(target, colours) {
  const svg = target.querySelector("svg");
  if (!svg) return;
  svg.style.backgroundColor = colours.ground;
  for (const el of svg.querySelectorAll(".axis path, .axis line")) el.style.stroke = colours.axis;
  for (const el of svg.querySelectorAll(".grid line, .grid path")) el.style.stroke = colours.grid;
  for (const el of svg.querySelectorAll("text")) el.style.fill = colours.text;
}

function draw(holder, source, options) {
  const box = holder.clientWidth || holder.parentElement?.clientWidth || 320;
  const target = document.createElement("div");
  holder.replaceChildren(target);
  try {
    plotter(plotOptions(options, { target, ...plotSize(box), palette: PALETTE }));
    paint(target, plotColours(PALETTE));
  } catch (e) {
    holder.replaceChildren(fallback(source, e instanceof Error ? e.message : "the plot did not draw"));
  }
}

/** Redraws at a new width. Disconnects itself once the plot has left the document. */
function observe(box, holder, source, options) {
  if (typeof ResizeObserver !== "function") return;
  let last = holder.clientWidth;
  const ro = new ResizeObserver(() => {
    if (!box.isConnected) {
      ro.disconnect();
      return;
    }
    const now = holder.clientWidth;
    if (Math.abs(now - last) < 8) return; // a redraw changes the height, never the width
    last = now;
    draw(holder, source, options);
  });
  ro.observe(holder);
}

/** A closed plot fence: an element now, the drawing when the bundle lands, the source if it cannot draw. */
export function plotElement(source) {
  const box = document.createElement("div");
  box.className = "plot";
  const cap = document.createElement("div");
  cap.className = "cap";
  cap.textContent = "plot";
  box.append(cap);
  const holder = document.createElement("div");
  holder.className = "holder";
  box.append(holder);

  const parsed = parsePlot(source);
  if (parsed.error) {
    holder.append(fallback(source, parsed.error));
    return box;
  }
  holder.textContent = "drawing a plot…";
  load().then((ready) => {
    if (!ready) {
      holder.replaceChildren(fallback(source, "plots unavailable"));
      return;
    }
    // A frame later: the element is in the document by then, so the first draw already has the pane's width.
    requestAnimationFrame(() => {
      draw(holder, source, parsed.options);
      observe(box, holder, source, parsed.options);
    });
  });
  return box;
}
