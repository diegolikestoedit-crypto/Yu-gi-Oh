// Pixel-sprite showcases for menus: a living featured monster on a pedestal, and static deck covers.
import { card as cardData } from "./carddb.js";
import { SpriteRenderer } from "./render/pixel.js";
import { basePose } from "./render/rigs.js";

const coverCache = new Map();

// A static pixel portrait (the monster's idle frame), trimmed and scaled up crisply. Returns a data URL.
export function spriteCover(cid, height = 120) {
  const key = `${cid}:${height}`;
  if (coverCache.has(key)) return coverCache.get(key);
  const c = cardData(cid);
  const spr = new SpriteRenderer(c.visual);
  const R = spr.rig.height / 46; // ~46 sprite pixels tall
  const pose = basePose(0.4);
  if (c.visual.rig === "dragon") pose.raise = 0.3;
  const f = spr.render(pose, R);
  const d = f.canvas.getContext("2d").getImageData(0, 0, f.w, f.h).data;
  let x0 = f.w, y0 = f.h, x1 = 0, y1 = 0;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (d[(y * f.w + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const k = Math.max(1, Math.floor(height / h));
  const out = document.createElement("canvas");
  out.width = w * k; out.height = h * k;
  const o = out.getContext("2d");
  o.imageSmoothingEnabled = false;
  o.drawImage(f.canvas, x0, y0, w, h, 0, 0, w * k, h * k);
  const url = out.toDataURL();
  coverCache.set(key, url);
  return url;
}

// A featured monster idling on a pedestal, cycling through a roster with a materialise flash.
export class Showcase {
  constructor(canvas, cids, onChange) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.cids = cids;
    this.onChange = onChange;
    this.i = 0;
    this.t = 0;
    this.since = 0;
    this.frameT = -1;
    this.running = false;
    this.set(0);
  }
  set(i) {
    this.i = (i + this.cids.length) % this.cids.length;
    const c = cardData(this.cids[this.i]);
    this.spr = new SpriteRenderer(c.visual);
    this.pose = basePose(0);
    this.since = 0;
    this.frame = null;
    if (this.onChange) this.onChange(c);
  }
  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      this.step(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; }
  step(dt) {
    this.t += dt; this.since += dt; this.pose.t += dt;
    if (this.since > 6) this.set(this.i + 1);
    const { cv, ctx } = this;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    // pedestal: stepped pixel ellipse with a glowing rim
    const px = 4, cx = W / 2, base = H * 0.86;
    for (let r = 0; r < 4; r++) {
      ctx.fillStyle = ["#1a1f3a", "#262d52", "#323b6a", "#6fe0ff"][r];
      const rw = (W * 0.36) - r * 10, rh = (H * 0.07) - r * 3;
      for (let y = -rh; y <= rh; y += px) {
        const xw = rw * Math.sqrt(Math.max(0, 1 - (y * y) / (rh * rh)));
        ctx.fillRect(Math.round((cx - xw) / px) * px, Math.round((base + y - r * 4) / px) * px, Math.round((xw * 2) / px) * px, px);
      }
    }
    // pixel sparkles rising
    for (let k = 0; k < 14; k++) {
      const ph = (this.t * 0.25 + k * 0.13) % 1;
      ctx.globalAlpha = 1 - ph;
      ctx.fillStyle = k % 2 ? "#9fe6ff" : "#ffe58a";
      ctx.fillRect(Math.round((cx + Math.sin(k * 2.1) * W * 0.3) / px) * px, Math.round((base - ph * H * 0.7) / px) * px, px, px);
    }
    ctx.globalAlpha = 1;
    // the monster, re-rendered at 15 fps
    const R = this.spr.rig.height / 52;
    if (!this.frame || this.pose.t - this.frameT >= 1 / 15) { this.frame = this.spr.render(this.pose, R); this.frameT = this.pose.t; }
    const f = this.frame;
    const k = Math.max(2, Math.floor((H * 0.62) / 52));
    const appear = Math.min(1, this.since / 0.5);
    let img = f.canvas;
    if (appear < 1) {
      // Materialise from white light: tint a copy of the sprite only.
      this.tint = this.tint || document.createElement("canvas");
      const t = this.tint, tc = t.getContext("2d");
      t.width = f.w; t.height = f.h;
      tc.drawImage(f.canvas, 0, 0);
      tc.globalCompositeOperation = "source-atop";
      tc.fillStyle = `rgba(255,255,255,${Math.round((1 - appear) * 4) / 4})`;
      tc.fillRect(0, 0, f.w, f.h);
      img = t;
    }
    ctx.save();
    ctx.globalAlpha = appear;
    ctx.translate(Math.round(cx - this.spr.rig.artBox.cx / R * k), Math.round(base - 6));
    ctx.drawImage(img, -f.ox * k, -f.oy * k, f.w * k, f.h * k);
    ctx.restore();
  }
}
