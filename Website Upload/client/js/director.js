// The director turns authoritative events into cinematic sequences. Every handler ends by applying the
// event's state snapshot, so whatever the animation shows, the field always lands on the server's truth.
import { card as cardData } from "./carddb.js";
import { audio } from "./audio.js";
import { cardCanvas, cardBack, CARD_W, CARD_H } from "./render/cardart.js";
import {
  MagicCircle, Pillar, Portal, Beam, Bolt, Projectile, Ring, Slash, Dome, Cylinder, Sinkhole, Vortex, TextPop, CardFlash,
  Shatter, Cracks,
} from "./render/fx.js";
import { W } from "./render/stage.js";
import { proj, Z } from "./render/board.js";

const MONSTER_VOICE = { dragon: "roar", sorcerer: "chime", knight: "slash", bird: "screech", golem: "rumble", serpent: "hiss", imp: "cackle", fairy: "chime" };
const SUMMON_COLORS = {
  grand_portal: ["#bfe6ff", "#ffffff"], arcane_circle: ["#c77dff", "#ff5cf0"], light_pillar: ["#fff3c4", "#ffffff"],
  wind_swirl: ["#bff7ef", "#3fb6a8"], earth_rise: ["#d5ff9a", "#a08050"], flame_burst: ["#ffb347", "#ff3b1a"],
  shadow_pool: ["#b45cff", "#2a0a40"], water_spout: ["#bff4ff", "#2f6fb3"], fusion_vortex: ["#ff9bf0", "#7af0ff"],
};

export class Director {
  constructor(stage, ui) {
    this.stage = stage;
    this.ui = ui;
    this.queue = [];
    this.busy = false;
    this.spellFx = null;
  }

  push(msg) {
    this.queue.push(msg);
    if (!this.busy) this.run();
  }

  async run() {
    this.busy = true;
    this.ui.setBusy(true);
    for (;;) {
      if (!this.queue.length) {
        // A follow-up move (an AI action, an opponent's chain) often arrives a moment later: hold the camera
        // briefly instead of snapping back and zooming in again.
        const mine = this.ui.view && this.ui.decider === this.ui.view.you;
        if (!mine && this.stage.cam.z > 1.001) await this.wait(0.35);
        if (!this.queue.length) break;
      }
      const msg = this.queue.shift();
      for (const ev of msg.events || []) {
        try { this.ui.logEvent(ev); } catch (err) { console.error(err); }
        // Catch up instantly when the tab is hidden or far behind; never drop state.
        const instant = document.hidden || this.queue.length > 4;
        try {
          if (instant || !this[ev.type]) this.apply(ev.view);
          else await this[ev.type](ev);
        } catch (err) {
          console.error("animation failed for", ev.type, err);
          this.safeApply(ev.view);
        }
      }
      this.safeApply(msg.view);
      this.stage.highlights.clear();
      try { this.ui.update(msg.view, msg.actions, msg.decider, msg.hint); } catch (err) { console.error(err); }
    }
    this.stage.boost = 1;
    if (this.stage.dim.a > 0.001) this.stage.setDim(0, 0.3);
    for (const a of this.stage.actors.values()) a.engaged = false;
    this.busy = false;
    this.ui.setBusy(false);
    this.stage.resetCamera(0.4);
  }

  apply(view) {
    if (!view) return;
    this.stage.sync(view);
    this.ui.updateView(view);
  }

  safeApply(view) {
    try { this.apply(view); } catch (err) { console.error("apply failed", err); }
  }

  // ------------------------------------------------------------- helpers
  side(player) { return this.stage.sideOf(player); }
  wait(s) { return this.stage.wait(s); }
  pointOf(iid, view) {
    const a = this.stage.actor(iid);
    if (a) return a.center();
    return this.stage.cardPos(iid, view);
  }
  sideCenter(side) { return this.stage.sideCenter(side); }
  lpPoint(player) { return this.side(player) === 0 ? { x: 200, y: 790 } : { x: W - 200, y: 130 }; }
  // Where spell/trap cards are shown big when they activate: over the activating player's half.
  flashPos(side) { return { x: side === 0 ? 560 : W - 560, y: side === 0 ? 530 : 380 }; }
  // A horizontal barrier line just in front of a side's monster row.
  frontLine(side) { return proj(0, side === 0 ? Z.mon0 + 0.1 : Z.mon1 - 0.1); }
  engage(...iids) { for (const i of iids) { const a = i && this.stage.actor(i); if (a) a.engaged = true; } }
  popText(x, y, text, color, size = 40, life = 1.2) { this.stage.add(new TextPop({ x, y, text, color, size, life, top: true })); }
  burst(x, y, n, o) { this.stage.particles.burst(x, y, Math.round(n * (this.stage.quality === "low" ? 0.4 : 1)), o); }

  // ---------------------------------------------------------------- flow
  async DUEL_STARTED(ev) {
    this.apply(ev.view);
    this.stage.env.set(ev.view.env || this.stage.baseEnv);
    audio.startMusic();
    const you = ev.view.players[ev.view.you].name, opp = ev.view.players[1 - ev.view.you].name;
    this.ui.banner(`${you}  vs  ${opp}`, "Duel start", "#f4cf6a");
    audio.play("summon");
    await this.wait(1.5);
  }

  async CARD_DRAWN(ev) {
    this.apply(ev.view);
    audio.play("card_draw");
    await this.wait(ev.reason === "opening" ? 0.3 : 0.18);
  }

  async TURN_STARTED(ev) {
    this.apply(ev.view);
    const mine = this.side(ev.player) === 0;
    this.ui.banner(mine ? "Your Turn" : `${ev.view.players[ev.player].name}'s Turn`, `Turn ${ev.turn}`, mine ? "#5cc8ff" : "#ff6a8a");
    audio.play("turn");
    await this.wait(0.75);
  }

  async PHASE_CHANGED(ev) {
    this.apply(ev.view);
    if (ev.phase === "battle") {
      this.ui.banner("Battle Phase", "", "#ff9a5a", true);
      audio.play("phase");
      await this.wait(0.45);
    } else if (ev.phase === "draw" || ev.phase === "standby") {
      await this.wait(0.12);
    } else {
      audio.play("phase");
      await this.wait(0.2);
    }
  }

  async MONSTER_SET(ev) {
    this.apply(ev.view);
    const s = this.stage.slotPos(this.side(ev.player), ev.slot);
    audio.play("card_place");
    this.stage.add(new Ring({ x: s.x, y: s.y, r0: 20, r1: 90, color: "#cfd8ff", life: 0.5 }));
    this.burst(s.x, s.y, 14, { color: "#c8c0b0", speed: [30, 110], squash: 0.3, kind: "smoke", additive: false, size: [4, 8], grow: 10, life: [0.4, 0.8] });
    await this.wait(0.4);
  }

  async CARD_SET(ev) {
    this.apply(ev.view);
    audio.play("card_place");
    await this.wait(0.35);
  }

  async POSITION_CHANGED(ev) {
    this.apply(ev.view);
    audio.play("card_place");
    const a = this.stage.actor(ev.iid);
    if (a) this.popText(a.x, a.y - a.rig.height * a.scale - 10, ev.position === "def" ? "DEFENSE" : "ATTACK", ev.position === "def" ? "#6ab8ff" : "#ffb070", 22, 0.9);
    await this.wait(0.5);
  }

  async CARD_DISCARDED(ev) {
    this.apply(ev.view);
    audio.play("card_place");
    await this.wait(0.25);
  }

  async RESPONSE_PASSED(ev) {
    this.apply(ev.view);
    await this.wait(0.05);
  }

  // ------------------------------------------------------------ summoning
  async TRIBUTE_SUMMON_STARTED(ev) {
    const side = this.side(ev.player);
    const c = this.sideCenter(side);
    this.tributeTarget = c;
    this.ui.banner("Tribute Summon", cardData(ev.cid).name, "#f4cf6a", true);
    await this.stage.focus(c.x, c.y - 100, 1.08, 0.5);
    this.stage.add(new MagicCircle({ x: c.x, y: c.y, r: 220, color: "#f4cf6a", color2: "#fff", life: 2.4, points: 5 }));
    audio.play("charge", { dur: 1.2 });
    await this.wait(0.5);
    this.apply(ev.view);
  }

  async MONSTER_TRIBUTED(ev) {
    const a = this.stage.actor(ev.iid);
    const c = this.tributeTarget || this.sideCenter(this.side(ev.player));
    if (a) {
      a.keep = true; a.engaged = true;
      audio.play("whoosh");
      this.stage.tween(a, { mat: 0, lift: 60 }, 0.6, "inOut");
      for (let i = 0; i < 18; i++) {
        const from = a.center();
        setTimeout(() => this.stage.add(new Projectile({ from, to: { x: c.x, y: c.y - 80 }, life: 0.6, color: "#f4cf6a", size: 4, particles: this.stage.particles, trailRate: 0.3 })), i * 30);
      }
      await this.wait(0.6);
      await this.stage.tween(a, { alpha: 0 }, 0.25);
      a.keep = false;
    }
    this.apply(ev.view);
  }

  async MONSTER_SUMMONED(ev) {
    const c = cardData(ev.cid);
    const v = c.visual;
    const side = this.side(ev.player);
    const s = this.stage.slotPos(side, ev.slot);
    const big = c.level >= 7 || c.rarity === "ultra";
    const style = ev.method === "fusion" ? "fusion_vortex" : ev.method === "ascension" ? "grand_portal" : v.summon;
    const [c1, c2] = SUMMON_COLORS[style] || ["#ffffff", "#ffffff"];
    const top = { x: s.x, y: s.y - 240 * (v.scale || 1) * this.stage.figScale(s.s) * 0.55 };

    await this.stage.focus(s.x, s.y - 120, big ? 1.16 : 1.06, big ? 0.7 : 0.35);

    if (ev.method === "revive") {
      const gy = this.stage.cardPos(ev.iid, this.prevView || ev.view);
      this.stage.add(new MagicCircle({ x: s.x, y: s.y, r: 120, color: "#9effc4", life: 1.8 }));
      this.stage.add(new Projectile({ from: this.stage.pilePos(this.side(ev.from_player ?? ev.player), "gy"), to: top, life: 0.7, color: "#9effc4", size: 10, particles: this.stage.particles, arc: 120 }));
      audio.play("revive");
      await this.wait(0.7);
      this.stage.add(new Pillar({ x: s.x, y: s.y, w: 70, h: 700, color: "#9effc4", life: 1.1 }));
    } else if (style === "grand_portal") {
      await this.stage.setDim(0.45, 0.5, "#020414");
      this.stage.add(new MagicCircle({ x: s.x, y: s.y, r: 230, color: c1, color2: c2, life: 3.0, points: 8, spin: 0.8 }));
      this.stage.add(new Portal({ x: top.x, y: top.y - 40, r: 140, color: c1, color2: "#6fc3ff", life: 2.6 }));
      audio.play("summon_epic");
      for (let i = 0; i < 26; i++) setTimeout(() => this.burst(top.x + (Math.random() - 0.5) * 600, top.y + (Math.random() - 0.5) * 400, 1, { color: [c1, "#6fc3ff"], speed: [5, 20], life: [0.8, 1.4], size: [3, 6] }), i * 40);
      this.stage.shake(4);
      await this.wait(1.6);
      this.stage.add(new Pillar({ x: s.x, y: s.y, w: 120, h: 900, color: c1, life: 1.2 }));
      this.stage.flash("#ffffff", 0.75, 0.6);
      this.stage.shake(16);
    } else if (style === "arcane_circle") {
      this.stage.add(new MagicCircle({ x: s.x, y: s.y, r: 140, color: c1, color2: c2, life: 2.0, points: 7 }));
      this.stage.add(new MagicCircle({ x: s.x, y: s.y - 160, r: 70, color: c2, life: 1.6, squash: 1, spin: -2 }));
      audio.play("summon", { big: big ? 1 : 0 });
      for (let i = 0; i < 12; i++) setTimeout(() => this.burst(s.x + (Math.random() - 0.5) * 200, s.y, 3, { color: [c1, c2], angle: -Math.PI / 2, spread: 0.4, speed: [100, 260], life: [0.6, 1.1] }), i * 50);
      await this.wait(big ? 1.1 : 0.7);
      this.stage.flash(c1, 0.35, 0.4);
    } else if (style === "flame_burst") {
      audio.play("fire", { dur: 1.0 });
      this.stage.add(new MagicCircle({ x: s.x, y: s.y, r: 120, color: c1, life: 1.4 }));
      for (let i = 0; i < 10; i++) setTimeout(() => this.burst(s.x, s.y - 10, 16, { color: [c1, c2, "#fff0a0"], angle: -Math.PI / 2, spread: 0.9, speed: [120, 380], life: [0.4, 0.9], size: [4, 9], drag: 0.95 }), i * 50);
      await this.wait(0.7);
      this.stage.shake(8);
    } else if (style === "shadow_pool") {
      audio.play("summon");
      this.stage.add(new Sinkhole({ x: s.x, y: s.y, r: 90, color: c1, life: 1.4 }));
      for (let i = 0; i < 8; i++) setTimeout(() => this.burst(s.x, s.y, 6, { color: [c1, c2], kind: "smoke", additive: false, angle: -Math.PI / 2, spread: 0.8, speed: [40, 120], size: [8, 14], grow: 20 }), i * 60);
      await this.wait(0.7);
    } else if (style === "water_spout") {
      audio.play("water");
      this.stage.add(new Pillar({ x: s.x, y: s.y, w: 60, h: 400, color: c2, life: 1.0 }));
      for (let i = 0; i < 8; i++) setTimeout(() => this.burst(s.x, s.y - 20, 14, { color: [c1, c2, "#ffffff"], angle: -Math.PI / 2, spread: 0.7, speed: [150, 420], grav: 600, life: [0.6, 1.0], size: [3, 6] }), i * 50);
      await this.wait(0.65);
    } else if (style === "earth_rise") {
      audio.play("rumble");
      this.stage.shake(10);
      this.stage.add(new Ring({ x: s.x, y: s.y, r0: 20, r1: 160, color: c1, life: 0.8 }));
      for (let i = 0; i < 5; i++) setTimeout(() => this.burst(s.x, s.y, 10, { color: [c2, "#6b5a44"], kind: "shard", additive: false, angle: -Math.PI / 2, spread: 1.2, speed: [140, 340], grav: 700, size: [4, 9] }), i * 70);
      await this.wait(0.6);
    } else if (style === "wind_swirl") {
      audio.play("whoosh");
      for (let i = 0; i < 3; i++) this.stage.add(new Ring({ x: s.x, y: s.y - 60 - i * 50, r0: 100, r1: 20, color: c1, life: 0.7 + i * 0.1, squash: 0.3 }));
      this.burst(s.x, s.y - 80, 30, { color: [c1, c2], kind: "spark", speed: [100, 260], life: [0.3, 0.7] });
      await this.wait(0.6);
    } else if (style === "fusion_vortex") {
      this.stage.add(new Pillar({ x: s.x, y: s.y, w: 100, h: 800, color: c1, life: 1.2 }));
      this.stage.flash("#ffffff", 0.6, 0.5);
      this.stage.shake(12);
      await this.wait(0.3);
    } else {
      audio.play("summon");
      this.stage.add(new Pillar({ x: s.x, y: s.y, w: 50, h: 520, color: c1, life: 0.8 }));
      this.stage.add(new MagicCircle({ x: s.x, y: s.y, r: 90, color: c1, life: 1.0 }));
      await this.wait(0.5);
    }

    // Materialise the character.
    this.apply(ev.view);
    const a = this.stage.actor(ev.iid);
    if (a) {
      a.engaged = true; a.visibility = 1;
      a.mat = 0; a.grow = 0.55; a.alpha = 0;
      this.stage.tween(a, { alpha: 1 }, 0.25);
      this.stage.tween(a, { grow: 1 }, big ? 0.9 : 0.5, "back");
      await this.stage.tween(a, { mat: 1 }, big ? 1.0 : 0.55, "inOut");
      this.burst(a.center().x, a.center().y, big ? 60 : 24, { color: [c1, c2], speed: [80, 320], life: [0.4, 1.0], size: [2, 5] });
      // Entrance pose.
      audio.play(MONSTER_VOICE[v.rig] || "chime", { big: big ? 1 : 0 });
      if (v.rig === "dragon") {
        await this.stage.tween(a.pose, { raise: 1, jaw: 1 }, 0.45, "out");
        a.pose.flapRate = 2.2;
        this.stage.shake(big ? 14 : 6);
        this.stage.add(new Ring({ x: a.x, y: a.home.y, r0: 40, r1: 360, color: c1, life: 0.9, width: 10 }));
        await this.wait(big ? 0.7 : 0.3);
        await this.stage.tween(a.pose, { raise: 0, jaw: 0 }, 0.5, "inOut");
        a.pose.flapRate = 1;
      } else if (v.rig === "sorcerer") {
        await this.stage.tween(a.pose, { raise: 1, charge: 0.8 }, 0.4);
        this.stage.add(new Ring({ x: a.anchor().x, y: a.anchor().y, r0: 10, r1: 120, color: v.palette.accent, life: 0.6, squash: 1 }));
        await this.wait(0.35);
        await this.stage.tween(a.pose, { raise: 0, charge: 0 }, 0.4);
      } else {
        await this.stage.tween(a.pose, { raise: 0.7 }, 0.25);
        await this.stage.tween(a.pose, { raise: 0 }, 0.3);
      }
    }
    if (big) await this.stage.setDim(0, 0.5);
    else this.stage.setDim(0, 0.2);
    await this.stage.resetCamera(0.5);
  }

  async MONSTER_FLIPPED(ev) {
    const side = this.side(ev.player);
    const s = this.stage.slotPos(side, ev.slot);
    audio.play("card_place");
    this.stage.add(new Ring({ x: s.x, y: s.y, r0: 30, r1: 110, color: "#ffffff", life: 0.5 }));
    this.apply(ev.view);
    const a = this.stage.actor(ev.iid);
    if (a) {
      a.engaged = true; a.visibility = 1;
      a.mat = 0; a.alpha = 0;
      this.stage.tween(a, { alpha: 1 }, 0.2);
      await this.stage.tween(a, { mat: 1 }, 0.45);
    }
    await this.wait(0.2);
  }

  // A Fusion is offered: it rises in a column of gold light, cracks open and the Ascended form steps out.
  async ASCENSION_STARTED(ev) {
    const side = this.side(ev.player);
    const z = this.stage.slotPos(side, ev.material.slot);
    const a = this.stage.actor(ev.material.iid);
    this.ui.banner("Ascension Summon", cardData(ev.result_cid).name, "#ffe58a");
    await this.stage.focus(z.x, z.y - 140, 1.12, 0.5);
    await this.stage.setDim(0.45, 0.4, "#100a00");
    audio.play("charge", { dur: 1.4 });
    this.stage.add(new Pillar({ x: z.x, y: z.y, w: 120, h: 760, color: "#ffe58a", life: 2.4 }));
    this.stage.add(new MagicCircle({ x: z.x, y: z.y, r: 150, color: "#ffe58a", color2: "#ffffff", life: 2.4, points: 10, squash: 0.4 }));
    if (a) {
      a.keep = true; a.engaged = true;
      this.stage.tween(a, { lift: 90 }, 1.2, "inOut");
      a.flash = 0.4;
    }
    for (let i = 0; i < 4; i++) {
      this.burst(z.x, z.y - 60 - i * 40, 20, { color: ["#ffe58a", "#ffffff"], kind: "spark", speed: [60, 240], life: [0.4, 0.9], lift: -120 });
      await this.wait(0.28);
    }
    if (a) {
      const snap = a.snapshot();
      a.keep = false; a.hidden = true;
      this.stage.add(new Shatter({ ...snap, life: 1.2, cols: 5, rows: 6, power: 0.6, tint: "#ffe58a", floor: z.y + 400, particles: this.stage.particles, grav: 200 }));
    }
    audio.play("summon_epic");
    this.stage.flash("#fff6d0", 0.8, 0.5);
    this.stage.shake(14);
    this.stage.add(new Ring({ x: z.x, y: z.y, r0: 30, r1: 320, color: "#ffe58a", life: 0.9, squash: 0.35, width: 10 }));
    await this.wait(0.3);
    this.apply(ev.view);
    this.stage.setDim(0, 0.6);
  }

  async FUSION_SUMMON_STARTED(ev) {
    const side = this.side(ev.player);
    const sc = this.stage.sideCenter(side);
    const c = { x: sc.x, y: sc.y - 110 };
    this.ui.banner(ev.contact ? "Combine!" : "Fusion Summon", cardData(ev.result_cid).name, "#ff9bf0", true);
    await this.stage.focus(c.x, c.y + 80, 1.08, 0.5);
    this.stage.add(new Vortex({ x: c.x, y: c.y, r: 160, colors: ["#ff9bf0", "#7af0ff", "#ffe58a"], life: 2.6 }));
    audio.play("fusion");
    for (const m of ev.materials) {
      const a = this.stage.actor(m.iid);
      if (a) {
        a.keep = true; a.engaged = true;
        this.stage.tween(a.offset, { x: c.x - a.home.x, y: c.y - a.home.y + 80 }, 1.1, "in");
        this.stage.tween(a, { grow: 0.2, mat: 0 }, 1.1, "in");
      } else {
        const from = this.stage.handPos(ev.player);
        this.stage.add(new CardFlash({ img: cardCanvas(m.cid), x: from.x, y: from.y - 200, w: 120, life: 1.2, rise: 200, glow: "#ff9bf0" }));
        this.stage.add(new Projectile({ from: { x: from.x, y: from.y - 300 }, to: c, life: 1.1, color: "#ff9bf0", size: 10, particles: this.stage.particles }));
      }
    }
    await this.wait(1.2);
    for (const m of ev.materials) { const a = this.stage.actor(m.iid); if (a) { a.keep = false; a.hidden = true; } }
    this.stage.flash("#ffffff", 0.5, 0.4);
    this.burst(c.x, c.y, 60, { color: ["#ff9bf0", "#7af0ff", "#ffffff"], speed: [100, 400] });
    await this.wait(0.4);
    this.apply(ev.view);
  }

  // ------------------------------------------------------- spells / traps
  async SPELL_ACTIVATED(ev) {
    const c = cardData(ev.cid);
    const side = this.side(ev.player);
    const fx = c.visual.fx;
    const [pa, pb] = [c.visual.palette.a, c.visual.palette.b];
    this.prevView = this.stage.view;
    this.spellFx = { fx, src: ev.iid };
    const { x, y: fy } = this.flashPos(side);
    audio.play("activate_spell");
    this.stage.add(new CardFlash({ img: cardCanvas(ev.cid), x, y: fy - 60, w: 150, life: 1.3, rise: 30, glow: pb, top: true }));
    this.stage.add(new MagicCircle({ x, y: fy + 40, r: 110, color: pb, life: 1.3, squash: 0.45 }));
    this.ui.banner(c.name, c.subtype === "field" ? "Field Spell" : "Spell Card", "#5ff0c8", true);
    await this.wait(0.9);
    this.apply(ev.view);

    if (fx === "void_rift") {
      await this.stage.setDim(0.6, 0.6, "#05000c");
      const bc = this.stage.boardCenter();
      this.stage.addImpact(bc.x, bc.y, "impact", 2.2);
      this.riftFx = this.stage.add(new Vortex({ x: bc.x, y: bc.y - 40, r: 220, colors: ["#b45cff", "#3a0a6a", "#ff5cf0"], life: 3.2 }));
      audio.play("rift");
      this.stage.shake(10);
      await this.wait(0.9);
    } else if (fx === "lightning" && ev.target) {
      const t = this.pointOf(ev.target);
      this.stage.setDim(0.35, 0.2, "#000010");
      audio.play("lightning");
      for (let i = 0; i < 3; i++) {
        this.stage.add(new Bolt({ from: { x: t.x + (Math.random() - 0.5) * 120, y: -60 }, to: t, color: pb, life: 0.5, jag: 40 }));
        if (i === 0) this.stage.addImpact(t.x, t.y + 50, "scorch", 1.2);
        this.stage.flash("#e8f4ff", 0.5, 0.2);
        this.stage.shake(12);
        this.burst(t.x, t.y, 24, { color: [pa, pb, "#fff"], kind: "spark", speed: [120, 420], life: [0.2, 0.5] });
        await this.wait(0.16);
      }
      this.stage.setDim(0, 0.4);
    } else if (fx === "draw") {
      this.stage.add(new Pillar({ x, y: fy + 40, w: 40, h: 300, color: pa, life: 0.9 }));
      this.burst(x, fy - 60, 40, { color: [pa, pb], speed: [60, 220], life: [0.6, 1.1] });
      await this.wait(0.4);
    } else if (fx === "revive") {
      this.stage.add(new MagicCircle({ x, y: fy + 40, r: 140, color: pa, color2: pb, life: 1.6, points: 6, squash: 0.45 }));
      await this.wait(0.3);
    } else if (fx === "blades") {
      await this.wait(0.1);
    }
  }

  async SPELL_RESOLVED(ev) {
    if (this.riftFx) { this.riftFx.life = Math.min(this.riftFx.life, this.riftFx.age + 0.4); this.riftFx = null; }
    this.spellFx = null;
    this.stage.setDim(0, 0.5);
    this.apply(ev.view);
    audio.play("card_place");
    await this.wait(0.3);
  }

  async EFFECT_APPLIED(ev) {
    if (ev.effect === "lock_traps" || ev.effect === "lock_spells") {
      const p = this.stage.cardPos(ev.iid);
      audio.play("negate");
      this.stage.add(new MagicCircle({ x: p.x, y: p.y, r: 120, color: "#9fb8ff", color2: "#ffffff", life: 1.2, points: 8, squash: 0.45 }));
      this.ui.banner(ev.effect === "lock_traps" ? "Traps sealed" : "Spells sealed", `${ev.turns_left} turns`, "#9fb8ff", true);
      await this.wait(0.8);
    }
    if (ev.effect === "lock_attacks") {
      const lockedSide = 1 - this.side(ev.player);
      audio.play("barrier");
      for (let i = 0; i < 9; i++) {
        const pt = proj(-480 + i * 120, lockedSide === 0 ? Z.mon0 + 0.09 : Z.mon1 - 0.09);
        const x = pt.x, landY = pt.y - 36 * pt.s;
        setTimeout(() => {
          this.stage.add(new Projectile({ from: { x, y: -80 }, to: { x, y: landY }, life: 0.45, color: "#ffe58a", size: 8, particles: this.stage.particles }));
          setTimeout(() => this.burst(x, pt.y, 10, { color: ["#ffe58a", "#fff"], kind: "spark", speed: [60, 200], life: [0.2, 0.5] }), 420);
        }, i * 80);
      }
      await this.wait(1.2);
      this.stage.shake(6);
    }
    this.apply(ev.view);
  }

  async COUNTER_CHANGED(ev) {
    this.apply(ev.view);
    const p = this.stage.cardPos(ev.iid);
    this.popText(p.x, p.y, `${ev.turns_left} turn${ev.turns_left === 1 ? "" : "s"} left`, "#ffe58a", 18, 1.2);
    await this.wait(0.6);
  }

  async EFFECT_EXPIRED(ev) {
    const p = this.stage.cardPos(ev.iid);
    audio.play("destroy");
    this.burst(p.x, p.y, 30, { color: ["#ffe58a", "#fff"], kind: "shard", speed: [60, 220], additive: true });
    this.ui.banner(cardData(ev.cid).name, "Effect ended", "#ffe58a", true);
    this.apply(ev.view);
    await this.wait(0.7);
  }

  async FIELD_SPELL_ACTIVATED(ev) {
    const origin = this.stage.cardPos(ev.iid, ev.view);
    await this.stage.focus(800, 450, 0.96, 0.4);
    this.stage.env.transition(ev.env, 2.0, origin);
    audio.play("field");
    await this.wait(0.7);
    this.ui.banner(this.stage.env.name, "The field transforms", "#5ff0c8", true);
    await this.wait(1.4);
    this.apply(ev.view);
    await this.stage.resetCamera(0.5);
  }

  async FIELD_SPELL_REMOVED(ev) {
    this.stage.env.transition(ev.view.env || this.stage.baseEnv, 1.2, this.stage.cardPos(ev.iid, this.stage.view));
    this.apply(ev.view);
    await this.wait(0.8);
  }

  async TRAP_ACTIVATED(ev) {
    const c = cardData(ev.cid);
    const side = this.side(ev.player);
    const [pa, pb] = [c.visual.palette.a, c.visual.palette.b];
    const fx = c.visual.fx;
    this.spellFx = { fx, src: ev.iid };
    audio.play("activate_trap");
    this.stage.flash("#ff3a8a", 0.35, 0.4);
    this.stage.shake(8);
    const { x, y: fy } = this.flashPos(side);
    this.stage.add(new CardFlash({ img: cardCanvas(ev.cid), x, y: fy - 60, w: 170, life: 1.3, rise: 20, glow: "#ff5aa0", top: true }));
    this.ui.banner(c.name, "Trap Card", "#ff6aa8", true);
    await this.wait(0.9);
    this.apply(ev.view);

    const attacker = ev.attacker ? this.stage.actor(ev.attacker) : null;
    if (fx === "prism_barrier") {
      const fl = this.frontLine(side);
      this.stage.add(new Dome({ x: fl.x, y: fl.y - 40, r: 90, wide: 5.4, color: pa, life: 1.6 }));
      audio.play("barrier");
      await this.wait(0.5);
      const targets = [...this.stage.actors.values()].filter((a) => a.side !== side && a.position === "atk");
      for (const t of targets) {
        this.stage.add(new Beam({ from: { x: t.center().x, y: fl.y - 40 }, to: () => t.center(), width: 10, color: pb, core: "#ffffff", life: 0.7 }));
      }
      audio.play("beam", { dur: 0.6 });
      this.stage.flash("#ffffff", 0.4, 0.3);
      await this.wait(0.6);
    } else if (fx === "echo_chamber" && attacker) {
      const ax = attacker.anchor();
      const dc = this.sideCenter(side);
      const mid = { x: (ax.x + dc.x) / 2, y: (ax.y + dc.y) / 2 };
      this.stage.add(new Cylinder({ x: mid.x, y: mid.y, w: 46, h: 120, color: pa, color2: pb, life: 2.2, angle: Math.atan2(ax.y - dc.y, ax.x - dc.x) + Math.PI / 2 }));
      audio.play("barrier");
      await this.wait(0.4);
      await this.stage.tween(attacker.pose, { charge: 1, raise: 0.6 }, 0.4);
      this.stage.add(new Projectile({ from: attacker.anchor(), to: mid, life: 0.35, color: attacker.pal.glow, size: 12, particles: this.stage.particles }));
      attacker.pose.charge = 0; this.stage.tween(attacker.pose, { raise: 0 }, 0.3);
      await this.wait(0.35);
      const dp = this.stage.duelistPoint(attacker.side);
      const back = { x: dp.x + (attacker.side === 0 ? -260 : 260), y: dp.y - 80 };
      this.stage.add(new Cylinder({ x: back.x, y: back.y + 60, w: 46, h: 120, color: pa, color2: pb, life: 1.4, angle: 0 }));
      audio.play("orb");
      await this.wait(0.3);
      this.stage.add(new Projectile({ from: { x: back.x, y: back.y + 60 }, to: this.lpPoint(1 - ev.player), life: 0.5, color: attacker.pal.glow, size: 14, particles: this.stage.particles }));
      await this.wait(0.5);
      this.stage.shake(14);
    } else if (fx === "barrier") {
      const fl = this.frontLine(side);
      this.stage.add(new Dome({ x: fl.x, y: fl.y - 50, r: 110, wide: 5.6, color: pa, life: 1.6 }));
      audio.play("barrier");
      await this.wait(0.7);
    } else if (fx === "sinkhole" && ev.summoned) {
      const a = this.stage.actor(ev.summoned);
      if (a) {
        this.stage.add(new Sinkhole({ x: a.home.x, y: a.home.y, r: 110, color: pb, life: 1.6 }));
        audio.play("rumble");
        this.stage.shake(10);
        await this.wait(0.4);
        a.keep = true;
        a.pose.recoil = 1;
        await this.stage.tween(a, { lift: -120, alpha: 0.2 }, 0.7, "in");
      }
    }
  }

  async TRAP_RESOLVED(ev) {
    this.spellFx = null;
    this.apply(ev.view);
    await this.wait(0.25);
  }

  // ---------------------------------------------------------------- battle
  async ATTACK_DECLARED(ev) {
    this.lastAttacker = ev.attacker;
    this.apply(ev.view);
    const a = this.stage.actor(ev.attacker);
    this.engage(ev.attacker, ev.target);
    this.stage.highlights.set(ev.attacker, "selected");
    if (ev.target) this.stage.highlights.set(ev.target, "target");
    if (a) {
      const t = ev.target ? this.pointOf(ev.target) : this.stage.duelistPoint(1 - a.side);
      await this.stage.focus((a.x + t.x) / 2, (a.y + t.y) / 2 - 60, 1.07, 0.4);
      audio.play("whoosh");
      await this.stage.tween(a.pose, { raise: 0.35 }, 0.3);
      this.popText(a.x, a.y - a.rig.height * a.scale - 20, ev.target ? "ATTACK!" : "DIRECT ATTACK!", "#ffb070", 26, 0.9);
      await this.wait(0.45);
    }
  }

  async ATTACK_NEGATED(ev) {
    const a = this.stage.actor(ev.attacker);
    if (a) {
      a.pose.recoil = 1;
      this.stage.add(new Ring({ x: a.center().x, y: a.center().y, r0: 20, r1: 120, color: "#7af0ff", life: 0.6, squash: 1 }));
      this.popText(a.x, a.y - a.rig.height * a.scale - 20, "NEGATED", "#7af0ff", 30, 1.0);
      this.stage.tween(a.pose, { raise: 0, charge: 0, lunge: 0 }, 0.3);
    }
    audio.play("barrier");
    this.apply(ev.view);
    await this.wait(0.6);
  }

  async ATTACK_RESOLVED(ev) {
    const a = this.stage.actor(ev.attacker);
    if (!a || ev.fizzled) { this.apply(ev.view); return; }
    this.engage(ev.attacker, ev.target);
    const targetActor = ev.target ? this.stage.actor(ev.target) : null;
    const tp = () => (targetActor ? targetActor.center() : ev.target ? this.pointOf(ev.target) : (() => { const d = this.stage.duelistPoint(1 - a.side); return { x: d.x, y: d.y - 40 }; })());
    // Battle values shown before the clash.
    if (ev.target) {
      this.popText(a.x, a.y + 70, `${ev.attacker_value}`, "#ffb070", 30, 1.3);
      const t = tp();
      this.popText(t.x, t.y + 120, `${ev.target_value}`, ev.target_position === "def" ? "#6ab8ff" : "#ffb070", 30, 1.3);
    }
    await this.attackAnimation(a, tp, !ev.target);
    const hit = ev.target ? this.stage.cardPos(ev.target) : this.stage.duelistPoint(1 - a.side);
    this.stage.addImpact(hit.x + (Math.random() - 0.5) * 40, hit.y + (ev.target ? 30 : -30), "impact", ev.target ? 1 : 1.3);
    if (!ev.target) {
      this.stage.flash("#ffffff", 0.35, 0.3);
      this.stage.shake(16);
    }
    this.apply(ev.view);
  }

  // Signature attack per monster, chosen by card.visual.attack.
  async attackAnimation(a, tp, direct) {
    const v = a.card.visual, pal = a.pal, style = v.attack;
    const S = this.stage;
    const homeFacing = a.facing;
    const t00 = tp();
    if (Math.abs(t00.x - a.x) > 30) a.facing = Math.sign(t00.x - a.x);
    try { await this.attackStyle(a, tp, direct, v, pal, style, S); } finally { a.facing = homeFacing; }
  }

  async attackStyle(a, tp, direct, v, pal, style, S) {
    const impact = (color, n = 40) => {
      const t = tp();
      this.burst(t.x, t.y, n, { color: [color, "#ffffff", pal.accent], speed: [80, 420], life: [0.3, 0.8], size: [2, 6] });
      S.add(new Ring({ x: t.x, y: t.y, r0: 10, r1: 140, color, life: 0.5, squash: 0.9 }));
      audio.play("impact");
      S.shake(direct ? 18 : 12);
    };
    if (style === "radiant_beam" || style === "fire_breath" || style === "dark_flame" || style === "water_jet") {
      const color = style === "radiant_beam" ? pal.glow : style === "water_jet" ? "#bff4ff" : pal.accent;
      const t0 = tp();
      await S.focus((a.x * 2 + t0.x) / 3, a.y - 120, style === "radiant_beam" ? 1.12 : 1.06, 0.35);
      audio.play("charge", { dur: style === "radiant_beam" ? 1.1 : 0.6 });
      const chargeTime = style === "radiant_beam" ? 1.1 : 0.6;
      S.tween(a.pose, { raise: 1, jaw: 0.7, charge: 1 }, chargeTime, "inOut");
      const n = style === "radiant_beam" ? 26 : 12;
      for (let i = 0; i < n; i++) {
        setTimeout(() => {
          const m = a.anchor();
          const ang = Math.random() * Math.PI * 2, r = 120 + Math.random() * 80;
          S.add(new Projectile({ from: { x: m.x + Math.cos(ang) * r, y: m.y + Math.sin(ang) * r }, to: () => a.anchor(), life: 0.4, color, size: 3 }));
        }, (i * chargeTime * 1000) / n);
      }
      await this.wait(chargeTime);
      a.pose.flapRate = 2;
      S.tween(a.pose, { raise: 0, lunge: 0.8, jaw: 1 }, 0.18, "out");
      audio.play(MONSTER_VOICE[v.rig] || "roar", { big: 1 });
      if (style === "radiant_beam") {
        audio.play("beam", { dur: 1.0 });
        S.add(new Beam({ from: () => a.anchor(), to: tp, width: 26, color: pal.accent, core: "#ffffff", life: 1.0, growTime: 0.12 }));
        S.flash("#e8f6ff", 0.4, 0.3);
        for (let i = 0; i < 8; i++) setTimeout(() => impact(pal.glow, 18), 120 + i * 100);
        await this.wait(1.0);
      } else if (style === "water_jet") {
        audio.play("water");
        S.add(new Beam({ from: () => a.anchor(), to: tp, width: 12, color: "#58d0ff", core: "#ffffff", life: 0.8, growTime: 0.2 }));
        for (let i = 0; i < 6; i++) setTimeout(() => { impact("#bff4ff", 14); this.burst(tp().x, tp().y, 10, { kind: "bubble", additive: false, color: "#bff4ff", speed: [60, 200] }); }, 150 + i * 100);
        await this.wait(0.8);
      } else {
        const dark = style === "dark_flame";
        audio.play("fire", { dur: 0.9 });
        const cols = dark ? ["#ff3b4a", "#8a1020", "#3a0010"] : ["#ffd27a", "#ff7a2a", "#ff3b1a"];
        for (let i = 0; i < 18; i++) {
          setTimeout(() => {
            const m = a.anchor(), t = tp();
            const ang = Math.atan2(t.y - m.y, t.x - m.x);
            this.burst(m.x, m.y, 10, { angle: ang, spread: 0.35, speed: [420, 700], life: [0.35, 0.6], size: [6, 12], grow: 18, drag: 0.97, color: cols, additive: !dark || i % 2 === 0 });
            if (dark && i % 4 === 0) S.add(new Projectile({ from: m, to: t, life: 0.35, color: "#ff3b4a", size: 10, dark: true, particles: S.particles }));
          }, i * 45);
        }
        setTimeout(() => impact(cols[0], 30), 380);
        setTimeout(() => impact(cols[1], 20), 650);
        await this.wait(0.95);
      }
      await S.tween(a.pose, { lunge: 0, jaw: 0, charge: 0 }, 0.4, "inOut");
      a.pose.flapRate = 1;
    } else if (style === "void_orb") {
      audio.play("charge", { dur: 0.8 });
      await S.tween(a.pose, { raise: 1, charge: 1 }, 0.8, "inOut");
      S.add(new MagicCircle({ x: a.anchor().x, y: a.anchor().y, r: 50, color: pal.accent, life: 0.9, squash: 1, spin: 4 }));
      await this.wait(0.2);
      S.tween(a.pose, { raise: 0.2, lunge: 1, charge: 0 }, 0.2);
      audio.play("orb");
      S.add(new Projectile({ from: a.anchor(), to: tp, life: 0.6, color: pal.accent, color2: pal.glow, size: 16 * a.scale, arc: 60, particles: S.particles, dark: true }));
      await this.wait(0.6);
      impact(pal.accent, 50);
      S.add(new Ring({ x: tp().x, y: tp().y, r0: 10, r1: 200, color: pal.glow, life: 0.7, squash: 1 }));
      await S.tween(a.pose, { raise: 0, lunge: 0 }, 0.4);
    } else if (style === "blade_dash" || style === "dive" || style === "slam") {
      const t = tp();
      const vx = t.x - a.x, vy = t.y + 40 - a.y, L = Math.hypot(vx, vy) || 1;
      const stop = style === "slam" ? 110 : 70;
      const dx = vx - (vx / L) * stop, dy = vy - (vy / L) * stop;
      if (style === "dive") {
        audio.play("screech");
        await S.tween(a.offset, { y: -120 }, 0.35, "out");
        S.tween(a.pose, { lunge: 1 }, 0.3);
        audio.play("whoosh");
        await S.tween(a.offset, { x: dx, y: dy - 20 }, 0.3, "in");
        impact(pal.accent, 46);
        S.add(new Slash({ x: t.x, y: t.y, r: 70, angle: 0.6, color: pal.glow, life: 0.35 }));
      } else {
        a.pose.walk = true;
        audio.play("whoosh");
        await S.tween(a.offset, { x: dx, y: dy }, 0.42, "inOut");
        a.pose.walk = false;
        if (style === "blade_dash") {
          await S.tween(a.pose, { raise: 1 }, 0.16);
          audio.play("slash");
          S.tween(a.pose, { raise: 0, slash: 1 }, 0.16, "in");
          await this.wait(0.12);
          S.add(new Slash({ x: t.x, y: t.y, r: 80, angle: a.facing > 0 ? 0.2 : Math.PI - 0.2, color: pal.glow, life: 0.35 }));
          impact(pal.glow, 30);
          await this.wait(0.2);
          a.pose.slash = 0;
        } else {
          audio.play("rumble");
          await S.tween(a.pose, { raise: 1 }, 0.3);
          S.tween(a.pose, { slam: 1, raise: 0 }, 0.14, "in");
          await this.wait(0.14);
          S.add(new Ring({ x: a.x + a.facing * 40, y: a.y, r0: 20, r1: 220, color: pal.glow, life: 0.6 }));
          this.burst(a.x + a.facing * 40, a.y, 30, { kind: "shard", additive: false, color: [pal.body, pal.shade], angle: -Math.PI / 2, spread: 1.6, speed: [150, 380], grav: 900 });
          impact(pal.glow, 30);
          await this.wait(0.25);
          a.pose.slam = 0;
        }
      }
      a.pose.walk = true;
      S.tween(a.pose, { lunge: 0 }, 0.4);
      await S.tween(a.offset, { x: 0, y: 0 }, 0.45, "inOut");
      a.pose.walk = false;
    } else if (style === "shadow_bolt" || style === "shards") {
      audio.play(style === "shards" ? "shards" : "cackle");
      await S.tween(a.pose, { raise: 1, charge: 1 }, 0.45);
      S.tween(a.pose, { raise: 0, lunge: 1, charge: 0 }, 0.2);
      const n = style === "shards" ? 7 : 1;
      for (let i = 0; i < n; i++) {
        setTimeout(() => S.add(new Projectile({ from: a.anchor(), to: () => { const p = tp(); return { x: p.x + (i - n / 2) * 8, y: p.y + (i - n / 2) * 6 }; }, life: 0.45, color: style === "shards" ? pal.accent : pal.accent, color2: pal.glow, size: style === "shards" ? 6 : 14, arc: style === "shards" ? 40 + i * 12 : 80, particles: S.particles })), i * 60);
      }
      await this.wait(0.45 + n * 0.06);
      impact(pal.accent, 34);
      await S.tween(a.pose, { lunge: 0 }, 0.3);
    } else {
      await S.tween(a.pose, { lunge: 1 }, 0.25);
      S.add(new Projectile({ from: a.anchor(), to: tp, life: 0.4, color: pal.glow, size: 12, particles: S.particles }));
      await this.wait(0.4);
      impact(pal.glow);
      await S.tween(a.pose, { lunge: 0 }, 0.3);
    }
  }

  async MONSTER_DAMAGED(ev) {
    const a = this.stage.actor(ev.iid);
    if (a) {
      a.engaged = true;
      a.flash = 1;
      a.pose.recoil = ev.recoil ? 0.7 : 1;
      this.stage.tween(a.offset, { x: -a.facing * 26 }, 0.08).then(() => this.stage.tween(a.offset, { x: 0 }, 0.35));
      audio.play("hit");
      this.burst(a.center().x, a.center().y, 16, { color: ["#ffffff", a.pal.accent], kind: "spark", speed: [120, 360], life: [0.2, 0.5] });
    }
    this.apply(ev.view);
    await this.wait(ev.survived ? 0.45 : 0.25);
  }

  async LIFE_POINTS_CHANGED(ev) {
    const p = this.lpPoint(ev.player);
    this.popText(p.x, p.y + 20, `${ev.delta > 0 ? "+" : ""}${ev.delta}`, ev.delta < 0 ? "#ff6a6a" : "#6dffa8", 46, 1.4);
    if (ev.delta < 0) { audio.play("lp_down"); this.ui.lpHit(ev.player); }
    this.apply(ev.view);
    await this.wait(0.7);
  }

  // Battle and effect destruction: hit-stop, fractures, then the sprite itself breaks into pieces that
  // scatter, bounce on the board and fade, while its spirit drifts to the Graveyard.
  async MONSTER_DESTROYED(ev) {
    const a = this.stage.actor(ev.iid);
    const rift = this.spellFx && this.spellFx.fx === "void_rift" && ev.by === this.spellFx.src;
    const side = this.side(ev.player);
    if (a && !a.hidden) {
      a.keep = true; a.engaged = true; a.visibility = 1;
      const c = a.center();
      if (rift) {
        audio.play("whoosh");
        this.stage.tween(a, { grow: 0.3, alpha: 0.2 }, 0.7, "in");
        const bc = this.stage.boardCenter();
        await this.stage.tween(a.offset, { x: bc.x - a.home.x, y: bc.y - a.home.y + 20 }, 0.7, "in");
        a.keep = false; a.hidden = true;
      } else {
        const battle = ev.reason === "battle";
        const hitFrom = battle && this.lastAttacker && this.stage.actor(this.lastAttacker);
        const origin = hitFrom ? { x: c.x + (hitFrom.center().x < c.x ? -30 : 30), y: c.y } : { x: c.x, y: c.y - 10 };
        const tint = battle ? "#ffffff" : "#c9a0ff";
        // 1. hit-stop and fractures
        a.flash = 1;
        audio.play("crack");
        const snap0 = a.snapshot();
        this.stage.add(new Cracks({ ...snap0, origin, color: battle ? "#fff6d0" : "#e0c8ff", life: 0.5, count: 8 }));
        this.stage.shake(6);
        await this.wait(0.32);
        // 2. it breaks
        const snap = a.snapshot();
        a.keep = false; a.hidden = true;
        this.apply(ev.view);
        audio.play("shatter");
        audio.play("destroy");
        this.stage.flash(battle ? "#ffffff" : "#b89aff", 0.25, 0.18);
        this.stage.shake(12);
        this.stage.add(new Shatter({ ...snap, origin, life: 1.6, cols: 6, rows: 7, power: battle ? 1.05 : 0.8, tint,
          floor: a.home.y + 6, particles: this.stage.particles, dust: a.pal.shade }));
        this.stage.add(new Ring({ x: a.home.x, y: a.home.y, r0: 20, r1: 160 * a.home.s, color: a.pal.glow, life: 0.6, squash: 0.35, width: 6 }));
        this.burst(origin.x, origin.y, 46, { color: [a.pal.glow, a.pal.accent, "#ffffff"], kind: "spark", speed: [180, 560], life: [0.2, 0.6] });
        this.burst(a.home.x, a.home.y - 10, 22, { color: [a.pal.shade, "#3a3430", "#6a625a"], kind: "smoke", speed: [30, 120], squash: 0.4, life: [0.7, 1.4], size: [10, 22], grow: 14, additive: false });
        this.burst(c.x, c.y, 30, { color: [a.pal.body, a.pal.accent], kind: "shard", speed: [80, 360], grav: 700, life: [0.6, 1.2], size: [2, 5], additive: false });
        if (battle) this.stage.addImpact(a.home.x, a.home.y, "scorch", 0.9 * a.home.s + 0.3);
        // 3. its spirit returns to the Graveyard
        const gy = this.stage.pilePos(side, "gy");
        this.stage.add(new Projectile({ from: { x: c.x, y: c.y - 20 }, to: { x: gy.x, y: gy.y }, life: 0.75, arc: 80, color: a.pal.glow, size: 9, particles: this.stage.particles, trailRate: 0.7 }));
        await this.wait(0.55);
      }
    } else {
      // A face-down monster with no living figure: its card breaks instead.
      await this.breakCard(ev.cid, this.stage.zonePos(side, ev.slot), side, ev.reason === "battle" ? "#ffffff" : "#c9a0ff", ev.player, ev.view);
    }
    this.apply(ev.view);
    await this.wait(0.1);
  }

  // Shatter a card lying on the field (Spell/Trap Zone or a monster zone without a figure).
  async breakCard(cid, z, side, tint = "#ffffff", player, view) {
    const img = cid ? cardCanvas(cid) : cardBack();
    const s = z.s || 1;
    const w = CARD_W * 0.34 * s, h = CARD_H * 0.34 * s;
    const x = z.x - w / 2, y = z.y - h / 2 - 12 * s;
    audio.play("crack");
    this.stage.add(new Cracks({ x, y, w, h, origin: { x: z.x, y: z.y - 12 * s }, color: tint, life: 0.4, count: 6 }));
    await this.wait(0.26);
    if (view) this.apply(view);
    audio.play("shatter");
    this.stage.shake(7);
    this.stage.add(new Shatter({ img, x, y, w, h, origin: { x: z.x, y: z.y }, life: 1.3, cols: 4, rows: 5, power: 0.7, tint, edge: tint,
      floor: z.y + h * 0.4, particles: this.stage.particles, dust: "#7a7468" }));
    this.burst(z.x, z.y, 26, { color: [tint, "#ffffff"], kind: "spark", speed: [120, 380], life: [0.2, 0.5] });
    if (player !== undefined) {
      const gy = this.stage.pilePos(side, "gy");
      this.stage.add(new Projectile({ from: { x: z.x, y: z.y }, to: { x: gy.x, y: gy.y }, life: 0.6, arc: 50, color: tint, size: 6, particles: this.stage.particles, trailRate: 0.5 }));
    }
    await this.wait(0.4);
  }

  async CARD_DESTROYED(ev) {
    const side = this.side(ev.player);
    const z = this.stage.stPos(side, ev.slot);
    const name = ev.cid ? cardData(ev.cid).name : "Set card";
    this.popText(z.x, z.y - 60, ev.reason === "equip_lost" ? "Equip lost" : "Destroyed", "#ffb0c0", 22, 1.1);
    await this.breakCard(ev.cid, z, side, ev.reason === "equip_lost" ? "#ffd27a" : "#ff8ab0", ev.player, ev.view);
    if (ev.reason !== "equip_lost") this.ui.banner(name, "Destroyed", "#ff8ab0", true);
    this.apply(ev.view);
    await this.wait(0.2);
  }

  async SPELL_NEGATED(ev) {
    const side = this.side(ev.player);
    const z = this.stage.stPos(side, ev.slot);
    audio.play("negate");
    this.stage.flash("#ff3ad0", 0.3, 0.3);
    this.stage.add(new MagicCircle({ x: z.x, y: z.y, r: 90, color: "#ff6ad8", color2: "#ffffff", life: 0.9, points: 8, squash: 0.45 }));
    this.ui.banner(cardData(ev.cid).name, "Negated!", "#ff6ad8", true);
    if (this.riftFx) { this.riftFx.life = Math.min(this.riftFx.life, this.riftFx.age + 0.3); this.riftFx = null; }
    this.stage.setDim(0, 0.3);
    this.spellFx = null;
    await this.wait(0.4);
    await this.breakCard(ev.cid, z, side, "#ff6ad8", ev.player, ev.view);
    this.apply(ev.view);
  }

  async EQUIP_ATTACHED(ev) {
    const t = this.pointOf(ev.target);
    const from = this.stage.stPos(this.side(ev.player), ev.slot);
    const c = cardData(ev.cid);
    const col = c.visual.palette.b;
    audio.play("power_up");
    this.stage.add(new Projectile({ from: { x: from.x, y: from.y }, to: t, life: 0.5, arc: 60, color: col, size: 10, particles: this.stage.particles }));
    await this.wait(0.45);
    this.stage.add(new Ring({ x: t.x, y: t.y + 40, r0: 10, r1: 90, color: col, life: 0.6, squash: 0.35, width: 5 }));
    this.burst(t.x, t.y, 30, { color: [col, "#ffffff"], speed: [60, 220], life: [0.4, 0.9] });
    const a = this.stage.actor(ev.target);
    if (a) a.flash = 0.6;
    this.popText(t.x, t.y - 70, `+${ev.atk} ATK${ev.defense ? ` / +${ev.defense} DEF` : ""}`, "#ffe58a", 26, 1.3);
    this.apply(ev.view);
    await this.wait(0.6);
  }

  async MONSTER_BOOSTED(ev) {
    const t = this.pointOf(ev.iid);
    audio.play("power_up");
    const a = this.stage.actor(ev.iid);
    if (a) { a.flash = 0.8; this.stage.add(new Pillar({ x: a.home.x, y: a.home.y, w: 50, h: 220, color: "#ffe86a", life: 0.7 })); }
    this.burst(t.x, t.y, 36, { color: ["#ffe86a", "#ffffff"], kind: "spark", speed: [100, 300], life: [0.3, 0.7] });
    this.popText(t.x, t.y - 70, `+${ev.amount} ATK`, "#ffe86a", 30, 1.3);
    this.apply(ev.view);
    await this.wait(0.7);
  }

  async MONSTER_EFFECT(ev) {
    const c = cardData(ev.cid);
    const a = this.stage.actor(ev.iid);
    const p = a && !a.hidden ? a.center() : this.stage.cardPos(ev.iid, this.stage.view);
    const col = (c.visual && c.visual.palette && c.visual.palette.glow) || "#ffd27a";
    audio.play("activate_spell");
    if (a && !a.hidden) a.flash = 0.7;
    this.stage.add(new MagicCircle({ x: p.x, y: p.y + 40, r: 80, color: col, color2: "#ffffff", life: 1.0, points: 6, squash: 0.4 }));
    this.burst(p.x, p.y, 26, { color: [col, "#ffffff"], speed: [40, 180], life: [0.4, 0.9] });
    const label = ev.trigger === "flip" ? "FLIP effect" : ev.trigger === "destroyed_by_battle" ? "Last effect" : "Monster effect";
    this.ui.banner(c.name, label, "#ffb36b", true);
    await this.wait(0.8);
    this.apply(ev.view);
  }

  async CARD_ADDED_TO_HAND(ev) {
    const side = this.side(ev.player);
    const fromGy = ev.from_zone === "gy";
    const pile = this.stage.pilePos(side, fromGy ? "gy" : "deck");
    const col = fromGy ? "#9fffb0" : "#7ae8ff";
    audio.play(fromGy ? "revive" : "card_draw");
    this.stage.add(new CardFlash({ img: cardCanvas(ev.cid), x: pile.x, y: pile.y - 80, w: 120, life: 1.1, rise: 40, glow: col }));
    if (fromGy) this.burst(pile.x, pile.y, 24, { color: [col, "#ffffff"], speed: [40, 160], life: [0.4, 0.9], lift: -60 });
    this.ui.banner(cardData(ev.cid).name, fromGy ? "Returned from the Graveyard" : "Added from the Deck", col, true);
    await this.wait(0.9);
    this.apply(ev.view);
  }

  // A monster is swept off the field back to its owner's hand (or Extra Deck): it spins up, shrinks and flies off.
  async MONSTER_BOUNCED(ev) {
    const a = this.stage.actor(ev.iid);
    const side = this.side(ev.player);
    const ownerSide = this.side(ev.owner);
    const dest = ev.to === "extra" ? this.stage.pilePos(ownerSide, "extra") : { x: W / 2, y: ownerSide === 0 ? 980 : -80 };
    audio.play("whoosh");
    this.ui.banner(cardData(ev.cid).name, ev.to === "extra" ? "Returned to the Extra Deck" : "Returned to the hand", "#9fe8ff", true);
    if (a && !a.hidden) {
      a.keep = true; a.engaged = true; a.flash = 0.6;
      const c = a.center();
      this.stage.add(new Ring({ x: a.home.x, y: a.home.y, r0: 20, r1: 120 * a.home.s, color: "#9fe8ff", life: 0.5, squash: 0.35, width: 5 }));
      this.burst(c.x, c.y, 26, { color: ["#9fe8ff", "#ffffff"], kind: "spark", speed: [80, 260], life: [0.3, 0.6] });
      this.stage.tween(a, { grow: 0.25, alpha: 0 }, 0.6, "in");
      await this.stage.tween(a.offset, { x: dest.x - a.home.x, y: dest.y - a.home.y }, 0.6, "in");
      a.keep = false; a.hidden = true;
    } else {
      const z = this.stage.zonePos(side, ev.slot);
      this.stage.add(new Projectile({ from: { x: z.x, y: z.y }, to: dest, life: 0.5, color: "#9fe8ff", size: 8, particles: this.stage.particles }));
      await this.wait(0.5);
    }
    this.apply(ev.view);
  }

  async DUEL_WON(ev) {
    this.apply(ev.view);
    const won = ev.player === ev.view.you;
    await this.wait(0.4);
    this.stage.flash(won ? "#fff6d0" : "#200010", 0.6, 1.0);
    audio.stopMusic();
    audio.play(won ? "victory" : "defeat");
    this.ui.showEnd(won, ev.reason);
    await this.wait(0.5);
  }
}
