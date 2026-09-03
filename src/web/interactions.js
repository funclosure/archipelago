import { app, api, hitTest, setScale } from "./app.js";

/** Selects an island (or null), re-renders listeners, and posts focus so "this one" works in the terminal. */
export async function select(slug) {
  if (slug === app.selected) return;
  app.selected = slug;
  for (const fn of app.listeners) fn(app.snapshot);
  try {
    await api("/api/focus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: app.domain, island: slug }),
    });
  } catch (error) {
    console.error(error);
  }
}

export function installInteractions(canvas) {
  let drag = null; // { kind: "pan" | "node", node, lastX, lastY, moved }

  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 0) drag.moved = true;
      if (drag.kind === "pan") {
        app.camera.panBy(dx, dy);
      } else {
        const w = app.camera.toWorld(e.clientX, e.clientY);
        drag.node.x = w.x;
        drag.node.y = w.y;
        drag.node.pinned = true;
        app.sim.reheat(0.4);
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
    drag = { kind: hit ? "node" : "pan", node: hit, lastX: e.clientX, lastY: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
  });

  canvas.addEventListener("pointerup", (e) => {
    canvas.classList.remove("dragging");
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === "node") {
      d.node.pinned = false;
      app.sim.reheat(0.2);
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

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") void select(null);
  });
}
