// Reusable visual-effect primitives and a pooled particle system.
// Effects only *display* outcomes the rules engine already decided.
import { rgba } from "./rigs.js";

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const ease = (p) => 1 - Math.pow(1 - p, 3);
const fade = (p, a = 0.15, b = 0.7) => (p < a ? p / a : p > b ? Math.max(0, 1 - (p - b) / (1 - b)) : 1);
function col(c) { return c && c.startsWith("#") ? c : "#ffffff"; }

// ------------------------------------------------------------------ particles
// Glow particles are stamped from a small pre-rendered sprite per colour instead of building a radial
// gradient for every particle every frame.
const GLOW = new Map();
function glowSprite(color) {
  let cv = GLOW.get(color);
  if (!cv) {
    cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const c = cv.getContext("2d");
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    if (GLOW.size > 200) GLOW.clear();
    GLOW.set(color, cv);
  }
  return cv;
}

export class Particles {
  constructor(max = 1600) {
    this.max = max;
    this.list = [];
  }
  setQuality(q) { this.max = q === "low" ? 380 : 1600; }
  spawn(p) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0, life: p.life || 1, age: 0,
      size: p.size || 3, grow: p.grow || 0, color: col(p.color), grav: p.grav || 0, drag: p.drag ?? 0.98,
      kind: p.kind || "glow", spin: p.spin || 0, rot: p.rot || 0, additive: p.additive ?? true,
    });
  }
  burst(x, y, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = o.angle !== undefined ? o.angle + rand(-(o.spread ?? TAU), o.spread ?? TAU) / 2 : rand(0, TAU);
      const sp = rand(o.speed?.[0] ?? 40, o.speed?.[1] ?? 220);
      this.spawn({
        x: x + rand(-(o.jitter || 0), o.jitter || 0), y: y + rand(-(o.jitter || 0), o.jitter || 0),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * (o.squash || 1) + (o.lift || 0),
        life: rand(o.life?.[0] ?? 0.4, o.life?.[1] ?? 1.1), size: rand(o.size?.[0] ?? 2, o.size?.[1] ?? 5),
        color: Array.isArray(o.color) ? o.color[(Math.random() * o.color.length) | 0] : o.color,
        grav: o.grav, drag: o.drag, kind: o.kind, grow: o.grow, spin: rand(-6, 6), additive: o.additive,
      });
    }
  }
  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) { L.splice(i, 1); continue; }
      p.vx *= Math.pow(p.drag, dt * 60); p.vy *= Math.pow(p.drag, dt * 60);
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.size = Math.max(0.2, p.size + p.grow * dt);
    }
  }
  draw(ctx) {
    for (const additive of [false, true]) {
      ctx.globalCompositeOperation = additive ? "lighter" : "source-over";
      for (const p of this.list) {
        if (p.additive !== additive) continue;
        const k = 1 - p.age / p.life;
        ctx.globalAlpha = Math.min(1, k * 1.4);
        if (p.kind === "glow") {
          const r = p.size * 2.2;
          ctx.drawImage(glowSprite(p.color), p.x - r, p.y - r, r * 2, r * 2);
        } else if (p.kind === "spark") {
          ctx.strokeStyle = p.color; ctx.lineWidth = p.size * 0.6;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
        } else if (p.kind === "shard") {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.moveTo(0, -p.size * 1.6); ctx.lineTo(p.size * 0.7, 0); ctx.lineTo(0, p.size * 1.6); ctx.lineTo(-p.size * 0.7, 0); ctx.fill();
          ctx.restore();
        } else if (p.kind === "smoke") {
          ctx.globalAlpha = k * 0.45;
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
        } else if (p.kind === "bubble") {
          ctx.strokeStyle = p.color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.stroke();
        } else {
          ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

// -------------------------------------------------------------------- effects
class Effect {
  constructor(o) { Object.assign(this, o); this.age = 0; this.life = o.life || 1; }
  update(dt) { this.age += dt; }
  get p() { return Math.min(1, this.age / this.life); }
  get done() { return this.age >= this.life; }
  pos(v) { return typeof v === "function" ? v() : v; }
}

export class MagicCircle extends Effect {
  draw(ctx) {
    const p = this.p, a = fade(p, 0.15, 0.75), r = this.r * (0.6 + 0.4 * ease(Math.min(1, p * 2.5)));
    const sq = this.squash ?? 0.32;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(1, sq);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = a;
    ctx.shadowColor = this.color; ctx.shadowBlur = 20;
    ctx.strokeStyle = this.color; ctx.lineWidth = 3 / sq * 0.6;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, TAU); ctx.stroke();
    ctx.rotate(this.age * (this.spin ?? 1.4));
    const n = this.points || 6;
    // Odd counts draw a single star; even counts draw two interlocking polygons.
    const polys = n % 2 ? [[n, 2, 0]] : [[n / 2, 1, 0], [n / 2, 1, TAU / n]];
    for (const [m, step, off] of polys) {
      ctx.beginPath();
      for (let i = 0; i <= m; i++) {
        const ang = off + (i * step * TAU) / m;
        ctx.lineTo(Math.cos(ang) * r * 0.78, Math.sin(ang) * r * 0.78);
      }
      ctx.stroke();
    }
    ctx.fillStyle = this.color2 || this.color;
    for (let i = 0; i < 16; i++) {
      ctx.save(); ctx.rotate((i / 16) * TAU); ctx.fillRect(r * 0.84, -3, 10, 6); ctx.restore();
    }
    ctx.globalAlpha = a * 0.25;
    ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

export class Pillar extends Effect {
  draw(ctx) {
    const p = this.p, a = fade(p, 0.1, 0.6);
    const w = this.w * (p < 0.2 ? p / 0.2 : 1 - (p - 0.2) * 0.6);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = a;
    const g = ctx.createLinearGradient(this.x - w, 0, this.x + w, 0);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.5, this.color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(this.x - w, this.y - this.h, w * 2, this.h);
    ctx.globalAlpha = a * 0.8;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(this.x - w * 0.12, this.y - this.h, w * 0.24, this.h);
    ctx.restore();
  }
}

export class Portal extends Effect {
  draw(ctx) {
    const p = this.p, a = fade(p, 0.12, 0.8), open = ease(Math.min(1, p * 2.2)) * (p > 0.8 ? 1 - (p - 0.8) * 5 : 1);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = a;
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate(this.age * (1.6 + i * 0.5) * (i % 2 ? -1 : 1));
      ctx.strokeStyle = i % 2 ? this.color : this.color2 || "#ffffff";
      ctx.lineWidth = 4 - i * 0.6;
      ctx.shadowColor = this.color; ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.ellipse(0, 0, this.r * open * (1 - i * 0.12), this.r * open * 1.25 * (1 - i * 0.12), 0, i, i + 4.6);
      ctx.stroke();
      ctx.restore();
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, this.r * open * 1.1);
    g.addColorStop(0, "rgba(255,255,255,0.9)"); g.addColorStop(0.4, rgba(col(this.color), 0.5)); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, this.r * open * 1.1, this.r * open * 1.4, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

export class Beam extends Effect {
  draw(ctx) {
    const a = this.pos(this.from), b = this.pos(this.to);
    const p = this.p, grow = Math.min(1, p / (this.growTime || 0.25));
    const end = { x: a.x + (b.x - a.x) * grow, y: a.y + (b.y - a.y) * grow };
    const w = this.width * fade(p, 0.05, 0.75) * (1 + Math.sin(this.age * 40) * 0.08);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const [mult, c, alpha] of [[2.4, this.color, 0.25], [1.4, this.color, 0.55], [0.55, this.core || "#ffffff", 1]]) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = c; ctx.lineWidth = w * mult;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    }
    ctx.restore();
  }
}

export class Bolt extends Effect {
  constructor(o) { super(o); this.reseed(); this.t = 0; }
  reseed() {
    const a = this.from, b = this.to, n = 12;
    this.pts = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const off = i === 0 || i === n ? 0 : rand(-1, 1) * (this.jag || 34);
      this.pts.push({ x: a.x + (b.x - a.x) * k + off, y: a.y + (b.y - a.y) * k + off * 0.3 });
    }
  }
  update(dt) { super.update(dt); this.t += dt; if (this.t > 0.05) { this.t = 0; this.reseed(); } }
  draw(ctx) {
    const a = fade(this.p, 0.02, 0.5);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    for (const [w, c, al] of [[14, this.color, 0.3], [6, this.color, 0.7], [2.5, "#ffffff", 1]]) {
      ctx.globalAlpha = a * al; ctx.strokeStyle = c; ctx.lineWidth = w;
      ctx.beginPath();
      this.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.restore();
  }
}

export class Projectile extends Effect {
  update(dt) {
    super.update(dt);
    const p = this.pos(this.at());
    if (this.particles && Math.random() < (this.trailRate ?? 0.9)) {
      this.particles.spawn({ x: p.x + rand(-4, 4), y: p.y + rand(-4, 4), vx: rand(-20, 20), vy: rand(-20, 20), life: rand(0.25, 0.6),
        size: rand(this.size * 0.3, this.size * 0.7), color: Math.random() < 0.5 ? this.color : this.color2 || "#ffffff" });
    }
  }
  at() {
    const a = this.pos(this.from), b = this.pos(this.to), k = ease(this.p);
    const arc = this.arc || 0;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * arc };
  }
  draw(ctx) {
    const p = this.at();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const s = this.size * (1 + Math.sin(this.age * 30) * 0.1);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 2.4);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.3, this.color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, s * 2.4, 0, TAU); ctx.fill();
    if (this.dark) { ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = "#0a0012"; ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.55, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
}

export class Ring extends Effect {
  draw(ctx) {
    const p = ease(this.p), r = this.r0 + (this.r1 - this.r0) * p;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = (1 - this.p) * (this.alpha ?? 1);
    ctx.strokeStyle = this.color; ctx.lineWidth = (this.width || 8) * (1 - this.p * 0.7);
    ctx.shadowColor = this.color; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.ellipse(this.x, this.y, r, r * (this.squash ?? 0.35), 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

export class Slash extends Effect {
  draw(ctx) {
    const p = this.p, k = ease(Math.min(1, p * 1.8));
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle || 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1 - p;
    ctx.shadowColor = this.color; ctx.shadowBlur = 18;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    const r = this.r, a0 = -1.3, a1 = -1.3 + 2.6 * k;
    ctx.arc(0, 0, r, a0, a1);
    ctx.arc(0, 0, r * 0.78, a1, a0, true);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

export class Dome extends Effect {
  draw(ctx) {
    const p = this.p, a = fade(p, 0.1, 0.75), r = this.r * ease(Math.min(1, p * 3));
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.85, rgba(col(this.color), 0.25)); g.addColorStop(1, rgba(col(this.color), 0.7));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, r * (this.wide || 1), r, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = this.color; ctx.lineWidth = 2; ctx.shadowColor = this.color; ctx.shadowBlur = 14;
    const hs = 26;
    for (let yy = -r; yy < r; yy += hs * 0.86) {
      for (let xx = -r * (this.wide || 1); xx < r * (this.wide || 1); xx += hs * 1.5) {
        const ox = xx + ((Math.round(yy / (hs * 0.86)) & 1) ? hs * 0.75 : 0);
        const d = Math.hypot(ox / (this.wide || 1), yy) / r;
        if (d > 1) continue;
        ctx.globalAlpha = a * (0.15 + d * 0.6) * (0.6 + Math.sin(this.age * 6 + ox * 0.05) * 0.4);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const an = i * Math.PI / 3; ctx.lineTo(ox + Math.cos(an) * hs * 0.5, yy + Math.sin(an) * hs * 0.5); }
        ctx.closePath(); ctx.stroke();
      }
    }
    ctx.restore();
  }
}

export class Cylinder extends Effect {
  draw(ctx) {
    const p = this.p, a = fade(p, 0.12, 0.8), h = this.h * ease(Math.min(1, p * 3)), w = this.w;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle || 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = a;
    const g = ctx.createLinearGradient(-w, 0, w, 0);
    g.addColorStop(0, rgba(col(this.color), 0.7)); g.addColorStop(0.5, rgba(col(this.color2 || this.color), 0.15)); g.addColorStop(1, rgba(col(this.color), 0.7));
    ctx.fillStyle = g; ctx.fillRect(-w, -h / 2, w * 2, h);
    ctx.strokeStyle = this.color; ctx.lineWidth = 4; ctx.shadowColor = this.color; ctx.shadowBlur = 18;
    for (const yy of [-h / 2, h / 2]) { ctx.beginPath(); ctx.ellipse(0, yy, w, w * 0.32, 0, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = a * 0.6;
    for (let i = 0; i < 6; i++) {
      const yy = ((this.age * 160 + i * h / 6) % h) - h / 2;
      ctx.beginPath(); ctx.ellipse(0, yy, w * 0.9, w * 0.28, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
}

export class Sinkhole extends Effect {
  draw(ctx) {
    const p = this.p, open = ease(Math.min(1, p * 2.5)) * (p > 0.85 ? 1 - (p - 0.85) / 0.15 : 1);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(5,3,2,0.95)";
    ctx.beginPath(); ctx.ellipse(0, 0, this.r * open, this.r * 0.3 * open, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(col(this.color), 0.9); ctx.lineWidth = 3; ctx.shadowColor = this.color; ctx.shadowBlur = 12;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * this.r * open, Math.sin(a) * this.r * 0.3 * open);
      ctx.lineTo(Math.cos(a + 0.1) * this.r * 1.5 * open, Math.sin(a + 0.1) * this.r * 0.45 * open);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export class Vortex extends Effect {
  draw(ctx) {
    const p = this.p, a = fade(p, 0.1, 0.85), r = this.r * (0.4 + 0.6 * ease(Math.min(1, p * 2)));
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = a;
    for (let arm = 0; arm < 3; arm++) {
      ctx.strokeStyle = this.colors[arm % this.colors.length];
      ctx.lineWidth = 5; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 18;
      ctx.beginPath();
      for (let k = 0; k < 1; k += 0.02) {
        const ang = k * 9 + arm * (TAU / 3) - this.age * 5;
        const rr = r * (1 - k);
        ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr * 0.6);
      }
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.5);
    g.addColorStop(0, "#ffffff"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

export class TextPop extends Effect {
  draw(ctx) {
    const p = this.p;
    ctx.save();
    ctx.globalAlpha = fade(p, 0.08, 0.7);
    const s = (this.size || 40) * (p < 0.12 ? 1.6 - p * 5 : 1);
    ctx.font = `900 ${s}px 'Nunito Sans', system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,.8)";
    const y = this.y - ease(p) * (this.rise ?? 50);
    ctx.strokeText(this.text, this.x, y);
    ctx.fillStyle = this.color || "#fff";
    ctx.fillText(this.text, this.x, y);
    ctx.restore();
  }
}

export class CardFlash extends Effect {
  // A card image that rises, flips toward the viewer and glows: used for spell/trap activation.
  draw(ctx) {
    const p = this.p, a = fade(p, 0.12, 0.75);
    const img = this.img;
    const w = this.w * (0.7 + ease(Math.min(1, p * 3)) * 0.3), h = w * (img.height / img.width);
    const flip = Math.min(1, p * 4);
    ctx.save();
    ctx.translate(this.x, this.y - ease(Math.min(1, p * 2)) * (this.rise || 0));
    ctx.scale(Math.abs(Math.cos((1 - flip) * Math.PI / 2)) || 0.02, 1);
    ctx.globalAlpha = a;
    ctx.shadowColor = this.glow || "#fff"; ctx.shadowBlur = 40;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

// ------------------------------------------------------------- destruction
// Breaks an image (a monster's current sprite frame, or a card face) into jagged pieces that fly apart.
// The pieces share a jittered vertex grid, so before they move the picture looks whole; each one then
// leaves on a delay that grows with its distance from the point of impact.
export class Shatter extends Effect {
  constructor(o) {
    super(o);
    const cols = o.cols || 6, rows = o.rows || 7;
    const V = [];
    for (let j = 0; j <= rows; j++) {
      V.push([]);
      for (let i = 0; i <= cols; i++) {
        const edge = i === 0 || j === 0 || i === cols || j === rows;
        V[j].push({ x: (i + (edge ? 0 : rand(-0.38, 0.38))) / cols * o.w, y: (j + (edge ? 0 : rand(-0.38, 0.38))) / rows * o.h });
      }
    }
    const origin = o.origin || { x: o.x + o.w / 2, y: o.y + o.h / 2 };
    const maxD = Math.hypot(o.w, o.h);
    const power = o.power || 1;
    this.shards = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = V[j][i], b = V[j][i + 1], c = V[j + 1][i + 1], d = V[j + 1][i];
      const tris = Math.random() < 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
      for (const pts of tris) {
        const cx = (pts[0].x + pts[1].x + pts[2].x) / 3, cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
        const wx = o.x + cx, wy = o.y + cy;
        const dx = wx - origin.x, dy = wy - origin.y, dist = Math.hypot(dx, dy) || 1;
        const sp = rand(160, 420) * power * (1.1 - dist / maxD * 0.5);
        this.shards.push({
          pts: pts.map((p) => ({ x: p.x - cx, y: p.y - cy })), cx, cy, x: wx, y: wy,
          vx: (dx / dist) * sp + rand(-40, 40), vy: (dy / dist) * sp * 0.6 - rand(120, 300) * power,
          rot: 0, spin: rand(-7, 7) * power, delay: (dist / maxD) * (o.spread ?? 0.22), bounced: false,
        });
      }
    }
    this.floor = o.floor ?? o.y + o.h + 10;
    // A silhouette in the tint colour, so the glow only lights the picture's own pixels, never the gaps.
    if (o.tint) {
      const t = document.createElement("canvas");
      t.width = o.img.width; t.height = o.img.height;
      const c = t.getContext("2d");
      c.drawImage(o.img, 0, 0);
      c.globalCompositeOperation = "source-atop";
      c.fillStyle = o.tint; c.fillRect(0, 0, t.width, t.height);
      this.tintImg = t;
    }
  }
  update(dt) {
    super.update(dt);
    for (const s of this.shards) {
      if (this.age < s.delay) continue;
      s.vy += (this.grav ?? 900) * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.rot += s.spin * dt;
      if (s.y > this.floor && s.vy > 0) {
        s.y = this.floor; s.vy *= -0.32; s.vx *= 0.6; s.spin *= 0.5;
        if (!s.bounced && this.particles) this.particles.spawn({ x: s.x, y: s.y, vx: rand(-30, 30), vy: rand(-60, -20), life: 0.5, size: rand(4, 9), color: this.dust || "#8a8070", kind: "smoke", additive: false });
        s.bounced = true;
      }
    }
  }
  draw(ctx) {
    const p = this.p;
    const alpha = p < 0.55 ? 1 : Math.max(0, 1 - (p - 0.55) / 0.45);
    if (alpha <= 0) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const s of this.shards) {
      const moving = this.age >= s.delay;
      const t = moving ? Math.min(1, (this.age - s.delay) / 0.35) : 0;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x, s.pts[0].y); ctx.lineTo(s.pts[1].x, s.pts[1].y); ctx.lineTo(s.pts[2].x, s.pts[2].y); ctx.closePath();
      ctx.save();
      ctx.clip();
      ctx.drawImage(this.img, -s.cx, -s.cy, this.w, this.h);
      // Freshly broken faces catch the light, then cool down.
      if (this.tintImg && t < 1) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = alpha * (1 - t) * 0.7; ctx.drawImage(this.tintImg, -s.cx, -s.cy, this.w, this.h); }
      ctx.restore();
      if (this.edge) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = alpha * (moving ? 1 - t * 0.7 : 0.25);
        ctx.strokeStyle = this.edge; ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
}

// Jagged glowing fractures spreading across a rectangle from an impact point.
export class Cracks extends Effect {
  constructor(o) {
    super(o);
    const n = o.count || 7;
    this.lines = [];
    for (let i = 0; i < n; i++) {
      let a = (i / n) * TAU + rand(-0.3, 0.3), x = 0, y = 0;
      const pts = [{ x, y }];
      const len = rand(0.45, 0.8) * Math.max(o.w, o.h);
      for (let k = 0; k < 6; k++) {
        a += rand(-0.6, 0.6);
        x += Math.cos(a) * len / 6; y += Math.sin(a) * len / 6;
        pts.push({ x, y });
      }
      this.lines.push(pts);
    }
  }
  draw(ctx) {
    const grow = ease(Math.min(1, this.p / 0.6));
    const o = this.pos(this.origin);
    ctx.save();
    ctx.beginPath(); ctx.rect(this.x, this.y, this.w, this.h); ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = this.p < 0.8 ? 1 : (1 - this.p) / 0.2;
    ctx.strokeStyle = this.color || "#ffffff";
    ctx.shadowColor = this.color || "#ffffff"; ctx.shadowBlur = 10;
    ctx.lineWidth = 2.2; ctx.lineJoin = "miter";
    for (const pts of this.lines) {
      const upto = Math.max(1, Math.floor(grow * (pts.length - 1)));
      ctx.beginPath(); ctx.moveTo(o.x + pts[0].x, o.y + pts[0].y);
      for (let k = 1; k <= upto; k++) ctx.lineTo(o.x + pts[k].x, o.y + pts[k].y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
