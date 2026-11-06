// Battlefield themes: an original tabletop mat per environment (surroundings + board surface + animated
// overlay + ambient particles). The active theme always comes from the authoritative view (view.env);
// Field Spell events animate the change with a radial wipe. Static layers are cached per theme.
import { W, H, TILE_W, TILE_H, FORE, Z, proj, outline, allZones } from "./board.js";
import { ARENAS } from "./arenas.js";

const TAU = Math.PI * 2;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function vgrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function poly(ctx, pts) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); }
function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// ------------------------------------------------------------------ board base
// Everything here is drawn once per theme into a cached canvas, so it can be richly detailed.
const HALF = 568;                         // board half-width at the near edge, in board units
const TRUNK = [0.2375, 0.7625];           // conduit trunk behind each side's monster row
const COLS = [-3, -2, -1, 0, 1, 2, 3].map((c) => c * 150);

// Energy conduits in board space (x, z): trunks behind the monster rows, branches to every zone,
// spines to the central emblem, and outer rings along the rim. The overlay sends pulses along them.
export const CIRCUITS = (() => {
  const paths = [];
  for (const side of [0, 1]) {
    const tz = TRUNK[side];
    const mz = side === 0 ? Z.mon0 : Z.mon1, sz = side === 0 ? Z.st0 : Z.st1;
    const toMid = side === 0 ? Z.mid - 0.035 : Z.mid + 0.035;
    paths.push({ main: true, pts: [[-520, tz], [520, tz]] });
    for (const sx of [-1, 1]) {
      paths.push({ main: true, pts: [[sx * 75, tz], [sx * 75, toMid], [sx * 22, toMid]] });
      paths.push({ main: true, pts: [[sx * 520, tz], [sx * 535, tz], [sx * 535, side === 0 ? 0.04 : 0.96]] });
      paths.push({ main: true, pts: [[sx * 535, tz], [sx * 535, toMid]] });
    }
    for (const x of COLS) {
      paths.push({ main: false, pts: [[x, tz], [x, (tz + mz) / 2]] });
      paths.push({ main: false, pts: [[x, tz], [x, (tz + sz) / 2]] });
    }
  }
  return paths;
})();

function P(x, z) { return proj(x, z); }
// A polyline in board space, subdivided so line width follows perspective.
function boardLine(ctx, pts, width, color, steps = 10) {
  ctx.strokeStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    for (let k = 0; k < steps; k++) {
      const a = P(x0 + ((x1 - x0) * k) / steps, z0 + ((z1 - z0) * k) / steps);
      const b = P(x0 + ((x1 - x0) * (k + 1)) / steps, z0 + ((z1 - z0) * (k + 1)) / steps);
      ctx.lineWidth = width * (a.s + b.s) / 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
}
function boardPoly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, z], i) => { const p = P(x, z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); }
function engrave(ctx, th, draw, lw = 1.6) {
  // Carved look: a dark cut with a light lip below it.
  ctx.save(); ctx.translate(0, 1.2); ctx.strokeStyle = th.engraveLight; ctx.lineWidth = lw; draw(); ctx.restore();
  ctx.strokeStyle = th.engraveDark; ctx.lineWidth = lw; draw();
}

function sigil(ctx, kind, r, th) {
  const path = () => {
    ctx.beginPath();
    if (kind === "mon") {
      ctx.arc(0, 0, r, 0, TAU);
      ctx.moveTo(0, -r * 0.78); ctx.lineTo(r * 0.78, 0); ctx.lineTo(0, r * 0.78); ctx.lineTo(-r * 0.78, 0); ctx.closePath();
      ctx.moveTo(0, -r * 0.34); ctx.lineTo(r * 0.34, 0); ctx.lineTo(0, r * 0.34); ctx.lineTo(-r * 0.34, 0); ctx.closePath();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, l = i % 4 === 0 ? 0.8 : 0.9; ctx.moveTo(Math.cos(a) * r * l, Math.sin(a) * r * l); ctx.lineTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1); }
    } else if (kind === "st") {
      ctx.arc(0, 0, r, 0, TAU); ctx.moveTo(r * 0.72, 0); ctx.arc(0, 0, r * 0.72, 0, TAU);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + TAU / 16; ctx.moveTo(Math.cos(a) * r * 0.18, Math.sin(a) * r * 0.18); ctx.lineTo(Math.cos(a) * r * (i % 2 ? 0.5 : 0.72), Math.sin(a) * r * (i % 2 ? 0.5 : 0.72)); }
    } else if (kind === "field") {
      for (const k of [1, 0.7]) { for (let i = 0; i <= 6; i++) { const a = (i / 6) * TAU + TAU / 12; i ? ctx.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k) : ctx.moveTo(Math.cos(a) * r * k, Math.sin(a) * r * k); } }
      ctx.moveTo(r * 0.3, 0); ctx.arc(0, 0, r * 0.3, 0, TAU);
    } else if (kind === "gy") {
      ctx.moveTo(-r * 0.6, r * 0.8); ctx.lineTo(-r * 0.6, -r * 0.2); ctx.arc(0, -r * 0.2, r * 0.6, Math.PI, 0); ctx.lineTo(r * 0.6, r * 0.8); ctx.closePath();
      ctx.moveTo(0, -r * 0.45); ctx.lineTo(0, r * 0.45); ctx.moveTo(-r * 0.28, -r * 0.1); ctx.lineTo(r * 0.28, -r * 0.1);
    } else {
      for (let i = 0; i < 3; i++) ctx.rect(-r * 0.5 + i * 3, -r * 0.8 - i * 3, r * 1.0, r * 1.5);
    }
  };
  engrave(ctx, th, () => { path(); ctx.stroke(); });
}

// Weathered stone plate: chipped irregular outline, slight tilt, moss or snow on the corners.
function drawStoneTile(ctx, zn, th) {
  const s = zn.s, w = TILE_W * s, h = TILE_H * s * FORE;
  const r = rng(Math.round(zn.x * 13 + zn.y * 7));
  const tilt = (r() - 0.5) * 0.035;
  const shape = (inset) => {
    const pts = [];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    corners.forEach(([cx, cy], i) => {
      const chip = r() < 0.35 ? 6 + r() * 10 : 2;
      const x = cx * (w / 2 - inset), y = cy * (h / 2 - inset * 0.8);
      pts.push([x - cx * chip * s * (i % 2 ? 1 : 0.3), y], [x, y - cy * chip * s * 0.7]);
      // a couple of edge notches between corners
      const [nx, ny] = corners[(i + 1) % 4];
      for (let k = 1; k < 3; k++) {
        const t = k / 3, ex = x + ((nx * (w / 2 - inset)) - x) * t, ey = y + ((ny * (h / 2 - inset * 0.8)) - y) * t;
        const j = (r() - 0.5) * 3 * s;
        pts.push([ex + (cx === nx ? j : 0), ey + (cy === ny ? j * 0.7 : 0)]);
      }
    });
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  };
  ctx.save();
  ctx.translate(zn.x, zn.y); ctx.rotate(tilt);
  ctx.fillStyle = "rgba(0,0,0,.42)"; ctx.save(); ctx.translate(3, 7); shape(0); ctx.fill(); ctx.restore();
  ctx.fillStyle = th.tileEdge; shape(0); ctx.fill();
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, th.tile[0]); g.addColorStop(1, th.tile[1]);
  ctx.fillStyle = g; shape(4 * s); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 1; ctx.stroke();
  // pitted surface and hairline cracks
  for (let i = 0; i < 40; i++) { ctx.fillStyle = r() < 0.6 ? "rgba(0,0,0,.14)" : "rgba(255,255,255,.12)"; ctx.fillRect((r() - 0.5) * w * 0.85, (r() - 0.5) * h * 0.8, (1 + r() * 2) * s, (1 + r()) * s); }
  ctx.strokeStyle = th.crack; ctx.lineWidth = 1;
  for (let i = 0; i < 2; i++) {
    let x = (r() - 0.5) * w * 0.8, y = (r() - 0.5) * h * 0.8;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 18 * s; y += (r() - 0.5) * 12 * s; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // weathered sigil (broken strokes)
  ctx.save(); ctx.scale(1, FORE); ctx.setLineDash([7 * s, 2 * s]);
  sigil(ctx, zn.kind, Math.min(w, h / FORE) * 0.27, th);
  ctx.restore();
  // moss / snow clumps creeping over the corners
  const clump = th.snow ? ["#ffffff", "#e8f2ff"] : th.grass ? ["#5f9a3a", "#7bb54e"] : null;
  if (clump) {
    for (let i = 0; i < 4; i++) {
      if (r() < 0.45) continue;
      const cx = (i % 2 ? 1 : -1) * w * 0.42, cy = (i < 2 ? -1 : 1) * h * 0.38;
      for (let k = 0; k < 7; k++) {
        ctx.fillStyle = clump[k % 2]; ctx.globalAlpha = 0.75;
        ctx.beginPath(); ctx.ellipse(cx + (r() - 0.5) * 18 * s, cy + (r() - 0.5) * 10 * s, (3 + r() * 6) * s, (2 + r() * 3) * s, 0, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  stoneLabel(ctx, zn, th, h);
}

function stoneLabel(ctx, zn, th, h) {
  if (zn.kind === "mon" || zn.kind === "st") return;
  const s = zn.s;
  ctx.font = `900 ${Math.round(9 * s)}px 'Nunito Sans', system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = th.label; ctx.fillText({ field: "FIELD", gy: "GRAVE", deck: "DECK", extra: "EXTRA" }[zn.kind], zn.x, zn.y + h / 2 - 9 * s);
}

// Holo-panel: dark glass with a micro hex pattern and neon edge strips.
function drawNeonTile(ctx, zn, th) {
  const s = zn.s, w = TILE_W * s, h = TILE_H * s * FORE, rr = 6 * s;
  ctx.save();
  ctx.translate(zn.x, zn.y);
  ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.beginPath(); ctx.roundRect(-w / 2 + 2, -h / 2 + 6, w, h, rr); ctx.fill();
  const fg = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  fg.addColorStop(0, th.metal[0]); fg.addColorStop(0.4, th.metal[1]); fg.addColorStop(1, th.metal[2]);
  ctx.fillStyle = fg; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, rr); ctx.fill();
  const ins = 5 * s;
  ctx.fillStyle = "#070a12"; ctx.beginPath(); ctx.roundRect(-w / 2 + ins, -h / 2 + ins, w - ins * 2, h - ins * 2, rr * 0.6); ctx.fill();
  ctx.save(); ctx.clip();
  ctx.strokeStyle = "rgba(63,240,255,.10)"; ctx.lineWidth = 1;
  const hr = 7 * s;
  for (let y = -h / 2, row = 0; y < h / 2 + hr; y += hr * 1.5 * FORE, row++) for (let x = -w / 2 + (row % 2) * hr * 0.87; x < w / 2 + hr; x += hr * 1.73) {
    ctx.beginPath(); for (let i = 0; i <= 6; i++) { const a = (i / 6) * TAU + TAU / 12; ctx.lineTo(x + Math.cos(a) * hr * 0.9, y + Math.sin(a) * hr * 0.9 * FORE); } ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = th.trim; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.roundRect(-w / 2 + ins, -h / 2 + ins, w - ins * 2, h - ins * 2, rr * 0.6); ctx.stroke();
  ctx.globalAlpha = 1;
  const bl = 12 * s, bx = w / 2 - 2 * s, by = h / 2 - 2 * s;
  ctx.strokeStyle = th.trim; ctx.lineWidth = 2.6 * s;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.beginPath(); ctx.moveTo(sx * bx, sy * by - sy * bl); ctx.lineTo(sx * bx, sy * by); ctx.lineTo(sx * bx - sx * bl, sy * by); ctx.stroke(); }
  ctx.save(); ctx.scale(1, FORE);
  ctx.globalAlpha = 0.8;
  sigil(ctx, zn.kind, Math.min(w, h / FORE) * 0.27, th);
  ctx.restore();
  ctx.restore();
  stoneLabel(ctx, zn, th, h);
}

function drawTile(ctx, zn, th) {
  if (th.tileStyle === "stone") return drawStoneTile(ctx, zn, th);
  if (th.tileStyle === "neon") return drawNeonTile(ctx, zn, th);
  const s = zn.s, w = TILE_W * s, h = TILE_H * s * FORE, rr = 10 * s;
  ctx.save();
  ctx.translate(zn.x, zn.y);
  // shadow + metal frame
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.beginPath(); ctx.roundRect(-w / 2 + 2, -h / 2 + 6, w, h, rr); ctx.fill();
  const fg = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  fg.addColorStop(0, th.metal[0]); fg.addColorStop(0.5, th.metal[1]); fg.addColorStop(1, th.metal[2]);
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, rr); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-w / 2 + rr, -h / 2 + 1); ctx.lineTo(w / 2 - rr, -h / 2 + 1); ctx.stroke();
  // recessed stone panel
  const ins = 6 * s;
  const ig = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  ig.addColorStop(0, th.tile[0]); ig.addColorStop(1, th.tile[1]);
  ctx.fillStyle = ig;
  ctx.beginPath(); ctx.roundRect(-w / 2 + ins, -h / 2 + ins * 0.8, w - ins * 2, h - ins * 1.6, rr * 0.7); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(-w / 2 + ins + 3, -h / 2 + ins * 0.8 + 3, w - ins * 2 - 6, h - ins * 1.6 - 6, rr * 0.5); ctx.stroke();
  // subtle stone grain inside the panel
  const rg = rng(Math.round(zn.x * 7 + zn.y * 13));
  ctx.fillStyle = "rgba(0,0,0,.12)";
  for (let i = 0; i < 26; i++) ctx.fillRect(-w / 2 + ins + rg() * (w - ins * 2), -h / 2 + ins + rg() * (h - ins * 2), 1.5 * s, 1.5 * s);
  // corner brackets + rivets
  const bl = 13 * s, bx = w / 2 - 3 * s, by = h / 2 - 3 * s;
  ctx.strokeStyle = th.trim; ctx.lineWidth = 2.2 * s; ctx.lineCap = "square";
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.beginPath(); ctx.moveTo(sx * bx, sy * by + -sy * bl); ctx.lineTo(sx * bx, sy * by); ctx.lineTo(sx * bx - sx * bl, sy * by); ctx.stroke();
    ctx.fillStyle = th.trim; ctx.beginPath(); ctx.arc(sx * (bx - 8 * s), sy * (by - 7 * s), 1.6 * s, 0, TAU); ctx.fill();
  }
  // engraved sigil
  ctx.save();
  ctx.scale(1, FORE);
  sigil(ctx, zn.kind, Math.min(w, h / FORE) * 0.27, th);
  ctx.restore();
  ctx.restore();
  // label plate on special zones
  if (zn.kind !== "mon" && zn.kind !== "st") {
    const label = { field: "FIELD", gy: "GRAVE", deck: "DECK", extra: "EXTRA" }[zn.kind];
    const pw = 52 * s, ph = 13 * s, py = zn.y + h / 2 - 2 * s;
    const pg = ctx.createLinearGradient(0, py - ph / 2, 0, py + ph / 2);
    pg.addColorStop(0, th.metal[0]); pg.addColorStop(1, th.metal[2]);
    ctx.fillStyle = pg; ctx.beginPath(); ctx.roundRect(zn.x - pw / 2, py - ph / 2, pw, ph, 4 * s); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = `900 ${Math.round(8.5 * s)}px 'Nunito Sans', system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = th.label; ctx.fillText(label, zn.x, py + 0.5);
  }
}

// The board is a thick slab: its front and side faces are visible below the rim.
function drawSlab(ctx, th) {
  const o = outline(56), T = 46;
  const [a, b, c, d] = o; // near-left, near-right, far-right, far-left
  const down = (p) => ({ x: p.x, y: p.y + T * p.s });
  const [f0, f1] = th.slab || [th.rim[1], th.metal[2]];
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.beginPath(); ctx.ellipse(800, a.y + T + 10, 760, 40, 0, 0, TAU); ctx.fill();
  for (const [p, q] of [[d, a], [b, c]]) {
    const g = ctx.createLinearGradient(p.x, 0, q.x, 0);
    g.addColorStop(0, f1); g.addColorStop(1, f0);
    ctx.fillStyle = g; poly(ctx, [p, q, down(q), down(p)]); ctx.fill();
  }
  const g = ctx.createLinearGradient(0, a.y, 0, a.y + T);
  g.addColorStop(0, f0); g.addColorStop(1, f1);
  ctx.fillStyle = g; poly(ctx, [a, b, down(b), down(a)]); ctx.fill();
  // stone courses on the front face
  ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 1.2;
  for (let k = 1; k < 3; k++) { ctx.beginPath(); ctx.moveTo(a.x, a.y + (T * k) / 3); ctx.lineTo(b.x, b.y + (T * k) / 3); ctx.stroke(); }
  for (let x = a.x + 40; x < b.x; x += 62) { const row = Math.floor((x - a.x) / 62) % 2; ctx.beginPath(); ctx.moveTo(x + row * 20, a.y + (row ? T / 3 : 0)); ctx.lineTo(x + row * 20, a.y + (row ? (2 * T) / 3 : T / 3)); ctx.stroke(); }
}

// Grass, snow and broken edges creeping over the rim (natural arenas only).
function weather(ctx, th, r) {
  const o = outline(56);
  const edgePts = [];
  for (const [p, q] of [[o[0], o[1]], [o[1], o[2]], [o[2], o[3]], [o[3], o[0]]]) for (let k = 0; k < 1; k += 0.006) edgePts.push({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, s: p.s + (q.s - p.s) * k });
  // chipped bites out of the rim
  ctx.fillStyle = th.slab ? th.slab[1] : "#000";
  for (let i = 0; i < 18; i++) {
    const p = edgePts[(r() * edgePts.length) | 0], rr = (4 + r() * 10) * p.s;
    ctx.beginPath(); ctx.moveTo(p.x - rr, p.y); ctx.lineTo(p.x - rr * 0.3, p.y - rr * 0.8); ctx.lineTo(p.x + rr * 0.6, p.y - rr * 0.5); ctx.lineTo(p.x + rr, p.y + rr * 0.2); ctx.closePath(); ctx.fill();
  }
  if (th.grass) {
    for (const p of edgePts) {
      if (r() < 0.45) continue;
      for (let k = 0; k < 3; k++) {
        const h = (4 + r() * 10) * p.s;
        ctx.strokeStyle = r() < 0.5 ? "#4f8f34" : "#6fae46"; ctx.lineWidth = 1.3;
        const x = p.x + (r() - 0.5) * 10;
        ctx.beginPath(); ctx.moveTo(x, p.y + 2); ctx.lineTo(x + (r() - 0.5) * h * 0.7, p.y - h); ctx.stroke();
      }
    }
    // vines draped over the rim
    ctx.strokeStyle = "#3f7a2a"; ctx.lineWidth = 2.4;
    for (let i = 0; i < 10; i++) {
      const p = edgePts[(r() * edgePts.length) | 0];
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.bezierCurveTo(p.x + 10, p.y + 10, p.x - 8, p.y + 22, p.x + 4, p.y + 36 * p.s); ctx.stroke();
      ctx.fillStyle = "#5f9a3a"; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(p.x + (r() - 0.5) * 10, p.y + k * 8 * p.s, 3.2, 2, r() * 3, 0, TAU); ctx.fill(); }
    }
  }
  if (th.snow) {
    ctx.fillStyle = "rgba(255,255,255,.92)";
    for (const p of edgePts) { if (r() < 0.5) continue; ctx.beginPath(); ctx.ellipse(p.x, p.y - 2, (6 + r() * 10) * p.s, (2 + r() * 3) * p.s, 0, 0, TAU); ctx.fill(); }
  }
}

function drawBase(ctx, th, seed) {
  const r = rng(seed);
  drawSlab(ctx, th);
  // ---- outer frame: shadow, dark metal, stone band, trims
  ctx.fillStyle = "rgba(0,0,0,.5)"; poly(ctx, outline(60).map((p) => ({ x: p.x, y: p.y + 18 }))); ctx.fill();
  const og = ctx.createLinearGradient(0, outline(56)[2].y, 0, outline(56)[0].y);
  og.addColorStop(0, th.metal[1]); og.addColorStop(1, th.metal[2]);
  ctx.fillStyle = og; poly(ctx, outline(56)); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 2; ctx.stroke();
  const sg = ctx.createLinearGradient(0, outline(40)[2].y, 0, outline(40)[0].y);
  sg.addColorStop(0, th.rim[0]); sg.addColorStop(1, th.rim[1]);
  ctx.fillStyle = sg; poly(ctx, outline(42)); ctx.fill();
  // rim blocks with engraved glyph marks
  ctx.lineWidth = 1.4;
  for (let k = 0; k <= 1.0001; k += 1 / 20) {
    for (const sx of [-1, 1]) {
      const a = P(sx * (HALF + 4), k), b = P(sx * (HALF + 42), k);
      ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (k < 1) {
        const c = P(sx * (HALF + 23), k + 1 / 40);
        ctx.strokeStyle = th.engraveDark;
        ctx.beginPath(); ctx.moveTo(c.x - 4 * c.s, c.y); ctx.lineTo(c.x, c.y - 4 * c.s); ctx.lineTo(c.x + 4 * c.s, c.y); ctx.lineTo(c.x, c.y + 4 * c.s); ctx.closePath(); ctx.stroke();
      }
    }
  }
  for (let x = -HALF; x <= HALF; x += 71) {
    for (const z of [-0.03, 1.03]) {
      const a = P(x, z), b = P(x, z === -0.03 ? -0.006 : 1.006);
      ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  for (const [m, w, c] of [[42, 2.5, th.trim], [56, 1.5, "rgba(255,255,255,.18)"], [3, 3, th.trim]]) {
    ctx.strokeStyle = c; ctx.lineWidth = w; poly(ctx, outline(m)); ctx.stroke();
  }

  // ---- ground
  const ground = outline(0);
  ctx.save();
  poly(ctx, ground); ctx.clip();
  ctx.fillStyle = vgrad(ctx, ground[2].y, ground[0].y, [[0, th.ground[1]], [1, th.ground[0]]]);
  ctx.fillRect(0, 0, W, H);
  // irregular stone slabs, staggered rows
  let z = -0.01;
  while (z < 1.01) {
    const dz = 0.045 + r() * 0.03;
    let x = -HALF - r() * 80;
    while (x < HALF) {
      const dw = 70 + r() * 90;
      const tone = r();
      ctx.fillStyle = tone < 0.5 ? `rgba(255,255,255,${0.02 + r() * 0.05})` : `rgba(0,0,0,${0.03 + r() * 0.07})`;
      boardPoly(ctx, [[x, z], [x + dw, z], [x + dw, z + dz], [x, z + dz]]); ctx.fill();
      ctx.strokeStyle = th.grout; ctx.lineWidth = 1.1; ctx.stroke();
      if (r() < 0.25) { // chipped corner
        ctx.fillStyle = "rgba(0,0,0,.18)"; boardPoly(ctx, [[x + dw, z], [x + dw - 10, z], [x + dw, z + 0.012]]); ctx.fill();
      }
      x += dw;
    }
    z += dz;
  }
  // etched hex lattice
  ctx.strokeStyle = th.hex; ctx.lineWidth = 1;
  const hr = 42, hw = hr * Math.sqrt(3);
  for (let row = 0, zz = 0; zz <= 1.05; row++, zz += (hr * 1.5) / 900) {
    for (let xx = -HALF - hw + (row % 2) * (hw / 2); xx <= HALF + hw; xx += hw) {
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * TAU + TAU / 12;
        const p = P(xx + Math.cos(a) * hr, zz + (Math.sin(a) * hr) / 900);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }
  // overgrowth / deposits: clustered blotches per theme
  for (let i = 0; i < 26; i++) {
    const cx = (r() - 0.5) * 1150, cz = r();
    for (let j = 0; j < 9; j++) {
      const p = P(cx + (r() - 0.5) * 90, cz + (r() - 0.5) * 0.05);
      ctx.fillStyle = th.patch; ctx.globalAlpha = 0.08 + r() * 0.22;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, (8 + r() * 26) * p.s, (4 + r() * 10) * p.s, r() * 3, 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // speckle, wear and cracks
  for (let i = 0; i < 1800; i++) {
    const p = P((r() - 0.5) * 1200, r());
    ctx.fillStyle = r() < 0.5 ? th.speck : "rgba(0,0,0,.3)";
    ctx.globalAlpha = 0.12 + r() * 0.25;
    ctx.fillRect(p.x, p.y, 1.4 * p.s, 1.4 * p.s);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 26; i++) {
    let x = (r() - 0.5) * 1100, cz = r();
    let p = P(x, cz);
    ctx.strokeStyle = th.crack; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    for (let k = 0; k < 7; k++) {
      x += (r() - 0.5) * 60; cz += (r() - 0.5) * 0.04; p = P(x, cz); ctx.lineTo(p.x, p.y);
      if (r() < 0.3) { const q = P(x + (r() - 0.5) * 40, cz + (r() - 0.5) * 0.03); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.moveTo(p.x, p.y); }
    }
    ctx.stroke();
  }
  // lighting: a soft pool of light in the middle, ambient occlusion along the walls
  const c0 = P(0, Z.mid);
  const lg = ctx.createRadialGradient(c0.x, c0.y, 40, c0.x, c0.y, 760);
  lg.addColorStop(0, th.light); lg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
  for (const [a, b] of [[ground[0], ground[3]], [ground[1], ground[2]]]) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const inward = mid.x < W / 2 ? 1 : -1;
    const g = ctx.createLinearGradient(mid.x, 0, mid.x + inward * 90, 0);
    g.addColorStop(0, "rgba(0,0,0,.45)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(Math.min(mid.x, mid.x + inward * 90) - 60, 0, 220, H);
  }
  for (const [y, dir] of [[ground[2].y, 1], [ground[0].y, -1]]) {
    const g = ctx.createLinearGradient(0, y, 0, y + dir * 60);
    g.addColorStop(0, "rgba(0,0,0,.4)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, Math.min(y, y + dir * 60), W, 60);
  }
  // a faint glow pooled under every zone
  for (const zn of allZones()) {
    const g = ctx.createRadialGradient(zn.x, zn.y, 10, zn.x, zn.y, 95 * zn.s);
    g.addColorStop(0, th.zoneGlow); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(zn.x, zn.y, 95 * zn.s, 70 * zn.s, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();

  // ---- conduits: recessed groove, metal lips, dim inlay core
  for (const c of CIRCUITS) {
    const wd = c.main ? 1 : 0.7;
    boardLine(ctx, c.pts, 9 * wd, th.groove);
    boardLine(ctx, c.pts, 6 * wd, th.metal[2]);
    boardLine(ctx, c.pts, 3 * wd, th.inlayDim);
  }
  // junction nodes
  for (const side of [0, 1]) for (const x of COLS) {
    const p = P(x, TRUNK[side]);
    ctx.fillStyle = th.metal[1]; ctx.beginPath(); ctx.ellipse(p.x, p.y, 7 * p.s, 5 * p.s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = th.inlayDim; ctx.beginPath(); ctx.ellipse(p.x, p.y, 3 * p.s, 2.2 * p.s, 0, 0, TAU); ctx.fill();
  }

  // ---- centre divider + emblem
  const band = (m) => [[-HALF, Z.mid - m], [HALF, Z.mid - m], [HALF, Z.mid + m], [-HALF, Z.mid + m]];
  ctx.fillStyle = th.metal[2]; boardPoly(ctx, band(0.016)); ctx.fill();
  ctx.fillStyle = th.rim[1]; boardPoly(ctx, band(0.01)); ctx.fill();
  for (const sgn of [-1, 1]) boardLine(ctx, [[-HALF, Z.mid + sgn * 0.013], [HALF, Z.mid + sgn * 0.013]], 1.6, th.trim, 20);
  boardLine(ctx, [[-HALF, Z.mid], [HALF, Z.mid]], 2, th.inlayDim, 20);
  for (let x = -520; x <= 520; x += 65) {
    const p = P(x, Z.mid);
    ctx.fillStyle = th.trim; ctx.beginPath(); ctx.moveTo(p.x, p.y - 4 * p.s); ctx.lineTo(p.x + 5 * p.s, p.y); ctx.lineTo(p.x, p.y + 4 * p.s); ctx.lineTo(p.x - 5 * p.s, p.y); ctx.closePath(); ctx.fill();
  }
  const ec = P(0, Z.mid);
  ctx.save();
  ctx.translate(ec.x, ec.y); ctx.scale(1, 0.32);
  for (const [rad, lw, col] of [[92, 6, th.metal[2]], [86, 3, th.trim], [70, 2, th.engraveDark], [52, 2.5, th.trim]]) {
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(0, 0, rad * ec.s, 0, TAU); ctx.stroke();
  }
  ctx.fillStyle = th.rim[1]; ctx.beginPath(); ctx.arc(0, 0, 50 * ec.s, 0, TAU); ctx.fill();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU, r0 = 72 * ec.s, r1 = (i % 3 ? 80 : 85) * ec.s;
    ctx.strokeStyle = th.trim; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
  }
  ctx.fillStyle = th.trim;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, rad = (i % 2 ? 16 : 44) * ec.s; ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = th.groove; ctx.beginPath(); ctx.arc(0, 0, 12 * ec.s, 0, TAU); ctx.fill();
  ctx.restore();

  // ---- gem sockets on the side rims
  for (const sx of [-1, 1]) for (const zz of [Z.mon0, Z.mid, Z.mon1]) {
    const p = P(sx * (HALF + 23), zz);
    ctx.fillStyle = th.metal[2]; ctx.beginPath(); ctx.ellipse(p.x, p.y, 13 * p.s, 10 * p.s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = th.trim; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = th.groove; ctx.beginPath(); ctx.ellipse(p.x, p.y, 8 * p.s, 6 * p.s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = th.inlayDim; ctx.beginPath(); ctx.ellipse(p.x - 2 * p.s, p.y - 2 * p.s, 3 * p.s, 2 * p.s, 0, 0, TAU); ctx.fill();
  }

  // ---- corner bastions
  for (const c of outline(46)) {
    const s = c.s * 1.05, x = c.x, y = c.y;
    ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.beginPath(); ctx.ellipse(x + 4, y + 10 * s, 40 * s, 14 * s, 0, 0, TAU); ctx.fill();
    const bg = ctx.createLinearGradient(x - 34 * s, 0, x + 34 * s, 0);
    bg.addColorStop(0, th.metal[2]); bg.addColorStop(0.45, th.metal[0]); bg.addColorStop(1, th.metal[2]);
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(x - 32 * s, y); ctx.lineTo(x - 32 * s, y - 30 * s); ctx.lineTo(x + 32 * s, y - 30 * s); ctx.lineTo(x + 32 * s, y); ctx.ellipse(x, y, 32 * s, 11 * s, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = th.rim[0]; ctx.beginPath(); ctx.ellipse(x, y - 30 * s, 32 * s, 11 * s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = th.trim; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 1.2;
    for (const k of [-16, 0, 16]) { ctx.beginPath(); ctx.moveTo(x + k * s, y - 28 * s); ctx.lineTo(x + k * s, y + 8 * s); ctx.stroke(); }
    ctx.fillStyle = th.groove; ctx.beginPath(); ctx.ellipse(x, y - 30 * s, 14 * s, 5 * s, 0, 0, TAU); ctx.fill();
  }

  if (th.grass || th.snow) {
    // grass sprouting in the floor's grout lines / snow drifts across the floor
    ctx.save(); poly(ctx, outline(0)); ctx.clip();
    for (let i = 0; i < 900; i++) {
      const p = P((r() - 0.5) * 1140, r());
      if (th.grass) { const h = (2 + r() * 6) * p.s; ctx.strokeStyle = r() < 0.5 ? "rgba(79,143,52,.8)" : "rgba(111,174,70,.8)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + (r() - 0.5) * h, p.y - h); ctx.stroke(); }
      else if (r() < 0.25) { ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.beginPath(); ctx.ellipse(p.x, p.y, (6 + r() * 20) * p.s, (2 + r() * 5) * p.s, 0, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }
  for (const zn of allZones()) drawTile(ctx, zn, th);
  if (th.grass || th.snow) weather(ctx, th, r);
}

// --------------------------------------------------------------- battle damage
// Scars live in absolute board space (player 0's point of view), so both players see the same spot.
function scarList(seed) {
  const r = rng(seed), out = [];
  for (let i = 0; i < 44; i++) {
    const k = r();
    out.push({
      x: (r() - 0.5) * 1080, z: 0.04 + r() * 0.92, seed: (r() * 1e9) | 0,
      kind: k < 0.45 ? "crack" : k < 0.65 ? "crater" : k < 0.85 ? "chunk" : "scorch",
      size: 0.6 + r() * 0.9, at: (i + 1) / 46,
    });
  }
  return out;
}

function drawScar(ctx, sc, th, flip) {
  const p = P(flip ? -sc.x : sc.x, flip ? 1 - sc.z : sc.z);
  const S = th.scar || { dark: "rgba(0,0,0,.7)", lip: "rgba(255,255,255,.3)", soil: "#3a2a1a", scorch: "rgba(0,0,0,.4)", debris: ["#777", "#555", "#333"] };
  const r = rng(sc.seed), k = sc.size * p.s;
  const cracks = (n, len) => {
    for (let i = 0; i < n; i++) {
      let a = r() * TAU, x = p.x, y = p.y;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        a += (r() - 0.5) * 0.9; const l = (len / 6) * (0.6 + r() * 0.8) * k;
        x += Math.cos(a) * l; y += Math.sin(a) * l * FORE; ctx.lineTo(x, y);
        if (r() < 0.25) { const bx = x + Math.cos(a + 1) * l * 0.8, by = y + Math.sin(a + 1) * l * 0.5; ctx.moveTo(x, y); ctx.lineTo(bx, by); ctx.moveTo(x, y); }
      }
      ctx.strokeStyle = S.lip; ctx.lineWidth = 2.6 * k; ctx.save(); ctx.translate(0, 1.2); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = S.dark; ctx.lineWidth = 1.8 * k; ctx.stroke();
    }
  };
  const debris = (n, spread) => {
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = (0.6 + r() * 0.8) * spread * k, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d * FORE, s2 = (2 + r() * 5) * k;
      ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(x + 1, y + 2, s2, s2 * 0.4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = S.debris[(r() * S.debris.length) | 0];
      ctx.beginPath(); ctx.moveTo(x - s2, y); ctx.lineTo(x - s2 * 0.2, y - s2 * 0.9); ctx.lineTo(x + s2, y - s2 * 0.3); ctx.lineTo(x + s2 * 0.5, y + s2 * 0.3); ctx.closePath(); ctx.fill();
    }
  };
  if (sc.kind === "crack") cracks(2 + ((r() * 2) | 0), 90);
  else if (sc.kind === "scorch") {
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 60 * k);
    g.addColorStop(0, S.scorch); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, 60 * k, 60 * k * FORE, 0, 0, TAU); ctx.fill();
    cracks(2, 40);
  } else if (sc.kind === "crater" || sc.kind === "impact") {
    const rx = (sc.kind === "impact" ? 46 : 34) * k, ry = rx * FORE * 0.8;
    const g = ctx.createRadialGradient(p.x, p.y + ry * 0.2, 2, p.x, p.y, rx);
    g.addColorStop(0, S.soil); g.addColorStop(0.7, S.dark); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = S.lip; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.ellipse(p.x, p.y + 1, rx * 0.85, ry * 0.85, 0, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
    cracks(4, 80); debris(10, rx * 1.3 / k);
  } else { // chunk: a slab broken out of the floor
    const w2 = 26 * k, h2 = 16 * k * FORE;
    ctx.fillStyle = S.soil;
    ctx.beginPath(); ctx.moveTo(p.x - w2, p.y - h2 * 0.2); ctx.lineTo(p.x - w2 * 0.3, p.y - h2); ctx.lineTo(p.x + w2, p.y - h2 * 0.5); ctx.lineTo(p.x + w2 * 0.7, p.y + h2); ctx.lineTo(p.x - w2 * 0.6, p.y + h2 * 0.8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = S.lip; ctx.lineWidth = 1.5; ctx.stroke();
    cracks(2, 50); debris(6, 40);
  }
  if (S.sparks && (sc.kind === "crater" || sc.kind === "impact")) {
    ctx.strokeStyle = "rgba(63,240,255,.8)"; ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) { const a = r() * TAU; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(a) * 20 * k, p.y + Math.sin(a) * 10 * k); ctx.stroke(); }
  }
}

// Clip to the board floor with every zone tile cut out (even-odd).
function floorClip(ctx) {
  ctx.beginPath();
  outline(0).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  for (const zn of allZones()) {
    const w = TILE_W * zn.s, h = TILE_H * zn.s * FORE;
    ctx.rect(zn.x - w / 2 - 2, zn.y - h / 2 - 2, w + 4, h + 6);
  }
  ctx.clip("evenodd");
}

// Animated layer shared by every theme: pulses running along the conduits, breathing gems,
// corner crystals and a slowly turning ring on the emblem. Cheap enough to draw every frame.
function techOverlay(ctx, t, th) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // conduit pulses
  CIRCUITS.forEach((c, ci) => {
    if (!c.main) return;
    const pts = c.pts;
    let len = 0;
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], (pts[i + 1][1] - pts[i][1]) * 900); segs.push(l); len += l; }
    for (let n = 0; n < 2; n++) {
      let d = ((t * 120 + ci * 97 + n * len * 0.5) % len), i = 0;
      while (i < segs.length - 1 && d > segs[i]) { d -= segs[i]; i++; }
      const k = Math.min(1, d / (segs[i] || 1));
      const p = P(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k);
      glow(ctx, p.x, p.y, 14 * p.s, th.pulse);
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
    }
  });
  // breathing inlay along the centre line
  ctx.globalAlpha = 0.35 + Math.sin(t * 1.6) * 0.15;
  boardLine(ctx, [[-HALF, Z.mid], [HALF, Z.mid]], 2.4, th.inlay, 20);
  ctx.globalAlpha = 1;
  // emblem ring
  const ec = P(0, Z.mid);
  ctx.save(); ctx.translate(ec.x, ec.y); ctx.scale(1, 0.32); ctx.rotate(t * 0.25);
  ctx.strokeStyle = th.inlay; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.55;
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(0, 0, 62 * ec.s, (i / 6) * TAU, (i / 6) * TAU + 0.6); ctx.stroke(); }
  ctx.restore();
  glow(ctx, ec.x, ec.y, 34 * ec.s, th.pulse);
  // gem sockets
  for (const sx of [-1, 1]) [Z.mon0, Z.mid, Z.mon1].forEach((zz, i) => {
    const p = P(sx * (HALF + 23), zz);
    ctx.globalAlpha = 0.5 + Math.sin(t * 2 + i + sx) * 0.3;
    glow(ctx, p.x, p.y, 18 * p.s, th.pulse);
  });
  ctx.globalAlpha = 1;
  // bastion crystals
  outline(46).forEach((c, i) => {
    const s = c.s * 1.05, x = c.x, y = c.y - 30 * s - 22 * s + Math.sin(t * 1.4 + i) * 3 * s;
    glow(ctx, x, y, 46 * s, th.pulse);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = th.crystal;
    ctx.beginPath(); ctx.moveTo(x, y - 20 * s); ctx.lineTo(x + 9 * s, y); ctx.lineTo(x, y + 14 * s); ctx.lineTo(x - 9 * s, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.moveTo(x, y - 20 * s); ctx.lineTo(x + 3 * s, y - 2 * s); ctx.lineTo(x - 3 * s, y); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = "lighter";
  });
  ctx.restore();
}

// --------------------------------------------------------------------- themes
const THEMES = {
  arena: {
    name: "Moonlit Citadel",
    ground: ["#55627e", "#3a4560"], patch: "#8fb7d8", speck: "#c9d8f0", crack: "rgba(12,18,40,.55)", grout: "rgba(10,14,30,.22)",
    tile: ["#a9b6cf", "#7a88a6"], tileEdge: "#3b4566", emblem: "rgba(40,60,110,.5)", label: "rgba(20,30,60,.7)",
    rim: ["#d9e1f0", "#6f7ca0"], inlay: "#6fe0ff",
    metal: ["#dfe6f5", "#8a96b8", "#3a4566"], trim: "#eef3ff", engraveDark: "rgba(20,28,60,.55)", engraveLight: "rgba(255,255,255,.28)", hex: "rgba(200,220,255,.07)", groove: "#141a30", inlayDim: "rgba(111,224,255,.35)", pulse: "rgba(120,230,255,.75)", crystal: "#9ff0ff",
    light: "rgba(170,200,255,.16)", zoneGlow: "rgba(111,224,255,.12)",
    surround(ctx, R, t) {
      ctx.fillStyle = vgrad(ctx, R.y0, R.y1, [[0, "#070b22"], [0.6, "#16224a"], [1, "#0a1028"]]);
      ctx.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
      const r = rng(4);
      for (let i = 0; i < 160; i++) {
        const x = R.x0 + r() * (R.x1 - R.x0), y = R.y0 + r() * (R.y1 - R.y0), ph = r() * 6;
        ctx.globalAlpha = 0.3 + 0.6 * Math.abs(Math.sin(t * 0.6 + ph)); ctx.fillStyle = "#e2ebff"; ctx.fillRect(x, y, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
      // cloud sea under the floating citadel
      for (let i = 0; i < 14; i++) {
        const x = ((i * 157 + t * 8) % 2000) - 200, y = 600 + (i % 4) * 90;
        ctx.fillStyle = "rgba(120,140,200,.10)"; ctx.beginPath(); ctx.ellipse(x, y, 260, 60, 0, 0, TAU); ctx.fill();
      }
      // crystal pylons at the corners
      for (const [x, y, s] of [[170, 790, 1], [1430, 790, 1], [330, 80, 0.7], [1270, 80, 0.7]]) {
        ctx.fillStyle = "#2a3456"; ctx.beginPath(); ctx.ellipse(x, y + 30 * s, 50 * s, 18 * s, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = "#4a5880"; ctx.fillRect(x - 30 * s, y - 20 * s, 60 * s, 50 * s);
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        glow(ctx, x, y - 60 * s, 90 * s, `rgba(110,220,255,${0.25 + Math.sin(t * 2 + x) * 0.08})`);
        ctx.restore();
        ctx.fillStyle = "#9ff0ff";
        ctx.beginPath(); ctx.moveTo(x, y - 110 * s + Math.sin(t * 1.5 + x) * 6); ctx.lineTo(x + 18 * s, y - 50 * s); ctx.lineTo(x, y - 20 * s); ctx.lineTo(x - 18 * s, y - 50 * s); ctx.closePath(); ctx.fill();
      }
    },
    overlay(ctx, t) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const a = 0.35 + Math.sin(t * 1.4) * 0.15;
      ctx.strokeStyle = `rgba(110,224,255,${a})`; ctx.lineWidth = 2.5; ctx.shadowColor = "#6fe0ff"; ctx.shadowBlur = 12;
      const L = proj(-560, Z.mid), Rr = proj(560, Z.mid);
      ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(Rr.x, Rr.y); ctx.stroke();
      ctx.restore();
    },
    ambient(P, dt) {
      if (Math.random() < dt * 5) { const p = proj((Math.random() - 0.5) * 1100, Math.random()); P.spawn({ x: p.x, y: p.y, vy: -14, vx: (Math.random() - 0.5) * 6, life: 3.5, size: 1.5, color: "#a8e8ff", drag: 1 }); }
    },
  },
  abyss: {
    name: "Sunken Abyss",
    ground: ["#2f6670", "#1d4450"], patch: "#3fae8c", speck: "#bff4ff", crack: "rgba(2,20,30,.5)", grout: "rgba(0,20,30,.25)",
    tile: ["#7fc6c9", "#4b8f99"], tileEdge: "#1b4a56", emblem: "rgba(0,60,80,.5)", label: "rgba(0,40,60,.75)",
    rim: ["#9fd8d6", "#2c6f7a"], inlay: "#7ef0d8",
    metal: ["#e8c98a", "#a07a3e", "#4a3418"], trim: "#ffe2a8", engraveDark: "rgba(0,30,40,.55)", engraveLight: "rgba(200,255,250,.25)", hex: "rgba(170,255,240,.07)", groove: "#061a20", inlayDim: "rgba(126,240,216,.35)", pulse: "rgba(126,240,216,.75)", crystal: "#9ffff0",
    light: "rgba(150,255,240,.14)", zoneGlow: "rgba(126,240,216,.12)",
    surround(ctx, R, t) {
      ctx.fillStyle = vgrad(ctx, R.y0, R.y1, [[0, "#0b6a92"], [0.5, "#064262"], [1, "#032238"]]);
      ctx.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 12; i++) {
        const x = 200 + i * 110 + Math.sin(t * 0.3 + i) * 30;
        ctx.fillStyle = `rgba(160,240,255,${0.04 + 0.03 * Math.sin(t + i)})`;
        ctx.beginPath(); ctx.moveTo(x - 20, R.y0); ctx.lineTo(x + 20, R.y0); ctx.lineTo(x + 160, R.y1); ctx.lineTo(x + 60, R.y1); ctx.fill();
      }
      ctx.restore();
      const r = rng(9);
      for (let i = 0; i < 26; i++) {
        const left = i % 2 === 0;
        const x = left ? 40 + r() * 200 : 1360 + r() * 200, h = 120 + r() * 220, base = 300 + r() * 600, ph = r() * 6;
        ctx.strokeStyle = r() < 0.5 ? "rgba(30,140,100,.85)" : "rgba(20,100,80,.7)"; ctx.lineWidth = 6 + r() * 5; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x, base);
        for (let k = 1; k <= 8; k++) ctx.lineTo(x + Math.sin(t * 0.9 + ph + k * 0.5) * k * 2.4, base - (h * k) / 8);
        ctx.stroke();
      }
    },
    overlay(ctx, t) {
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineWidth = 2;
      for (let i = 0; i < 12; i++) {
        ctx.strokeStyle = `rgba(170,245,255,${0.05 + 0.03 * Math.sin(t * 1.3 + i)})`;
        ctx.beginPath();
        for (let x = -620; x <= 620; x += 40) { const p = proj(x, i / 12 + Math.sin(x * 0.01 + t + i) * 0.01); x === -620 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
        ctx.stroke();
      }
      ctx.restore();
    },
    ambient(P, dt) {
      if (Math.random() < dt * 14) P.spawn({ x: 150 + Math.random() * 1300, y: 900, vy: -40 - Math.random() * 50, vx: (Math.random() - 0.5) * 10, life: 7, size: 2 + Math.random() * 4, color: "#bff4ff", kind: "bubble", drag: 1, additive: false });
    },
  },
  caldera: {
    name: "Ember Caldera",
    ground: ["#4a3029", "#2c1c18"], patch: "#8a4a2a", speck: "#ffb070", crack: "rgba(255,110,30,.35)", grout: "rgba(0,0,0,.3)",
    tile: ["#6e5148", "#4a342e"], tileEdge: "#21140f", emblem: "rgba(255,140,60,.45)", label: "rgba(255,190,140,.75)",
    rim: ["#7a5246", "#2a1612"], inlay: "#ff8a3c",
    metal: ["#b8a69c", "#5e4e46", "#211815"], trim: "#ffb070", engraveDark: "rgba(0,0,0,.6)", engraveLight: "rgba(255,170,110,.22)", hex: "rgba(255,150,80,.06)", groove: "#0e0605", inlayDim: "rgba(255,122,42,.4)", pulse: "rgba(255,130,50,.8)", crystal: "#ffb070",
    light: "rgba(255,140,60,.14)", zoneGlow: "rgba(255,110,40,.14)",
    surround(ctx, R, t) {
      ctx.fillStyle = vgrad(ctx, R.y0, R.y1, [[0, "#1a0503"], [0.5, "#3a0c06"], [1, "#5a1406"]]);
      ctx.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (const [x, y] of [[120, 300], [1480, 320], [200, 760], [1400, 760], [800, 0]]) glow(ctx, x, y, 320, `rgba(255,90,20,${0.28 + Math.sin(t * 1.3 + x) * 0.08})`);
      ctx.restore();
      const r = rng(13);
      ctx.fillStyle = "#1a0907";
      for (let i = 0; i < 18; i++) {
        const left = i % 2 === 0, x = left ? r() * 230 : 1370 + r() * 230, y = 100 + r() * 760, s = 20 + r() * 50;
        ctx.beginPath(); ctx.moveTo(x - s, y + s * 0.5); ctx.lineTo(x - s * 0.3, y - s * 0.6); ctx.lineTo(x + s * 0.6, y - s * 0.3); ctx.lineTo(x + s, y + s * 0.5); ctx.fill();
      }
    },
    overlay(ctx, t) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(255,120,30,${0.45 + Math.sin(t * 2) * 0.15})`; ctx.lineWidth = 2.5; ctx.shadowColor = "#ff6a00"; ctx.shadowBlur = 10;
      const r = rng(77);
      for (let i = 0; i < 12; i++) {
        let x = (r() - 0.5) * 1000, z = r(), p = proj(x, z);
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 120; z += (r() - 0.5) * 0.05; p = proj(x, z); ctx.lineTo(p.x, p.y); }
        ctx.stroke();
      }
      const L = proj(-560, Z.mid), Rr = proj(560, Z.mid);
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(Rr.x, Rr.y); ctx.stroke();
      ctx.restore();
    },
    ambient(P, dt) {
      if (Math.random() < dt * 22) P.spawn({ x: 150 + Math.random() * 1300, y: 880, vy: -50 - Math.random() * 70, vx: (Math.random() - 0.5) * 30, life: 4, size: 1.5 + Math.random() * 2, color: Math.random() < 0.5 ? "#ffb347" : "#ff5a1a", drag: 0.995 });
    },
  },
  sanctum: {
    name: "Radiant Sanctum",
    ground: ["#d9b77a", "#b48c52"], patch: "#f4e2b0", speck: "#fff4d8", crack: "rgba(90,60,20,.35)", grout: "rgba(90,60,20,.18)",
    tile: ["#fbf3e0", "#e2cfa6"], tileEdge: "#a8833f", emblem: "rgba(160,110,30,.55)", label: "rgba(110,70,10,.8)",
    rim: ["#ffe9a8", "#b38233"], inlay: "#fff2b0",
    metal: ["#fff4cc", "#d4a650", "#7a5420"], trim: "#fffbe8", engraveDark: "rgba(110,70,15,.5)", engraveLight: "rgba(255,255,255,.45)", hex: "rgba(120,80,20,.08)", groove: "#6a4a1c", inlayDim: "rgba(255,220,120,.45)", pulse: "rgba(255,230,140,.8)", crystal: "#fff2b0",
    light: "rgba(255,245,210,.22)", zoneGlow: "rgba(255,230,150,.16)",
    surround(ctx, R, t) {
      ctx.fillStyle = vgrad(ctx, R.y0, R.y1, [[0, "#f8e8bc"], [0.5, "#e2b56a"], [1, "#b07a38"]]);
      ctx.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 14; i++) {
        const a = Math.PI / 2 + (i / 13 - 0.5) * 2.2;
        ctx.globalAlpha = 0.05 + 0.04 * Math.sin(t * 0.8 + i);
        ctx.fillStyle = "#fff6d8"; ctx.beginPath(); ctx.moveTo(800, -140);
        ctx.lineTo(800 + Math.cos(a - 0.04) * 1300, -140 + Math.sin(a - 0.04) * 1300); ctx.lineTo(800 + Math.cos(a + 0.04) * 1300, -140 + Math.sin(a + 0.04) * 1300); ctx.fill();
      }
      ctx.restore();
      for (const x of [90, 230, 1370, 1510]) {
        const g = ctx.createLinearGradient(x - 30, 0, x + 30, 0);
        g.addColorStop(0, "#c89a60"); g.addColorStop(0.5, "#fff2d6"); g.addColorStop(1, "#b08048");
        ctx.fillStyle = g; ctx.fillRect(x - 28, 20, 56, 880);
        ctx.fillStyle = "#d8b27a"; ctx.fillRect(x - 40, 10, 80, 20);
      }
    },
    overlay(ctx, t) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const k = (t * 0.12) % 1.4 - 0.2;
      const a = proj(-700, k - 0.06), b = proj(700, k - 0.06), c = proj(700, k + 0.06), d = proj(-700, k + 0.06);
      const g = ctx.createLinearGradient(0, c.y, 0, a.y);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,250,220,.12)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; poly(ctx, [a, b, c, d]); ctx.fill();
      ctx.restore();
    },
    ambient(P, dt) {
      if (Math.random() < dt * 12) P.spawn({ x: 150 + Math.random() * 1300, y: 150 + Math.random() * 700, vy: -8, vx: (Math.random() - 0.5) * 8, life: 5, size: 2 + Math.random() * 2, color: "#fff4c0", drag: 1 });
    },
  },
  umbral: {
    name: "Umbral Expanse",
    ground: ["#2a1d3a", "#160e22"], patch: "#5a2a8a", speck: "#b48cff", crack: "rgba(180,100,255,.3)", grout: "rgba(0,0,0,.35)",
    tile: ["#3e2d55", "#251a36"], tileEdge: "#0e0816", emblem: "rgba(190,120,255,.5)", label: "rgba(210,170,255,.75)",
    rim: ["#4a3666", "#140c1e"], inlay: "#b45cff",
    metal: ["#8e7ab0", "#43355e", "#150e20"], trim: "#d6b8ff", engraveDark: "rgba(0,0,0,.6)", engraveLight: "rgba(200,160,255,.25)", hex: "rgba(190,130,255,.07)", groove: "#05030a", inlayDim: "rgba(180,92,255,.4)", pulse: "rgba(190,110,255,.8)", crystal: "#c99bff",
    light: "rgba(170,100,255,.14)", zoneGlow: "rgba(180,92,255,.14)",
    surround(ctx, R, t) {
      ctx.fillStyle = vgrad(ctx, R.y0, R.y1, [[0, "#030106"], [0.5, "#12052a"], [1, "#080212"]]);
      ctx.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 6; i++) {
        const x = (i % 2 ? 1450 : 150) + Math.sin(t * 0.2 + i) * 40, y = 120 + i * 140;
        glow(ctx, x, y, 260, i % 2 ? "rgba(160,60,255,.2)" : "rgba(255,60,200,.12)");
      }
      ctx.restore();
      const r = rng(51);
      for (let i = 0; i < 18; i++) {
        const left = i % 2 === 0, x = left ? 40 + r() * 220 : 1340 + r() * 220, y = 60 + r() * 800, s = 10 + r() * 36, ph = r() * 6;
        ctx.save(); ctx.translate(x, y + Math.sin(t * 0.6 + ph) * 10); ctx.rotate(t * 0.2 + ph);
        ctx.fillStyle = "rgba(20,8,40,.95)"; ctx.strokeStyle = "rgba(190,120,255,.7)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.5, 0); ctx.lineTo(0, s * 1.3); ctx.lineTo(-s * 0.5, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    },
    overlay(ctx, t) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (const zn of allZones()) {
        if (zn.kind !== "mon") continue;
        ctx.globalAlpha = 0.18 + 0.12 * Math.sin(t * 2 + zn.x * 0.01);
        glow(ctx, zn.x, zn.y, 60 * zn.s, "rgba(180,92,255,.8)");
      }
      ctx.restore();
    },
    ambient(P, dt) {
      if (Math.random() < dt * 10) { const p = proj((Math.random() - 0.5) * 1100, Math.random()); P.spawn({ x: p.x, y: p.y, vy: -20, vx: (Math.random() - 0.5) * 20, life: 3, size: 6 + Math.random() * 8, grow: 6, color: "#6a2aa8", kind: "smoke", additive: false, drag: 1 }); }
    },
  },
};

Object.assign(THEMES, ARENAS);

export class Environment {
  constructor() {
    this.current = "arena";
    this.prev = null;
    this.p = 1;
    this.dur = 1;
    this.origin = { x: 800, y: 450 };
    this.cache = new Map();
    this.cachePr = 0;
    this.backdrops = new Map();
    this.wear = 0;
    this.impacts = [];
    this.flip = false;
    this.damage = null;
    this.damageKey = "";
    this.surroundFps = 30;   // animated surroundings are redrawn into a cache at this rate, not every frame
    this.surrounds = new Map();
  }
  // The scenery around the board (trees, skyline, weather...) changes slowly: draw it into a cached layer
  // a limited number of times per second and stamp that layer every frame.
  surroundLayer(id, R, t, pr) {
    const key = `${id}|${R.x0.toFixed(0)}|${R.y0.toFixed(0)}|${R.x1.toFixed(0)}|${R.y1.toFixed(0)}|${pr.toFixed(2)}`;
    let s = this.surrounds.get(id);
    if (!s || s.key !== key) {
      const cv = document.createElement("canvas");
      cv.width = Math.ceil((R.x1 - R.x0) * pr); cv.height = Math.ceil((R.y1 - R.y0) * pr);
      s = { key, cv, t: -1 };
      this.surrounds.set(id, s);
      this.evict(this.surrounds, id);
    }
    if (s.t < 0 || t - s.t >= 1 / this.surroundFps || t < s.t) {
      const c = s.cv.getContext("2d");
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, s.cv.width, s.cv.height);
      c.setTransform(pr, 0, 0, pr, -R.x0 * pr, -R.y0 * pr);
      // The static sky goes in first so additive scenery blends exactly as it would on screen.
      if (THEMES[id].backdrop) c.drawImage(this.backdrop(id, R, pr), R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
      THEMES[id].surround(c, R, t);
      s.t = t;
    }
    return s.cv;
  }
  // Battle damage: deterministic scars revealed as `wear` rises, plus scars at real impact points.
  setDamage(wear, impacts, flip) {
    this.wear = wear; this.impacts = impacts; this.flip = flip;
  }
  damageLayer(pr) {
    const key = `${this.current}|${Math.round(this.wear * 40)}|${this.impacts.length}|${this.flip}|${pr.toFixed(2)}`;
    if (key === this.damageKey) return this.damage;
    this.damageKey = key;
    const th = THEMES[this.current];
    const scars = scarList(77 + this.current.length * 13).filter((sc) => sc.at <= this.wear).concat(this.impacts);
    if (!scars.length) { this.damage = null; return null; }
    const cv = this.damage && this.damage.width === Math.ceil(W * pr) ? this.damage : document.createElement("canvas");
    cv.width = Math.ceil(W * pr); cv.height = Math.ceil(H * pr);
    const c = cv.getContext("2d");
    c.setTransform(pr, 0, 0, pr, 0, 0);
    c.save(); poly(c, outline(6)); c.clip();
    for (const sc of scars) drawScar(c, sc, th, this.flip);
    c.restore();
    this.damage = cv;
    return cv;
  }
  backdrop(id, R, pr) {
    const key = `${id}|${R.x0.toFixed(0)}|${R.y0.toFixed(0)}|${R.x1.toFixed(0)}|${R.y1.toFixed(0)}|${pr.toFixed(2)}`;
    let b = this.backdrops.get(id);
    if (!b || b.key !== key) {
      const cv = document.createElement("canvas");
      cv.width = Math.ceil((R.x1 - R.x0) * pr); cv.height = Math.ceil((R.y1 - R.y0) * pr);
      const c = cv.getContext("2d");
      c.setTransform(pr, 0, 0, pr, -R.x0 * pr, -R.y0 * pr);
      THEMES[id].backdrop(c, R);
      b = { key, cv };
      this.backdrops.set(id, b);
      this.evict(this.backdrops, id);
    }
    return b.cv;
  }
  // Full-screen layers are big: keep only the arenas currently on screen (the current one and, mid-wipe, the old one).
  evict(map, keep) {
    for (const k of [...map.keys()]) if (k !== keep && k !== this.current && k !== this.prev) map.delete(k);
  }
  get name() { return THEMES[this.current].name; }
  set(id) { this.current = THEMES[id] ? id : "arena"; this.prev = null; this.p = 1; }
  transition(id, dur = 1.6, origin) {
    id = THEMES[id] ? id : "arena";
    if (id === this.current) return;
    this.prev = this.current;
    this.current = id;
    this.p = 0;
    this.dur = dur;
    if (origin) this.origin = origin;
  }
  update(dt, particles) {
    if (this.p < 1) { this.p = Math.min(1, this.p + dt / this.dur); if (this.p >= 1) this.prev = null; }
    THEMES[this.current].ambient(particles, dt);
  }
  base(id, pr) {
    if (Math.abs(pr - this.cachePr) > 0.01) { this.cache.clear(); this.cachePr = pr; }
    if (!this.cache.has(id)) {
      const cv = document.createElement("canvas");
      cv.width = Math.ceil(W * pr); cv.height = Math.ceil(H * pr);
      const c = cv.getContext("2d");
      c.scale(pr, pr);
      drawBase(c, THEMES[id], 31 + id.length * 7);
      this.cache.set(id, cv);
      this.evict(this.cache, id);
    }
    return this.cache.get(id);
  }
  drawTheme(ctx, id, R, t, pr) {
    const th = THEMES[id];
    ctx.drawImage(this.surroundLayer(id, R, t, pr), R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
    if (!this.board) return; // menus show only the surroundings
    ctx.drawImage(this.base(id, pr), 0, 0, W, H);
    const dmg = this.damageLayer(pr);
    if (dmg) ctx.drawImage(dmg, 0, 0, W, H);
    techOverlay(ctx, t, th);
    // Theme overlays (lava seams, caustics, sweeps) run across the floor, never over the zone tiles.
    ctx.save();
    floorClip(ctx);
    th.overlay(ctx, t);
    ctx.restore();
  }
  draw(ctx, R, t, pr = 1, board = true) {
    this.board = board;
    if (this.prev && this.p < 1) {
      this.drawTheme(ctx, this.prev, R, t, pr);
      const maxR = Math.hypot(R.x1 - R.x0, R.y1 - R.y0);
      const r = maxR * (this.p * this.p * (3 - 2 * this.p));
      ctx.save();
      ctx.beginPath(); ctx.arc(this.origin.x, this.origin.y, r, 0, TAU); ctx.clip();
      this.drawTheme(ctx, this.current, R, t, pr);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 10 * (1 - this.p) + 2;
      ctx.shadowColor = "#fff"; ctx.shadowBlur = 30;
      ctx.beginPath(); ctx.arc(this.origin.x, this.origin.y, r, 0, TAU); ctx.stroke();
      ctx.restore();
    } else {
      this.drawTheme(ctx, this.current, R, t, pr);
    }
  }
}
