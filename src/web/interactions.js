import { app, api, hitTest, seaAt, setScale, postPositions, frameSelection, insets } from "./app.js";
import { openSeaEditor, removeSeaById, saveSeaPosition, seaEditing } from "./seas.js";
import { registerRegion } from "./keys.js";

const CLICK_SLOP = 4; // px of pointer travel before a press counts as a drag

let focusQueue = Promise.resolve();

/** Selects an island (or null), re-renders listeners, and posts focus so "this one" works in the terminal. */
export async function select(slug) {
  if (slug === app.selected) return;
  app.selected = slug;
  for (const fn of app.listeners) fn(app.snapshot);
  frameSelection(); // the listeners have opened or closed the pane, so its width is settled
  // Serialise focus writes so the server always ends on the latest selection.
  focusQueue = focusQueue.then(() =>
    api("/api/focus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: app.domain, island: slug }),
    }).catch((error) => console.error(error)),
  );
  await focusQueue;
}

/** The live node for a slug; snapshot refreshes rebuild app.nodes, so never hold a node across events. */
function nodeBySlug(slug) {
  return app.nodes.find((n) => n.slug === slug) ?? null;
}

/** Dragging an island this close to the map area's edge pans the sea, up to EDGE_SPEED px a frame at the edge. */
const EDGE = 56;
const EDGE_SPEED = 14;

export function installInteractions(canvas) {
  let drag = null; // { kind: "pan" | "node" | "sea", slug, sea, startX, startY, lastX, lastY, moved, ox, oy }
  let edgeFrame = 0;

  /** Puts the dragged island under the pointer. */
  function moveDragged(px, py) {
    const node = nodeBySlug(drag.slug);
    if (!node) return;
    const w = app.camera.toWorld(px, py);
    node.x = w.x;
    node.y = w.y;
    node.pinned = true; // a dragged island is placed by hand from now on
  }

  /** While an island is held near an edge, the sea scrolls under it, so it can be pushed out into open water. */
  function edgePan() {
    edgeFrame = 0;
    if (!drag || drag.kind !== "node" || !drag.moved) return;
    const { left, right, top, bottom } = insets();
    const { w, h } = app.size;
    const push = (d) => (d < EDGE ? ((EDGE - Math.max(0, d)) / EDGE) * EDGE_SPEED : 0);
    const dx = push(drag.lastX - left) - push(w - right - drag.lastX);
    const dy = push(drag.lastY - top) - push(h - bottom - drag.lastY);
    if (!dx && !dy) return;
    app.camera.panBy(dx, dy);
    moveDragged(drag.lastX, drag.lastY);
    edgeFrame = requestAnimationFrame(edgePan);
  }

  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > CLICK_SLOP) drag.moved = true;
      if (drag.kind === "pan") {
        app.camera.panBy(dx, dy);
      } else if (drag.kind === "sea") {
        const sea = app.seas.find((s) => s.id === drag.sea);
        if (sea && drag.moved) {
          const w = app.camera.toWorld(e.clientX, e.clientY);
          sea.x = w.x - drag.ox;
          sea.y = w.y - drag.oy;
        }
      } else if (drag.moved) {
        moveDragged(e.clientX, e.clientY);
        if (!edgeFrame) edgeFrame = requestAnimationFrame(edgePan);
      }
      return;
    }
    const hit = hitTest(e.clientX, e.clientY);
    const slug = hit ? hit.slug : null;
    const sea = hit ? null : seaAt(e.clientX, e.clientY);
    app.hoverSea = sea ? sea.id : null;
    if (slug !== app.hover) app.hover = slug;
    canvas.classList.toggle("hover", Boolean(slug || sea));
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (seaEditing()) return; // the click lands on the water: the field's blur keeps the name
    const hit = hitTest(e.clientX, e.clientY);
    const sea = hit ? null : seaAt(e.clientX, e.clientY);
    const w = app.camera.toWorld(e.clientX, e.clientY);
    drag = {
      kind: hit ? "node" : sea ? "sea" : "pan",
      slug: hit ? hit.slug : null,
      sea: sea ? sea.id : null,
      ox: sea ? w.x - sea.x : 0,
      oy: sea ? w.y - sea.y : 0,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
    if (sea) app.draggingSea = sea.id;
    canvas.setPointerCapture(e.pointerId); // released implicitly on pointerup
    canvas.classList.add("dragging");
  });

  canvas.addEventListener("pointerup", (e) => {
    canvas.classList.remove("dragging");
    cancelAnimationFrame(edgeFrame);
    edgeFrame = 0;
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === "node" && d.moved) {
      const node = nodeBySlug(d.slug);
      if (node) postPositions([node]).catch((error) => console.error(error));
      return;
    }
    if (d.kind === "sea") {
      const sea = app.seas.find((s) => s.id === d.sea);
      app.draggingSea = null;
      app.selectedSea = d.sea; // a click or a drag selects the sea's name
      if (sea && d.moved) void saveSeaPosition(sea);
      return;
    }
    if (d.moved) return;
    app.selectedSea = null;
    const hit = hitTest(e.clientX, e.clientY);
    void select(hit ? hit.slug : null);
  });

  canvas.addEventListener("pointerleave", () => {
    app.hover = null;
    canvas.classList.remove("hover");
  });

  canvas.addEventListener("dblclick", (e) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit) {
      if (hit.island.hasChildren) void setScale(hit.slug);
      return;
    }
    // Double-click a sea's name to rename it; double-click open water to name a sea there.
    const sea = seaAt(e.clientX, e.clientY);
    if (sea) openSeaEditor({ sea });
    else openSeaEditor({ at: app.camera.toWorld(e.clientX, e.clientY) });
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      app.camera.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );

  const PAN_PX = 80;
  const ZOOM = 1.2;
  /** The centre of the map area between the outline, the pane, the header, and the bottom card, in screen px. */
  const mapCentre = () => {
    const { left, right, top, bottom } = insets();
    return { x: left + (app.size.w - left - right) / 2, y: top + (app.size.h - top - bottom) / 2 };
  };
  const nearestToCentre = () => {
    const c = app.camera.toWorld(mapCentre().x, mapCentre().y);
    let best = null;
    let bestD = Infinity;
    for (const n of app.nodes) {
      const d = Math.hypot(n.x - c.x, n.y - c.y);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };
  registerRegion("map", {
    seaSelected: () => app.selectedSea !== null,
    clearSea: () => { app.selectedSea = null; },
    onKey(e) {
      switch (e.key) {
        case "Enter": {
          const slug = app.hover ?? nearestToCentre()?.slug ?? null;
          if (slug) void select(slug);
          return Boolean(slug);
        }
        case "ArrowLeft": app.camera.panBy(PAN_PX, 0); return true;
        case "ArrowRight": app.camera.panBy(-PAN_PX, 0); return true;
        case "ArrowUp": app.camera.panBy(0, PAN_PX); return true;
        case "ArrowDown": app.camera.panBy(0, -PAN_PX); return true;
        case "+":
        case "=": { const c = mapCentre(); app.camera.zoomAt(c.x, c.y, ZOOM); return true; }
        case "-": { const c = mapCentre(); app.camera.zoomAt(c.x, c.y, 1 / ZOOM); return true; }
        case "0": frameSelection(); return true;
        case "Delete":
        case "Backspace":
          if (app.selectedSea === null) return false;
          void removeSeaById(app.selectedSea);
          return true;
        default: return false;
      }
    },
  });
}
