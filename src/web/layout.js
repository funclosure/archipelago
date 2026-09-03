// Force layout in the spirit of mindgraph's gravity-field model:
// mass-scaled repulsion, strait springs, soft centre gravity. Runs while alpha > 0.

import { WORLD } from "./view-model.js";

const REPULSION = 10000;
const SPRING = 0.03;
const CENTER = 0.0008;
const DAMPING = 0.8;
const MIN_GAP = 60;
const REST_GAP = 150;

export function createSimulation() {
  let nodes = [];
  let links = [];
  let alpha = 0;
  const center = { x: 0, y: 0 };

  /** Replace the graph. `heat` is the starting alpha: 1 for a new scale, lower for a quiet refresh. */
  function setGraph(newNodes, newLinks, heat = 1) {
    nodes = newNodes;
    links = newLinks;
    alpha = heat;
  }
  function setCenter(x, y) {
    center.x = x;
    center.y = y;
  }
  function reheat(value = 0.5) {
    alpha = Math.max(alpha, value);
  }

  function tick() {
    if (alpha <= 0.002) {
      alpha = 0;
      return false;
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = 1;
          dy = 0;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const gap = a.radius + b.radius + MIN_GAP;
        let f = (REPULSION * a.mass * b.mass) / d2;
        if (d < gap) f += (gap - d) * 0.6;
        const fx = (dx / d) * f * alpha;
        const fy = (dy / d) * f * alpha;
        a.vx -= fx / a.mass;
        a.vy -= fy / a.mass;
        b.vx += fx / b.mass;
        b.vy += fy / b.mass;
      }
    }
    for (const l of links) {
      const a = l.source;
      const b = l.target;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = a.radius + b.radius + REST_GAP;
      const f = (d - rest) * SPRING * alpha;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx / a.mass;
      a.vy += fy / a.mass;
      b.vx -= fx / b.mass;
      b.vy -= fy / b.mass;
    }
    let movement = 0;
    for (const n of nodes) {
      n.vx += (center.x - n.x) * CENTER * alpha;
      n.vy += (center.y - n.y) * CENTER * alpha;
      if (n.pinned) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < n.radius) { n.x = n.radius; n.vx = 0; }
      if (n.x > WORLD - n.radius) { n.x = WORLD - n.radius; n.vx = 0; }
      if (n.y < n.radius) { n.y = n.radius; n.vy = 0; }
      if (n.y > WORLD - n.radius) { n.y = WORLD - n.radius; n.vy = 0; }
      movement += Math.abs(n.vx) + Math.abs(n.vy);
    }
    alpha *= 0.99;
    if (nodes.length && movement / nodes.length < 0.03) alpha = 0;
    return true;
  }

  return {
    tick,
    setGraph,
    setCenter,
    reheat,
    get alpha() {
      return alpha;
    },
  };
}
