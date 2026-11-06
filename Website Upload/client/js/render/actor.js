// A living monster on the field. It owns its animation state; the director drives its pose for
// summons, attacks, hits and destruction. Its slot and stats always come from the authoritative view.
import { card as cardData } from "../carddb.js";
import { RIGS, basePose } from "./rigs.js";
import { COL } from "./board.js";
import { SpriteRenderer, noise } from "./pixel.js";

const PIXEL = 2.6;        // logical px per sprite pixel at the near edge of the board (same for every monster)
const SPRITE_FPS = 15;    // poses advance frame-by-frame, like hand-animated sprites

const AURA = {
  light: { color: ["#fff6cf", "#bfe6ff"], rate: 5, vy: -30 },
  dark: { color: ["#b45cff", "#5a1a8a"], rate: 6, vy: -24, kind: "smoke", additive: false },
  fire: { color: ["#ffb347", "#ff5a1a"], rate: 9, vy: -60 },
  water: { color: ["#bff4ff", "#58d0ff"], rate: 4, vy: -30, kind: "bubble", additive: false },
  wind: { color: ["#d8fff4", "#7ef0d8"], rate: 5, vy: -10, vx: 60 },
  earth: { color: ["#d5ff9a", "#a08050"], rate: 3, vy: -14 },
};

export class Actor {
  constructor(stage, iid, cid, side, slot) {
    this.stage = stage;
    this.iid = iid;
    this.cid = cid;
    this.card = cardData(cid);
    const v = this.card.visual;
    this.rig = RIGS[v.rig];
    this.pal = v.palette;
    this.variant = v.variant;
    this.side = side;
    this.slot = slot;
    this.facing = side === 0 ? 1 : -1;
    this.home = stage.slotPos(side, slot);
    this.offset = { x: 0, y: 0 };
    this.pose = basePose(Math.random() * 10);
    this.alpha = 1;
    this.mat = 1;         // materialisation 0..1 (0 = pure light silhouette)
    this.flash = 0;       // white hit flash
    this.dissolve = 0;    // destruction progress
    this.lift = 0;        // vertical offset (summons rising, destruction)
    this.grow = 1;        // extra scale multiplier for entrances
    this.position = "atk";
    this.stats = null;
    this.highlight = null;
    this.anchors = null;
    this.hidden = false;
    this.engaged = false;   // in "figures during actions" mode, only engaged figures show
    this.visibility = stage.figures === "always" ? 1 : 0;
    this.sprite = new SpriteRenderer(v);
    this.frame = null;
    this.frameT = -1;
    this.drawK = null;
    this.tint = document.createElement("canvas");
    this.tctx = this.tint.getContext("2d", { willReadFrequently: true });
    this.auraTimer = 0;
  }

  // Figures stand on their card: height is clamped to a readable range and width to the zone.
  get scale() {
    const s = this.home.s, vs = this.card.visual.scale || 1;
    let k = vs * this.stage.figScale(s);
    const h = this.rig.height * k, minH = 100 * s, maxH = 150 * s * vs;
    if (h < minH) k = minH / this.rig.height;
    if (h > maxH) k = maxH / this.rig.height;
    return Math.min(k, (1.45 * COL * s) / this.rig.width);
  }
  // Centre the rig's visual mass (not its origin) over the card.
  get x() { return this.home.x + this.offset.x - this.rig.artBox.cx * this.scale * this.grow * this.facing; }
  get y() { return this.home.y + this.offset.y - this.lift; }

  moveToSlot(side, slot) {
    this.side = side; this.slot = slot; this.facing = side === 0 ? 1 : -1;
    this.home = this.stage.slotPos(side, slot);
  }

  update(dt) {
    this.pose.t += dt;
    const want = this.stage.figures === "always" || this.engaged ? 1 : 0;
    this.visibility += (want - this.visibility) * Math.min(1, dt * 5);
    this.flash = Math.max(0, this.flash - dt * 3);
    const wantCrouch = this.position === "def" ? 1 : 0;
    this.pose.crouch += (wantCrouch - this.pose.crouch) * Math.min(1, dt * 6);
    this.pose.recoil = Math.max(0, this.pose.recoil - dt * 2.2);
    // Elemental aura: subtle, and quieter in low quality.
    const aura = AURA[this.card.visual.aura];
    if (aura && !this.hidden && this.dissolve === 0 && this.mat > 0.9) {
      this.auraTimer += dt * aura.rate * (this.stage.quality === "low" ? 0.3 : 1);
      while (this.auraTimer > 1) {
        this.auraTimer -= 1;
        const w = this.rig.width * this.scale * 0.4, h = this.rig.height * this.scale;
        this.stage.particles.spawn({
          x: this.x + (Math.random() - 0.5) * w * 2, y: this.y - Math.random() * h * 0.8,
          vx: (aura.vx || 0) * this.facing * Math.random() + (Math.random() - 0.5) * 16, vy: aura.vy * (0.5 + Math.random()),
          life: 1.2 + Math.random(), size: aura.kind === "smoke" ? 6 : 2 + Math.random() * 2, grow: aura.kind === "smoke" ? 8 : 0,
          color: aura.color[(Math.random() * aura.color.length) | 0], kind: aura.kind || "glow", additive: aura.additive ?? true, drag: 0.99,
        });
      }
    }
  }

  // World-space anchor (e.g. "attack" = mouth / staff tip / blade).
  anchor(name = "attack") {
    const a = (this.anchors && this.anchors[name]) || { x: 0, y: -this.rig.height * 0.5 };
    const s = (this.drawK || this.scale) * this.grow;
    return { x: this.x + a.x * s * this.facing, y: this.y + a.y * s };
  }
  center() { return this.anchor("center"); }

  bounds() {
    const s = this.scale * this.grow;
    const w = this.rig.width * s, h = this.rig.height * s;
    return { x0: this.x - w * 0.55, x1: this.x + w * 0.55, y0: this.y - h, y1: this.y + 14 };
  }

  // Re-render the pixel sprite at the sprite frame rate, or when its pixel grid changes.
  spriteFrame() {
    const L = PIXEL * this.home.s;
    const R = L / this.scale;
    const stale = !this.frame || Math.abs(this.frame.R - R) / R > 0.02 || this.pose.t - this.frameT >= 1 / SPRITE_FPS || this.pose.t < this.frameT;
    if (stale) {
      this.frame = this.sprite.render(this.pose, R);
      this.frameT = this.pose.t;
      this.anchors = this.frame.anchors;
    }
    return this.frame;
  }

  // Hit flashes, materialisation and the pixel dissolve are applied on a copy of the sprite.
  shaded(f) {
    const white = Math.max(this.flash, 1 - this.mat);
    if (white <= 0.01 && this.dissolve <= 0) return f.canvas;
    const t = this.tint, c = this.tctx;
    if (t.width !== f.w || t.height !== f.h) { t.width = f.w; t.height = f.h; }
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, f.w, f.h);
    c.drawImage(f.canvas, 0, 0);
    if (white > 0.01) {
      c.globalCompositeOperation = "source-atop";
      c.fillStyle = `rgba(255,255,255,${Math.round(Math.min(1, white) * 4) / 4})`; // stepped, like palette swaps
      c.fillRect(0, 0, f.w, f.h);
      c.globalCompositeOperation = "source-over";
    }
    if (this.dissolve > 0) {
      const img = c.getImageData(0, 0, f.w, f.h), d = img.data;
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
        // Dissolve from the top down, pixel by pixel.
        if (noise(x, y) * 0.7 + (y / f.h) * 0.3 < this.dissolve * 1.05) d[(y * f.w + x) * 4 + 3] = 0;
      }
      c.putImageData(img, 0, 0);
    }
    return t;
  }

  // The monster exactly as it is drawn right now, for effects that break it apart.
  snapshot() {
    const f = this.spriteFrame();
    const Ld = this.lastLd || PIXEL * this.home.s;
    const cv = document.createElement("canvas");
    cv.width = f.w; cv.height = f.h;
    const c = cv.getContext("2d");
    if (this.facing < 0) { c.translate(f.w, 0); c.scale(-1, 1); }
    c.drawImage(this.shaded(f), 0, 0);
    const w = f.w * Ld, h = f.h * Ld;
    const x = this.facing > 0 ? this.x - f.ox * Ld : this.x + f.ox * Ld - w;
    return { img: cv, x, y: this.y - f.oy * Ld, w, h };
  }

  draw(ctx, pr) {
    if (this.hidden || this.alpha * this.visibility <= 0.001) return;
    const f = this.spriteFrame();
    // Snap each sprite pixel to a whole number of device pixels so the art stays crisp.
    const L = PIXEL * this.home.s;
    const dev = Math.max(1, Math.round(L * pr));
    const Ld = (dev / pr) * this.grow;
    this.drawK = Ld / this.grow / f.R;
    const s = this.drawK * this.grow;
    const img = this.shaded(f);
    this.lastLd = Ld;

    // shadow on the floor
    ctx.save();
    ctx.globalAlpha = this.alpha * this.visibility * 0.45 * (1 - this.dissolve) * Math.min(1, this.mat * 2);
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(this.home.x + this.offset.x, this.home.y + this.offset.y + 4, this.rig.width * s * 0.42, 14 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = this.alpha * this.visibility;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(this.x * pr) / pr, Math.round(this.y * pr) / pr);
    ctx.scale(this.facing, 1);
    if (this.highlight) {
      ctx.shadowColor = { target: "#ff6a6a", selected: "#ffe58a", hint: "#7ae8ff" }[this.highlight] || "#6dffa8";
      ctx.shadowBlur = 22 + Math.sin(this.pose.t * 6) * 6;
    }
    ctx.drawImage(img, -f.ox * Ld, -f.oy * Ld, f.w * Ld, f.h * Ld);
    ctx.restore();

    if (this.position === "def" && this.mat > 0.9 && this.dissolve === 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.16 + Math.sin(this.pose.t * 3) * 0.05;
      ctx.fillStyle = "#6ab8ff";
      ctx.beginPath();
      ctx.ellipse(this.x + this.facing * this.rig.width * s * 0.35, this.y - this.rig.height * s * 0.45, 22 * s, this.rig.height * s * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
