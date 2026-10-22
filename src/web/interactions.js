import { app, api, hitTest, seaAt, setScale, postPositions, frameSelection, insets } from "./app.js";
import { openSeaEditor, removeSeaById, saveSeaPosition, seaEditing } from "./seas.js";
import { registerRegion } from "./keys.js";
import { LONG_PRESS_MS, pinchStep, pressAction, slopFor } from "./gesture-model.js";
import { boxBetween, emptyGroup, gatherBox, groupOffsets, groupSize, moveGroup, toggleMember } from "./group-model.js";


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
  // kind: "pan" | "node" | "sea" | "group" (a gathered member: all of them move) | "toggle" (shift-click) | "box" (shift-drag on water)
  // | "press" (a finger held still: acts on lift) | "pinch" (two fingers: pan and zoom)
  let drag = null; // { kind, slug, sea, startX, startY, lastX, lastY, moved, slop, ox, oy, offsets, from, timer }
  let edgeFrame = 0;
  const fingers = new Map(); // pointerId → { x, y } for every touch on the map

  /** A finger that holds still stops counting toward a long-press the moment it wanders. */
  function stopPress(d) {
    clearTimeout(d.timer);
    app.press = null;
  }

  /** Puts the dragged island, or the whole gathered group, under the pointer. */
  function moveDragged(px, py) {
    const w = app.camera.toWorld(px, py);
    if (drag.kind === "group") return moveGroup(drag.offsets, w, app.nodes, app.seas);
    const node = nodeBySlug(drag.slug);
    if (!node) return;
    node.x = w.x;
    node.y = w.y;
    node.pinned = true; // a dragged island is placed by hand from now on
  }

  /** While an island is held near an edge, the sea scrolls under it, so it can be pushed out into open water. */
  function edgePan() {
    edgeFrame = 0;
    if (!drag || (drag.kind !== "node" && drag.kind !== "group") || !drag.moved) return;
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
    if (fingers.has(e.pointerId)) {
      const last = fingers.get(e.pointerId);
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (drag?.kind === "pinch") {
        const [ida, idb] = [...fingers.keys()];
        const other = fingers.get(e.pointerId === ida ? idb : ida);
        const step = pinchStep(last, other, fingers.get(e.pointerId), other);
        app.camera.zoomAt(step.at.x, step.at.y, step.factor);
        app.camera.panBy(step.dx, step.dy);
        return;
      }
    }
    if (drag) {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (drag.kind === "press") return; // the long-press already counted: lifting the finger acts
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > drag.slop) {
        drag.moved = true;
        stopPress(drag);
      }
      if (drag.kind === "pan") {
        app.camera.panBy(dx, dy);
      } else if (drag.kind === "toggle") {
        // a shift-press on an island or a name only gathers it; dragging it does nothing
      } else if (drag.kind === "box") {
        if (drag.moved) app.marquee = boxBetween(drag.from, app.camera.toWorld(e.clientX, e.clientY));
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
    if (e.pointerType === "touch") {
      e.preventDefault(); // no compatibility mousedown after the finger lifts: it would focus the map and close a sea's field
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (fingers.size === 2) {
      // A second finger: pinch, unless the first is already carrying something (then the second is ignored).
      if (drag && drag.moved) return;
      if (drag) stopPress(drag);
      releaseHolds(drag);
      drag = { kind: "pinch", moved: true };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (drag) return; // a third finger, or a stray press mid-gesture
    const hit = hitTest(e.clientX, e.clientY);
    const sea = hit ? null : seaAt(e.clientX, e.clientY);
    const w = app.camera.toWorld(e.clientX, e.clientY);
    const gathered = (hit && app.group.islands.has(hit.slug)) || (sea && app.group.seas.has(sea.id));
    const kind = e.shiftKey ? (hit || sea ? "toggle" : "box") : gathered && groupSize(app.group) > 1 ? "group" : hit ? "node" : sea ? "sea" : "pan";
    drag = {
      kind,
      from: w,
      offsets: kind === "group" ? groupOffsets(app.group, w, app.nodes, app.seas) : [],
      slug: hit ? hit.slug : null,
      sea: sea ? sea.id : null,
      ox: sea ? w.x - sea.x : 0,
      oy: sea ? w.y - sea.y : 0,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      slop: slopFor(e.pointerType),
      timer: 0,
    };
    if (e.pointerType !== "mouse" && !e.shiftKey) {
      // Phones have no double-click and no shift: a finger held still gathers an island, renames a sea, or names one.
      const d = drag;
      app.press = { x: w.x, y: w.y, start: performance.now() };
      d.timer = setTimeout(() => {
        if (drag !== d || d.moved) return;
        releaseHolds(d);
        d.kind = "press";
        navigator.vibrate?.(12);
      }, LONG_PRESS_MS);
    }
    if (kind === "sea") app.heldSeas.add(sea.id);
    if (kind === "group") for (const id of app.group.seas) app.heldSeas.add(id);
    canvas.setPointerCapture(e.pointerId); // released implicitly on pointerup
    canvas.classList.add("dragging");
  });

  /** Seas held so a refresh mid-drag keeps them where the pointer put them; let go when a drag ends unsaved. */
  function releaseHolds(d) {
    if (d?.kind === "sea") app.heldSeas.delete(d.sea);
    if (d?.kind === "group") for (const id of app.group.seas) app.heldSeas.delete(id);
  }

  /** Ends the gesture on pointerup, or on pointercancel (`cancelled`): a move is kept, a click or a press is not. */
  function finish(e, cancelled) {
    fingers.delete(e.pointerId);
    if (drag?.kind === "pinch") {
      if (fingers.size === 0) drag = null; // the last finger up ends the pinch; one left behind does not start a drag
      return;
    }
    canvas.classList.remove("dragging");
    cancelAnimationFrame(edgeFrame);
    edgeFrame = 0;
    const d = drag;
    drag = null;
    if (!d) return;
    stopPress(d);
    app.marquee = cancelled ? null : app.marquee;
    if (cancelled && !d.moved) return releaseHolds(d);
    if (d.kind === "press") {
      const action = pressAction({ island: d.slug, sea: d.sea });
      if (action === "gather") app.group = toggleMember(app.group, "islands", d.slug);
      else if (action === "rename") openSeaEditor({ sea: app.seas.find((s) => s.id === d.sea) });
      else openSeaEditor({ at: d.from });
      return;
    }
    if (d.kind === "toggle") {
      app.group = d.slug ? toggleMember(app.group, "islands", d.slug) : toggleMember(app.group, "seas", d.sea);
      return;
    }
    if (d.kind === "box") {
      if (app.marquee) app.group = gatherBox(app.group, app.marquee, app.nodes, app.seas);
      app.marquee = null;
      return;
    }
    if (d.kind === "group" && d.moved) {
      void saveGroup();
      return;
    }
    if (d.kind === "group") for (const id of app.group.seas) app.heldSeas.delete(id);
    // A click or a drag of anything outside the group lets the group go; a click on a member keeps it, and so does panning.
    else if (!(d.kind === "pan" && d.moved)) app.group = emptyGroup();
    if (d.kind === "node" && d.moved) {
      const node = nodeBySlug(d.slug);
      if (node) postPositions([node]).catch((error) => console.error(error));
      return;
    }
    if (d.sea !== null && d.slug === null) {
      const sea = app.seas.find((s) => s.id === d.sea);
      app.selectedSea = d.sea; // a click or a drag selects the sea's name
      if (sea && d.moved) void saveSeaPosition(sea).finally(() => app.heldSeas.delete(d.sea));
      else app.heldSeas.delete(d.sea);
      return;
    }
    if (d.moved) return;
    app.selectedSea = null;
    const hit = hitTest(e.clientX, e.clientY);
    void select(hit ? hit.slug : null);
  }

  canvas.addEventListener("pointerup", (e) => finish(e, false));
  canvas.addEventListener("pointercancel", (e) => finish(e, true));
  canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // a long-press is the map's, not the browser's menu

  /** Saves where a moved group now sits: its islands in one post, then each sea name. */
  async function saveGroup() {
    const nodes = app.nodes.filter((n) => app.group.islands.has(n.slug));
    const seas = app.seas.filter((s) => app.group.seas.has(s.id));
    try {
      if (nodes.length) await postPositions(nodes);
      for (const s of seas) await saveSeaPosition(s);
    } catch (error) {
      console.error(error);
    } finally {
      for (const s of seas) app.heldSeas.delete(s.id);
    }
  }

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
    gathered: () => groupSize(app.group) > 0,
    clearGroup: () => { app.group = emptyGroup(); },
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
