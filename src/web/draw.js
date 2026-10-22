// Contour: how an island is drawn. Reads derived fields only (state, marks, lamp, rollup, harbour, children, strait verdicts)
// and keeps no state of its own; the lens is already applied by the view model, and the write animations run off its timestamps.
import {
  CENTRE, COAST, LAMP_R, SOUNDING_R, RING_STEP, ROLLUP_R, SNOW_R, HALO_R, ANCHOR, NAME_Y, LEVEL,
  boxScale, ringPoints, arcRanges, arcIndices, polar, rollupSegments, hatchLines, polylineLength,
} from "./contour.js";
import { LINE_H } from "./labels.js";
import { t as tr } from "./i18n.js"; // `t` is the animation clock in this file

export const PALETTE = {
  sea: "#0E293A",
  line: "#F0F6F9",
  lamp: "#FDC44F",
  reef: "#FD7466",
  sand: "#EAD297",
  grass: "#79C77C",
  snow: "#F8F7F2",
  explore: "#65D8E4",
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

/** The theme pushes its eight canvas tokens here; every draw call reads PALETTE at draw time. */
export function setPalette(p) {
  Object.assign(PALETTE, p);
}

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A sea's stippled water (sea-model.js), in the coast colour: fine dots, stronger where its islands are close. */
export function drawSeaWater(ctx, dots, radius, dim = false) {
  const r = radius * 0.024;
  for (const [x, y, a] of dots) {
    ctx.fillStyle = alpha(PALETTE.line, (0.07 + a * 0.2) * (dim ? 0.4 : 1));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A sea's name: upright capitals, tracked as `set` says (sea-model.js `lettering`), faint until hovered or selected. */
export function drawSeaName(ctx, sea, set, { selected = false, hover = false, dim = false, draft = false } = {}) {
  ctx.save();
  ctx.font = `${set.font}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = draft ? alpha(PALETTE.lamp, 0.6) : alpha(PALETTE.line, (selected || hover ? 0.72 : 0.4) * (dim ? 0.5 : 1));
  let x = sea.x - set.total / 2;
  [...set.text].forEach((ch, i) => {
    ctx.fillText(ch, x, sea.y + set.font * 0.35);
    x += set.widths[i] + set.track;
  });
  if (selected) {
    const pad = set.font * 0.5;
    ctx.setLineDash([set.font * 0.14, set.font * 0.18]);
    ctx.strokeStyle = alpha(PALETTE.lamp, 0.7);
    ctx.lineWidth = set.font * 0.04;
    ctx.strokeRect(sea.x - set.total / 2 - pad, sea.y - set.font * 0.9, set.total + 2 * pad, set.font * 1.5);
  }
  ctx.restore();
}

/** The box a shift-drag is drawing to gather islands, in world units; `scale` (px per world unit) keeps its line one px. */
export function drawMarquee(ctx, box, scale) {
  ctx.save();
  ctx.fillStyle = alpha(PALETTE.lamp, 0.06);
  ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  ctx.setLineDash([4 / scale, 4 / scale]);
  ctx.strokeStyle = alpha(PALETTE.lamp, 0.8);
  ctx.lineWidth = 1 / scale;
  ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  ctx.restore();
}

/** A finger held on the map: a lamp ring that closes as the press nears a long-press, a fixed size on screen. */
export function drawPress(ctx, press, scale, progress) {
  if (progress < 0.15) return; // a tap or the start of a drag shows nothing
  const r = 28 / scale;
  ctx.save();
  ctx.beginPath();
  ctx.arc(press.x, press.y, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.strokeStyle = alpha(PALETTE.lamp, progress < 1 ? 0.6 : 0.9);
  ctx.lineWidth = 3 / scale;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

/** Where the three coasts of the sketching chart sit, in px from its centre, with the seeds that shape them. */
const SKETCH_ISLES = [
  { dx: -92, dy: 6, seed: 7 },
  { dx: 0, dy: -38, seed: 23 },
  { dx: 96, dy: 14, seed: 41 },
];
/** One loop of the sketching chart, in ms: each coast traces in turn, the straits follow, then it fades and redraws. */
const SKETCH_LOOP = 4800;

/**
 * The cartographer at work on an empty scale, in screen px around `at`: three coasts trace themselves one after
 * another in lamp, dotted straits join them, and the whole fades and starts over; under it the title and the step.
 * `still` (reduced motion) draws it once, complete.
 */
export function drawSketching(ctx, at, now, { title, step, still = false }) {
  const t = still ? SKETCH_LOOP * 0.7 : now % SKETCH_LOOP;
  const fade = still ? 1 : t < 300 ? t / 300 : t > SKETCH_LOOP - 700 ? (SKETCH_LOOP - t) / 700 : 1;
  const s = 34 / COAST; // box units → px: a coast of 34px
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const done = [];
  SKETCH_ISLES.forEach((isle, i) => {
    const p = Math.max(0, Math.min(1, (t - 200 - i * 650) / 1300));
    if (p <= 0) return;
    const pts = ringPoints(isle.seed, COAST).map((q) => ({ x: at.x + isle.dx + (q.x - CENTRE) * s, y: at.y + isle.dy + (q.y - CENTRE) * s }));
    traceRing(ctx, pts, p * pts.length);
    if (p === 1) {
      ctx.fillStyle = alpha(PALETTE.lamp, 0.06);
      ctx.fill();
      done.push(isle);
    }
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = alpha(PALETTE.lamp, 0.85);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    // the pen: a lamp dot where the line is being drawn
    if (p < 1) {
      const head = pts[Math.min(pts.length - 1, Math.floor(p * pts.length))];
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = alpha(PALETTE.lamp, 0.95);
      ctx.fill();
    }
  });
  // dotted straits between finished neighbours, drawn out from each coast
  for (let i = 1; i < done.length; i++) {
    const a = done[i - 1];
    const b = done[i];
    const p = Math.max(0, Math.min(1, (t - 200 - i * 650 - 1300) / 500));
    const dx = b.dx - a.dx;
    const dy = b.dy - a.dy;
    const d = Math.hypot(dx, dy);
    const ux = dx / d;
    const uy = dy / d;
    const x1 = at.x + a.dx + ux * 42;
    const y1 = at.y + a.dy + uy * 42;
    const len = (d - 84) * p;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + ux * len, y1 + uy * len);
    ctx.setLineDash([1, 5]);
    ctx.strokeStyle = alpha(PALETTE.lamp, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "italic 20px Georgia, 'Times New Roman', serif";
  ctx.fillStyle = alpha(PALETTE.line, 0.85);
  ctx.fillText(title, at.x, at.y + 92);
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = alpha(PALETTE.line, 0.55);
  const dots = still ? "…" : ".".repeat(1 + (Math.floor(now / 400) % 3));
  ctx.fillText(`${step}${dots}`, at.x, at.y + 116);
  ctx.restore();
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
  const lm = node.marks;
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
  const lm = node.marks;
  if (!lm || !lm.total) return;
  arcRanges(lm.total).forEach((arc, k) => {
    const p = polar(arc.mid, LAMP_R);
    const item = lm.items[k];
    if (item && item.lit) {
      const t = progress(node.litAt.get(item.slug), LAMP_MS, now);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = alpha(PALETTE[node.lamp], 0.22 * t);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE[node.lamp];
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

/** The font every island name is measured and drawn in: 20 box units tall. */
export const NAME_FONT = "20px Georgia, 'Times New Roman', serif";

/**
 * The name where `labels.js` put it: wrapped, below or above the coast, faded when it had no clear spot. Without a
 * label (a caller that laid nothing out), one line below. Returns the y under the last line, for the draft line.
 */
function drawName(ctx, node, lifted = false, label = null) {
  const lines = label?.lines ?? [node.name];
  const top = label?.top ?? NAME_Y;
  const cx = label?.cx ?? CENTRE;
  if (label?.hidden) return null;
  ctx.font = NAME_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // A halo of sea around each name, so a sea's lettering passing behind never muddies it.
  ctx.lineJoin = "round";
  ctx.strokeStyle = PALETTE.sea;
  ctx.lineWidth = 6;
  ctx.fillStyle = alpha(PALETTE.line, lifted || node.state !== "open" ? 0.9 : 0.75);
  lines.forEach((line, i) => {
    ctx.strokeText(line, cx, top + i * LINE_H);
    ctx.fillText(line, cx, top + i * LINE_H);
  });
  return { cx, y: top + lines.length * LINE_H };
}

/** A draft from the cartographer's pending sketch: a dashed coast in the lamp's colour, its name, and "draft". No elevation, no lamps. */
function drawDraft(ctx, node, dim, label) {
  const s = boxScale(node.radius);
  ctx.save();
  ctx.translate(node.x - CENTRE * s, node.y - CENTRE * s);
  ctx.scale(s, s);
  ctx.globalAlpha = dim ? 0.28 : 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const coast = ringPoints(node.seed, COAST);
  traceRing(ctx, coast);
  ctx.fillStyle = alpha(PALETTE.lamp, 0.06);
  ctx.fill();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = alpha(PALETTE.lamp, 0.8);
  ctx.stroke();
  ctx.setLineDash([]);
  if (node.island.harbour) drawAnchor(ctx);
  const under = drawName(ctx, node, false, label);
  if (under) {
    ctx.font = "italic 13px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = alpha(PALETTE.lamp, 0.85);
    ctx.fillText(tr("draw.draft"), under.cx, under.y + 3);
  }
  ctx.restore();
}

export function drawIsland(ctx, node, { dim = false, selected = false, gathered = false, hovered = false, now = 0, label = null } = {}) {
  if (node.draft) return drawDraft(ctx, node, dim, label);
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
  if (node.rollup) drawRollup(ctx, node);
  else drawElevation(ctx, node, now);
  if (node.state === "reef") drawHatch(ctx, coast);
  drawCoast(ctx, node, coast, now);
  drawLamps(ctx, node, now);
  if (isl.harbour) drawAnchor(ctx);
  if (gathered) {
    // Gathered into a group: a dashed lamp ring just outside the halo, so it reads beside a selection too.
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, HALO_R + 6, 0, Math.PI * 2);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = alpha(PALETTE.lamp, 0.75);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (selected) {
    // The selection: a firm halo. Hover on the selected island adds nothing.
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, HALO_R, 0, Math.PI * 2);
    ctx.strokeStyle = alpha(PALETTE.line, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (hovered) {
    // Hover: a light dotted halo, so the pointer's island reads without competing with the selection.
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, HALO_R, 0, Math.PI * 2);
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = alpha(PALETTE.line, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawName(ctx, node, hovered || selected, label);
  ctx.restore();
}

/** A strait is drawn only once both islands have verdicts: dotted until the strait itself is charted. */
export function drawStrait(ctx, link, { dim = false } = {}) {
  const a = link.source;
  const b = link.target;
  if (link.hidden || !a.island.verdict || !b.island.verdict) return;
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
