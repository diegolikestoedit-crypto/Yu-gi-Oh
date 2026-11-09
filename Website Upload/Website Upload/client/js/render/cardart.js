// Original card face and card back rendering. Monster art is a portrait of the same rig used on the field,
// so a card and its living monster always match. Results are cached per card id.
import { card as cardData, ATTR_COLORS, monsterKind, subtypeName } from "../carddb.js";
import { RIGS, basePose, shade, rgba } from "./rigs.js";
import { SpriteRenderer, ramp } from "./pixel.js";

export const CARD_W = 240, CARD_H = 350;
const cache = new Map();
const urlCache = new Map();
let backCanvas = null;

const FRAMES = {
  monster: ["#d6a04c", "#7a4a18"],
  effect: ["#d8743a", "#6e2a0e"],
  fusion: ["#a46be0", "#3e1d6b"],
  ascended: ["#f2dc8c", "#7a5414"],
  ritual: ["#5a8ae0", "#1a2e6a"],
  token: ["#a8a8b0", "#4a4a52"],
  spell: ["#2bb59d", "#0d4f47"],
  trap: ["#cf3a72", "#5a0f2e"],
};

function frameFor(c) {
  if (c.type === "monster") return FRAMES[c.subtype] || FRAMES.monster;
  return FRAMES[c.type];
}

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function wrap(ctx, text, x, y, maxW, lh, maxLines) {
  const words = text.split(" ");
  let line = "", lines = 0;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); y += lh; line = w;
      if (++lines >= maxLines - 1) { ctx.fillText(line + "…", x, y); return; }
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}

function attrGlyph(ctx, attr, x, y, r) {
  const [hi, lo] = ATTR_COLORS[attr] || ["#fff", "#888"];
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
  g.addColorStop(0, hi); g.addColorStop(1, lo);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = "rgba(20,10,0,.75)"; ctx.strokeStyle = "rgba(20,10,0,.75)"; ctx.lineWidth = 2;
  ctx.beginPath();
  const s = r * 0.5;
  switch (attr) {
    case "LIGHT": ctx.arc(x, y, s * 0.55, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.moveTo(x + Math.cos(a) * s * 0.8, y + Math.sin(a) * s * 0.8); ctx.lineTo(x + Math.cos(a) * s * 1.2, y + Math.sin(a) * s * 1.2); }
      ctx.stroke(); break;
    case "DARK": ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = lo; ctx.beginPath(); ctx.arc(x + s * 0.45, y - s * 0.2, s * 0.85, 0, Math.PI * 2); ctx.fill(); break;
    case "FIRE": ctx.moveTo(x, y - s * 1.2); ctx.quadraticCurveTo(x + s * 1.1, y, x, y + s); ctx.quadraticCurveTo(x - s * 1.1, y, x, y - s * 1.2); ctx.fill(); break;
    case "WATER": ctx.moveTo(x, y - s * 1.2); ctx.quadraticCurveTo(x + s, y + s * 0.2, x, y + s); ctx.quadraticCurveTo(x - s, y + s * 0.2, x, y - s * 1.2); ctx.fill(); break;
    case "WIND": ctx.arc(x, y, s * 0.9, 0.2, Math.PI * 1.6); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, s * 0.4, 0.2, Math.PI * 1.7); ctx.stroke(); break;
    case "EARTH": ctx.moveTo(x - s, y + s * 0.7); ctx.lineTo(x - s * 0.2, y - s); ctx.lineTo(x + s * 0.3, y - s * 0.2); ctx.lineTo(x + s * 0.6, y - s * 0.6); ctx.lineTo(x + s * 1.1, y + s * 0.7); ctx.fill(); break;
    default: ctx.fillText("?", x, y);
  }
}

// Monster portraits are pixel-art scenes: the same sprite as on the field, over a pixel backdrop.
const ART_PX = 2; // card-canvas pixels per art pixel
function drawMonsterArt(ctx, c, x, y, w, h) {
  const v = c.visual;
  const rig = RIGS[v.rig];
  const [hi, lo] = ATTR_COLORS[c.attribute] || ["#888", "#222"];
  const pw = Math.round(w / ART_PX), ph = Math.round(h / ART_PX);
  const art = document.createElement("canvas");
  art.width = pw; art.height = ph;
  const a = art.getContext("2d");
  // Banded sky: a stepped gradient instead of a smooth one.
  const sky = ramp(lo, 5).reverse();
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    const k = i / (bands - 1), col = sky[Math.min(sky.length - 1, Math.round(k * 2.2))];
    a.fillStyle = `rgb(${col})`;
    a.fillRect(0, Math.floor((i * ph * 0.8) / bands), pw, Math.ceil((ph * 0.8) / bands) + 1);
  }
  // Dithered halo behind the monster.
  const hr = ramp(hi, 3);
  const cx = pw * 0.55, cy = ph * 0.42;
  for (let yy = 0; yy < ph; yy++) for (let xx = 0; xx < pw; xx++) {
    const d = Math.hypot((xx - cx) / (pw * 0.42), (yy - cy) / (ph * 0.42));
    if (d < 0.55 || (d < 0.8 && (xx + yy) % 2 === 0) || (d < 1 && (xx % 2 === 0 && yy % 2 === 0))) {
      a.fillStyle = `rgba(${d < 0.55 ? hr[1] : hr[0]},${d < 0.55 ? 0.55 : 0.4})`;
      a.fillRect(xx, yy, 1, 1);
    }
  }
  // Ground strip and a few pixel stars.
  const gr = ramp(shade(lo, -0.3).startsWith("#") ? lo : lo, 3);
  a.fillStyle = `rgb(${gr[0]})`; a.fillRect(0, Math.floor(ph * 0.8), pw, ph);
  a.fillStyle = `rgb(${gr[1]})`; a.fillRect(0, Math.floor(ph * 0.8), pw, 1);
  let seed = c.id.split("").reduce((s, ch) => s + ch.charCodeAt(0), 7);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) { a.fillStyle = `rgba(255,250,230,${0.5 + rnd() * 0.5})`; a.fillRect(Math.floor(rnd() * pw), Math.floor(rnd() * ph * 0.6), 1, 1); }
  if (rig) {
    const box = rig.artBox;
    const R = Math.max(box.w / pw, box.h / ph) / 1.05; // rig units per art pixel
    const pose = basePose(0.6);
    if (v.rig === "dragon") { pose.jaw = 0.25; pose.raise = 0.25; }
    if (v.rig === "sorcerer") pose.charge = 0.4;
    const spr = new SpriteRenderer(v);
    const frame = spr.render(pose, R, { x0: box.cx - (pw * R) / 2, x1: box.cx + (pw * R) / 2, y0: box.cy - (ph * R) / 2 - ph * R * 0.03, y1: box.cy + (ph * R) / 2 - ph * R * 0.03 });
    a.drawImage(frame.canvas, 0, 0);
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(art, x, y, w, h);
  ctx.restore();
}

// Emblem art for spells and traps, chosen by the card's visual fx (never by name).
function drawEmblem(ctx, c, x, y, w, h) {
  const v = c.visual || {};
  const pa = v.palette || { a: "#334", b: "#99f" };
  const bg = ctx.createRadialGradient(x + w / 2, y + h / 2, 4, x + w / 2, y + h / 2, w * 0.75);
  bg.addColorStop(0, shade(pa.b, -0.1)); bg.addColorStop(0.5, shade(pa.a, 0.05)); bg.addColorStop(1, shade(pa.a, -0.5));
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(cx, cy);
  ctx.strokeStyle = pa.b; ctx.fillStyle = pa.b; ctx.lineWidth = 3;
  ctx.shadowColor = pa.b; ctx.shadowBlur = 14;
  const R = Math.min(w, h) * 0.36;
  switch (v.fx) {
    case "draw": // chalice
      ctx.beginPath(); ctx.moveTo(-R * 0.7, -R * 0.6); ctx.quadraticCurveTo(-R * 0.6, R * 0.2, 0, R * 0.25); ctx.quadraticCurveTo(R * 0.6, R * 0.2, R * 0.7, -R * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillRect(-4, R * 0.2, 8, R * 0.5); ctx.fillRect(-R * 0.4, R * 0.68, R * 0.8, 8);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = "#fff"; ctx.fillRect(-R * 0.5 + i * R * 0.35, -R - 18 - i * 6, R * 0.28, R * 0.4); }
      break;
    case "void_rift":
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(0, 0, R * (1 - i * 0.18), i, i + 4.5); ctx.stroke(); }
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(0, 0, R * 0.25, 0, Math.PI * 2); ctx.fill();
      break;
    case "lightning":
      ctx.fillStyle = "#fff8c0";
      ctx.beginPath(); ctx.moveTo(R * 0.1, -R * 1.1); ctx.lineTo(-R * 0.45, R * 0.05); ctx.lineTo(-R * 0.05, R * 0.05); ctx.lineTo(-R * 0.25, R * 1.1); ctx.lineTo(R * 0.5, -R * 0.2); ctx.lineTo(R * 0.08, -R * 0.2); ctx.closePath(); ctx.fill();
      break;
    case "revive":
      ctx.beginPath(); ctx.arc(0, R * 0.2, R * 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, R * 0.9); ctx.lineTo(0, -R * 1.1); ctx.moveTo(-R * 0.35, -R * 0.6); ctx.lineTo(0, -R * 1.1); ctx.lineTo(R * 0.35, -R * 0.6); ctx.stroke();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.fillRect(Math.cos(a) * R * 0.7 - 3, R * 0.2 + Math.sin(a) * R * 0.7 - 3, 6, 6); }
      break;
    case "blades":
      for (let i = -2; i <= 2; i++) { ctx.save(); ctx.translate(i * R * 0.42, Math.abs(i) * 8); ctx.fillStyle = "#fff6c0";
        ctx.beginPath(); ctx.moveTo(-5, -R); ctx.lineTo(5, -R); ctx.lineTo(4, R * 0.5); ctx.lineTo(0, R * 0.8); ctx.lineTo(-4, R * 0.5); ctx.fill(); ctx.fillRect(-12, -R + 6, 24, 5); ctx.restore(); }
      break;
    case "fusion":
      for (let i = 0; i < 2; i++) { ctx.strokeStyle = i ? pa.a === "#ff9bf0" ? "#ff9bf0" : pa.b : pa.b; ctx.beginPath(); for (let a = 0; a < 9; a += 0.1) { const r = a * R * 0.11; const px = Math.cos(a + i * Math.PI) * r, py = Math.sin(a + i * Math.PI) * r; a ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
      break;
    case "field":
      ctx.shadowBlur = 0;
      ctx.fillStyle = rgba(pa.b, 0.9);
      ctx.beginPath(); ctx.moveTo(-w / 2, R * 0.6); ctx.lineTo(-R * 0.6, -R * 0.3); ctx.lineTo(-R * 0.1, R * 0.2); ctx.lineTo(R * 0.4, -R * 0.6); ctx.lineTo(w / 2, R * 0.5); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(R * 0.6, -R * 0.75, R * 0.22, 0, Math.PI * 2); ctx.fill();
      break;
    case "prism_barrier":
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 - Math.PI / 2; ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); } ctx.closePath(); ctx.stroke();
      ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(-R, -R * 1.2); ctx.lineTo(0, 0); ctx.lineTo(R * 1.2, -R * 0.6); ctx.stroke();
      break;
    case "echo_chamber":
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(0, -R * 0.7 + i * R * 0.7, R * 0.6, R * 0.22, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(-R * 0.6, -R * 0.7); ctx.lineTo(-R * 0.6, R * 0.7); ctx.moveTo(R * 0.6, -R * 0.7); ctx.lineTo(R * 0.6, R * 0.7); ctx.stroke();
      break;
    case "barrier":
      ctx.beginPath(); ctx.arc(0, R * 0.4, R, Math.PI, 0); ctx.stroke();
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(0, R * 0.4, R * (0.3 + i * 0.15), Math.PI, 0); ctx.globalAlpha = 0.4; ctx.stroke(); }
      ctx.globalAlpha = 1;
      break;
    case "sinkhole":
      ctx.fillStyle = "#050302"; ctx.beginPath(); ctx.ellipse(0, R * 0.3, R, R * 0.38, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = pa.b; for (let i = 0; i < 7; i++) { const a = i * 0.9; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R, R * 0.3 + Math.sin(a) * R * 0.38); ctx.lineTo(Math.cos(a) * R * 1.4, R * 0.3 + Math.sin(a) * R * 0.55); ctx.stroke(); }
      break;
    case "equip_blade": // upright sword
      ctx.fillStyle = "#fff3c8";
      ctx.beginPath(); ctx.moveTo(0, -R * 1.15); ctx.lineTo(R * 0.14, -R * 0.9); ctx.lineTo(R * 0.12, R * 0.45); ctx.lineTo(-R * 0.12, R * 0.45); ctx.lineTo(-R * 0.14, -R * 0.9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = pa.b; ctx.fillRect(-R * 0.55, R * 0.42, R * 1.1, 9); ctx.fillRect(-6, R * 0.5, 12, R * 0.45);
      ctx.beginPath(); ctx.arc(0, R * 1.02, 9, 0, Math.PI * 2); ctx.fill();
      break;
    case "equip_shield":
      ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(R * 0.85, -R * 0.65); ctx.quadraticCurveTo(R * 0.8, R * 0.6, 0, R * 1.05); ctx.quadraticCurveTo(-R * 0.8, R * 0.6, -R * 0.85, -R * 0.65); ctx.closePath();
      ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -R * 0.6); ctx.lineTo(0, R * 0.6); ctx.moveTo(-R * 0.45, -R * 0.15); ctx.lineTo(R * 0.45, -R * 0.15); ctx.stroke();
      break;
    case "surge": // rising chevrons
      ctx.fillStyle = "#fff6b0";
      for (let i = 0; i < 3; i++) { const y = R * 0.7 - i * R * 0.62; ctx.beginPath(); ctx.moveTo(-R * 0.8, y + R * 0.3); ctx.lineTo(0, y - R * 0.25); ctx.lineTo(R * 0.8, y + R * 0.3); ctx.lineTo(R * 0.8, y + R * 0.05); ctx.lineTo(0, y - R * 0.5); ctx.lineTo(-R * 0.8, y + R * 0.05); ctx.closePath(); ctx.globalAlpha = 0.5 + i * 0.25; ctx.fill(); }
      ctx.globalAlpha = 1;
      break;
    case "tempest":
    case "squall": // spiral gale
      for (let k = 0; k < 3; k++) { ctx.beginPath(); for (let a = 0; a < 7; a += 0.12) { const r = a * R * 0.15; const px = Math.cos(a + k * 2.1) * r, py = Math.sin(a + k * 2.1) * r * 0.7; a ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
      if (v.fx === "squall") { ctx.fillStyle = "#fff"; for (let i = 0; i < 6; i++) ctx.fillRect(-R + i * R * 0.4, -R * 0.9 + (i % 2) * 14, 5, 5); }
      break;
    case "lantern":
      ctx.beginPath(); ctx.arc(0, -R * 0.95, R * 0.18, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-R * 0.4, -R * 0.7); ctx.lineTo(R * 0.4, -R * 0.7); ctx.lineTo(R * 0.5, R * 0.6); ctx.lineTo(-R * 0.5, R * 0.6); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = "#fff3a0"; ctx.beginPath(); ctx.ellipse(0, 0, R * 0.2, R * 0.34, 0, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.fillRect(Math.cos(a) * R * 0.95 - 2, Math.sin(a) * R * 0.95 - 2, 4, 4); }
      break;
    case "champion": // a banner on a spear, haloed
      ctx.beginPath(); ctx.arc(0, -R * 0.2, R * 0.9, 0, Math.PI * 2); ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff3c0"; ctx.fillRect(-4, -R * 1.1, 8, R * 2.1);
      ctx.fillStyle = pa.b; ctx.beginPath(); ctx.moveTo(4, -R); ctx.lineTo(R * 0.8, -R * 0.75); ctx.lineTo(4, -R * 0.45); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-12, -R * 1.05); ctx.lineTo(0, -R * 1.35); ctx.lineTo(12, -R * 1.05); ctx.fill();
      break;
    case "crown":
      ctx.fillStyle = "#fff0b0";
      ctx.beginPath(); ctx.moveTo(-R, R * 0.35); ctx.lineTo(-R * 0.9, -R * 0.45); ctx.lineTo(-R * 0.45, 0); ctx.lineTo(0, -R * 0.75); ctx.lineTo(R * 0.45, 0); ctx.lineTo(R * 0.9, -R * 0.45); ctx.lineTo(R, R * 0.35); ctx.closePath(); ctx.fill();
      ctx.fillStyle = pa.a; ctx.fillRect(-R, R * 0.35, R * 2, R * 0.22);
      for (const x of [-R * 0.9, 0, R * 0.9]) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, x === 0 ? -R * 0.8 : -R * 0.5, 6, 0, Math.PI * 2); ctx.fill(); }
      for (let i = 0; i < 7; i++) { ctx.globalAlpha = 0.5; ctx.fillRect(-2, -R * 1.5 + i * 3, 4, 2); ctx.globalAlpha = 1; }
      break;
    case "rally": // rising phoenix wings over a shield
      ctx.beginPath(); ctx.moveTo(0, -R * 0.4); ctx.lineTo(R * 0.5, -R * 0.2); ctx.quadraticCurveTo(R * 0.5, R * 0.5, 0, R * 0.9); ctx.quadraticCurveTo(-R * 0.5, R * 0.5, -R * 0.5, -R * 0.2); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = "#ffd88a";
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * R * 0.3, -R * 0.3); ctx.quadraticCurveTo(sx * R * 1.2, -R * 1.1, sx * R * 1.1, R * 0.1); ctx.quadraticCurveTo(sx * R * 0.8, -R * 0.3, sx * R * 0.3, -R * 0.3); ctx.fill(); }
      break;
    case "null_seal": // crossed-out circle of runes
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, R * 0.72, 0, Math.PI * 2); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-R * 0.7, -R * 0.7); ctx.lineTo(R * 0.7, R * 0.7); ctx.stroke();
      for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; ctx.fillRect(Math.cos(a) * R * 0.86 - 3, Math.sin(a) * R * 0.86 - 3, 6, 6); }
      break;
    case "gravity": // pressing rings
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(0, R * 0.6 - i * 4, R * (1 - i * 0.2), R * 0.28 * (1 - i * 0.2), 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = pa.b; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * R * 0.5, -R); ctx.lineTo(i * R * 0.5 + 10, -R * 0.55); ctx.lineTo(i * R * 0.5 - 10, -R * 0.55); ctx.fill(); ctx.fillRect(i * R * 0.5 - 3, -R * 1.2, 6, R * 0.65); }
      break;
    default:
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function render(c) {
  const cv = document.createElement("canvas");
  cv.width = CARD_W; cv.height = CARD_H;
  const ctx = cv.getContext("2d");
  const [fa, fb] = frameFor(c);
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 14);
  ctx.fillStyle = "#0c0a08"; ctx.fill();
  const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  g.addColorStop(0, shade(fa, 0.15)); g.addColorStop(0.5, fa); g.addColorStop(1, fb);
  roundRect(ctx, 6, 6, CARD_W - 12, CARD_H - 12, 10); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = "rgba(255,240,200,.55)"; ctx.lineWidth = 1.5; ctx.stroke();
  // texture lines
  ctx.save(); ctx.globalAlpha = 0.08; ctx.strokeStyle = "#fff";
  for (let i = -CARD_H; i < CARD_W; i += 9) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + CARD_H, CARD_H); ctx.stroke(); }
  ctx.restore();

  // name bar
  roundRect(ctx, 14, 14, CARD_W - 28, 32, 6);
  ctx.fillStyle = "rgba(10,8,6,.55)"; ctx.fill();
  ctx.font = "800 15px 'Nunito Sans', system-ui, sans-serif";
  ctx.textBaseline = "middle";
  if (c.rarity === "ultra") {
    const ng = ctx.createLinearGradient(20, 20, 200, 40);
    ng.addColorStop(0, "#fff6d0"); ng.addColorStop(0.5, "#f4cf6a"); ng.addColorStop(1, "#fffbe8");
    ctx.fillStyle = ng;
  } else ctx.fillStyle = c.rarity === "rare" ? "#ffffff" : "#f2ead8";
  let name = c.name;
  while (ctx.measureText(name).width > CARD_W - 74 && name.length > 4) name = name.slice(0, -2) + "…";
  ctx.fillText(name, 22, 31);
  if (c.type === "monster") attrGlyph(ctx, c.attribute, CARD_W - 32, 30, 12);
  else {
    ctx.fillStyle = c.type === "spell" ? "#7af0d0" : "#ff9bc0";
    ctx.beginPath(); ctx.arc(CARD_W - 32, 30, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1a1008"; ctx.font = "900 13px system-ui"; ctx.textAlign = "center";
    ctx.fillText(c.type === "spell" ? "S" : "T", CARD_W - 32, 31); ctx.textAlign = "left";
  }

  // level pips / type label
  ctx.font = "800 11px 'Nunito Sans', system-ui, sans-serif";
  if (c.type === "monster") {
    for (let i = 0; i < c.level; i++) {
      const x = CARD_W - 30 - i * 17, y = 58;
      ctx.fillStyle = "#ffcf4a"; ctx.strokeStyle = "#7a3a00"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  } else {
    ctx.fillStyle = "#fff"; ctx.textAlign = "right";
    const sub = subtypeName(c) ? ` · ${subtypeName(c).toUpperCase()}` : "";
    ctx.fillText(`${c.type.toUpperCase()} CARD${sub}`, CARD_W - 18, 58);
    ctx.textAlign = "left";
  }

  // art window
  const ax = 22, ay = 70, aw = CARD_W - 44, ah = 160;
  ctx.fillStyle = "#000"; ctx.fillRect(ax - 3, ay - 3, aw + 6, ah + 6);
  if (c.type === "monster") drawMonsterArt(ctx, c, ax, ay, aw, ah);
  else drawEmblem(ctx, c, ax, ay, aw, ah);
  ctx.strokeStyle = "rgba(255,235,190,.7)"; ctx.lineWidth = 1.5; ctx.strokeRect(ax - 1, ay - 1, aw + 2, ah + 2);
  const badge = c.subtype === "fusion" ? ["FUSION · LV " + c.level, "rgba(40,14,70,.88)", "#d9b8ff", "#f1e2ff", 92]
    : c.subtype === "ascended" ? ["ASCENDED · LV " + c.level, "rgba(70,44,6,.9)", "#ffe58a", "#fff6d0", 112]
    : c.fusion_substitute ? ["HERALD · ANY MATERIAL", "rgba(10,40,60,.88)", "#9fe8ff", "#e6fbff", 132] : null;
  if (badge) {
    // Fusions (Level 7+), Ascended monsters and Heralds are marked on the art so they read at a glance.
    const [label, bg, edge, ink, bw] = badge;
    ctx.save();
    roundRect(ctx, ax + 6, ay + ah - 24, bw, 18, 9);
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = ink; ctx.font = "900 10px 'Nunito Sans', system-ui, sans-serif"; ctx.textBaseline = "middle";
    ctx.fillText(label, ax + 14, ay + ah - 15);
    ctx.restore();
  }
  if (c.rarity === "ultra") {
    const foil = ctx.createLinearGradient(ax, ay, ax + aw, ay + ah);
    foil.addColorStop(0, "rgba(255,255,255,0)"); foil.addColorStop(0.45, "rgba(255,255,255,.18)"); foil.addColorStop(0.55, "rgba(180,220,255,.14)"); foil.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = foil; ctx.fillRect(ax, ay, aw, ah);
  }

  // text box
  const tx = 16, ty = 240, tw = CARD_W - 32, th = 92;
  roundRect(ctx, tx, ty, tw, th, 6);
  ctx.fillStyle = c.type === "monster" ? "#efe3c4" : c.type === "spell" ? "#d7efe8" : "#f1d9e3"; ctx.fill();
  ctx.fillStyle = "#2a1c0c";
  ctx.textBaseline = "alphabetic";
  let ly = ty + 15;
  if (c.type === "monster") {
    ctx.font = "800 10.5px 'Nunito Sans', system-ui, sans-serif";
    ctx.fillText(`[${c.race} / ${monsterKind(c)}]`, tx + 7, ly);
    ly += 13;
  }
  ctx.font = "italic 400 10px 'Nunito Sans', system-ui, sans-serif";
  if (c.type !== "monster" || c.subtype !== "normal") ctx.font = "600 10.5px 'Nunito Sans', system-ui, sans-serif";
  wrap(ctx, c.text, tx + 7, ly, tw - 14, 12, c.type === "monster" ? 4 : 6);
  if (c.type === "monster") {
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(tx + 6, ty + th - 20, tw - 12, 1);
    ctx.font = "900 12px 'Nunito Sans', system-ui, sans-serif"; ctx.fillStyle = "#2a1c0c"; ctx.textAlign = "right";
    ctx.fillText(`ATK/${c.atk}   DEF/${c.def}`, tx + tw - 8, ty + th - 6);
    ctx.textAlign = "left";
  }
  ctx.font = "700 8px system-ui"; ctx.fillStyle = "rgba(255,255,255,.6)";
  ctx.fillText(c.id, 18, CARD_H - 9);
  return cv;
}

export function cardCanvas(cid) {
  if (!cid) return cardBack();
  if (!cache.has(cid)) {
    const c = cardData(cid);
    if (!c) return cardBack();
    cache.set(cid, render(c));
  }
  return cache.get(cid);
}

export function cardURL(cid) {
  const key = cid || "__back";
  if (!urlCache.has(key)) urlCache.set(key, cardCanvas(cid).toDataURL("image/png"));
  return urlCache.get(key);
}

export function cardBack() {
  if (backCanvas) return backCanvas;
  const cv = document.createElement("canvas");
  cv.width = CARD_W; cv.height = CARD_H;
  const ctx = cv.getContext("2d");
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 14); ctx.fillStyle = "#07060e"; ctx.fill();
  const g = ctx.createRadialGradient(CARD_W / 2, CARD_H / 2, 10, CARD_W / 2, CARD_H / 2, CARD_H * 0.7);
  g.addColorStop(0, "#3a2f8f"); g.addColorStop(0.55, "#17154a"); g.addColorStop(1, "#090822");
  roundRect(ctx, 7, 7, CARD_W - 14, CARD_H - 14, 10); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = "#c9a24a"; ctx.lineWidth = 3; ctx.stroke();
  ctx.save(); ctx.translate(CARD_W / 2, CARD_H / 2);
  ctx.strokeStyle = "rgba(244,207,106,.85)"; ctx.lineWidth = 2;
  for (const r of [78, 64, 30]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = "rgba(244,207,106,.9)";
  ctx.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 26 : 60; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#17154a"; ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#9fe6ff"; ctx.shadowColor = "#9fe6ff"; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = "rgba(244,207,106,.8)"; ctx.font = "700 14px 'Cinzel', Georgia, serif"; ctx.textAlign = "center";
  ctx.fillText("LIVING DUEL", CARD_W / 2, CARD_H - 34);
  ctx.fillText("LIVING DUEL", CARD_W / 2, 46);
  backCanvas = cv;
  return cv;
}
