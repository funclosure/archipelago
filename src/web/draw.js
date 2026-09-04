import { seededRandom, litSegments } from "./view-model.js";

export const PALETTE = {
  water: "#1a1816",
  text: "#ede8e3",
  muted: "#8f877f",
  sand: "#d9c7a3",
  land: "#c9a87c",
  ridge: "#8a6e4b",
  reef: "#a3452e",
  spotlight: "#f2d9a8",
  channel: "#4a4038",
};

const RISE_MS = 600;

export function clear(ctx, w, h) {
  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(0, 0, w, h);
}

/** A blobby coastline: 14 points at seeded radii, always the same shape for the same island. */
function outline(node, scale) {
  const rnd = seededRandom(node.seed);
  const pts = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const r = node.radius * scale * (0.78 + 0.32 * rnd());
    pts.push({ x: node.x + Math.cos(angle) * r, y: node.y + Math.sin(angle) * r });
  }
  return pts;
}

function tracePath(ctx, pts) {
  const n = pts.length;
  const mid = (i) => ({ x: (pts[i % n].x + pts[(i + 1) % n].x) / 2, y: (pts[i % n].y + pts[(i + 1) % n].y) / 2 });
  ctx.beginPath();
  const m0 = mid(0);
  ctx.moveTo(m0.x, m0.y);
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    const m = mid(i);
    ctx.quadraticCurveTo(p.x, p.y, m.x, m.y);
  }
  ctx.closePath();
}

/** Only the lit coastline segments: segment k runs from mid(k) to mid(k+1) through point k+1. */
function traceSegments(ctx, pts, lit) {
  const n = pts.length;
  const mid = (i) => ({ x: (pts[i % n].x + pts[(i + 1) % n].x) / 2, y: (pts[i % n].y + pts[(i + 1) % n].y) / 2 });
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    if (!lit[k]) continue;
    const a = mid(k);
    const p = pts[(k + 1) % n];
    const b = mid(k + 1);
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(p.x, p.y, b.x, b.y);
  }
}

export function drawIsland(ctx, node, { dim = false, spotlight = false, now = 0 } = {}) {
  const t = node.changedAt ? Math.min(1, (now - node.changedAt) / RISE_MS) : 1;
  const ease = 1 - Math.pow(1 - t, 3);
  const grow = 0.6 + 0.4 * ease;
  const state = node.state;
  const hasOwnVerdict = Boolean(node.island.verdict);

  ctx.save();
  ctx.globalAlpha = (dim ? 0.28 : 1) * (0.35 + 0.65 * ease);
  if (spotlight) {
    ctx.shadowColor = PALETTE.spotlight;
    ctx.shadowBlur = 24;
  }

  if (state === "open") {
    const pts = outline(node, grow);
    tracePath(ctx, pts);
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = PALETTE.muted;
    ctx.stroke();
    ctx.setLineDash([]);
    const lm = node.island.landmarks;
    if (lm && lm.total > 0 && lm.unlocked > 0) {
      // Each lit landmark turns one run of the dashed coastline solid: the island is being charted.
      // outline() starts at 3 o'clock, so the runs are rotated a quarter turn to begin at the top.
      const lit = litSegments(pts.length, lm.total, lm.unlocked);
      const n = pts.length;
      const shift = Math.round(n / 4);
      const rotated = new Array(n);
      for (let k = 0; k < n; k++) rotated[k] = lit[(k + shift) % n];
      traceSegments(ctx, pts, rotated);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = PALETTE.sand;
      ctx.stroke();
    }
  } else if (state === "sandbar") {
    tracePath(ctx, outline(node, grow * 0.8));
    ctx.fillStyle = PALETTE.sand;
    const keep = ctx.globalAlpha;
    ctx.globalAlpha = keep * 0.6;
    ctx.fill();
    ctx.globalAlpha = keep;
  } else {
    tracePath(ctx, outline(node, grow));
    ctx.fillStyle = PALETTE.land;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (state === "mountainous") {
      for (const s of [0.66, 0.4]) {
        tracePath(ctx, outline(node, grow * s));
        ctx.strokeStyle = PALETTE.ridge;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      tracePath(ctx, outline(node, grow * 0.22));
      ctx.fillStyle = PALETTE.ridge;
      ctx.fill();
    }
    if (state === "reef") drawReef(ctx, node, grow);
  }
  ctx.shadowBlur = 0;

  if (!hasOwnVerdict && node.island.children.total > 0) drawRollup(ctx, node, grow);
  drawLabel(ctx, node, grow, hasOwnVerdict);
  ctx.restore();
}

/** A jagged reef line across the land plus a hazard glyph: never mistakable for open water. */
function drawReef(ctx, node, grow) {
  const r = node.radius * grow;
  ctx.beginPath();
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const x = node.x - r * 1.1 + (2.2 * r * i) / steps;
    const y = node.y + (i % 2 ? -1 : 1) * r * 0.16 - r * 0.1;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = PALETTE.reef;
  ctx.lineWidth = 4.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  const gx = node.x + r * 0.85;
  const gy = node.y - r * 0.85;
  ctx.beginPath();
  ctx.moveTo(gx, gy - 12);
  ctx.lineTo(gx + 10, gy + 7);
  ctx.lineTo(gx - 10, gy + 7);
  ctx.closePath();
  ctx.fillStyle = PALETTE.reef;
  ctx.fill();
  ctx.fillStyle = PALETTE.water;
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", gx, gy + 2);
}

/** Ring of dots around a parent with no verdict of its own: one dot per islet, coloured by state. */
function drawRollup(ctx, node, grow) {
  const by = node.island.children.byState;
  const dots = [];
  for (const s of ["mountainous", "settled", "sandbar", "reef", "open"]) for (let i = 0; i < by[s]; i++) dots.push(s);
  const r = node.radius * grow + 13;
  const fill = { reef: PALETTE.reef, sandbar: PALETTE.sand, mountainous: PALETTE.ridge, settled: PALETTE.land };
  dots.forEach((s, i) => {
    const a = -Math.PI / 2 + (i / dots.length) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(node.x + Math.cos(a) * r, node.y + Math.sin(a) * r, 4.5, 0, Math.PI * 2);
    if (s === "open") {
      ctx.strokeStyle = PALETTE.muted;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = fill[s];
      ctx.fill();
    }
  });
}

function drawLabel(ctx, node, grow, hasOwnVerdict) {
  ctx.font = "24px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = node.state === "open" ? PALETTE.muted : PALETTE.text;
  const offset = !hasOwnVerdict && node.island.children.total > 0 ? 30 : 14;
  ctx.fillText(node.name, node.x, node.y + node.radius * grow + offset);
}

export function drawStrait(ctx, link, { dim = false } = {}) {
  const a = link.source;
  const b = link.target;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const x1 = a.x + ux * a.radius * 0.9;
  const y1 = a.y + uy * a.radius * 0.9;
  const x2 = b.x - ux * b.radius * 0.9;
  const y2 = b.y - uy * b.radius * 0.9;

  ctx.save();
  ctx.globalAlpha = dim ? 0.2 : 0.9;
  ctx.lineCap = "round";
  if (link.state === "reef") {
    const steps = Math.max(6, Math.floor(d / 14));
    const nx = -uy;
    const ny = ux;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const off = (i % 2 ? 1 : -1) * 6;
      const x = x1 + (x2 - x1) * t + nx * off;
      const y = y1 + (y2 - y1) * t + ny * off;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = PALETTE.reef;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    if (link.state === "open") {
      ctx.setLineDash([4, 8]);
      ctx.strokeStyle = PALETTE.channel;
      ctx.lineWidth = 1.8;
    } else if (link.state === "sandbar") {
      ctx.strokeStyle = PALETTE.sand;
      ctx.lineWidth = 1.8;
    } else if (link.state === "settled") {
      ctx.strokeStyle = PALETTE.land;
      ctx.lineWidth = 3;
    } else {
      ctx.strokeStyle = PALETTE.land;
      ctx.lineWidth = 5;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
