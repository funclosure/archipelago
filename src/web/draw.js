// Contour: how the map is drawn, as an engraved sea chart. Reads derived fields only (state, marks, lamp, rollup,
// harbour, children, strait verdicts) and keeps no state of its own: the lens is already applied by the view model,
// the write animations run off its timestamps, and what is built once (an island's engraving, a lamp's glow) is
// kept in draw-cache.js. Inside an island every length is in box units (contour.js); `hair` is one screen pixel in
// those units, so a fine line never falls below a pixel however far the map is zoomed out.
import {
  CENTRE, COAST, SHELF, SOUNDING_R, RING_STEP, SNOW_R, HALO_R, ANCHOR_R, NAME_Y, LEVEL, STAR, SOCKET_R, EXPLORED, ROLLUP_MARK, WATER,
  boxScale, ringPoints, arcRanges, arcIndices, polar, lampPoint, anchorAngle, rollupMarks, hatchLines, polylineLength, shoreMarks, hillMarks, straitCurve,
} from "./contour.js";
import { cachedPath, cachedSprite, clearSprites } from "./draw-cache.js";
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
/** The sheet the palette belongs to: paper (a light theme) takes the engraving at full strength and the chart's furniture. */
export const SHEET = { paper: false };

/** A lamp coming on: it flares past its size, then settles. The coast's arc firms up first. */
const LAMP_MS = 900;
const ARC_MS = 300;
const RING_MS = 400;
/** An island the selection sets aside. */
const DIM = 0.28;
/** How far apart the shore's and a summit's hachures lie, in box units (see `fineness`). */
const HACHURE_GAP = 5.5;
const HILL_GAP = 3.6;
const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 0..1 through an animation that started at `since`; 1 when there is nothing to animate. */
function progress(since, ms, now) {
  if (!since || reduced) return 1;
  return Math.min(1, (now - since) / ms);
}

/** True while one of the island's write animations (a lamp coming on, a ring being drawn) is still running. */
export function isAnimating(node, now) {
  if (reduced) return false;
  if (node.stateAt && now - node.stateAt < RING_MS) return true;
  for (const at of node.litAt.values()) if (at && now - at < LAMP_MS) return true;
  return false;
}

/** The theme pushes its eight canvas tokens here, and whether it is paper; every draw call reads them at draw time. */
export function setPalette(p, { paper = false } = {}) {
  Object.assign(PALETTE, p);
  SHEET.paper = paper;
  clearSprites();
}

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A colour deepened: each channel multiplied by `k`, as ink soaked into the same sheet. */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v * k).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** A strength for paper or for a dark sea: engraving that is ink on paper is only a hint on dark water. */
const ink = (paper, dark) => (SHEET.paper ? paper : dark);

// ---- the sea: stippled water, lettering, and on paper the chart's furniture ----

/** The strengths a sea's dots are sorted into, so a whole sea is four fills, not one per dot. */
const STIPPLE = [0.125, 0.375, 0.625, 0.875];

/** A sea's stippled water (`stippleDots` in sea-model.js) as one path per strength. Built when the sea or an island moves. */
export function stipplePaths(dots, radius) {
  const r = radius * 0.024;
  const paths = STIPPLE.map(() => new Path2D());
  for (const [x, y, a] of dots) {
    const p = paths[Math.min(STIPPLE.length - 1, Math.floor(a * STIPPLE.length))];
    p.moveTo(x + r, y);
    p.arc(x, y, r, 0, Math.PI * 2);
  }
  return paths;
}

/** A sea's water, in the coast colour: fine dots, stronger where its islands are close. */
export function drawSeaWater(ctx, paths, dim = false) {
  paths.forEach((p, i) => {
    ctx.fillStyle = alpha(PALETTE.line, (0.07 + STIPPLE[i] * 0.2) * (dim ? 0.4 : 1));
    ctx.fill(p);
  });
}

/**
 * A sea's name: upright capitals, tracked as `set` says (sea-model.js `lettering`), faint until hovered or selected.
 * `fade` (0..1) takes it away as it slides under the header.
 */
export function drawSeaName(ctx, sea, set, { selected = false, hover = false, dim = false, draft = false, fade = 1 } = {}) {
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.font = `${set.font}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  // On paper the name is ink: at the dark themes' strength it would read as disabled text.
  const strength = selected || hover ? ink(0.8, 0.72) : ink(0.55, 0.4);
  ctx.fillStyle = draft ? alpha(PALETTE.lamp, 0.6) : alpha(PALETTE.line, strength * (dim ? 0.5 : 1));
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

/**
 * Paper only: the graticule, in world units. `grid` is `graticule(view, scale)` from furniture-model.js, `view` the
 * world rect in sight, `scale` px per unit. Its lines are one screen pixel and faint: the sheet's ruling, not a grid.
 */
export function drawGraticule(ctx, grid, view, scale) {
  if (!SHEET.paper) return;
  const rule = (lines, strength) => {
    if (strength <= 0) return;
    ctx.beginPath();
    for (const x of lines.xs) {
      ctx.moveTo(x, view.y0);
      ctx.lineTo(x, view.y1);
    }
    for (const y of lines.ys) {
      ctx.moveTo(view.x0, y);
      ctx.lineTo(view.x1, y);
    }
    ctx.strokeStyle = alpha(PALETTE.line, 0.1 * strength);
    ctx.stroke();
  };
  ctx.lineWidth = 1 / scale;
  rule(grid.firm, 1);
  rule(grid.faint, grid.fade);
}

/** The rose is drawn in a space where its radius is 100. */
const ROSE = 100;
/** How far its rhumb lines run before they have faded away, in rose radii. */
const RHUMB = 30;
/** The rose's points, shortest first so the cardinal ones lie on top: how many, how long, and the first one's turn from north. */
const ROSE_POINTS = [[8, 62, Math.PI / 8], [4, 86, Math.PI / 4], [4, 122, 0]];

/** One half of every point in a layer: the left halves are inked, the right left as paper, as on an engraved rose. */
function rosePoints(layer, side) {
  const [n, len, off] = ROSE_POINTS[layer];
  return cachedPath(`rose|${layer}|${side}`, (p) => {
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2 - Math.PI / 2;
      const b = a + (side * Math.PI) / 2;
      p.moveTo(0, 0);
      p.lineTo(Math.cos(b) * 10, Math.sin(b) * 10);
      p.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      p.closePath();
    }
  });
}

/**
 * Paper only: the compass rose at `rose` ({ x, y, r } in world units), under the seas and the islands, with rhumb
 * lines that fade out across the sheet. `scale` is px per world unit.
 */
export function drawRose(ctx, rose, scale) {
  if (!SHEET.paper || !rose) return;
  const k = rose.r / ROSE;
  const px = 1 / (scale * k); // one screen pixel in the rose's units
  ctx.save();
  ctx.translate(rose.x, rose.y);
  ctx.scale(k, k);
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  const reach = ROSE * RHUMB;
  ctx.lineWidth = Math.max(px, 1);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const x = Math.cos(a);
    const y = Math.sin(a);
    const g = ctx.createLinearGradient(x * ROSE, y * ROSE, x * reach, y * reach);
    g.addColorStop(0, alpha(PALETTE.line, i % 4 ? 0.08 : 0.14));
    g.addColorStop(1, alpha(PALETTE.line, 0));
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(x * ROSE, y * ROSE);
    ctx.lineTo(x * reach, y * reach);
    ctx.stroke();
  }
  ctx.strokeStyle = alpha(PALETTE.line, 0.5);
  ctx.lineWidth = Math.max(px * 0.9, 1.4);
  ctx.stroke(cachedPath("rose|rings", (p) => {
    for (const r of [ROSE, ROSE * 0.93, ROSE * 0.34]) {
      p.moveTo(r, 0);
      p.arc(0, 0, r, 0, Math.PI * 2);
    }
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      p.moveTo(Math.cos(a) * ROSE * 0.93, Math.sin(a) * ROSE * 0.93);
      p.lineTo(Math.cos(a) * ROSE, Math.sin(a) * ROSE);
    }
  }));
  ROSE_POINTS.forEach((_, layer) => {
    const inked = rosePoints(layer, -1);
    const bare = rosePoints(layer, 1);
    ctx.fillStyle = PALETTE.sea;
    ctx.fill(bare);
    ctx.fillStyle = alpha(PALETTE.line, 0.6);
    ctx.fill(inked);
    ctx.stroke(bare);
  });
  ctx.fillStyle = alpha(PALETTE.line, 0.6);
  ctx.font = "30px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("N", 0, -ROSE * 1.3);
  ctx.restore();
}

/**
 * Paper only, in screen px, over everything: the sheet deepens toward the edges of the map area (between the
 * outline and the pane), most at its lower corners and not at all behind the header: the shade comes in slowly
 * down the sheet, so the header's words sit on plain paper with no edge under them. One sprite per size, a quarter
 * of it, since it is all gradient.
 */
export function drawVignette(ctx, w, h, { left = 0, right = 0, top = 0 } = {}) {
  if (!SHEET.paper || !w || !h) return;
  const Q = 4;
  const sprite = cachedSprite(`vignette|${w}|${h}|${left}|${right}|${top}|${PALETTE.sea}`, w / Q, h / Q, (g) => {
    g.scale(1 / Q, 1 / Q);
    const cx = left + (w - left - right) / 2;
    const cy = h / 2;
    const r = Math.hypot(w - left - right, h) / 2;
    const edge = shade(PALETTE.sea, 0.55);
    const grad = g.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.15);
    grad.addColorStop(0, alpha(edge, 0));
    grad.addColorStop(1, alpha(edge, 0.3));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const foot = top + (h - top) * 0.5;
    const clear = g.createLinearGradient(0, 0, 0, foot);
    clear.addColorStop(0, alpha(PALETTE.sea, 1));
    clear.addColorStop(top / foot, alpha(PALETTE.sea, 1));
    clear.addColorStop(1, alpha(PALETTE.sea, 0));
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = clear;
    g.fillRect(0, 0, w, foot);
  }, "vignette");
  ctx.drawImage(sprite, 0, 0, w, h);
}

// ---- gestures and the cartographer at work ----

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

// ---- an island ----

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

/** The island's own shape at `radius`, closed, as a path kept per seed. */
function ringPath(seed, radius) {
  return cachedPath(`ring|${seed}|${radius}`, (p) => {
    const pts = ringPoints(seed, radius);
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.closePath();
  });
}

/** Strokes `[x1, y1, x2, y2]` as one path, kept under `key`. */
function strokesPath(key, strokes) {
  return cachedPath(key, (p) => {
    for (const [x1, y1, x2, y2] of strokes()) {
      p.moveTo(x1, y1);
      p.lineTo(x2, y2);
    }
  });
}

/** World → box: the island's centre is the box centre and one box unit is `s` world units, so every mark scales with the map. */
function enterBox(ctx, node) {
  const s = boxScale(node.radius);
  ctx.save();
  ctx.translate(node.x - CENTRE * s, node.y - CENTRE * s);
  ctx.scale(s, s);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/** A charted island that is not a reef: the ones that take the engraving (water-lining, shelf, hachures). */
const engraved = (node) => !node.draft && node.state !== "open" && node.state !== "reef";

/**
 * How much of a fine engraving shows when its strokes lie `gap` box units apart: all of it from three screen
 * pixels, none under one and a half, where the strokes would run together into a grey patch (a phone at home).
 */
const fineness = (gap, hair) => Math.max(0, Math.min(1, (gap / hair - 1.5) / 1.5));

/**
 * The level water-lining round a charted island, as on an engraved chart: rows of fine strokes, closest at the
 * shore. Drawn for every island before any island, so no lining crosses a coast (land is drawn opaque over it).
 * On a dark sea it is only a hint.
 */
export function drawShoreWater(ctx, node, { dim = false, hair = 1 } = {}) {
  const show = fineness(WATER.pitch, hair);
  if (!engraved(node) || show <= 0) return;
  enterBox(ctx, node);
  ctx.globalAlpha = (dim ? DIM : 1) * show;
  ctx.lineCap = "butt";
  ctx.strokeStyle = alpha(PALETTE.line, ink(0.3, 0.12));
  ctx.lineWidth = Math.max(0.7, hair * 0.8);
  ctx.stroke(cachedPath(`water|${node.seed}`, (p) => {
    for (const [x0, x1, y] of shoreMarks(node.seed).water) {
      p.moveTo(x0, y);
      p.lineTo(x1, y);
    }
  }));
  ctx.restore();
}

/**
 * Land: opaque, so nothing that passes behind an island (a sea's lettering, a neighbour's water-lining, the
 * graticule) shows through it, then the state's tint. A charted island first gets its shelf, a margin of bare
 * sheet round the coast inside a fine line.
 */
function drawLand(ctx, node, a, hair) {
  const coast = ringPath(node.seed, COAST);
  if (engraved(node)) {
    const shelf = ringPath(node.seed, COAST * SHELF);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.sea;
    ctx.fill(shelf);
    ctx.globalAlpha = a;
    ctx.strokeStyle = alpha(PALETTE.line, ink(0.42, 0.2));
    ctx.lineWidth = Math.max(0.8, hair);
    ctx.stroke(shelf);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.sea;
  ctx.fill(coast);
  ctx.globalAlpha = a;
  const s = node.state;
  ctx.fillStyle = s === "open" ? alpha(PALETTE.line, 0.04) : s === "sandbar" || s === "reef" ? alpha(PALETTE.sand, ink(0.3, 0.18)) : alpha(PALETTE.grass, ink(0.26, 0.22));
  ctx.fill(coast);
  const show = fineness(HACHURE_GAP, hair);
  if (engraved(node) && show > 0) {
    // shore hachures: short strokes just inside the coast, leaning one way
    ctx.strokeStyle = alpha(PALETTE.line, ink(0.5, 0.22) * show);
    ctx.lineWidth = Math.max(0.8, hair * 0.9);
    ctx.stroke(strokesPath(`hachures|${node.seed}`, () => shoreMarks(node.seed).hachures));
  }
}

/** Elevation rings inside the coast, one per level; on a state change they draw clockwise. A mountain's summit is hachured round its snow. */
function drawElevation(ctx, node, now, hair) {
  const level = LEVEL[node.state] || 0;
  if (!level) return;
  const t = progress(node.stateAt, RING_MS, now);
  ctx.strokeStyle = alpha(PALETTE.line, 0.7);
  ctx.lineWidth = Math.max(1.2, hair);
  for (let k = 1; k <= level; k++) {
    if (t >= 1) ctx.stroke(ringPath(node.seed, COAST - RING_STEP * k));
    else {
      const pts = ringPoints(node.seed, COAST - RING_STEP * k);
      traceRing(ctx, pts, pts.length * t);
      ctx.stroke();
    }
  }
  if (node.state === "mountainous" && t >= 1) {
    ctx.strokeStyle = alpha(PALETTE.line, ink(0.6, 0.5) * fineness(HILL_GAP, hair));
    ctx.lineWidth = Math.max(0.9, hair * 0.9);
    ctx.stroke(strokesPath(`hills|${node.seed}`, () => hillMarks(node.seed)));
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, SNOW_R, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.snow;
    ctx.fill();
    ctx.strokeStyle = alpha(PALETTE.line, 0.7);
    ctx.lineWidth = Math.max(1, hair);
    ctx.stroke();
  }
}

/** A reef: a light 45° hatch clipped to the coast, a dotted danger line round it, and the hazard's mark at its centre. */
function drawReef(ctx, node, hair) {
  ctx.save();
  ctx.clip(ringPath(node.seed, COAST));
  ctx.strokeStyle = alpha(PALETTE.reef, 0.8);
  ctx.lineWidth = Math.max(1.1, hair);
  ctx.lineCap = "butt";
  ctx.stroke(strokesPath("hatch", () => hatchLines().map((l) => [l.x1, l.y1, l.x2, l.y2])));
  ctx.restore();
  const w = Math.max(1.2, hair * 1.2);
  ctx.setLineDash([0.1, w * 3.2]);
  ctx.strokeStyle = PALETTE.reef;
  ctx.lineWidth = w;
  ctx.stroke(ringPath(node.seed, COAST * SHELF));
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(CENTRE, CENTRE - 12);
  ctx.lineTo(CENTRE + 12.5, CENTRE + 9.5);
  ctx.lineTo(CENTRE - 12.5, CENTRE + 9.5);
  ctx.closePath();
  ctx.fillStyle = PALETTE.reef;
  ctx.fill();
  ctx.strokeStyle = PALETTE.sea;
  ctx.lineWidth = Math.max(1.4, hair * 0.5); // its edge of bare sheet: never so wide, zoomed out, that it eats the mark
  ctx.stroke();
}

/**
 * A parent with islets and no verdict of its own: one small mark per islet inside its coast, in the islet's own
 * state (open water a dotted ring, a charted islet a tinted one, a reef the hazard's mark). A handful of islets,
 * not a share of a ring.
 */
function drawRollup(ctx, node, hair) {
  const r = ROLLUP_MARK;
  for (const m of rollupMarks(node.island.children.byState)) {
    if (m.state === "reef") {
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - r);
      ctx.lineTo(m.x + r, m.y + r * 0.8);
      ctx.lineTo(m.x - r, m.y + r * 0.8);
      ctx.closePath();
      ctx.fillStyle = PALETTE.reef;
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    // The marks are small: their lines keep to a share of a screen pixel when zoomed out, so a mark stays a mark.
    if (m.state === "open") {
      const w = Math.max(1, hair * 0.7);
      ctx.setLineDash([w * 1.4, w * 2.6]);
      ctx.strokeStyle = alpha(PALETTE.line, 0.55);
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    ctx.fillStyle = alpha(m.state === "sandbar" ? PALETTE.sand : PALETTE.grass, ink(0.75, 0.6));
    ctx.fill();
    ctx.strokeStyle = alpha(PALETTE.line, 0.75);
    ctx.lineWidth = Math.max(1.1, hair * 0.6);
    ctx.stroke();
    if (m.state === "mountainous") {
      ctx.beginPath();
      ctx.arc(m.x, m.y, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.snow;
      ctx.fill();
    }
  }
}

/**
 * The coastline: one arc per landmark, dotted while dark (with a sounding), firm once lit. In the mentor's lens
 * an explored landmark is not lit: its arc is a fine line in the mentor's colour over the uncharted coast.
 */
function drawCoast(ctx, node, coast, now, hair) {
  const lm = node.marks;
  const total = lm ? lm.total : 0;
  const explored = node.lamp === "explore";
  const fine = Math.max(1.1, hair * 1.1);
  const dotted = () => {
    ctx.setLineDash([fine * 1.6, fine * 3.4]);
    ctx.lineWidth = fine;
    ctx.strokeStyle = alpha(PALETTE.line, 0.6);
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
  // A "?" sounding marks a dark landmark on open water only (on charted land it would sit among the hachures), and
  // only when it is at least nine screen pixels: smaller it is a speck, and the dotted arc already says dark.
  const soundings = node.state === "open" && 11 / hair >= 9;
  arcIndices(total, coast.length).forEach(({ i0, i1 }, k) => {
    const item = lm.items[k];
    const lit = Boolean(item && item.lit);
    const t = lit ? progress(node.litAt.get(item.slug), ARC_MS, now) : 0;
    if (!lit || t < 1 || explored) {
      traceArc(ctx, coast, i0, i1);
      dotted();
    }
    if (lit) {
      // the dash grows from a dot to the whole arc, then the arc is solid
      const len = polylineLength(coast, i0, i1);
      traceArc(ctx, coast, i0, i1);
      ctx.setLineDash(t < 1 ? [1 + t * len, Math.max(0.01, 5 * (1 - t))] : []);
      ctx.lineWidth = explored ? Math.max(1.5, hair * 1.3) : Math.max(2.4, hair * 1.6);
      ctx.strokeStyle = explored ? alpha(PALETTE.explore, 0.9) : PALETTE.line;
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (soundings) {
      const p = polar(arcs[k].mid, SOUNDING_R);
      ctx.font = "italic 11px Georgia, 'Times New Roman', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = alpha(PALETTE.line, 0.55);
      ctx.fillText("?", p.x, p.y);
    }
  });
}

/** A soft round glow in a colour, as a sprite: the one part of a lamp that is not a line. */
function glowSprite(colour, strength) {
  const S = 96;
  return cachedSprite(`glow|${colour}|${strength}`, S, S, (g) => {
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, alpha(colour, strength));
    grad.addColorStop(0.38, alpha(colour, strength * 0.42));
    grad.addColorStop(1, alpha(colour, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  });
}

/** The lit lamp's eight rays about the origin: long on the compass points, short between. */
const starRays = () =>
  cachedPath("star", (p) => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const tip = i % 2 ? STAR.short : STAR.long;
      p.moveTo(Math.cos(a) * STAR.from, Math.sin(a) * STAR.from);
      p.lineTo(Math.cos(a) * tip, Math.sin(a) * tip);
    }
  });

/**
 * A lit lamp at the origin: a starburst in the lamp colour inside a soft glow. Every lit lamp is the same size:
 * a lamp is lit or it is dark. `t` runs 0..1 as it comes on: the rays shoot out past their length and the glow
 * swells (`flare`), then both settle.
 */
function drawStar(ctx, t) {
  const grow = t >= 1 ? 1 : 1 - (1 - Math.min(1, t / 0.3)) ** 3;
  const flare = t >= 1 ? 0 : t < 0.25 ? t / 0.25 : ((1 - t) / 0.75) ** 2;
  const was = ctx.globalAlpha;
  const size = (0.3 + 0.7 * grow) * (1 + 0.4 * flare);
  ctx.scale(size, size);
  const glow = glowSprite(PALETTE.lamp, ink(0.5, 0.6));
  const g = STAR.glow * (1 + 0.7 * flare);
  ctx.globalAlpha = was * grow;
  ctx.drawImage(glow, -g, -g, g * 2, g * 2);
  if (flare > 0) {
    ctx.globalAlpha = was * flare * 0.9;
    ctx.drawImage(glow, -g, -g, g * 2, g * 2);
    ctx.globalAlpha = was * grow;
  }
  ctx.strokeStyle = PALETTE.lamp;
  ctx.lineWidth = STAR.ray;
  ctx.stroke(starRays());
  ctx.beginPath();
  ctx.arc(0, 0, STAR.core, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.lamp;
  ctx.fill();
  ctx.globalAlpha = was;
}

/** An explored landmark in the mentor's lens: a small ring round a dot in the mentor's colour. No rays: it is not lit. */
function drawExplored(ctx, t) {
  const grow = t >= 1 ? 1 : 1 - (1 - t) ** 3;
  const was = ctx.globalAlpha;
  ctx.globalAlpha = was * grow;
  const g = EXPLORED.glow;
  ctx.drawImage(glowSprite(PALETTE.explore, ink(0.22, 0.26)), -g, -g, g * 2, g * 2);
  ctx.beginPath();
  ctx.arc(0, 0, EXPLORED.ring * (0.6 + 0.4 * grow), 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.sea;
  ctx.fill();
  ctx.strokeStyle = PALETTE.explore;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, EXPLORED.core, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.explore;
  ctx.fill();
  ctx.globalAlpha = was;
}

/** A lit lamp's rays reach at least this far on screen, and a dark socket is at least this wide, however far the map is zoomed out. */
const STAR_MIN_PX = 6.5;
const SOCKET_MIN_PX = 1.5;
const MARK_MAX = 1.8;

/**
 * One lamp per landmark just outside the coast, following its shape: a hollow socket while dark; lit, a starburst
 * with a glow (the Keeper's lens) or, explored with the mentor, a quiet ring.
 */
function drawLamps(ctx, node, now, hair) {
  const lm = node.marks;
  if (!lm || !lm.total) return;
  const explored = node.lamp === "explore";
  const k = Math.min(MARK_MAX, Math.max(1, (STAR_MIN_PX * hair) / STAR.long));
  const ks = Math.min(MARK_MAX, Math.max(1, (SOCKET_MIN_PX * hair) / SOCKET_R));
  arcRanges(lm.total).forEach((arc, i) => {
    const p = lampPoint(node.seed, arc.mid);
    const item = lm.items[i];
    if (item && item.lit) {
      const t = progress(node.litAt.get(item.slug), explored ? ARC_MS : LAMP_MS, now);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(k, k);
      if (explored) drawExplored(ctx, t);
      else drawStar(ctx, t);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, SOCKET_R * ks, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.sea;
      ctx.fill();
      ctx.strokeStyle = alpha(PALETTE.line, 0.6);
      ctx.lineWidth = Math.max(1, hair);
      ctx.stroke();
    }
  });
}

/**
 * The harbour's anchor, drawn (not a glyph, which every platform draws its own way), in the water between two
 * lamps, on a patch of bare sheet so the water-lining does not run through it.
 */
function drawAnchor(ctx, total, hair) {
  const at = polar(anchorAngle(total), ANCHOR_R);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.beginPath();
  ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.sea;
  ctx.fill();
  ctx.strokeStyle = alpha(PALETTE.line, 0.85);
  ctx.lineWidth = Math.max(1.3, hair);
  ctx.stroke(cachedPath("anchor", (p) => {
    p.moveTo(1.9, -6.6);
    p.arc(0, -6.6, 1.9, 0, Math.PI * 2); // the ring
    p.moveTo(0, -4.7);
    p.lineTo(0, 6.8); // the shank
    p.moveTo(-3.6, -2.2);
    p.lineTo(3.6, -2.2); // the stock
    p.moveTo(-6.2, 1.4);
    p.quadraticCurveTo(-5.6, 6.6, 0, 6.8); // the arms
    p.quadraticCurveTo(5.6, 6.6, 6.2, 1.4);
    p.moveTo(-7.6, 3.4);
    p.lineTo(-6.2, 1.4);
    p.lineTo(-4.2, 2.9); // the flukes
    p.moveTo(7.6, 3.4);
    p.lineTo(6.2, 1.4);
    p.lineTo(4.2, 2.9);
  }));
  ctx.restore();
}

/** The font every island name is measured and drawn in: 20 box units tall. */
export const NAME_FONT = "20px Georgia, 'Times New Roman', serif";

/**
 * An island's name where `labels.js` put it: wrapped, below or above the coast or beside it, not drawn when it had
 * no clear spot. Its halo of sea is always solid, also under a dimmed name, so whatever passes behind (a sea's
 * lettering, its dots) never strikes the name through. A draft's name carries "draft" under it. Drawn for every
 * island after all the islands, so no lamp's glow lies over a name.
 */
export function drawIslandName(ctx, node, { lifted = false, dim = false, label = null } = {}) {
  if (label?.hidden) return;
  const lines = label?.lines ?? [node.name];
  const top = label?.top ?? NAME_Y;
  const cx = label?.cx ?? CENTRE;
  enterBox(ctx, node);
  ctx.font = NAME_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.strokeStyle = PALETTE.sea;
  ctx.lineWidth = 6;
  ctx.fillStyle = alpha(PALETTE.line, lifted || node.state !== "open" ? 0.9 : 0.75);
  lines.forEach((line, i) => {
    ctx.globalAlpha = 1;
    ctx.strokeText(line, cx, top + i * LINE_H);
    ctx.globalAlpha = dim ? DIM : 1;
    ctx.fillText(line, cx, top + i * LINE_H);
  });
  if (node.draft) {
    ctx.font = "italic 13px Georgia, 'Times New Roman', serif";
    ctx.fillStyle = alpha(PALETTE.lamp, 0.85);
    ctx.fillText(tr("draw.draft"), cx, top + lines.length * LINE_H + 3);
  }
  ctx.restore();
}

/** A draft from the cartographer's pending sketch: a dashed coast in the lamp's colour. No elevation, no lamps. */
function drawDraft(ctx, node, dim, hair) {
  enterBox(ctx, node);
  const coast = ringPath(node.seed, COAST);
  ctx.fillStyle = PALETTE.sea;
  ctx.fill(coast);
  ctx.globalAlpha = dim ? DIM : 1;
  ctx.fillStyle = alpha(PALETTE.lamp, 0.06);
  ctx.fill(coast);
  const w = Math.max(1.4, hair * 1.2);
  ctx.setLineDash([w * 4.3, w * 3.6]);
  ctx.lineWidth = w;
  ctx.strokeStyle = alpha(PALETTE.lamp, 0.8);
  ctx.stroke(coast);
  ctx.setLineDash([]);
  if (node.island.harbour) drawAnchor(ctx, 0, hair);
  ctx.restore();
}

/**
 * One island, without its name (`drawIslandName`). `hair` is one screen pixel in box units:
 * 1 / (the camera's scale × boxScale(node.radius)).
 */
export function drawIsland(ctx, node, { dim = false, selected = false, gathered = false, hovered = false, now = 0, hair = 1 } = {}) {
  if (node.draft) return drawDraft(ctx, node, dim, hair);
  const a = dim ? DIM : 1;
  enterBox(ctx, node);
  drawLand(ctx, node, a, hair);
  if (node.rollup) drawRollup(ctx, node, hair);
  else if (node.state !== "reef") drawElevation(ctx, node, now, hair);
  if (node.state === "reef") drawReef(ctx, node, hair);
  drawCoast(ctx, node, ringPoints(node.seed, COAST), now, hair);
  drawLamps(ctx, node, now, hair);
  if (node.island.harbour) drawAnchor(ctx, node.marks?.total ?? 0, hair);
  if (gathered) {
    // Gathered into a group: a dashed lamp ring just outside the halo, so it reads beside a selection too.
    const w = Math.max(1.5, hair * 1.5);
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, HALO_R + 5, 0, Math.PI * 2);
    ctx.setLineDash([w * 3.3, w * 3.3]);
    ctx.strokeStyle = alpha(PALETTE.lamp, 0.75);
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (selected) {
    // The selection: a firm halo, outside the lamps. Hover on the selected island adds nothing.
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, HALO_R, 0, Math.PI * 2);
    ctx.strokeStyle = alpha(PALETTE.line, 0.7);
    ctx.lineWidth = Math.max(1.5, hair * 1.5);
    ctx.stroke();
  } else if (hovered) {
    // Hover: a light dotted halo, so the pointer's island reads without competing with the selection.
    const w = Math.max(1, hair);
    ctx.beginPath();
    ctx.arc(CENTRE, CENTRE, HALO_R, 0, Math.PI * 2);
    ctx.setLineDash([w * 2, w * 4]);
    ctx.strokeStyle = alpha(PALETTE.line, 0.42);
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/**
 * A strait is drawn only once both islands have verdicts: dotted until the strait itself is charted. A shallow
 * curve from clear of one island's lamps to clear of the other's, as a channel is drawn on a chart, not a ruled
 * edge between two nodes. `scale` is px per world unit.
 */
export function drawStrait(ctx, link, { dim = false, scale = 1 } = {}) {
  const a = link.source;
  const b = link.target;
  if (link.hidden || !a.island.verdict || !b.island.verdict) return;
  const c = straitCurve(a, b, (a.seed ^ b.seed) & 1 ? 1 : -1);
  if (!c) return;
  const s = (boxScale(a.radius) + boxScale(b.radius)) / 2; // box units → world for widths and dashes
  const px = 1 / scale; // one screen pixel in world units

  ctx.save();
  ctx.globalAlpha = dim ? 0.2 : 1;
  ctx.lineCap = "round";
  const line = (o) => {
    ctx.beginPath();
    ctx.moveTo(c.x1 + c.nx * o, c.y1 + c.ny * o);
    ctx.quadraticCurveTo(c.cx + c.nx * o, c.cy + c.ny * o, c.x2 + c.nx * o, c.y2 + c.ny * o);
    ctx.stroke();
  };
  if (link.state === "open") {
    const w = Math.max(1.1 * s, px);
    ctx.setLineDash([w * 1.6, w * 4.4]);
    ctx.strokeStyle = alpha(PALETTE.line, 0.55);
    ctx.lineWidth = w;
    line(0);
  } else if (link.state === "reef") {
    const w = Math.max(1.6 * s, px * 1.3);
    ctx.setLineDash([w * 3.4, w * 2.6]);
    ctx.strokeStyle = PALETTE.reef;
    ctx.lineWidth = w;
    line(0);
  } else {
    const w = Math.max(1.5 * s, px * 1.2);
    ctx.strokeStyle = alpha(PALETTE.line, 0.8);
    ctx.lineWidth = w;
    if (link.state === "mountainous") {
      line(-w * 1.3);
      line(w * 1.3);
    } else line(0);
  }
  ctx.setLineDash([]);
  ctx.restore();
}
