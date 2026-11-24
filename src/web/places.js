// Phones (max-width 720px): one place at a time, and a bar at the bottom that moves between them. The islands'
// list is the outline taking the screen, the map keeps the selection while the pane steps aside, the island is
// the pane, the board is the board. places-model.js decides; this module stamps `body[data-place]` (styles.css
// shows and hides by it), draws the bar, and keeps the board in step. On a wider screen it does nothing. It also
// says whether the page runs to the screen's edges (the viewport's `viewport-fit`), which only the phone's layout pads.
import { app, reframe, frameSelection } from "./app.js";
import { isChartOpen, isGuideOpen } from "./chart.js";
import { boardOpen, boardCount, openBoard, closeBoard } from "./board.js";
import { nextPlace, settle, tabsEnabled, keyboardUp, keyboardRoom, takesKeyboard, viewportContent, PLACES, NARROW, COVER } from "./places-model.js";
import { t } from "./i18n.js";

let bar = null;
let place = null; // null until the first snapshot says whether an island is open

const narrow = () => matchMedia(NARROW).matches;
const has = () => ({ pane: document.body.classList.contains("pane-open"), island: Boolean(app.selected) });

const SVG = "http://www.w3.org/2000/svg";
const ICONS = {
  islands: ["M5 7h14", "M5 12h14", "M5 17h9"],
  map: ["M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z", "M12 12.6a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"],
  island: ["M5 6.5h14v9.5h-8l-4 3v-3H5z"],
  board: ["M4.5 5.5h6v6h-6z", "M13.5 5.5h6v9h-6z", "M4.5 14.5h6v4h-6z"],
};

function icon(name) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}

function label(name) {
  if (name === "island") return isChartOpen() && !app.selected ? t(isGuideOpen() ? "places.guide" : "places.cartographer") : t("places.island");
  if (name === "board") return app.selected && boardCount() ? t("places.boardCount", { n: boardCount() }) : t("places.board");
  return t(`places.${name}`);
}

function draw() {
  if (!bar) return;
  const enabled = tabsEnabled(has());
  for (const b of bar.children) {
    const name = b.dataset.place;
    b.disabled = !enabled[name];
    if (name === place) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
    b.querySelector(".lbl").textContent = label(name);
  }
}

/** Moves to a place: stamps the body, opens or closes the board to match, and refits the map. */
function show(next) {
  const was = place;
  place = next;
  document.body.dataset.place = place;
  if (place === "board" && !boardOpen()) openBoard();
  if (place !== "board" && boardOpen()) closeBoard();
  draw();
  syncCard();
  if (place === "map" && was !== "map") {
    // The map was under something: refit it to the room it has now, on the island still selected.
    requestAnimationFrame(() => {
      reframe();
      if (app.selected) frameSelection();
    });
  }
}

function on(event) {
  if (!narrow() || place === null) return;
  show(nextPlace(place, event, has()));
}

const root = document.documentElement;

/**
 * The bottom card's height, for the stylesheet (--cta-h): on a phone the card spans the screen over the bar, and
 * the dock stands on its right end instead of hiding behind it.
 */
function syncCard() {
  const card = narrow() ? document.querySelector("#cta:not([hidden]) .cta-card") : null;
  const h = card ? card.offsetHeight : 0; // 0 too while another place is showing (the card is not drawn there)
  const value = h ? `${h + 8}px` : "";
  if (root.style.getPropertyValue("--cta-h") !== value) root.style.setProperty("--cta-h", value);
}

let tallest = 0; // the tallest the visible window has been at this width: what it is with no keyboard
let widthWas = 0;

/**
 * A phone's keyboard: while one is up (places-model.js decides), `body.keyboard` takes the bar away and --vvt,
 * --vvh and --kb-h tell the stylesheet what is left of the window, so the pane, the board and a dialog end where
 * the keyboard begins and the conversation keeps every line it can. A browser may shrink the layout for the
 * keyboard or lay the keyboard over it (and pan the page under it): the visual viewport says which, either way.
 */
function syncKeyboard() {
  const vv = window.visualViewport;
  const layout = window.innerHeight;
  if (window.innerWidth !== widthWas) [widthWas, tallest] = [window.innerWidth, 0]; // the phone was turned: another window altogether
  const visual = vv ? vv.height : layout;
  const zoomed = Boolean(vv) && Math.abs(vv.scale - 1) > 0.01;
  if (!zoomed) tallest = Math.max(tallest, visual, layout);
  const at = document.activeElement;
  const typing = Boolean(at) && takesKeyboard({ tag: at.tagName, type: at.type, editable: at.isContentEditable });
  const room = keyboardRoom({ up: narrow() && keyboardUp({ typing, visual, tallest, zoomed }), layout, visualTop: vv ? vv.offsetTop : 0, visual });
  document.body.classList.toggle("keyboard", room !== null);
  for (const [name, value] of [["--vvt", room?.top], ["--vvh", room?.height], ["--kb-h", room?.under]]) {
    const next = room ? `${value}px` : "";
    if (root.style.getPropertyValue(name) !== next) root.style.setProperty(name, next);
  }
}

/** The page to the screen's edges while the phone is upright, inside the safe area on its side (viewportContent). */
function syncCover() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const next = viewportContent(meta.content, matchMedia(COVER).matches);
  if (meta.content !== next) meta.content = next;
}

export function installPlaces() {
  syncCover();
  matchMedia(COVER).addEventListener("change", syncCover);
  bar = document.createElement("nav");
  bar.id = "places";
  bar.className = "places";
  bar.setAttribute("aria-label", t("places.label"));
  for (const name of PLACES) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.place = name;
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    b.append(icon(name), lbl);
    b.addEventListener("click", () => {
      // The tab of the place already showing, as on any phone, goes back to its start: the map to home (or to the selected island).
      if (name === "map" && place === "map" && narrow()) return void frameSelection();
      on({ type: "tab", place: name });
    });
    bar.append(b);
  }
  document.body.append(bar);

  const start = () => {
    if (!narrow()) {
      place = null;
      delete document.body.dataset.place;
      return;
    }
    if (place === null) show(settle(boardOpen() ? "board" : "island", has()));
  };
  // After card.js has drawn the pane for this snapshot: an island left open last time opens on its pane.
  app.listeners.add(() => {
    start();
    if (place !== null) show(settle(place, has()));
  });
  matchMedia(NARROW).addEventListener("change", start);
  new ResizeObserver(syncCard).observe(document.getElementById("cta")); // the card came, went, or its buttons wrapped
  matchMedia(NARROW).addEventListener("change", syncCard);
  window.visualViewport?.addEventListener("resize", syncKeyboard);
  window.visualViewport?.addEventListener("scroll", syncKeyboard);
  window.addEventListener("resize", syncKeyboard);
  // Focus moves in two steps when a redraw builds the field again (out, then in): look once both have happened.
  const soon = () => requestAnimationFrame(syncKeyboard);
  document.addEventListener("focusin", soon);
  document.addEventListener("focusout", soon);
  syncKeyboard();
  // The page's own pick (interactions.js dispatches it at the document), never a text field's native `select`, which
  // bubbles here too when its selection moves (a caret put after words given back to the box) and would leave the pane.
  document.addEventListener("select", (e) => e.target === document && on({ type: "select", slug: e.detail }));
  document.addEventListener("board", (e) => {
    if (e.detail.open !== undefined) on({ type: "board", open: e.detail.open });
    else draw(); // its cards changed: the count on the tab
  });
  // The pane also opens and closes without a selection changing (the cartographer's pane).
  let paneWas = has().pane;
  new MutationObserver(() => {
    const open = has().pane;
    if (open === paneWas) return;
    paneWas = open;
    on({ type: "pane", open });
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}
