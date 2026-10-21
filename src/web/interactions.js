import { app, api, hitTest, setScale, postPositions, frameSelection, insets } from "./app.js";
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

export function installInteractions(canvas) {
  let drag = null; // { kind: "pan" | "node", slug, startX, startY, lastX, lastY, moved }

  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > CLICK_SLOP) drag.moved = true;
      if (drag.kind === "pan") {
        app.camera.panBy(dx, dy);
      } else if (drag.moved) {
        const node = nodeBySlug(drag.slug);
        if (!node) return;
        const w = app.camera.toWorld(e.clientX, e.clientY);
        node.x = w.x;
        node.y = w.y;
        node.pinned = true; // a dragged island is placed by hand from now on
      }
      return;
    }
    const hit = hitTest(e.clientX, e.clientY);
    const slug = hit ? hit.slug : null;
    if (slug !== app.hover) {
      app.hover = slug;
      canvas.classList.toggle("hover", Boolean(slug));
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    const hit = hitTest(e.clientX, e.clientY);
    drag = {
      kind: hit ? "node" : "pan",
      slug: hit ? hit.slug : null,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
    canvas.setPointerCapture(e.pointerId); // released implicitly on pointerup
    canvas.classList.add("dragging");
  });

  canvas.addEventListener("pointerup", (e) => {
    canvas.classList.remove("dragging");
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === "node" && d.moved) {
      const node = nodeBySlug(d.slug);
      if (node) postPositions([node]).catch((error) => console.error(error));
      return;
    }
    if (d.moved) return;
    const hit = hitTest(e.clientX, e.clientY);
    void select(hit ? hit.slug : null);
  });

  canvas.addEventListener("pointerleave", () => {
    app.hover = null;
    canvas.classList.remove("hover");
  });

  canvas.addEventListener("dblclick", (e) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit && hit.island.hasChildren) void setScale(hit.slug);
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
        default: return false;
      }
    },
  });
}
