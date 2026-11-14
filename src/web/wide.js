// A drawing wider than its box: a diagram in a reply or on a board card. A little too wide, it is drawn smaller so
// it fits; much too wide, its holder scrolls sideways and says so: the hidden side fades out and an arrow there
// moves it (the holder also takes the keyboard's arrows). wide-model.js holds the pure parts.
import { wideMode, moreSides, pageStep } from "./wide-model.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { t } from "./i18n.js";

/** Every holder watched. A holder gone from the page is dropped on a later sweep; one not on it yet gets one beat. */
const watched = new Set();

function naturalWidth(svg) {
  return Number.parseFloat(svg.getAttribute("width")) || svg.viewBox?.baseVal?.width || svg.getBoundingClientRect().width;
}

function update(record) {
  const { box, holder } = record;
  const svg = holder.querySelector(":scope > svg");
  const mode = svg ? wideMode(naturalWidth(svg), holder.clientWidth) : "none";
  box.classList.toggle("fit", mode === "fit");
  const more = mode === "scroll" ? moreSides(holder.scrollLeft, holder.clientWidth, holder.scrollWidth) : "none";
  if (box.dataset.more !== more) box.dataset.more = more;
  // A holder that scrolls takes focus, so the arrow keys move it; one that does not is no stop for the keyboard.
  if (mode === "scroll") holder.tabIndex = 0;
  else holder.removeAttribute("tabindex");
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
 * drawing is shrunk to it and `data-more` ("none", "start", "end", "both") while it scrolls; the stylesheet does the rest.
 */
export function watchWide(box, holder) {
  holder.classList.add("holder");
  const record = { box, holder, left: false };
  box.dataset.more = "none";
  box.append(arrow(record, "start"), arrow(record, "end"));
  holder.addEventListener("scroll", () => update(record), { passive: true });
  if (!ro) return;
  watched.add(record);
  ro.observe(holder);
}
