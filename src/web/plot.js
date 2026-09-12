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
        if (typeof m.functionPlot !== "function") {
          console.warn("plots unavailable: bundle export is not callable");
          loading = null; // a later fence may try again
          return false;
        }
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
  for (const el of svg.querySelectorAll(".axis .tick line")) el.style.stroke = colours.grid; // the gridlines: ticks, not a .grid layer
  for (const el of svg.querySelectorAll(".tip-x-line, .tip-y-line")) el.style.stroke = colours.grid; // the hover crosshair
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

// One observer for the whole page, not one per plot. A detached target is dropped from the browser's
// "gather active observations" pass, so a callback bound to it via closure would never fire again and
// disconnecting from inside it would leak; instead every firing sweeps the records for dead ones, so a
// later plot's resize cleans up any plot whose pane or board went away in the meantime.
const records = new Set();
const ro =
  typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
        for (const record of records) {
          try {
            if (!record.box.isConnected) {
              ro.unobserve(record.holder);
              records.delete(record);
              continue;
            }
            const now = record.holder.clientWidth;
            if (Math.abs(now - record.last) < 8) continue; // a redraw changes the height, never the width
            record.last = now;
            draw(record.holder, record.source, record.options);
          } catch (e) {
            console.warn("plot resize failed:", e); // one bad record must not stop the rest of the sweep
          }
        }
      })
    : null;

/** Redraws at a new width. The shared observer sweeps this record away once the plot has left the document. */
function observe(box, holder, source, options) {
  if (!ro) return;
  records.add({ box, holder, source, options, last: holder.clientWidth });
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
    // A background tab never fires rAF, so draw straight away; the ResizeObserver corrects
    // the width on its first callback once layout settles.
    draw(holder, source, parsed.options);
    observe(box, holder, source, parsed.options);
  });
  return box;
}
