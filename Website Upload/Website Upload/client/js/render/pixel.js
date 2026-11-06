// Pixel-art sprite pipeline. A monster's rig is drawn onto a small pixel grid, then cleaned into pixel art:
//   1. hard alpha (no soft edges)       2. colours snapped to a limited, hue-shifted ramp palette
//   3. stray pixels removed              4. a 1px outline coloured from each region's darkest tone
// Sprites are shown with nearest-neighbour scaling so every pixel stays sharp.
import { RIGS } from "./rigs.js";

// ------------------------------------------------------------------ colour
function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
// Move a hue toward a target hue by up to `deg` degrees (shortest way round).
function hueToward(h, target, deg) {
  let d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), deg);
}

// Classic pixel-art ramp: shadows shift toward cool violet, highlights toward warm gold.
export function ramp(hex, steps = 5) {
  const [h, s, l] = rgbHsl(hexRgb(hex));
  const tones = [
    [hueToward(h, 255, 18), clamp01(s * 1.05 + 0.08), clamp01(l * 0.42)],
    [hueToward(h, 255, 9), clamp01(s * 1.02 + 0.04), clamp01(l * 0.7)],
    [h, s, l],
    [hueToward(h, 50, 7), clamp01(s * 0.95), clamp01(l + (1 - l) * 0.38)],
    [hueToward(h, 50, 12), clamp01(s * 0.75), clamp01(l + (1 - l) * 0.72)],
  ];
  const pick = steps === 5 ? tones : steps === 3 ? [tones[1], tones[2], tones[4]] : [tones[2], tones[4]];
  return pick.map(hslRgb);
}

const INK = [20, 14, 30];
const WHITE = [255, 252, 240];

// A monster's palette: a few ramps built from its card palette. Each colour remembers its outline colour.
export function buildPalette(p) {
  const groups = [
    [p.body, 5], [p.accent, 5], [p.wing || p.cloth || p.fin || p.skin || p.shade, 5],
    [p.skin && (p.wing || p.cloth) ? p.skin : null, 3], [p.glow, 3], [p.eye, 2],
  ].filter(([c]) => c);
  const colors = [], outline = [];
  for (const [hex, n] of groups) {
    const r = ramp(hex, n);
    const deep = r[0];
    const ol = deep.map((v, i) => Math.round(v * 0.45 + INK[i] * 0.55));
    for (const c of r) {
      if (colors.some((q) => Math.abs(q[0] - c[0]) + Math.abs(q[1] - c[1]) + Math.abs(q[2] - c[2]) < 18)) continue;
      colors.push(c); outline.push(ol);
    }
  }
  colors.push(INK); outline.push(INK);
  colors.push(WHITE); outline.push(INK);
  return { colors, outline, lut: new Int16Array(32768).fill(-1) };
}

function nearest(pal, r, g, b) {
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  let idx = pal.lut[key];
  if (idx >= 0) return idx;
  let best = 1e9;
  for (let i = 0; i < pal.colors.length; i++) {
    const c = pal.colors[i];
    const dr = r - c[0], dg = g - c[1], db = b - c[2];
    const rm = (r + c[0]) / 2;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < best) { best = d; idx = i; }
  }
  pal.lut[key] = idx;
  return idx;
}

// In-place: turn a soft rendering into clean pixel art.
export function pixelize(img, pal, alphaCut = 110) {
  const { width: w, height: h, data } = img;
  const idx = new Int16Array(w * h).fill(-1);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    if (data[i + 3] < alphaCut) continue;
    idx[p] = nearest(pal, data[i], data[i + 1], data[i + 2]);
  }
  // Remove isolated pixels (no orthogonal neighbours).
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (idx[p] < 0) continue;
    const n = (x > 0 && idx[p - 1] >= 0) + (x < w - 1 && idx[p + 1] >= 0) + (y > 0 && idx[p - w] >= 0) + (y < h - 1 && idx[p + w] >= 0);
    if (n === 0) idx[p] = -1;
  }
  data.fill(0);
  for (let p = 0; p < w * h; p++) {
    const k = idx[p];
    if (k < 0) continue;
    const c = pal.colors[k], i = p * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  // 1px outline, tinted by the neighbouring region (selective outlining).
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (idx[p] >= 0) continue;
    let nb = -1;
    if (x > 0 && idx[p - 1] >= 0) nb = idx[p - 1];
    else if (x < w - 1 && idx[p + 1] >= 0) nb = idx[p + 1];
    else if (y < h - 1 && idx[p + w] >= 0) nb = idx[p + w];
    else if (y > 0 && idx[p - w] >= 0) nb = idx[p - w];
    if (nb < 0) continue;
    const c = pal.outline[nb], i = p * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return img;
}

// Renders one rig into pixel-art frames. R = rig units per sprite pixel (bigger R = chunkier pixels).
export class SpriteRenderer {
  constructor(visual) {
    this.rig = RIGS[visual.rig];
    this.palette = visual.palette;
    this.variant = visual.variant;
    this.pal = buildPalette(visual.palette);
    this.src = document.createElement("canvas");
    this.sctx = this.src.getContext("2d", { willReadFrequently: true });
    this.out = document.createElement("canvas");
    this.octx = this.out.getContext("2d");
    // Sprite bounds in rig units around the feet origin.
    const W = this.rig.width * 2.6, H = this.rig.height * 1.7;
    this.box = { x0: -W / 2, y0: -H * 0.88, x1: W / 2, y1: H * 0.12 };
  }

  render(pose, R, box = this.box) {
    const w = Math.max(4, Math.ceil((box.x1 - box.x0) / R)), h = Math.max(4, Math.ceil((box.y1 - box.y0) / R));
    if (this.src.width !== w || this.src.height !== h) { this.src.width = w; this.src.height = h; this.out.width = w; this.out.height = h; }
    const c = this.sctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    c.setTransform(1 / R, 0, 0, 1 / R, -box.x0 / R, -box.y0 / R);
    const anchors = this.rig.draw(c, pose, this.palette, this.variant);
    const img = pixelize(c.getImageData(0, 0, w, h), this.pal);
    this.octx.putImageData(img, 0, 0);
    return { canvas: this.out, anchors, ox: -box.x0 / R, oy: -box.y0 / R, R, w, h };
  }
}

// Hash noise for pixel dissolves: stable per pixel, uniform in [0,1).
export function noise(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
