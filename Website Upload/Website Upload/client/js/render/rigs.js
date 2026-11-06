// Procedural 2D character rigs. Each rig draws one original monster facing right with its feet at (0,0),
// reading a pose object that the actor animates (breathing, wing flaps, jaw, staff raise, lunge, recoil...).
// draw() returns anchor points (local coords) that effects use, e.g. the mouth a beam comes from.
//
// Rigs are data-driven by card.visual (rig name, palette, variant, scale). A sprite-sheet rig can be added
// to RIGS with the same interface when commissioned art is available.

const TAU = Math.PI * 2;

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function ell(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); }
function lin(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function rad(ctx, x, y, r, stops) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.1, r));
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function glowDot(ctx, x, y, r, color, P) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = rad(ctx, x, y, r * 3, [[0, color], [0.3, rgba(toHex(color), 0.5)], [1, "rgba(0,0,0,0)"]]);
  ctx.beginPath(); ctx.arc(x, y, r * 3, 0, TAU); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, TAU); ctx.fill();
  ctx.restore();
}
function toHex(c) { return c.startsWith("#") ? c : "#ffffff"; }
const lerp = (a, b, t) => a + (b - a) * t;
function bez(p0, p1, p2, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}
function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}
// Smooth tapered tube along a list of points: used for tails, necks, serpent bodies.
function tube(ctx, pts, r0, r1, fill, edge) {
  ctx.fillStyle = fill;
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, r = lerp(r0, r1, i / (pts.length - 1));
    left.push({ x: pts[i].x + nx * r, y: pts[i].y + ny * r });
    right.push({ x: pts[i].x - nx * r, y: pts[i].y - ny * r });
  }
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  const end = pts[pts.length - 1];
  ctx.arc(end.x, end.y, Math.max(0.5, r1), 0, TAU);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke(); }
  return { left, right };
}
function limb(ctx, pts, w0, w1, color) {
  ctx.strokeStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (let i = 0; i < pts.length - 1; i++) {
    ctx.lineWidth = lerp(w0, w1, i / Math.max(1, pts.length - 2));
    ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i + 1].x, pts[i + 1].y); ctx.stroke();
  }
}
function claws(ctx, x, y, dir, color, n = 3, len = 10) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const ox = x + dir * (i * 7 - 4);
    ctx.beginPath(); ctx.moveTo(ox, y - 4); ctx.lineTo(ox + dir * len, y + 1); ctx.lineTo(ox, y + 3); ctx.fill();
  }
}

// --------------------------------------------------------------------- dragon
function dragonWing(ctx, sx, sy, flap, pal, far, size = 1) {
  const th = -2.05 + flap * 0.55;
  const elbow = { x: sx + Math.cos(th) * 62 * size, y: sy + Math.sin(th) * 62 * size };
  const wa = th + 0.55 - flap * 0.15;
  const wrist = { x: elbow.x + Math.cos(wa) * 70 * size, y: elbow.y + Math.sin(wa) * 70 * size };
  const fingers = [-0.95, -0.35, 0.3, 0.95].map((o, i) => {
    const a = wa - 2.0 + o * 0.62 + flap * 0.1;
    const L = [125, 140, 122, 96][i] * size;
    return { x: wrist.x + Math.cos(a) * L, y: wrist.y + Math.sin(a) * L };
  });
  const attach = { x: sx - 60 * size, y: sy + 34 * size };
  // The far wing is a step darker, not black, so it keeps its shading ramp in pixel form.
  const base = far ? shade(pal.wing, -0.2) : pal.wing;
  ctx.save();
  ctx.fillStyle = lin(ctx, wrist.x, wrist.y, attach.x, attach.y + 60, [[0, shade(base, 0.15)], [1, shade(base, -0.35)]]);
  ctx.beginPath();
  ctx.moveTo(sx, sy); ctx.lineTo(elbow.x, elbow.y); ctx.lineTo(wrist.x, wrist.y); ctx.lineTo(fingers[0].x, fingers[0].y);
  let prev = fingers[0];
  for (let i = 1; i < fingers.length; i++) {
    const f = fingers[i];
    const cx = lerp(prev.x, f.x, 0.5) * 0.7 + wrist.x * 0.3, cy = lerp(prev.y, f.y, 0.5) * 0.7 + wrist.y * 0.3;
    ctx.quadraticCurveTo(cx, cy, f.x, f.y);
    prev = f;
  }
  ctx.quadraticCurveTo(lerp(prev.x, attach.x, 0.5) + 10, lerp(prev.y, attach.y, 0.5) - 20, attach.x, attach.y);
  ctx.closePath();
  ctx.fill();
  const bone = far ? shade(pal.shade, -0.12) : pal.shade;
  limb(ctx, [{ x: sx, y: sy }, elbow, wrist], 9 * size, 6 * size, bone);
  ctx.lineWidth = 3 * size; ctx.strokeStyle = bone;
  for (const f of fingers) { ctx.beginPath(); ctx.moveTo(wrist.x, wrist.y); ctx.lineTo(f.x, f.y); ctx.stroke(); }
  ctx.fillStyle = pal.accent;
  ctx.beginPath(); ctx.moveTo(wrist.x, wrist.y); ctx.lineTo(wrist.x - 6, wrist.y - 18 * size); ctx.lineTo(wrist.x + 6, wrist.y - 2); ctx.fill();
  ctx.restore();
}

function dragonHead(ctx, pal, P, glow) {
  const jaw = P.jaw * 0.6;
  // horns
  ctx.fillStyle = lin(ctx, -10, -20, -60, -50, [[0, pal.accent], [1, shade(pal.accent, -0.4)]]);
  ctx.beginPath(); ctx.moveTo(-14, -14); ctx.quadraticCurveTo(-44, -28, -66, -46); ctx.quadraticCurveTo(-40, -18, -20, -4); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-4, -18); ctx.quadraticCurveTo(-24, -40, -42, -62); ctx.quadraticCurveTo(-18, -34, -8, -8); ctx.fill();
  // lower jaw
  ctx.save();
  ctx.translate(-6, 8); ctx.rotate(jaw);
  ctx.fillStyle = shade(pal.body, -0.25);
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(58, 2); ctx.lineTo(52, 11); ctx.quadraticCurveTo(20, 16, -6, 12); ctx.closePath(); ctx.fill();
  if (jaw > 0.05) {
    ctx.fillStyle = "#fffdf2";
    for (let i = 0; i < 5; i++) { const x = 10 + i * 9; ctx.beginPath(); ctx.moveTo(x, 1); ctx.lineTo(x + 3, -6); ctx.lineTo(x + 6, 1); ctx.fill(); }
  }
  ctx.restore();
  if (jaw > 0.05) {
    ctx.fillStyle = rgba(toHex(glow), 0.85);
    ctx.beginPath(); ctx.moveTo(-4, 8); ctx.lineTo(60, 6); ctx.lineTo(56, 8 + jaw * 30); ctx.closePath(); ctx.fill();
  }
  // skull
  ctx.fillStyle = lin(ctx, 0, -30, 0, 14, [[0, shade(pal.body, 0.2)], [1, pal.shade]]);
  ctx.beginPath();
  ctx.moveTo(-24, -14); ctx.quadraticCurveTo(4, -32, 36, -16); ctx.lineTo(64, -4); ctx.quadraticCurveTo(68, 2, 62, 7);
  ctx.lineTo(18, 9); ctx.quadraticCurveTo(-10, 16, -26, 10); ctx.closePath(); ctx.fill();
  // brow ridge + nostril
  ctx.strokeStyle = shade(pal.shade, -0.25); ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(4, -16); ctx.quadraticCurveTo(22, -20, 34, -12); ctx.stroke();
  ctx.fillStyle = shade(pal.shade, -0.4); ell(ctx, 58, -2, 3, 1.6, 0.3); ctx.fill();
  // eye
  ctx.save();
  ctx.shadowColor = pal.eye; ctx.shadowBlur = 14;
  ctx.fillStyle = pal.eye; ell(ctx, 16, -9, 7, 3.6, -0.15); ctx.fill();
  ctx.fillStyle = "#fff"; ell(ctx, 18, -10, 2, 1.4); ctx.fill();
  ctx.restore();
  // crest
  ctx.fillStyle = pal.accent;
  for (let i = 0; i < 3; i++) {
    const x = -18 + i * 12;
    ctx.beginPath(); ctx.moveTo(x, -20 + i * 2); ctx.lineTo(x - 10, -34 + i * 3); ctx.lineTo(x + 6, -22 + i * 2); ctx.fill();
  }
}

function dragon(ctx, P, pal) {
  const t = P.t;
  const br = Math.sin(t * 2.1);
  const rear = P.raise, lunge = P.lunge, crouch = P.crouch;
  const flap = Math.sin(t * 2.3 * (P.flapRate || 1)) * (1 - crouch * 0.6) + rear * 0.5;
  const bx = -8 + lunge * 26 - P.recoil * 22;
  const by = -104 + br * 3 + crouch * 16 - rear * 12;
  const glow = pal.glow;

  dragonWing(ctx, bx + 18, by - 30, flap * 0.9, pal, true, 1.0);

  // tail
  const sway = Math.sin(t * 1.4) * 14;
  const tailPts = [];
  const tp = [{ x: bx - 55, y: by + 8 }, { x: bx - 130, y: by + 26 }, { x: bx - 170, y: -18 + sway * 0.4 }, { x: bx - 236, y: -40 + sway }];
  for (let i = 0; i <= 18; i++) tailPts.push(cubic(tp[0], tp[1], tp[2], tp[3], i / 18));
  tube(ctx, tailPts, 26, 3, lin(ctx, 0, by - 20, 0, 0, [[0, pal.body], [1, pal.shade]]));
  ctx.fillStyle = pal.accent;
  for (let i = 3; i < 17; i += 3) {
    const p = tailPts[i];
    ctx.beginPath(); ctx.moveTo(p.x - 6, p.y - 14 + i * 0.6); ctx.lineTo(p.x, p.y - 28 + i * 0.9); ctx.lineTo(p.x + 6, p.y - 14 + i * 0.6); ctx.fill();
  }

  // far legs
  const farLeg = shade(pal.shade, -0.3);
  limb(ctx, [{ x: bx - 40, y: by + 20 }, { x: bx - 58, y: by + 64 }, { x: bx - 44, y: -6 }], 30, 16, farLeg);
  limb(ctx, [{ x: bx + 40, y: by + 22 }, { x: bx + 30, y: by + 66 }, { x: bx + 44, y: -6 }], 22, 12, farLeg);

  // body
  ctx.fillStyle = lin(ctx, 0, by - 50, 0, by + 50, [[0, shade(pal.body, 0.12)], [0.6, pal.body], [1, pal.shade]]);
  ell(ctx, bx, by, 80, 52, -0.12); ctx.fill();
  ctx.fillStyle = rgba(toHex(pal.glow), 0.25);
  ell(ctx, bx + 10, by + 22, 58, 22, -0.1); ctx.fill();
  ctx.strokeStyle = rgba("#000000", 0.18); ctx.lineWidth = 2;
  for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(bx + i * 14 - 4, by + 10); ctx.quadraticCurveTo(bx + i * 14, by + 30, bx + i * 14 + 6, by + 42); ctx.stroke(); }

  // neck + head
  const hx = bx + 118 + lunge * 46 - rear * 34 - P.recoil * 10;
  const hy = by - 102 - rear * 30 + br * 5 + crouch * 20 + lunge * 20;
  const n0 = { x: bx + 46, y: by - 24 }, n1 = { x: bx + 96 + lunge * 20, y: by - 30 - rear * 30 }, n2 = { x: hx - 12, y: hy + 10 };
  const neck = [];
  for (let i = 0; i <= 12; i++) neck.push(bez(n0, n1, n2, i / 12));
  tube(ctx, neck, 30, 17, lin(ctx, 0, hy, 0, by, [[0, pal.body], [1, shade(pal.body, -0.1)]]));
  ctx.fillStyle = pal.accent;
  for (let i = 1; i < 12; i += 2) {
    const p = neck[i];
    ctx.beginPath(); ctx.moveTo(p.x - 8, p.y - 18 + i); ctx.lineTo(p.x - 12, p.y - 34 + i); ctx.lineTo(p.x + 2, p.y - 20 + i); ctx.fill();
  }

  // near legs
  limb(ctx, [{ x: bx - 30, y: by + 18 }, { x: bx - 48, y: by + 62 }, { x: bx - 30, y: -4 }], 34, 18, pal.shade);
  claws(ctx, bx - 30, -3, 1, pal.accent);
  limb(ctx, [{ x: bx + 50, y: by + 18 }, { x: bx + 42, y: by + 64 }, { x: bx + 58, y: -4 }], 26, 14, pal.shade);
  claws(ctx, bx + 58, -3, 1, pal.accent);

  const ha = -0.12 - rear * 0.4 + lunge * 0.28;
  ctx.save();
  ctx.translate(hx, hy); ctx.rotate(ha);
  dragonHead(ctx, pal, P, glow);
  ctx.restore();
  const mouth = { x: hx + Math.cos(ha) * 64 - Math.sin(ha) * 8, y: hy + Math.sin(ha) * 64 + Math.cos(ha) * 8 };

  dragonWing(ctx, bx - 4, by - 36, flap, pal, false, 1.08);

  if (P.charge > 0.01) glowDot(ctx, mouth.x, mouth.y, 6 + P.charge * 18, glow, P);
  return { mouth, attack: mouth, center: { x: bx, y: by - 20 }, top: { x: bx + 40, y: by - 190 } };
}

// ------------------------------------------------------------------- sorcerer
function sorcerer(ctx, P, pal) {
  const t = P.t;
  const bob = Math.sin(t * 1.7) * 7;
  const y0 = -26 + bob + P.crouch * 10;
  const lean = P.lunge * 0.15 - P.recoil * 0.2;
  const raise = P.raise;
  ctx.save();
  ctx.translate(0, y0);
  ctx.rotate(lean);

  // rotating rune halo
  ctx.save();
  ctx.translate(-6, -150);
  ctx.rotate(t * 0.4);
  ctx.strokeStyle = rgba(toHex(pal.accent), 0.35 + P.charge * 0.4); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 62, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 52, 0, TAU); ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    ctx.save(); ctx.rotate(a); ctx.translate(57, 0);
    ctx.fillStyle = rgba(toHex(pal.glow), 0.6);
    ctx.fillRect(-2, -5, 4, 10);
    ctx.restore();
  }
  ctx.restore();

  // cape
  const wave = Math.sin(t * 2.2);
  ctx.fillStyle = lin(ctx, 0, -150, 0, 0, [[0, shade(pal.cloth, -0.2)], [1, shade(pal.cloth, -0.55)]]);
  ctx.beginPath();
  ctx.moveTo(-22, -148); ctx.quadraticCurveTo(-60, -90, -78 + wave * 6, -6);
  ctx.quadraticCurveTo(-40, 4 + wave * 4, -10, -4); ctx.lineTo(20, -140); ctx.closePath(); ctx.fill();

  // robe
  ctx.fillStyle = lin(ctx, -40, -150, 40, 0, [[0, shade(pal.body, 0.15)], [0.5, pal.body], [1, pal.shade]]);
  ctx.beginPath();
  ctx.moveTo(-26, -150); ctx.lineTo(26, -150);
  ctx.quadraticCurveTo(44, -80, 54, -14);
  for (let i = 0; i <= 6; i++) {
    const x = 54 - i * 18;
    ctx.quadraticCurveTo(x - 9, -4 + Math.sin(t * 3 + i) * 4, x - 18, -14);
  }
  ctx.quadraticCurveTo(-46, -80, -26, -150); ctx.closePath(); ctx.fill();
  // trim + sash
  ctx.strokeStyle = pal.accent; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-2, -146); ctx.lineTo(4, -16); ctx.stroke();
  ctx.fillStyle = shade(pal.cloth, -0.1);
  ctx.fillRect(-30, -102, 62, 10);
  ctx.save(); ctx.shadowColor = pal.accent; ctx.shadowBlur = 12;
  ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.moveTo(2, -106); ctx.lineTo(9, -97); ctx.lineTo(2, -88); ctx.lineTo(-5, -97); ctx.fill();
  ctx.restore();
  // pauldrons
  ctx.fillStyle = lin(ctx, 0, -165, 0, -135, [[0, shade(pal.accent, 0.2)], [1, shade(pal.body, -0.3)]]);
  ell(ctx, -26, -148, 18, 11, -0.3); ctx.fill();
  ell(ctx, 26, -148, 18, 11, 0.3); ctx.fill();

  // back arm
  limb(ctx, [{ x: -28, y: -146 }, { x: -40, y: -110 + raise * 10 }, { x: -30, y: -84 }], 14, 11, shade(pal.body, -0.35));

  // head + hood
  const hx = 2 + P.lunge * 6, hy = -176;
  ctx.fillStyle = shade(pal.skin || "#d8c8b0", -0.1);
  ell(ctx, hx + 4, hy + 4, 15, 17); ctx.fill();
  ctx.fillStyle = lin(ctx, -30, -230, 30, -150, [[0, shade(pal.body, 0.25)], [1, pal.shade]]);
  ctx.beginPath();
  ctx.moveTo(hx - 26, hy + 26); ctx.quadraticCurveTo(hx - 34, hy - 20, hx - 14, hy - 44 + wave * 2);
  ctx.quadraticCurveTo(hx - 34, hy - 66, hx - 46, hy - 72);
  ctx.quadraticCurveTo(hx + 4, hy - 64, hx + 22, hy - 24); ctx.quadraticCurveTo(hx + 30, hy, hx + 20, hy + 24);
  ctx.quadraticCurveTo(hx + 8, hy + 10, hx + 10, hy - 4); ctx.quadraticCurveTo(hx, hy - 22, hx - 10, hy - 4);
  ctx.quadraticCurveTo(hx - 12, hy + 14, hx - 26, hy + 26); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ell(ctx, hx + 6, hy + 2, 10, 13); ctx.fill();
  ctx.save(); ctx.shadowColor = pal.eye; ctx.shadowBlur = 12; ctx.fillStyle = pal.eye;
  ell(ctx, hx + 4, hy - 1, 2.6, 1.6); ctx.fill(); ell(ctx, hx + 12, hy - 1, 2.6, 1.6); ctx.fill();
  ctx.restore();
  // floating crown shards
  for (let i = 0; i < 3; i++) {
    const a = t * 1.2 + (i * TAU) / 3;
    const x = hx + Math.cos(a) * 26, y = hy - 52 + Math.sin(a) * 6;
    ctx.fillStyle = rgba(toHex(pal.glow), Math.sin(a) > 0 ? 0.95 : 0.5);
    ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 4, y); ctx.fill();
  }

  // near arm + staff
  const handX = 34 + P.lunge * 24 - raise * 6, handY = -112 - raise * 54;
  const staffTilt = 0.12 + P.lunge * 0.5 - raise * 0.1;
  limb(ctx, [{ x: 26, y: -146 }, { x: 40, y: -126 - raise * 30 }, { x: handX, y: handY }], 14, 11, pal.body);
  ctx.save();
  ctx.translate(handX, handY);
  ctx.rotate(staffTilt);
  ctx.strokeStyle = lin(ctx, 0, -110, 0, 90, [[0, shade(pal.accent, -0.2)], [1, "#2a1c12"]]);
  ctx.lineWidth = 6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, 90); ctx.lineTo(0, -96); ctx.stroke();
  // crescent head
  ctx.strokeStyle = pal.accent; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(0, -116, 20, 0.3 * Math.PI, 1.7 * Math.PI, true); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = shade(pal.skin || "#d8c8b0", -0.05);
  ell(ctx, handX, handY, 7, 7); ctx.fill();
  const tip = { x: handX + Math.sin(staffTilt) * 116, y: handY - Math.cos(staffTilt) * 116 };
  glowDot(ctx, tip.x, tip.y, 5 + P.charge * 16, pal.glow, P);
  ctx.restore();

  const cos = Math.cos(lean), sin = Math.sin(lean);
  const tw = { x: tip.x * cos - tip.y * sin, y: tip.x * sin + tip.y * cos + y0 };
  return { attack: tw, center: { x: 0, y: -100 + y0 }, top: { x: 0, y: -250 + y0 } };
}

// --------------------------------------------------------------------- knight
function knight(ctx, P, pal) {
  const t = P.t;
  const br = Math.sin(t * 2) * 2;
  const step = P.walk ? Math.sin(t * 14) : 0;
  const lean = P.lunge * 0.25 - P.recoil * 0.2;
  const cr = P.crouch * 16;
  ctx.save();
  ctx.translate(0, cr);
  // plume (behind)
  const hx = 4 + P.lunge * 16, hy = -168 + br;
  ctx.fillStyle = pal.cloth;
  ctx.beginPath(); ctx.moveTo(hx - 4, hy - 26);
  for (let i = 0; i <= 5; i++) ctx.quadraticCurveTo(hx - 20 - i * 10, hy - 34 + Math.sin(t * 4 + i) * 5, hx - 26 - i * 10, hy - 18 + i * 6);
  ctx.lineTo(hx - 6, hy - 14); ctx.fill();

  // legs
  const metal = lin(ctx, -20, -200, 30, 0, [[0, shade(pal.body, 0.35)], [0.5, pal.body], [1, pal.shade]]);
  limb(ctx, [{ x: -10, y: -82 }, { x: -18 - step * 8, y: -44 }, { x: -22 - step * 12, y: -6 }], 18, 14, shade(pal.shade, -0.2));
  limb(ctx, [{ x: 12, y: -82 }, { x: 20 + step * 8, y: -44 }, { x: 24 + step * 12, y: -6 }], 18, 14, pal.shade);
  ctx.fillStyle = pal.shade;
  ell(ctx, -20 - step * 12, -4, 14, 6); ctx.fill(); ell(ctx, 28 + step * 12, -4, 14, 6); ctx.fill();

  ctx.save();
  ctx.translate(0, -80);
  ctx.rotate(lean);
  // shield arm (far)
  ctx.save();
  ctx.translate(20 + P.crouch * 18, -36);
  ctx.fillStyle = lin(ctx, -26, -40, 26, 40, [[0, shade(pal.body, 0.3)], [1, pal.shade]]);
  ctx.beginPath(); ctx.moveTo(-24, -40); ctx.lineTo(24, -40); ctx.lineTo(24, 4); ctx.quadraticCurveTo(14, 34, 0, 46); ctx.quadraticCurveTo(-14, 34, -24, 4); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = pal.accent; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = pal.cloth; ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(10, -4); ctx.lineTo(0, 28); ctx.lineTo(-10, -4); ctx.fill();
  ctx.restore();
  // tabard
  ctx.fillStyle = pal.cloth;
  ctx.beginPath(); ctx.moveTo(-16, -10); ctx.lineTo(18, -10); ctx.lineTo(22 + Math.sin(t * 3) * 3, 34); ctx.lineTo(-20 + Math.sin(t * 3 + 1) * 3, 34); ctx.fill();
  // torso
  ctx.fillStyle = metal;
  ctx.beginPath(); ctx.moveTo(-26, -84); ctx.lineTo(28, -84); ctx.quadraticCurveTo(34, -40, 20, -4); ctx.lineTo(-18, -4); ctx.quadraticCurveTo(-32, -40, -26, -84); ctx.fill();
  ctx.strokeStyle = shade(pal.shade, -0.3); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(2, -80); ctx.lineTo(2, -10); ctx.stroke();
  ctx.save(); ctx.shadowColor = pal.glow; ctx.shadowBlur = 10; ctx.fillStyle = pal.glow;
  ctx.beginPath(); ctx.arc(2, -56, 5, 0, TAU); ctx.fill(); ctx.restore();
  ctx.fillStyle = metal;
  ell(ctx, -26, -80, 17, 12, -0.4); ctx.fill(); ell(ctx, 28, -80, 17, 12, 0.4); ctx.fill();
  ctx.restore();

  // helmet
  ctx.save();
  ctx.translate(hx + lean * 30, hy - 4);
  ctx.fillStyle = metal;
  ctx.beginPath(); ctx.moveTo(-16, 18); ctx.quadraticCurveTo(-20, -24, 2, -28); ctx.quadraticCurveTo(24, -24, 20, 18); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#0b0d14"; ctx.fillRect(-2, -8, 22, 6);
  ctx.save(); ctx.shadowColor = pal.eye; ctx.shadowBlur = 12; ctx.fillStyle = pal.eye; ctx.fillRect(4, -7, 12, 3); ctx.restore();
  ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.moveTo(2, -28); ctx.lineTo(6, -40); ctx.lineTo(10, -26); ctx.fill();
  ctx.restore();

  // sword arm (near): slash rotates the blade through an arc
  const s = P.slash || 0;
  const raise = P.raise;
  const shoulder = { x: 26 + lean * 50, y: -156 };
  const handA = lerp(0.9, -2.1, raise) + s * 3.0;
  const hand = { x: shoulder.x + Math.cos(handA) * 46, y: shoulder.y + Math.sin(handA) * 46 + 20 };
  limb(ctx, [shoulder, { x: lerp(shoulder.x, hand.x, 0.5) + 6, y: lerp(shoulder.y, hand.y, 0.5) + 4 }, hand], 14, 11, pal.body);
  const bladeA = handA - 0.6 + (P.crouch ? -0.6 : 0);
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(bladeA);
  ctx.fillStyle = "#3a2a1a"; ctx.fillRect(-12, -3, 14, 6);
  ctx.fillStyle = pal.accent; ctx.fillRect(0, -10, 5, 20);
  ctx.fillStyle = lin(ctx, 0, -5, 0, 5, [[0, "#ffffff"], [0.5, shade(pal.glow, 0.2)], [1, shade(pal.body, -0.2)]]);
  ctx.beginPath(); ctx.moveTo(5, -5); ctx.lineTo(108, -3); ctx.lineTo(120, 0); ctx.lineTo(108, 3); ctx.lineTo(5, 5); ctx.fill();
  ctx.restore();
  const tip = { x: hand.x + Math.cos(bladeA) * 118, y: hand.y + Math.sin(bladeA) * 118 + cr };
  if (P.charge > 0.01) glowDot(ctx, tip.x, tip.y - cr, 4 + P.charge * 10, pal.glow, P);
  ctx.restore();
  return { attack: tip, center: { x: 0, y: -110 + cr }, top: { x: 0, y: -210 } };
}

// ----------------------------------------------------------------------- bird
function featherWing(ctx, sx, sy, flap, pal, far, size) {
  const base = far ? shade(pal.wing, -0.4) : pal.wing;
  const th = -1.9 + flap * 0.9;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(th + Math.PI / 2);
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + i * 0.22;
    const L = (70 + i * 10 - (i > 4 ? (i - 4) * 18 : 0)) * size;
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = lin(ctx, 0, 0, 0, -L, [[0, shade(base, -0.15)], [1, i % 2 ? shade(base, 0.2) : base]]);
    ctx.beginPath(); ctx.moveTo(-8 * size, 0); ctx.quadraticCurveTo(-12 * size, -L * 0.6, 0, -L); ctx.quadraticCurveTo(12 * size, -L * 0.6, 8 * size, 0); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = shade(base, -0.1);
  ell(ctx, 0, -20 * size, 22 * size, 34 * size); ctx.fill();
  ctx.restore();
}

function bird(ctx, P, pal, v) {
  const t = P.t;
  const armored = v === "armored";
  const sz = armored ? 1.15 : 1;
  const bob = Math.sin(t * 2.6) * 8;
  const flap = Math.sin(t * 5.2 * (P.flapRate || 1));
  const y0 = -128 + bob + P.crouch * 30;
  const lean = P.lunge * 0.45 - P.recoil * 0.3 - P.raise * 0.3;
  ctx.save();
  ctx.translate(P.recoil * -16, y0);
  ctx.rotate(lean);
  featherWing(ctx, -6, -18, flap * (1 - P.crouch * 0.7), pal, true, sz);
  // tail
  ctx.fillStyle = shade(pal.body, -0.25);
  for (let i = 0; i < 4; i++) {
    ctx.save(); ctx.translate(-44 * sz, 6); ctx.rotate(Math.PI + 0.25 - i * 0.16 + Math.sin(t * 3) * 0.05);
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.quadraticCurveTo(40 * sz, -10, 64 * sz, 0); ctx.quadraticCurveTo(40 * sz, 10, 0, 6); ctx.fill();
    ctx.restore();
  }
  // talons
  ctx.strokeStyle = pal.accent; ctx.lineWidth = 5; ctx.lineCap = "round";
  for (const dx of [-8, 12]) { ctx.beginPath(); ctx.moveTo(dx, 26); ctx.lineTo(dx + 4, 50 + P.lunge * 10); ctx.stroke(); claws(ctx, dx + 4, 52 + P.lunge * 10, 1, pal.accent, 3, 9); }
  // body
  ctx.fillStyle = lin(ctx, 0, -36, 0, 36, [[0, shade(pal.body, 0.15)], [1, pal.shade]]);
  ell(ctx, 0, 0, 52 * sz, 32 * sz, -0.12); ctx.fill();
  ctx.fillStyle = rgba(toHex(pal.glow), 0.35);
  ell(ctx, 16, 12, 30 * sz, 16 * sz, -0.2); ctx.fill();
  if (armored) {
    ctx.fillStyle = lin(ctx, 0, -30, 0, 30, [[0, "#fff8dc"], [1, pal.shade]]);
    ctx.beginPath(); ctx.moveTo(4, -28); ctx.quadraticCurveTo(50, -18, 58, 8); ctx.quadraticCurveTo(30, 30, 6, 26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = pal.cloth || pal.accent;
    ctx.beginPath(); ctx.moveTo(20, -20); ctx.lineTo(44, -6); ctx.lineTo(30, 16); ctx.lineTo(14, 4); ctx.closePath(); ctx.fill();
  }
  // head
  const hx = 54 * sz + P.lunge * 10, hy = -26 * sz;
  ctx.fillStyle = lin(ctx, hx, hy - 20, hx, hy + 20, [[0, shade(pal.body, 0.3)], [1, pal.body]]);
  ell(ctx, hx, hy, 22 * sz, 19 * sz); ctx.fill();
  ctx.fillStyle = pal.accent;
  ctx.beginPath(); ctx.moveTo(hx + 16, hy - 8); ctx.quadraticCurveTo(hx + 42, hy - 6, hx + 44, hy + 8); ctx.quadraticCurveTo(hx + 34, hy + 2, hx + 16, hy + 6); ctx.fill();
  ctx.save(); ctx.shadowColor = pal.eye; ctx.shadowBlur = 10; ctx.fillStyle = pal.eye;
  ell(ctx, hx + 8, hy - 5, 4, 3); ctx.fill(); ctx.restore();
  ctx.fillStyle = "#111"; ell(ctx, hx + 9, hy - 5, 1.6, 1.6); ctx.fill();
  if (armored) {
    ctx.fillStyle = lin(ctx, hx, hy - 24, hx, hy, [[0, "#fffbe6"], [1, pal.shade]]);
    ctx.beginPath(); ctx.moveTo(hx - 20, hy - 2); ctx.quadraticCurveTo(hx - 10, hy - 30, hx + 18, hy - 14); ctx.lineTo(hx + 8, hy - 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = pal.accent;
    ctx.beginPath(); ctx.moveTo(hx - 6, hy - 22); ctx.quadraticCurveTo(hx - 40, hy - 52 + Math.sin(t * 4) * 4, hx - 58, hy - 34); ctx.quadraticCurveTo(hx - 34, hy - 34, hx - 12, hy - 14); ctx.fill();
  } else {
    ctx.fillStyle = shade(pal.body, -0.2);
    ctx.beginPath(); ctx.moveTo(hx - 14, hy - 12); ctx.lineTo(hx - 34, hy - 20 + Math.sin(t * 3) * 3); ctx.lineTo(hx - 16, hy - 2); ctx.fill();
  }
  featherWing(ctx, -12, -22, flap * (1 - P.crouch * 0.7) + 0.1, pal, false, sz * 1.05);
  const beak = { x: hx + 44, y: hy + 4 };
  if (P.charge > 0.01) glowDot(ctx, beak.x, beak.y, 4 + P.charge * 12, pal.glow, P);
  ctx.restore();
  const c = Math.cos(lean), s = Math.sin(lean);
  return { attack: { x: beak.x * c - beak.y * s - P.recoil * 16, y: beak.x * s + beak.y * c + y0 }, center: { x: 0, y: y0 }, top: { x: 0, y: y0 - 90 } };
}

// ---------------------------------------------------------------------- golem
const ROCKS = [[-34, -150, 30, 26], [6, -168, 34, 28], [38, -138, 26, 24], [-22, -112, 34, 30], [20, -104, 36, 30], [-4, -76, 30, 22]];
function golem(ctx, P, pal) {
  const t = P.t;
  const br = Math.sin(t * 1.4) * 2;
  const cr = P.crouch * 14 + P.slam * 10;
  const raise = P.raise, slam = P.slam || 0;
  ctx.save();
  ctx.translate(P.recoil * -14 + P.lunge * 20, cr);
  // legs
  ctx.fillStyle = pal.shade;
  ctx.beginPath(); ctx.roundRect(-36, -62, 28, 60, 8); ctx.fill();
  ctx.beginPath(); ctx.roundRect(8, -62, 30, 60, 8); ctx.fill();
  // back arm
  const armUp = raise * (1 - slam);
  const bfx = -48, bfy = lerp(-50, -210, armUp) + slam * 20;
  limb(ctx, [{ x: -36, y: -146 + br }, { x: -52, y: lerp(-100, -180, armUp) }, { x: bfx, y: bfy }], 22, 18, shade(pal.shade, -0.25));
  ctx.fillStyle = shade(pal.body, -0.35); ell(ctx, bfx, bfy, 22, 20); ctx.fill();
  // torso rocks
  for (const [x, y, rx, ry] of ROCKS) {
    ctx.fillStyle = lin(ctx, x, y - ry, x, y + ry, [[0, shade(pal.body, 0.18)], [1, pal.shade]]);
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU, j = 0.82 + ((i * 37 + x) % 11) / 40;
      const px = x + Math.cos(a) * rx * j, py = y + br + Math.sin(a) * ry * j;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }
  // glowing cracks
  ctx.save(); ctx.shadowColor = pal.glow; ctx.shadowBlur = 10;
  ctx.strokeStyle = rgba(toHex(pal.glow), 0.6 + Math.sin(t * 3) * 0.2); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-10, -150); ctx.lineTo(-2, -130); ctx.lineTo(-12, -110); ctx.moveTo(20, -150); ctx.lineTo(26, -124); ctx.stroke();
  ctx.restore();
  // thorn vines
  ctx.strokeStyle = pal.accent; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-50, -90); ctx.bezierCurveTo(-20, -160, 30, -60, 52, -150); ctx.stroke();
  ctx.fillStyle = shade(pal.accent, 0.2);
  for (let i = 0; i < 6; i++) {
    const p = cubic({ x: -50, y: -90 }, { x: -20, y: -160 }, { x: 30, y: -60 }, { x: 52, y: -150 }, i / 6 + 0.05);
    ctx.beginPath(); ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x, p.y - 12); ctx.lineTo(p.x + 4, p.y); ctx.fill();
  }
  // head
  ctx.fillStyle = lin(ctx, 0, -214, 0, -180, [[0, shade(pal.body, 0.2)], [1, pal.shade]]);
  ctx.beginPath(); ctx.roundRect(-4, -214 + br, 40, 34, 8); ctx.fill();
  ctx.save(); ctx.shadowColor = pal.eye; ctx.shadowBlur = 14; ctx.fillStyle = pal.eye;
  ctx.fillRect(16, -202 + br, 8, 4); ctx.fillRect(28, -202 + br, 6, 4); ctx.restore();
  // near arm
  const ffx = 58 + P.lunge * 20, ffy = lerp(-46, -220, armUp) + slam * 26;
  limb(ctx, [{ x: 40, y: -146 + br }, { x: 62, y: lerp(-100, -186, armUp) }, { x: ffx, y: ffy }], 24, 20, pal.shade);
  ctx.fillStyle = lin(ctx, ffx, ffy - 24, ffx, ffy + 24, [[0, shade(pal.body, 0.15)], [1, pal.shade]]);
  ell(ctx, ffx, ffy, 26, 23); ctx.fill();
  if (P.charge > 0.01) glowDot(ctx, ffx, ffy, 4 + P.charge * 12, pal.glow, P);
  ctx.restore();
  return { attack: { x: ffx + P.lunge * 20, y: ffy + cr }, center: { x: 0, y: -120 }, top: { x: 0, y: -230 } };
}

// -------------------------------------------------------------------- serpent
function serpent(ctx, P, pal) {
  const t = P.t;
  const sway = Math.sin(t * 1.5);
  const rear = P.raise, lunge = P.lunge;
  // pool
  ctx.fillStyle = rad(ctx, 0, 0, 90, [[0, rgba(toHex(pal.glow), 0.5)], [0.6, rgba(toHex(pal.body), 0.45)], [1, "rgba(0,0,0,0)"]]);
  ell(ctx, 0, 0, 92, 22); ctx.fill();
  ctx.strokeStyle = rgba("#ffffff", 0.35); ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const r = ((t * 30 + i * 30) % 90);
    ctx.globalAlpha = 1 - r / 90;
    ell(ctx, 0, 0, r, r * 0.24); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const hx = 40 + lunge * 60 - rear * 26 - P.recoil * 24, hy = -196 - rear * 24 + lunge * 30 + P.crouch * 40;
  const p0 = { x: -36, y: 4 }, p1 = { x: -78 + sway * 10, y: -90 }, p2 = { x: 40 + sway * 12, y: -110 }, p3 = { x: hx - 16, y: hy + 14 };
  const pts = [];
  for (let i = 0; i <= 24; i++) pts.push(cubic(p0, p1, p2, p3, i / 24));
  // dorsal fin
  ctx.fillStyle = rgba(toHex(pal.fin || pal.accent), 0.85);
  ctx.beginPath();
  ctx.moveTo(pts[4].x, pts[4].y);
  for (let i = 4; i < 23; i++) { const p = pts[i]; ctx.lineTo(p.x - 18 - Math.sin(t * 4 + i) * 4, p.y - 18); }
  for (let i = 22; i >= 4; i--) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.fill();
  tube(ctx, pts, 30, 18, lin(ctx, -60, 0, 60, -200, [[0, pal.shade], [0.5, pal.body], [1, shade(pal.body, 0.2)]]));
  // belly scales
  ctx.strokeStyle = rgba(toHex(pal.accent), 0.5); ctx.lineWidth = 2;
  for (let i = 2; i < 23; i += 2) {
    const p = pts[i], q = pts[i + 1];
    const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1;
    const r = lerp(30, 18, i / 24) * 0.8;
    ctx.beginPath(); ctx.moveTo(p.x + (dy / L) * r, p.y - (dx / L) * r * -1); ctx.lineTo(p.x + (-dy / L) * r * 0.2, p.y + (dx / L) * r * 0.2); ctx.stroke();
  }
  // head
  const ha = -0.2 + lunge * 0.4 - rear * 0.3;
  ctx.save();
  ctx.translate(hx, hy); ctx.rotate(ha);
  ctx.fillStyle = rgba(toHex(pal.fin || pal.accent), 0.9);
  ctx.beginPath(); ctx.moveTo(-10, -10); ctx.quadraticCurveTo(-34, -40, -52, -30 + Math.sin(t * 3) * 4); ctx.quadraticCurveTo(-30, -20, -14, 4); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-6, 6); ctx.quadraticCurveTo(-30, 30, -46, 28); ctx.quadraticCurveTo(-26, 14, -10, 10); ctx.fill();
  ctx.save(); ctx.translate(0, 6); ctx.rotate(P.jaw * 0.6);
  ctx.fillStyle = shade(pal.body, -0.2);
  ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(48, 2); ctx.lineTo(40, 10); ctx.lineTo(-8, 10); ctx.fill();
  ctx.restore();
  ctx.fillStyle = lin(ctx, 0, -22, 0, 10, [[0, shade(pal.body, 0.25)], [1, pal.body]]);
  ctx.beginPath(); ctx.moveTo(-18, -12); ctx.quadraticCurveTo(10, -26, 54, -4); ctx.lineTo(52, 6); ctx.lineTo(-16, 10); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.shadowColor = pal.eye; ctx.shadowBlur = 12; ctx.fillStyle = pal.eye;
  ell(ctx, 12, -10, 5, 3); ctx.fill(); ctx.restore();
  ctx.restore();
  const mouth = { x: hx + Math.cos(ha) * 52 - Math.sin(ha) * 6, y: hy + Math.sin(ha) * 52 + Math.cos(ha) * 6 };
  if (P.charge > 0.01) glowDot(ctx, mouth.x, mouth.y, 5 + P.charge * 14, pal.glow, P);
  return { attack: mouth, center: { x: 0, y: -110 }, top: { x: hx, y: hy - 40 } };
}

// ------------------------------------------------------------------------ imp
function imp(ctx, P, pal) {
  const t = P.t;
  const hop = Math.abs(Math.sin(t * 3.2)) * 10 * (1 - P.crouch);
  const y0 = -hop + P.crouch * 8;
  ctx.save();
  ctx.translate(P.lunge * 20 - P.recoil * 16, y0);
  // tail
  ctx.strokeStyle = pal.shade; ctx.lineWidth = 5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-18, -36); ctx.bezierCurveTo(-50, -30, -46, -70 + Math.sin(t * 3) * 8, -70, -76); ctx.stroke();
  ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.moveTo(-70, -86); ctx.lineTo(-62, -72); ctx.lineTo(-80, -72); ctx.fill();
  // wings
  const fl = Math.sin(t * 9) * 0.4;
  for (const [ox, far] of [[-8, true], [2, false]]) {
    ctx.save(); ctx.translate(ox, -74); ctx.rotate(-0.6 + fl * (far ? 1 : -1) * 0.6);
    ctx.fillStyle = far ? shade(pal.wing, -0.3) : pal.wing;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-48, -36); ctx.quadraticCurveTo(-40, -14, -46, -4); ctx.quadraticCurveTo(-30, -6, -30, 6); ctx.quadraticCurveTo(-16, 2, 0, 10); ctx.fill();
    ctx.restore();
  }
  // legs
  limb(ctx, [{ x: -8, y: -30 }, { x: -12, y: -14 }, { x: -6, y: -2 }], 9, 7, pal.shade);
  limb(ctx, [{ x: 10, y: -30 }, { x: 14, y: -14 }, { x: 18, y: -2 }], 9, 7, pal.shade);
  // body + head
  ctx.fillStyle = lin(ctx, 0, -80, 0, -20, [[0, shade(pal.body, 0.2)], [1, pal.shade]]);
  ell(ctx, 2, -48, 24, 26); ctx.fill();
  ctx.fillStyle = lin(ctx, 0, -120, 0, -70, [[0, shade(pal.body, 0.3)], [1, pal.body]]);
  ell(ctx, 8, -94, 30, 26); ctx.fill();
  ctx.fillStyle = pal.accent;
  ctx.beginPath(); ctx.moveTo(-10, -112); ctx.quadraticCurveTo(-26, -138, -14, -150); ctx.quadraticCurveTo(-14, -130, 0, -116); ctx.fill();
  ctx.beginPath(); ctx.moveTo(18, -116); ctx.quadraticCurveTo(26, -142, 42, -146); ctx.quadraticCurveTo(30, -130, 30, -112); ctx.fill();
  ctx.save(); ctx.shadowColor = pal.eye; ctx.shadowBlur = 12; ctx.fillStyle = pal.eye;
  ell(ctx, 12, -100, 6, 7); ctx.fill(); ell(ctx, 30, -100, 5, 6); ctx.fill(); ctx.restore();
  ctx.fillStyle = "#1a0b10"; ell(ctx, 14, -99, 2, 4); ctx.fill(); ell(ctx, 31, -99, 2, 4); ctx.fill();
  ctx.fillStyle = "#1a0b10";
  ctx.beginPath(); ctx.moveTo(4, -84); ctx.quadraticCurveTo(22, -70, 38, -86); ctx.quadraticCurveTo(22, -78, 4, -84); ctx.fill();
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 4; i++) { const x = 10 + i * 7; ctx.beginPath(); ctx.moveTo(x, -82); ctx.lineTo(x + 3, -77); ctx.lineTo(x + 5, -82); ctx.fill(); }
  // arm
  const hand = { x: 30 + P.raise * 4 + P.lunge * 14, y: -54 - P.raise * 50 };
  limb(ctx, [{ x: 18, y: -60 }, { x: 28, y: -50 - P.raise * 20 }, hand], 7, 6, pal.body);
  if (P.charge > 0.01) glowDot(ctx, hand.x, hand.y - 6, 4 + P.charge * 12, pal.glow, P);
  ctx.restore();
  return { attack: { x: hand.x + P.lunge * 20, y: hand.y - 6 + y0 }, center: { x: 0, y: -70 }, top: { x: 0, y: -150 } };
}

// ---------------------------------------------------------------------- fairy
function fairy(ctx, P, pal) {
  const t = P.t;
  const bob = Math.sin(t * 2.2) * 8;
  const y0 = -40 + bob + P.crouch * 12;
  ctx.save();
  ctx.translate(-P.recoil * 14, y0);
  // aura
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = rad(ctx, 0, -80, 90, [[0, rgba(toHex(pal.glow), 0.25)], [1, "rgba(0,0,0,0)"]]);
  ctx.beginPath(); ctx.arc(0, -80, 90, 0, TAU); ctx.fill(); ctx.restore();
  // crystal wings
  const fl = Math.sin(t * 8) * 0.18;
  for (const [a, L, far] of [[-2.4, 90, true], [-1.9, 70, true], [-2.6, 96, false], [-1.7, 64, false]]) {
    ctx.save(); ctx.translate(-6, -104);
    ctx.rotate(a + (far ? -fl : fl) + Math.PI / 2);
    ctx.fillStyle = lin(ctx, 0, 0, 0, -L, [[0, rgba(toHex(pal.wing), far ? 0.4 : 0.6)], [1, rgba("#ffffff", far ? 0.5 : 0.85)]]);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-L * 0.28, -L * 0.5); ctx.lineTo(0, -L); ctx.lineTo(L * 0.22, -L * 0.45); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba("#ffffff", 0.7); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }
  // dress
  ctx.fillStyle = lin(ctx, 0, -110, 0, -20, [[0, pal.body], [1, shade(pal.shade, 0)]]);
  ctx.beginPath(); ctx.moveTo(-10, -108); ctx.lineTo(10, -108);
  ctx.quadraticCurveTo(30, -60, 34, -26);
  for (let i = 0; i < 4; i++) ctx.quadraticCurveTo(26 - i * 17, -14 + Math.sin(t * 3 + i) * 3, 17 - i * 17, -24);
  ctx.quadraticCurveTo(-30, -60, -10, -108); ctx.fill();
  // legs
  ctx.strokeStyle = shade(pal.body, -0.1); ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-6, -24); ctx.lineTo(-10, 0); ctx.moveTo(6, -24); ctx.lineTo(8, -2); ctx.stroke();
  // head + hair
  ctx.fillStyle = pal.accent;
  ctx.beginPath(); ctx.moveTo(-14, -140); ctx.quadraticCurveTo(-40, -120, -34 + Math.sin(t * 2) * 4, -80); ctx.quadraticCurveTo(-18, -110, -6, -116); ctx.fill();
  ctx.fillStyle = "#ffe8f0"; ell(ctx, 2, -130, 13, 15); ctx.fill();
  ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.ellipse(-2, -138, 15, 11, -0.3, Math.PI, TAU); ctx.fill();
  ctx.fillStyle = pal.eye; ell(ctx, 8, -130, 2.2, 3); ctx.fill();
  ctx.save(); ctx.shadowColor = pal.glow; ctx.shadowBlur = 10; ctx.fillStyle = pal.glow;
  ctx.beginPath(); ctx.moveTo(-6, -150); ctx.lineTo(0, -160); ctx.lineTo(6, -150); ctx.lineTo(12, -158); ctx.lineTo(12, -146); ctx.lineTo(-8, -146); ctx.fill(); ctx.restore();
  // arm
  const hand = { x: 22 + P.lunge * 16, y: -86 - P.raise * 48 };
  limb(ctx, [{ x: 6, y: -104 }, { x: 18, y: -92 - P.raise * 24 }, hand], 5, 4, "#ffe8f0");
  if (P.charge > 0.01) glowDot(ctx, hand.x, hand.y, 4 + P.charge * 12, pal.glow, P);
  ctx.restore();
  return { attack: { x: hand.x, y: hand.y + y0 }, center: { x: 0, y: -80 + y0 }, top: { x: 0, y: -170 + y0 } };
}

export const RIGS = {
  dragon: { draw: dragon, height: 240, width: 330, artBox: { cx: -40, cy: -130, w: 420, h: 320 } },
  sorcerer: { draw: sorcerer, height: 270, width: 150, artBox: { cx: 0, cy: -140, w: 210, h: 300 } },
  knight: { draw: knight, height: 220, width: 140, artBox: { cx: 10, cy: -110, w: 220, h: 260 } },
  bird: { draw: bird, height: 220, width: 220, artBox: { cx: 0, cy: -140, w: 280, h: 230 } },
  golem: { draw: golem, height: 230, width: 160, artBox: { cx: 6, cy: -116, w: 220, h: 250 } },
  serpent: { draw: serpent, height: 250, width: 190, artBox: { cx: 0, cy: -120, w: 240, h: 280 } },
  imp: { draw: imp, height: 150, width: 120, artBox: { cx: -6, cy: -78, w: 170, h: 180 } },
  fairy: { draw: fairy, height: 210, width: 150, artBox: { cx: 0, cy: -100, w: 210, h: 230 } },
};

export function basePose(t = 0) {
  return { t, charge: 0, jaw: 0, raise: 0, lunge: 0, recoil: 0, crouch: 0, slash: 0, slam: 0, walk: false, flapRate: 1 };
}
