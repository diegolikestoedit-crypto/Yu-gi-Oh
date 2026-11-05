// Procedural audio: every sound and the music are synthesised at runtime with WebAudio,
// so all audio is original. Four buses (music / sfx / monster / ui) follow the volume settings.
import { settings } from "./settings.js";

class Audio {
  constructor() {
    this.ctx = null;
    this.buses = {};
    this.musicOn = false;
    this.noiseBuf = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    for (const b of ["music", "sfx", "monster", "ui"]) {
      this.buses[b] = this.ctx.createGain();
      this.buses[b].connect(this.master);
    }
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    settings.onChange(() => this.applyVolumes());
    if (this.wantMusic) this.startMusic();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const muted = settings.get("muted");
    this.master.gain.value = muted ? 0 : 0.9;
    for (const b of ["music", "sfx", "monster", "ui"]) this.buses[b].gain.value = Number(settings.get(b));
  }

  // ---------------------------------------------------------- primitives
  tone(f, dur, { type = "sine", gain = 0.3, bus = "sfx", at = 0, attack = 0.005, glide, detune = 0, filter } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) { const fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = filter; node.connect(fl); node = fl; }
    node.connect(g).connect(this.buses[bus]);
    o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, { type = "bandpass", f = 1000, q = 1, gain = 0.3, bus = "sfx", at = 0, attack = 0.005, glide } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (glide) fl.frequency.exponentialRampToValueAtTime(Math.max(30, glide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.buses[bus]);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------- library
  play(name, o = {}) {
    if (!this.ctx) return;
    const at = o.at || 0;
    const big = o.big ? 1 : 0;
    switch (name) {
      case "ui_click": this.tone(880, 0.08, { type: "triangle", gain: 0.15, bus: "ui", at }); this.tone(1320, 0.06, { type: "sine", gain: 0.08, bus: "ui", at: at + 0.02 }); break;
      case "ui_hover": this.tone(1200, 0.04, { type: "sine", gain: 0.04, bus: "ui", at }); break;
      case "ui_error": this.tone(220, 0.16, { type: "square", gain: 0.06, bus: "ui", at, filter: 900 }); break;
      case "card_draw": this.noise(0.22, { f: 2600, q: 0.7, gain: 0.18, glide: 900, at }); break;
      case "card_place": this.noise(0.12, { type: "lowpass", f: 900, gain: 0.35, at }); this.tone(140, 0.12, { gain: 0.2, at }); break;
      case "phase": this.tone(660, 0.12, { type: "triangle", gain: 0.1, bus: "ui", at }); this.tone(990, 0.18, { type: "sine", gain: 0.08, bus: "ui", at: at + 0.06 }); break;
      case "turn": [523, 659, 784].forEach((f, i) => this.tone(f, 0.35, { type: "triangle", gain: 0.1, bus: "ui", at: at + i * 0.07 })); break;
      case "activate_spell":
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.5, { type: "sine", gain: 0.1, at: at + i * 0.05 }));
        this.noise(0.6, { f: 5000, q: 2, gain: 0.08, glide: 9000, at }); break;
      case "activate_trap":
        this.tone(110, 0.6, { type: "sawtooth", gain: 0.18, filter: 600, at });
        this.tone(233, 0.5, { type: "sawtooth", gain: 0.12, filter: 1200, at: at + 0.05 });
        this.noise(0.25, { type: "highpass", f: 3000, gain: 0.15, at }); break;
      case "summon":
        this.noise(0.9 + big, { f: 400, q: 0.8, gain: 0.25, glide: 3000, attack: 0.5, at });
        this.tone(110, 1 + big, { type: "sawtooth", gain: 0.12, filter: 800, glide: 220, attack: 0.4, at });
        this.tone(55, 0.9 + big, { type: "sine", gain: 0.4, at: at + 0.7 + big * 0.8 });
        break;
      case "summon_epic":
        [55, 82.4, 110, 164.8].forEach((f, i) => this.tone(f, 3.2, { type: "sawtooth", gain: 0.09, filter: 1400, attack: 1.2, at: at + i * 0.1 }));
        this.noise(2.6, { f: 300, q: 0.6, gain: 0.3, glide: 6000, attack: 1.8, at });
        break;
      case "impact": this.tone(70, 0.6, { gain: 0.5, glide: 35, at }); this.noise(0.5, { type: "lowpass", f: 1200, gain: 0.4, glide: 200, at }); break;
      case "roar":
        this.noise(1.1, { f: big ? 320 : 600, q: 3, gain: 0.35, bus: "monster", glide: big ? 160 : 300, attack: 0.08, at });
        this.tone(big ? 70 : 130, 1.1, { type: "sawtooth", gain: 0.18, bus: "monster", filter: 700, glide: big ? 50 : 90, attack: 0.08, at });
        break;
      case "hiss": this.noise(0.7, { type: "highpass", f: 3000, gain: 0.2, bus: "monster", at }); break;
      case "screech": this.tone(1400, 0.4, { type: "sawtooth", gain: 0.08, bus: "monster", glide: 2200, filter: 3000, at }); break;
      case "cackle": [0, 0.12, 0.24].forEach((d) => this.tone(700, 0.08, { type: "square", gain: 0.06, bus: "monster", filter: 1800, glide: 500, at: at + d })); break;
      case "rumble": this.noise(1.0, { type: "lowpass", f: 200, gain: 0.5, bus: "monster", at }); break;
      case "chime": [1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.6, { gain: 0.08, bus: "monster", at: at + i * 0.08 })); break;
      case "charge": this.tone(200, o.dur || 0.8, { type: "sawtooth", gain: 0.1, filter: 1500, glide: 900, attack: 0.3, at }); this.noise(o.dur || 0.8, { f: 800, q: 4, gain: 0.08, glide: 4000, attack: 0.3, at }); break;
      case "beam": this.noise(o.dur || 0.9, { f: 1200, q: 0.5, gain: 0.4, glide: 500, attack: 0.02, at }); this.tone(90, o.dur || 0.9, { type: "sawtooth", gain: 0.2, filter: 600, at }); break;
      case "fire": this.noise(o.dur || 0.9, { type: "lowpass", f: 1400, gain: 0.45, glide: 600, attack: 0.05, at }); break;
      case "orb": this.tone(300, 0.6, { type: "sine", gain: 0.2, glide: 900, at }); this.tone(450, 0.6, { type: "triangle", gain: 0.1, glide: 1350, at }); break;
      case "whoosh": this.noise(0.35, { f: 600, q: 1, gain: 0.3, glide: 2400, at }); break;
      case "slash": this.noise(0.18, { type: "highpass", f: 2000, gain: 0.35, at }); this.tone(1800, 0.12, { type: "sawtooth", gain: 0.05, glide: 600, at }); break;
      case "water": this.noise(0.8, { f: 700, q: 0.8, gain: 0.35, glide: 1600, at }); break;
      case "shards": [2093, 2637, 3136, 2349].forEach((f, i) => this.tone(f, 0.2, { gain: 0.06, at: at + i * 0.04 })); break;
      case "hit": this.noise(0.25, { type: "lowpass", f: 2500, gain: 0.45, glide: 300, at }); this.tone(120, 0.2, { gain: 0.3, glide: 60, at }); break;
      case "destroy":
        this.noise(1.1, { type: "lowpass", f: 3000, gain: 0.4, glide: 120, at });
        [880, 660, 440].forEach((f, i) => this.tone(f, 0.4, { type: "triangle", gain: 0.06, at: at + 0.1 + i * 0.08 }));
        break;
      case "lightning": this.noise(0.5, { type: "highpass", f: 1500, gain: 0.55, at }); this.tone(60, 0.7, { gain: 0.4, glide: 30, at: at + 0.03 }); break;
      case "barrier": [523, 784, 1047].forEach((f, i) => this.tone(f, 0.9, { gain: 0.1, attack: 0.05, at: at + i * 0.03 })); this.noise(0.4, { f: 6000, q: 4, gain: 0.08, at }); break;
      case "rift": this.tone(60, 2.4, { type: "sawtooth", gain: 0.2, filter: 300, glide: 30, attack: 0.6, at }); this.noise(2.2, { f: 200, q: 2, gain: 0.3, glide: 60, attack: 0.8, at }); break;
      case "field": this.noise(1.8, { f: 300, q: 0.5, gain: 0.25, glide: 2400, attack: 0.6, at }); [262, 392, 523].forEach((f, i) => this.tone(f, 1.8, { type: "triangle", gain: 0.07, attack: 0.5, at: at + i * 0.15 })); break;
      case "revive": [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.6, { type: "sine", gain: 0.08, at: at + i * 0.09 })); break;
      case "fusion": this.tone(220, 2, { type: "sawtooth", gain: 0.08, filter: 1200, glide: 880, attack: 0.8, at }); this.tone(330, 2, { type: "sawtooth", gain: 0.08, filter: 1200, glide: 1320, attack: 0.8, at }); break;
      case "lp_down": this.tone(440, 0.5, { type: "square", gain: 0.06, filter: 1500, glide: 220, at }); break;
      case "victory": [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.5, { type: "triangle", gain: 0.12, bus: "music", at: at + i * 0.13 })); break;
      case "defeat": [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.8, { type: "triangle", gain: 0.1, bus: "music", at: at + i * 0.28 })); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- music
  // A slow, original ambient progression with a soft arpeggio. Generated, not sampled.
  startMusic() {
    this.wantMusic = true;
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 207.7, 246.9]];
    let i = 0;
    const bar = 4.8;
    const tick = () => {
      if (!this.musicOn) return;
      const ch = chords[i % chords.length];
      ch.forEach((f, k) => {
        this.tone(f / 2, bar + 0.6, { type: "sawtooth", gain: 0.035, bus: "music", filter: 700, attack: 1.4, detune: k * 4 });
        this.tone(f, bar + 0.6, { type: "triangle", gain: 0.025, bus: "music", attack: 1.6, detune: -k * 5 });
      });
      const arp = [0, 1, 2, 1, 2, 0, 2, 1];
      arp.forEach((n, k) => this.tone(ch[n] * 2, 0.5, { type: "sine", gain: 0.03, bus: "music", at: k * (bar / arp.length), attack: 0.01 }));
      i++;
      this.musicTimer = setTimeout(tick, bar * 1000);
    };
    tick();
  }
  stopMusic() { this.musicOn = false; this.wantMusic = false; clearTimeout(this.musicTimer); }
}

export const audio = new Audio();
