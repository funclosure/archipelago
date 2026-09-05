// Contour: how an island is drawn. Reads derived fields only (state, landmarks, harbour, children, strait verdicts)
// and keeps no state of its own; the three write animations run off the timestamps the view model puts on nodes.
import {
  CENTRE, COAST, LAMP_R, SOUNDING_R, RING_STEP, ROLLUP_R, SNOW_R, HALO_R, ANCHOR, NAME_Y, LEVEL,
  boxScale, ringPoints, arcRanges, arcIndices, polar, rollupSegments, hatchLines, polylineLength,
} from "./contour.js";

export const PALETTE = {
  sea: "#1B3F5B",
  line: "#FFFFFF",
  lamp: "#F5C242",
  reef: "#D9473A",
  sand: "#E7D39A",
  grass: "#6FAF5E",
  snow: "#F2F4F1",
};

const LAMP_MS = 300;
const ARC_MS = 300;
const RING_MS = 400;
const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 0..1 through an animation that started at `since`; 1 when there is nothing to animate. */
function progress(since, ms, now) {
  if (!since || reduced) return 1;
  return Math.min(1, (now - since) / ms);
}

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function clear(ctx, w, h) {
  ctx.fillStyle = PALETTE.sea;
  ctx.fillRect(0, 0, w, h);
}

/** A closed ring through the points, or the first `upTo` segments of it while a ring is still being drawn. */
function traceRing(ctx, pts, upTo = pts.length) {
  const n = pts.length;
  const stop = Math.max(1, Math.min(n, Math.ceil(upTo)));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i <= stop; i++) ctx.lineTo(pts[i % n].x, pts[i % n].y);
  if (stop === n) ctx.closePath();
}

/** The open polyline from pts[i0] to pts[i1]; i1 === pts.length wraps to pts[0]. */
function traceArc(ctx, pts, i0, i1) {
  ctx.beginPath();
  ctx.moveTo(pts[i0 % pts.length].x, pts[i0 % pts.length].y);
  for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i % pts.length].x, pts[i % pts.length].y);
}

function fillInterior(ctx, state, coast) {
  traceRing(ctx, coast);
  ctx.fillStyle =
    state === "open" ? alpha(PALETTE.line, 0.04) : state === "sandbar" || state === "reef" ? alpha(PALETTE.sand, 0.18) : alpha(PALETTE.grass, 0.22);
  ctx.fill();
}

/** Elevation rings inside the coast, one per level; on a state change they draw clockwise. */
function drawElevation(ctx, node, now) {
  const level = LEVEL[node.state] || 0;
  if (!level) return;
  const t = progress(node.stateAt, RING_MS, now);
  ctx.strokeStyle = alpha(PALETTE.line, 0.7);
  ctx.lineWidth = 1.2;
  for (let k = 1; k <= level; k++) {
    const pts = ringPoints(node.seed, COAST - RING_STEP * k);
    traceRing(ctx, pts, pts.length * t);
    ctx.stroke();
  }
  if (node.state === "mountainous" && t >= 1) {
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, SNOW_R, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.snow;
    ctx.fill();
  }
}

/** The 45° hatch of a reef, clipped to the coast. */
function drawHatch(ctx, coast) {
  ctx.save();
  traceRing(ctx, coast);
  ctx.clip();
  ctx.beginPath();
  for (const l of hatchLines()) {
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
  }
  ctx.strokeStyle = PALETTE.reef;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.restore();
}

/** A parent with islets and no verdict of its own: one ring split by the islets' states. */
function drawRollup(ctx, node) {
  const colour = { sandbar: PALETTE.sand, settled: PALETTE.grass, mountainous: PALETTE.grass, reef: PALETTE.reef };
  ctx.lineWidth = 3;
  ctx.lineCap = "butt";
  for (const seg of rollupSegments(node.island.children.byState)) {
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, ROLLUP_R, seg.from, seg.to);
    ctx.strokeStyle = colour[seg.state];
    ctx.stroke();
  }
  ctx.lineCap = "round";
}

/** The coastline: one arc per landmark, dotted while dark (with a sounding), firm once lit. */
function drawCoast(ctx, node, coast, now) {
  const lm = node.island.landmarks;
  const total = lm ? lm.total : 0;
  const dotted = () => {
    ctx.setLineDash([1, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = alpha(PALETTE.line, 0.45);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (!total) {
    // no landmarks yet: the whole coast is uncharted
    traceRing(ctx, coast);
    dotted();
    return;
  }
  const arcs = arcRanges(total);
  arcIndices(total, coast.length).forEach(({ i0, i1 }, k) => {
    const item = lm.items[k];
    const lit = Boolean(item && item.lit);
    const t = lit ? progress(node.litAt.get(item.slug), ARC_MS, now) : 0;
    if (!lit || t < 1) {
      traceArc(ctx, coast, i0, i1);
      dotted();
    }
    if (lit) {
      // the dash grows from a dot to the whole arc, then the arc is solid
      const len = polylineLength(coast, i0, i1);
      traceArc(ctx, coast, i0, i1);
      ctx.setLineDash(t < 1 ? [1 + t * len, Math.max(0.01, 5 * (1 - t))] : []);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = PALETTE.line;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const p = polar(arcs[k].mid, SOUNDING_R);
      ctx.font = "9px Georgia, 'Times New Roman', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = alpha(PALETTE.line, 0.45);
      ctx.fillText("?", p.x, p.y);
    }
  });
}

/** One lamp per landmark just outside the coast: a hollow ring while dark, a lit dot with a halo once lit. */
function drawLamps(ctx, node, now) {
  const lm = node.island.landmarks;
  if (!lm || !lm.total) return;
  arcRanges(lm.total).forEach((arc, k) => {
    const p = polar(arc.mid, LAMP_R);
    const item = lm.items[k];
    if (item && item.lit) {
      const t = progress(node.litAt.get(item.slug), LAMP_MS, now);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = alpha(PALETTE.lamp, 0.22 * t);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.lamp;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.strokeStyle = alpha(PALETTE.line, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });
}

function drawAnchor(ctx) {
  ctx.font = "12px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = alpha(PALETTE.line, 0.85);
  ctx.fillText("⚓︎", ANCHOR.x, ANCHOR.y);
}

function drawName(ctx, node) {
  ctx.font = "20px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = alpha(PALETTE.line, node.state === "open" ? 0.75 : 0.9);
  ctx.fillText(node.name, CENTRE, NAME_Y);
}

export function drawIsland(ctx, node, { dim = false, selected = false, now = 0 } = {}) {
  const isl = node.island;
  const s = boxScale(node.radius);
  ctx.save();
  // world → box: the island's centre is the box centre, one box unit is `s` world units, so every mark scales with the map
  ctx.translate(node.x - CENTRE * s, node.y - CENTRE * s);
  ctx.scale(s, s);
  ctx.globalAlpha = dim ? 0.28 : 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const coast = ringPoints(node.seed, COAST);
  fillInterior(ctx, node.state, coast);
  if (!isl.verdict && isl.children.total > 0) drawRollup(ctx, node);
  else drawElevation(ctx, node, now);
  if (node.state === "reef") drawHatch(ctx, coast);
  drawCoast(ctx, node, coast, now);
  drawLamps(ctx, node, now);
  if (isl.harbour) drawAnchor(ctx);
  if (selected) {
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, HALO_R, 0, Math.PI * 2);
    ctx.strokeStyle = alpha(PALETTE.line, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  drawName(ctx, node);
  ctx.restore();
}

/** A strait is drawn only once both islands have verdicts: dotted until the strait itself is charted. */
export function drawStrait(ctx, link, { dim = false } = {}) {
  const a = link.source;
  const b = link.target;
  if (!a.island.verdict || !b.island.verdict) return;
  const sa = boxScale(a.radius);
  const sb = boxScale(b.radius);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const x1 = a.x + ux * (a.radius + 8 * sa);
  const y1 = a.y + uy * (a.radius + 8 * sa);
  const x2 = b.x - ux * (b.radius + 8 * sb);
  const y2 = b.y - uy * (b.radius + 8 * sb);
  const s = (sa + sb) / 2; // box units → world for widths and dashes

  ctx.save();
  ctx.globalAlpha = dim ? 0.2 : 1;
  ctx.lineCap = "round";
  const line = (ox, oy) => {
    ctx.beginPath();
    ctx.moveTo(x1 + ox, y1 + oy);
    ctx.lineTo(x2 + ox, y2 + oy);
    ctx.stroke();
  };
  if (link.state === "open") {
    ctx.setLineDash([2 * s, 6 * s]);
    ctx.strokeStyle = alpha(PALETTE.line, 0.45);
    ctx.lineWidth = 1 * s;
    line(0, 0);
  } else if (link.state === "reef") {
    ctx.setLineDash([6 * s, 3 * s]);
    ctx.strokeStyle = PALETTE.reef;
    ctx.lineWidth = 2 * s;
    line(0, 0);
  } else {
    ctx.strokeStyle = alpha(PALETTE.line, 0.85);
    ctx.lineWidth = 2 * s;
    line(0, 0);
    if (link.state === "mountainous") line(-uy * 3 * s, ux * 3 * s);
  }
  ctx.setLineDash([]);
  ctx.restore();
}
