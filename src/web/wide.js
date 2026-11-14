// Content wider than its box. A drawing (a diagram in a reply or on a board card) a little too wide is drawn smaller
// so it fits; much too wide, its holder scrolls sideways and says so: the hidden side fades out and an arrow there
// moves it (the holder also takes the keyboard's arrows). A long line of code scrolls its block the same way and
// fades the same way, without the arrows. wide-model.js holds the pure parts; the stylesheet draws from `data-more`.
import { wideMode, moreSides, pageStep } from "./wide-model.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { t } from "./i18n.js";

/** Every scroller watched. One gone from the page is dropped on a later sweep; one not on it yet gets one beat. */
const watched = new Set();

function naturalWidth(svg) {
  return Number.parseFloat(svg.getAttribute("width")) || svg.viewBox?.baseVal?.width || svg.getBoundingClientRect().width;
}

function update(record) {
  const { box, holder, drawing } = record;
  let scrolls = true;
  if (drawing) {
    const svg = holder.querySelector(":scope > svg");
    const mode = svg ? wideMode(naturalWidth(svg), holder.clientWidth) : "none";
    box.classList.toggle("fit", mode === "fit");
    scrolls = mode === "scroll";
    // A holder that scrolls takes focus, so the arrow keys move it; one that does not is no stop for the keyboard.
    if (scrolls) holder.tabIndex = 0;
    else holder.removeAttribute("tabindex");
  }
  const more = scrolls ? moreSides(holder.scrollLeft, holder.clientWidth, holder.scrollWidth) : "none";
  if (holder.dataset.more !== more) holder.dataset.more = more;
  if (box !== holder && box.dataset.more !== more) box.dataset.more = more;
}

const ro =
  typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
        for (const record of watched) {
          if (record.holder.isConnected) {
            record.left = false;
            update(record);
          } else if (record.left) {
            ro.unobserve(record.holder);
            watched.delete(record);
          } else record.left = true;
        }
      })
    : null;

function watch(record) {
  record.holder.dataset.more = "none";
  record.holder.addEventListener("scroll", () => update(record), { passive: true });
  if (!ro) return;
  watched.add(record);
  ro.observe(record.holder);
}

function arrow(record, side) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn sm icon wide-go ${side}`;
  b.append(icon(side === "start" ? "chevron-left" : "chevron-right", { size: 14 }));
  tip(b, t(side === "start" ? "wide.back" : "wide.on"));
  b.addEventListener("click", () => {
    const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    record.holder.scrollBy({ left: (side === "start" ? -1 : 1) * pageStep(record.holder.clientWidth), behavior: calm ? "auto" : "smooth" });
  });
  return b;
}

/**
 * Watches `holder`, the element inside `box` that a drawing (an `<svg>`) lands in. The box takes `.fit` when the
 * drawing is shrunk to it; box and holder take `data-more` ("none", "start", "end", "both") while it scrolls.
 */
export function watchWide(box, holder) {
  holder.classList.add("holder");
  const record = { box, holder, drawing: true, left: false };
  box.dataset.more = "none";
  box.append(arrow(record, "start"), arrow(record, "end"));
  watch(record);
}

/** Watches a block that scrolls sideways by itself (a `pre` of code): it takes `data-more` for the side that hides something. */
export function watchMore(scroller) {
  watch({ box: scroller, holder: scroller, drawing: false, left: false });
}
