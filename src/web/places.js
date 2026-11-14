// Phones (max-width 720px): one place at a time, and a bar at the bottom that moves between them. The islands'
// list is the outline taking the screen, the map keeps the selection while the pane steps aside, the island is
// the pane, the board is the board. places-model.js decides; this module stamps `body[data-place]` (styles.css
// shows and hides by it), draws the bar, and keeps the board in step. On a wider screen it does nothing.
import { app, reframe, frameSelection } from "./app.js";
import { isChartOpen, isGuideOpen } from "./chart.js";
import { boardOpen, boardCount, openBoard, closeBoard } from "./board.js";
import { nextPlace, settle, tabsEnabled, PLACES } from "./places-model.js";
import { t } from "./i18n.js";

const NARROW = "(max-width: 720px)";
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
    b.setAttribute("aria-current", String(name === place));
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

export function installPlaces() {
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
    b.addEventListener("click", () => on({ type: "tab", place: name }));
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
  document.addEventListener("select", (e) => on({ type: "select", slug: e.detail }));
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
