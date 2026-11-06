// The battlefield renderer: a tilted tabletop board with cards lying in their zones and living monster
// figures standing on their cards. Owns the frame loop, camera, tweens, layering and hit-testing.
// It never decides outcomes; sync(view) makes the picture match the authoritative state.
import { Actor } from "./actor.js";
import { Environment } from "./env.js";
import { Particles } from "./fx.js";
import { cardCanvas, cardBack } from "./cardart.js";
import { card as cardData } from "../carddb.js";
import {
  W, H, CARD_W, CARD_H, TILE_W, TILE_H, FORE, Z, proj,
  monsterZone, stZone, fieldZone, gyZone, deckZone, extraZone, sideCenter, duelistPoint, unproj,
} from "./board.js";

export { W, H };
const EASE = {
  linear: (p) => p,
  out: (p) => 1 - Math.pow(1 - p, 3),
  in: (p) => p * p * p,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  back: (p) => { const c = 1.7; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
};
const HL = { target: "#ff5a6a", selected: "#ffe58a", actionable: "#6dffa8", zone: "#6dd8ff", hint: "#7ae8ff" };
// Render-scale steps for the frame-rate governor: slower machines trade a little sharpness for smooth motion.
const PERF_SCALE = [1, 0.8, 0.66, 0.55];

// A soft glowing outline from three stacked strokes: looks like a blur glow at a fraction of the cost.
function glowStroke(ctx, path, color, width = 3, pulse = 1) {
  const base = ctx.globalAlpha;
  ctx.strokeStyle = color;
  for (const [a, k] of [[0.14 * pulse, 5], [0.3 * pulse, 2.6], [1, 1]]) {
    ctx.globalAlpha = base * a; ctx.lineWidth = width * k; path(); ctx.stroke();
  }
  ctx.globalAlpha = base;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.env = new Environment();
    this.particles = new Particles();
    this.effects = [];
    this.tweens = [];
    this.actors = new Map();
    this.view = null;
    this.time = 0;
    this.speed = 1;
    this.boost = 1;
    this.quality = "high";
    this.cameraMotion = true;
    this.figures = "always";
    this.cam = { x: W / 2, y: H / 2, z: 1, sx: 0, sy: 0 };
    this.shakeAmt = 0;
    this.dim = { a: 0, color: "#000" };
    this.flashFx = { a: 0, color: "#fff" };
    this.highlights = new Map();
    this.zoneHighlights = [];
    this.onClick = null;
    this.onHover = null;
    this.active = false;
    this.baseEnv = "meadow";  // the arena chosen in the room; Field Spells override it
    this.impacts = [];        // scars from real impacts, in absolute board space
    this.perfLevel = 0;       // 0 = full quality; raised automatically when frames run slow
    this.perfFloor = 0;       // the user's Low quality setting starts higher
    this.perfWindow = { t: 0, frames: 0, slow: 0, fast: 0 };
    this.noBlur = false;
    // shadowBlur is the most expensive canvas feature: one switch turns it off everywhere when frames run slow.
    const proto = CanvasRenderingContext2D.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "shadowBlur");
    const self = this;
    if (desc && desc.set) {
      Object.defineProperty(this.ctx, "shadowBlur", {
        get() { return desc.get.call(this); },
        set(v) { desc.set.call(this, self.noBlur ? 0 : v); },
      });
    }
    this.resize();
    addEventListener("resize", () => this.resize());
    canvas.addEventListener("pointerdown", (e) => this.pointer(e, "click"));
    canvas.addEventListener("pointermove", (e) => this.pointer(e, "move"));
    this.last = performance.now();
    const loop = () => {
      const now = performance.now();
      const raw = Math.max(0, now - this.last) / 1000;
      // Cap at 0.1s so low frame rates keep real-time pacing without huge jumps.
      this.frame(Math.min(0.1, raw));
      this.last = now;
      this.govern(raw);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // Background tabs may get no animation frames (hidden or merely occluded); keep sequences moving
    // so the duel state never stalls behind an animation nobody can see.
    setInterval(() => {
      const now = performance.now();
      if (now - this.last > 250) { this.step(Math.min(0.5, (now - this.last) / 1000)); this.last = now; }
    }, 100);
  }

  // Watch real frame times; step render quality down when the machine can't keep up, back up when it can.
  govern(raw) {
    if (document.hidden || raw > 0.5 || !this.active) return;
    const w = this.perfWindow;
    w.t += raw; w.frames++;
    if (w.t < 1) return;
    const avg = (w.t / w.frames) * 1000;
    w.t = 0; w.frames = 0;
    if (avg > 26) { w.slow++; w.fast = 0; } else if (avg < 14) { w.fast++; w.slow = 0; } else { w.slow = 0; w.fast = 0; }
    if (w.slow >= 2 && this.perfLevel < PERF_SCALE.length - 1) { this.setPerf(this.perfLevel + 1); w.slow = 0; }
    else if (w.fast >= 6 && this.perfLevel > this.perfFloor) { this.setPerf(this.perfLevel - 1); w.fast = 0; }
  }

  setPerf(level) {
    this.perfLevel = Math.max(this.perfFloor, Math.min(PERF_SCALE.length - 1, level));
    this.noBlur = this.perfLevel >= 1;
    this.particles.max = [1600, 1000, 600, 380][this.perfLevel];
    this.env.surroundFps = this.perfLevel >= 2 ? 15 : 30;
    this.resize();
  }

  // ---------------------------------------------------------------- layout
  resize() {
    const dpr = Math.max(0.75, Math.min(2, window.devicePixelRatio || 1) * PERF_SCALE[this.perfLevel || 0]);
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.fit = Math.max(0.05, Math.min(w / W, h / H));
    this.ox = (w - W * this.fit) / 2;
    this.oy = (h - H * this.fit) / 2;
    this.dpr = dpr;
    const ui = document.getElementById("ui");
    if (ui) ui.style.transform = `translate(${this.ox}px, ${this.oy}px) scale(${this.fit})`;
  }
  get pixelRatio() { return this.dpr * this.fit * this.cam.z; }
  visibleRect() {
    return { x0: -this.ox / this.fit - 20, y0: -this.oy / this.fit - 20, x1: W + this.ox / this.fit + 20, y1: H + this.oy / this.fit + 20 };
  }
  sideOf(player) { return this.view && player === this.view.you ? 0 : 1; }
  // Feet point of a monster standing on its zone card.
  slotPos(side, slot) { const z = monsterZone(side, slot); return { x: z.x, y: z.y + CARD_H * z.s * FORE * 0.22, s: z.s }; }
  zonePos(side, slot) { return monsterZone(side, slot); }
  stPos(side, slot) { return stZone(side, slot); }
  fieldPos(side) { return fieldZone(side); }
  pilePos(side, which) { return which === "gy" ? gyZone(side) : which === "deck" ? deckZone(side) : extraZone(side); }
  sideCenter(side) { return sideCenter(side); }
  duelistPoint(side) { return duelistPoint(side); }
  boardCenter() { return proj(0, Z.mid); }
  figScale(s) { return 0.5 * s; }
  handPos(player) { return this.sideOf(player) === 0 ? { x: W / 2, y: H + 40 } : { x: W / 2, y: -50 }; }

  // ------------------------------------------------------------ time/tween
  wait(sec) { return this.tween({}, {}, sec); }
  tween(obj, to, dur, ease = "out") {
    return new Promise((resolve) => {
      const from = {};
      for (const k in to) from[k] = obj[k];
      this.tweens.push({ obj, from, to, dur: Math.max(0.0001, dur), t: 0, ease: EASE[ease] || EASE.out, resolve });
    });
  }
  add(effect) { this.effects.push(effect); return effect; }
  async focus(x, y, z, dur = 0.5) {
    if (!this.cameraMotion) z = 1 + (z - 1) * 0.25;
    // Pull partway toward the subject so both halves of the board stay readable.
    const pull = Math.min(0.7, (z - 1) * 2.5);
    await this.tween(this.cam, { x: W / 2 + (x - W / 2) * pull, y: H / 2 + (y - H / 2) * pull, z }, dur, "inOut");
  }
  resetCamera(dur = 0.5) { return this.tween(this.cam, { x: W / 2, y: H / 2, z: 1 }, dur, "inOut"); }
  shake(amt = 10) { this.shakeAmt = Math.max(this.shakeAmt, this.cameraMotion ? amt : amt * 0.3); }
  flash(color = "#fff", a = 0.7, dur = 0.35) {
    this.flashFx.color = color; this.flashFx.a = a;
    this.tween(this.flashFx, { a: 0 }, dur, "out");
  }
  setDim(a, dur = 0.4, color = "#000") { this.dim.color = color; return this.tween(this.dim, { a }, dur, "inOut"); }

  // -------------------------------------------------------------- the view
  sync(view) {
    this.view = view;
    const seen = new Set();
    view.players.forEach((pl, p) => {
      const side = this.sideOf(p);
      pl.monsters.forEach((m, slot) => {
        if (!m || !m.cid || !m.face_up) return;
        seen.add(m.iid);
        let a = this.actors.get(m.iid);
        if (!a || a.cid !== m.cid) {
          a = new Actor(this, m.iid, m.cid, side, slot);
          this.actors.set(m.iid, a);
        } else if (a.slot !== slot || a.side !== side) a.moveToSlot(side, slot);
        a.position = m.position;
        a.stats = { atk: m.atk, defense: m.defense };
      });
    });
    for (const [iid, a] of this.actors) if (!seen.has(iid) && !a.keep) this.actors.delete(iid);
    if (!this.env.prev && this.env.current !== (view.env || this.baseEnv)) this.env.set(view.env || this.baseEnv);
    this.env.setDamage(this.wear(view), this.impacts, view.you === 1);
  }

  // How battle-worn the field is, derived only from authoritative state so both players agree.
  wear(view) {
    const start = view.profile === "frontier" ? 3000 : 4000;
    const lost = view.players.reduce((n, p) => n + Math.max(0, start - p.lp), 0) / (2 * start);
    const graves = view.players.reduce((n, p) => n + p.gy.length, 0) / 30;
    return Math.max(0, Math.min(1, lost * 1.1 + graves * 0.5 + (view.turn || 0) * 0.012));
  }

  // Leave a scar where something actually hit the field.
  addImpact(x, y, kind = "impact", size = 1) {
    const b = unproj(x, y);
    if (b.z < 0 || b.z > 1) return;
    const flip = this.view && this.view.you === 1;
    this.impacts.push({ x: flip ? -b.x : b.x, z: flip ? 1 - b.z : b.z, kind, size, seed: (Math.random() * 1e9) | 0 });
    if (this.impacts.length > 40) this.impacts.shift();
    if (this.view) this.env.setDamage(this.wear(this.view), this.impacts, this.view.you === 1);
  }

  actor(iid) { return this.actors.get(iid); }

  cardPos(iid, view = this.view) {
    if (!view) return this.boardCenter();
    for (let p = 0; p < 2; p++) {
      const pl = view.players[p], side = this.sideOf(p);
      const mi = pl.monsters.findIndex((m) => m && m.iid === iid);
      if (mi >= 0) return monsterZone(side, mi);
      const si = pl.st.findIndex((c) => c && c.iid === iid);
      if (si >= 0) return stZone(side, si);
      if (pl.field && pl.field.iid === iid) return fieldZone(side);
      if (pl.gy.some((c) => c.iid === iid)) return gyZone(side);
    }
    return this.boardCenter();
  }

  // ------------------------------------------------------------------ input
  toLogical(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left - this.ox) / this.fit, sy = (e.clientY - r.top - this.oy) / this.fit;
    const c = this.cam;
    return { x: (sx - W / 2) / c.z + c.x, y: (sy - H / 2) / c.z + c.y };
  }
  inTile(pt, z) {
    return Math.abs(pt.x - z.x) <= (TILE_W * z.s) / 2 && Math.abs(pt.y - z.y) <= (TILE_H * z.s * FORE) / 2;
  }
  hitTest(pt) {
    if (!this.view) return null;
    const list = [...this.actors.values()].filter((a) => !a.hidden && a.visibility > 0.5).sort((a, b) => b.home.y - a.home.y);
    for (const a of list) {
      const b = a.bounds();
      if (pt.x >= b.x0 && pt.x <= b.x1 && pt.y >= b.y0 && pt.y <= b.y1) return { kind: "monster", iid: a.iid };
    }
    for (let p = 0; p < 2; p++) {
      const pl = this.view.players[p], side = this.sideOf(p);
      for (let slot = 0; slot < 5; slot++) {
        const m = pl.monsters[slot];
        if (this.inTile(pt, monsterZone(side, slot))) return m ? { kind: "monster", iid: m.iid } : { kind: "zone", side, slot };
        const c = pl.st[slot];
        if (c && this.inTile(pt, stZone(side, slot))) return { kind: "st", iid: c.iid };
      }
      if (pl.field && this.inTile(pt, fieldZone(side))) return { kind: "field", iid: pl.field.iid };
      if (this.inTile(pt, gyZone(side))) return { kind: "gy", player: p };
    }
    return null;
  }
  pointer(e, type) {
    if (!this.active) return;
    const hit = this.hitTest(this.toLogical(e));
    if (type === "click") { if (this.onClick) this.onClick(hit, e); return; }
    const key = hit ? hit.iid || hit.kind + (hit.player ?? hit.slot) : null;
    if (key !== this.hoverKey) { this.hoverKey = key; if (this.onHover) this.onHover(hit); }
    this.canvas.style.cursor = hit && hit.kind !== "zone" ? "pointer" : "default";
  }

  // ------------------------------------------------------------------ frame
  step(rawDt) {
    const dt = rawDt * this.speed * this.boost;
    this.time += dt;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.dur), k = tw.ease(p);
      for (const key in tw.to) tw.obj[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * k;
      if (p >= 1) { this.tweens.splice(i, 1); tw.resolve(); }
    }
    for (const a of this.actors.values()) a.update(dt);
    for (const e of this.effects) e.update(dt);
    this.effects = this.effects.filter((e) => !e.done);
    this.particles.update(dt);
    this.env.update(rawDt, this.particles);
    this.shakeAmt *= Math.pow(0.02, rawDt);
    this.cam.sx = (Math.random() - 0.5) * this.shakeAmt;
    this.cam.sy = (Math.random() - 0.5) * this.shakeAmt;
  }

  frame(rawDt) {
    this.step(rawDt);
    try { this.render(); } catch (err) { if (!this.renderErr) { this.renderErr = true; console.error(err); } }
  }

  render() {
    const ctx = this.ctx;
    const k = this.dpr * this.fit;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#05060f";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, this.ox * this.dpr, this.oy * this.dpr);
    const c = this.cam;
    ctx.translate(W / 2 + c.sx, H / 2 + c.sy);
    ctx.scale(c.z, c.z);
    ctx.translate(-c.x, -c.y);
    this.env.draw(ctx, this.visibleRect(), this.time, k, this.active);
    if (this.active && this.view) {
      this.drawTurnWall(ctx);
      this.drawZoneHighlights(ctx);
      this.drawCards(ctx);
      const actors = [...this.actors.values()].sort((a, b) => a.home.y - b.home.y);
      for (const a of actors) { a.highlight = this.highlights.get(a.iid) || null; a.draw(ctx, this.pixelRatio); }
      this.drawLocks(ctx);
    }
    if (this.dim.a > 0.001) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = this.dim.a; ctx.fillStyle = this.dim.color;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
    }
    for (const e of this.effects) if (!e.top) e.draw(ctx);
    this.particles.draw(ctx);
    for (const e of this.effects) if (e.top) e.draw(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.flashFx.a > 0.001) {
      ctx.globalAlpha = this.flashFx.a; ctx.fillStyle = this.flashFx.color;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); ctx.globalAlpha = 1;
    }
    const g = ctx.createRadialGradient(this.canvas.width / 2, this.canvas.height / 2, this.canvas.height * 0.4, this.canvas.width / 2, this.canvas.height / 2, this.canvas.height * 1.0);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // A shimmering energy wall along the active player's back edge.
  drawTurnWall(ctx) {
    if (this.view.active === null || this.view.winner !== null) return;
    const mine = this.view.active === this.view.you;
    const z0 = mine ? 0.0 : 1.0, dz = mine ? 0.06 : -0.05;
    const col = mine ? [90, 190, 255] : [255, 90, 120];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const n = 46;
    for (let i = 0; i < n; i++) {
      const x = -580 + (1160 * (i + 0.5)) / n;
      const flick = 0.5 + 0.5 * Math.sin(this.time * 3 + i * 1.7);
      const a = proj(x, z0), b = proj(x, z0 + dz * (0.6 + flick * 0.6));
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y - 30 * a.s);
      g.addColorStop(0, `rgba(${col},${0.55})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.strokeStyle = g; ctx.lineWidth = 9 * a.s;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y - 30 * a.s); ctx.stroke();
    }
    const L = proj(-590, z0), R = proj(590, z0);
    glowStroke(ctx, () => { ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(R.x, R.y); }, `rgba(${col},0.85)`, 3);
    ctx.restore();
  }

  drawZoneHighlights(ctx) {
    for (const zh of this.zoneHighlights) {
      const z = zh.kind === "st" ? stZone(zh.side, zh.slot) : monsterZone(zh.side, zh.slot);
      this.tileGlow(ctx, z, zh.color || HL.zone);
    }
  }
  tileGlow(ctx, z, color) {
    const w = TILE_W * z.s, h = TILE_H * z.s * FORE;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.75 + Math.sin(this.time * 5) * 0.2;
    glowStroke(ctx, () => { ctx.beginPath(); ctx.roundRect(z.x - w / 2 + 3, z.y - h / 2 + 3, w - 6, h - 6, 10 * z.s); }, color, 3);
    ctx.restore();
  }

  // A card lying on the board, foreshortened; rotated for Defense Position.
  boardCard(ctx, z, cid, faceUp, rotated, highlight, lift = 0, setTag = false) {
    const img = faceUp && cid ? cardCanvas(cid) : cardBack();
    const w = CARD_W * z.s, h = CARD_H * z.s;
    ctx.save();
    ctx.translate(z.x, z.y - lift);
    ctx.fillStyle = "rgba(0,0,0,.4)";
    ctx.save(); ctx.scale(1, FORE); if (rotated) ctx.rotate(Math.PI / 2);
    ctx.fillRect(-w / 2 + 3, -h / 2 + 6, w, h);
    ctx.restore();
    ctx.scale(1, FORE);
    if (rotated) ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    if (setTag) {
      // Face-down but yours: the face stays readable under a dark veil with a SET ribbon.
      ctx.fillStyle = "rgba(8,14,40,.42)"; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = "rgba(160,190,255,.8)"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4); ctx.setLineDash([]);
      const bh = 22 * (w / 80);
      ctx.fillStyle = "rgba(20,30,70,.9)"; ctx.fillRect(-w / 2, -bh / 2, w, bh);
      ctx.fillStyle = "#cfe0ff"; ctx.font = `900 ${Math.round(bh * 0.62)}px 'Nunito Sans', system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("SET", 0, 1);
    }
    if (highlight) {
      // Pulsing outline glow drawn as strokes (blurring the whole card image every frame was the costly part).
      const pulse = 0.8 + Math.sin(this.time * 6) * 0.2;
      ctx.globalAlpha = 1;
      glowStroke(ctx, () => { ctx.beginPath(); ctx.rect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4); }, HL[highlight] || highlight, 3, pulse);
    }
    ctx.restore();
  }

  statLabel(ctx, z, m, side) {
    const d = cardData(m.cid);
    if (!d || m.atk === undefined) return;
    const y = z.y + (CARD_H * z.s * FORE) / 2 + 14 * z.s;
    const color = (v, b) => (v > b ? "#6dffa8" : v < b ? "#ff8a8a" : "#ffffff");
    ctx.save();
    ctx.font = `900 ${Math.round(19 * z.s)}px 'Nunito Sans', system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.85)";
    const def = m.position === "def";
    const a = `${m.atk}`, sep = "/", b = `${m.defense}`;
    const wa = ctx.measureText(a).width, ws = ctx.measureText(sep).width;
    ctx.font = `800 ${Math.round(15 * z.s)}px 'Nunito Sans', system-ui, sans-serif`;
    const wb = ctx.measureText(b).width;
    let x = z.x - (wa + ws + wb) / 2;
    ctx.font = `800 ${Math.round((def ? 15 : 19) * z.s)}px 'Nunito Sans', system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.strokeText(a, x, y); ctx.fillStyle = color(m.atk, d.atk); ctx.globalAlpha = def ? 0.7 : 1; ctx.fillText(a, x, y);
    x += ctx.measureText(a).width;
    ctx.globalAlpha = 0.8; ctx.strokeText(sep, x, y); ctx.fillStyle = "#fff"; ctx.fillText(sep, x, y);
    x += ws;
    ctx.font = `800 ${Math.round((def ? 19 : 15) * z.s)}px 'Nunito Sans', system-ui, sans-serif`;
    ctx.globalAlpha = def ? 1 : 0.75; ctx.strokeText(b, x, y); ctx.fillStyle = color(m.defense, d.def); ctx.fillText(b, x, y);
    ctx.restore();
    // level badge on the card's corner
    const bx = z.x + (CARD_W * z.s) / 2 - 4 * z.s, by = z.y + (CARD_H * z.s * FORE) / 2 - 10 * z.s;
    ctx.save();
    ctx.fillStyle = "rgba(10,10,20,.85)"; ctx.beginPath(); ctx.arc(bx, by, 11 * z.s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#f4cf6a"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "#ffd75a"; ctx.font = `900 ${Math.round(11 * z.s)}px 'Nunito Sans', system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`★${d.level}`, bx, by + 0.5);
    ctx.restore();
  }

  pile(ctx, z, n, topCid, label) {
    for (let i = Math.min(4, n) - 1; i >= 0; i--) this.boardCard(ctx, z, i === 0 ? topCid : null, i === 0 && !!topCid, false, null, i * 2.2);
    if (n > 0) {
      ctx.save();
      ctx.font = `800 ${Math.round(12 * z.s)}px 'Nunito Sans', system-ui`; ctx.textAlign = "center";
      ctx.fillStyle = "rgba(8,10,24,.8)";
      const y = z.y + (CARD_H * z.s * FORE) / 2 + 12 * z.s;
      ctx.beginPath(); ctx.roundRect(z.x - 30 * z.s, y - 9 * z.s, 60 * z.s, 18 * z.s, 9 * z.s); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(`${label} ${n}`, z.x, y + 4 * z.s);
      ctx.restore();
    }
  }

  drawCards(ctx) {
    // Far side first so near cards overlap correctly.
    const order = [1, 0].map((side) => (side === 0 ? this.view.you : 1 - this.view.you));
    for (const p of order) {
      const pl = this.view.players[p], side = this.sideOf(p);
      this.pile(ctx, deckZone(side), pl.deck_count, null, "Deck");
      this.pile(ctx, extraZone(side), pl.extra_count, null, "Extra");
      const top = pl.gy[pl.gy.length - 1];
      this.pile(ctx, gyZone(side), pl.gy.length, top && top.cid, "Grave");
      if (pl.field) this.boardCard(ctx, fieldZone(side), pl.field.cid, true, false, this.highlights.get(pl.field.iid));
      pl.st.forEach((c, slot) => {
        if (!c) return;
        const z = stZone(side, slot);
        // Your own Set cards show their face (darkened, tagged SET); the opponent's stay hidden.
        const ownSet = !c.face_up && side === 0 && c.cid;
        this.boardCard(ctx, z, c.cid, c.face_up || !!ownSet, false, this.highlights.get(c.iid), 0, !!ownSet);
        if (c.counters && c.counters.turns_left) {
          ctx.save(); ctx.fillStyle = "#ffe58a"; ctx.font = `900 ${Math.round(16 * z.s)}px 'Nunito Sans'`; ctx.textAlign = "center";
          ctx.lineWidth = 4; ctx.strokeStyle = "#000"; ctx.strokeText(String(c.counters.turns_left), z.x + 30 * z.s, z.y - 30 * z.s);
          ctx.fillText(String(c.counters.turns_left), z.x + 30 * z.s, z.y - 30 * z.s); ctx.restore();
        }
      });
      pl.monsters.forEach((m, slot) => {
        if (!m) return;
        const z = monsterZone(side, slot);
        const a = this.actors.get(m.iid);
        if (a && (a.hidden || a.mat < 0.05)) return; // still materialising: the card arrives with the figure
        const faceUp = m.face_up && !!m.cid;
        const ownSet = !faceUp && side === 0 && !!m.cid;
        this.boardCard(ctx, z, m.cid, faceUp || ownSet, m.position === "def", this.highlights.get(m.iid), 0, ownSet);
        if (faceUp) this.statLabel(ctx, z, m, side);
      });
    }
  }

  // Lingering "cannot attack" effects (Veil of Halting Blades): swords planted before the locked side's monsters.
  drawLocks(ctx) {
    for (let p = 0; p < 2; p++) {
      const pl = this.view.players[p];
      const lock = pl.st.find((c) => c && c.face_up && c.cid && cardData(c.cid).effect.ops.some((o) => o.op === "lock_attacks"));
      if (!lock) continue;
      const lockedSide = this.sideOf(1 - p);
      const z = lockedSide === 0 ? Z.mon0 + 0.09 : Z.mon1 - 0.09;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 9; i++) {
        const pt = proj(-480 + i * 120, z);
        const bob = Math.sin(this.time * 2 + i) * 4;
        ctx.save();
        ctx.translate(pt.x, pt.y - 36 * pt.s + bob);
        ctx.scale(pt.s * 0.8, pt.s * 0.8);
        ctx.globalAlpha = 0.8;
        const g = ctx.createLinearGradient(0, -60, 0, 60);
        g.addColorStop(0, "#fffbe0"); g.addColorStop(1, "#e0a020");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(-5, -60); ctx.lineTo(5, -60); ctx.lineTo(4, 40); ctx.lineTo(0, 60); ctx.lineTo(-4, 40); ctx.closePath(); ctx.fill();
        ctx.fillRect(-14, -54, 28, 5);
        ctx.restore();
      }
      ctx.restore();
    }
  }
}
