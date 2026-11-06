// Selectable arenas: full landscapes with depth (layered mountains, forests, skylines) around the board.
// backdrop() is static and cached; surround() adds light animation on top every frame.
import { W, H, proj, outline } from "./board.js";

const TAU = Math.PI * 2;
export const HORIZON = 150;

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function vgrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
// How "near" a screen row is: 0 at the horizon, 1 at the bottom edge.
const depth = (y) => Math.max(0, Math.min(1.2, (y - HORIZON) / (H - HORIZON)));
const onBoard = (x, y) => {
  const o = outline(70);
  const t = (y - o[0].y) / (o[3].y - o[0].y);
  if (t < -0.02 || t > 1.02) return false;
  const l = o[0].x + (o[3].x - o[0].x) * t, r = o[1].x + (o[2].x - o[1].x) * t;
  return x > l && x < r;
};

// A jagged mountain range with light and shadow faces, optional snow caps.
function range(ctx, r, { base, top, step, color, shadow, snow, haze, x0, x1 }) {
  const pts = [];
  let y = base - (base - top) * 0.5;
  for (let x = x0; x <= x1; x += step * (0.6 + r() * 0.8)) {
    y += (r() - 0.5) * (base - top) * 0.9;
    y = Math.max(top, Math.min(base - 6, y));
    pts.push([x, y]);
  }
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x0, base);
  for (const [x, yy] of pts) ctx.lineTo(x, yy);
  ctx.lineTo(x1, base); ctx.closePath(); ctx.fill();
  // shadowed slopes: every descending face to the right of a peak
  ctx.fillStyle = shadow;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    if (by > ay) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(bx - (bx - ax) * 0.2, base); ctx.lineTo(ax, base); ctx.closePath(); ctx.fill(); }
  }
  if (snow) {
    ctx.fillStyle = snow;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, yy] = pts[i];
      if (yy < pts[i - 1][1] && yy < pts[i + 1][1] && yy < top + (base - top) * 0.45) {
        const d = (base - yy) * 0.22;
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + d * 0.9, yy + d); ctx.lineTo(x + d * 0.3, yy + d * 0.8); ctx.lineTo(x - d * 0.2, yy + d * 1.1); ctx.lineTo(x - d * 0.8, yy + d); ctx.closePath(); ctx.fill();
      }
    }
  }
  if (haze) { ctx.fillStyle = vgrad(ctx, top, base, [[0, "rgba(0,0,0,0)"], [1, haze]]); ctx.fillRect(x0, top, x1 - x0, base - top); }
}

function pine(ctx, x, y, h, dark, light, snow) {
  ctx.fillStyle = "#3a2a1a"; ctx.fillRect(x - h * 0.04, y - h * 0.18, h * 0.08, h * 0.2);
  for (let k = 0; k < 3; k++) {
    const yy = y - h * (0.15 + k * 0.27), w = h * (0.36 - k * 0.09);
    ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(x - w, yy); ctx.lineTo(x, yy - h * 0.42); ctx.lineTo(x + w, yy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = light; ctx.beginPath(); ctx.moveTo(x - w * 0.9, yy); ctx.lineTo(x, yy - h * 0.42); ctx.lineTo(x - w * 0.1, yy); ctx.closePath(); ctx.fill();
    if (snow) { ctx.fillStyle = snow; ctx.beginPath(); ctx.moveTo(x - w * 0.5, yy - h * 0.2); ctx.lineTo(x, yy - h * 0.42); ctx.lineTo(x + w * 0.45, yy - h * 0.22); ctx.lineTo(x, yy - h * 0.28); ctx.closePath(); ctx.fill(); }
  }
}
function roundTree(ctx, x, y, h, dark, mid, light) {
  ctx.fillStyle = "#4a3320"; ctx.fillRect(x - h * 0.05, y - h * 0.35, h * 0.1, h * 0.36);
  for (const [dx, dy, rr, c] of [[0, -0.62, 0.32, dark], [-0.2, -0.5, 0.24, dark], [0.2, -0.52, 0.25, dark], [-0.06, -0.7, 0.22, mid], [0.12, -0.62, 0.18, mid], [-0.12, -0.78, 0.12, light]]) {
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + dx * h, y + dy * h, rr * h, 0, TAU); ctx.fill();
  }
}
function rock(ctx, x, y, s, c0, c1) {
  ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(x + s * 0.2, y + s * 0.1, s * 1.1, s * 0.3, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = c0; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x - s * 0.6, y - s * 0.8); ctx.lineTo(x + s * 0.2, y - s); ctx.lineTo(x + s, y - s * 0.3); ctx.lineTo(x + s * 0.9, y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = c1; ctx.beginPath(); ctx.moveTo(x + s * 0.2, y - s); ctx.lineTo(x + s, y - s * 0.3); ctx.lineTo(x + s * 0.9, y); ctx.lineTo(x + s * 0.1, y); ctx.closePath(); ctx.fill();
}
function clouds(ctx, t, color, n, yMax, speed = 6) {
  for (let i = 0; i < n; i++) {
    const x = ((i * 263 + t * speed * (1 + (i % 3) * 0.3)) % 2100) - 250, y = 18 + (i * 37) % yMax;
    ctx.fillStyle = color;
    for (const [dx, dy, rx, ry] of [[0, 0, 90, 22], [50, -10, 60, 20], [-50, -6, 55, 16], [20, -18, 40, 16]]) {
      ctx.beginPath(); ctx.ellipse(x + dx, y + dy, rx, ry, 0, 0, TAU); ctx.fill();
    }
  }
}

// ----------------------------------------------------------------- meadow
const meadow = {
  name: "Highland Meadow",
  tileStyle: "stone",
  ground: ["#8d8a78", "#6f6c5c"], patch: "#5f9a3a", speck: "#e6e0c8", crack: "rgba(40,30,20,.55)", grout: "rgba(40,50,25,.35)",
  tile: ["#c9c3ad", "#9c9580"], tileEdge: "#5d5848", emblem: "rgba(60,50,30,.5)", label: "rgba(50,40,20,.85)",
  rim: ["#b9b29a", "#7a735f"], inlay: "#9ff07a",
  metal: ["#d6cfb6", "#9a927a", "#55503f"], trim: "#e7dfc2", engraveDark: "rgba(50,40,25,.55)", engraveLight: "rgba(255,250,230,.35)",
  hex: "rgba(60,50,30,.05)", groove: "#3d3a2c", inlayDim: "rgba(140,220,110,.35)", pulse: "rgba(170,255,140,.65)", crystal: "#b8ff9a",
  light: "rgba(255,248,210,.18)", zoneGlow: "rgba(170,255,140,.08)", grass: true,
  slab: ["#7a735f", "#4e4a3c"],
  scar: { dark: "rgba(45,32,20,.85)", lip: "rgba(240,230,200,.45)", soil: "#5a4028", scorch: "rgba(30,20,10,.5)", debris: ["#9c9580", "#7a735f", "#5a4028"] },
  backdrop(ctx, R) {
    const r = rng(101);
    ctx.fillStyle = vgrad(ctx, R.y0, HORIZON + 10, [[0, "#5aa7ec"], [0.7, "#a9d6f7"], [1, "#e3f1fb"]]);
    ctx.fillRect(R.x0, R.y0, R.x1 - R.x0, HORIZON - R.y0 + 12);
    glow(ctx, 1260, 30, 260, "rgba(255,250,220,.75)");
    range(ctx, r, { base: HORIZON + 6, top: 18, step: 70, color: "#9fb6d4", shadow: "rgba(70,95,140,.35)", snow: "#f4f8ff", haze: "rgba(220,235,250,.7)", x0: R.x0, x1: R.x1 });
    range(ctx, r, { base: HORIZON + 10, top: 62, step: 55, color: "#7d9fb5", shadow: "rgba(50,75,100,.35)", snow: "rgba(240,248,255,.8)", haze: "rgba(200,225,240,.5)", x0: R.x0, x1: R.x1 });
    range(ctx, r, { base: HORIZON + 14, top: 104, step: 40, color: "#5f8f6a", shadow: "rgba(30,60,40,.35)", haze: "rgba(180,215,200,.4)", x0: R.x0, x1: R.x1 });
    // rolling grass plain
    ctx.fillStyle = vgrad(ctx, HORIZON, R.y1, [[0, "#9cc77a"], [0.25, "#78b04e"], [1, "#3f7a2a"]]);
    ctx.fillRect(R.x0, HORIZON + 8, R.x1 - R.x0, R.y1 - HORIZON);
    // light/shadow undulations
    for (let i = 0; i < 40; i++) {
      const y = HORIZON + 20 + r() * (R.y1 - HORIZON), d = depth(y);
      ctx.fillStyle = r() < 0.5 ? "rgba(255,255,200,.06)" : "rgba(20,50,10,.08)";
      ctx.beginPath(); ctx.ellipse(R.x0 + r() * (R.x1 - R.x0), y, 120 + d * 260, 10 + d * 30, 0, 0, TAU); ctx.fill();
    }
    // dirt paths leading to the arena
    ctx.strokeStyle = "rgba(150,115,70,.55)"; ctx.lineCap = "round";
    for (const [sx, ex] of [[R.x0 + 40, 330], [R.x1 - 40, 1270]]) {
      ctx.lineWidth = 24; ctx.beginPath(); ctx.moveTo(sx, R.y1); ctx.quadraticCurveTo((sx + ex) / 2, 640, ex, 420); ctx.stroke();
    }
    // scattered forest on both sides, sorted far to near
    const trees = [];
    for (let i = 0; i < 70; i++) {
      const y = HORIZON + 12 + Math.pow(r(), 1.4) * (R.y1 - HORIZON);
      const x = r() < 0.5 ? R.x0 + r() * 420 : R.x1 - r() * 420;
      if (onBoard(x, y)) continue;
      trees.push([x, y, r() < 0.55]);
    }
    trees.sort((a, b) => a[1] - b[1]);
    for (const [x, y, isPine] of trees) {
      const h = 18 + depth(y) * 150;
      if (isPine) pine(ctx, x, y, h, "#2f5a2a", "#427a34");
      else roundTree(ctx, x, y, h, "#3d6e2c", "#56913a", "#7bb556");
    }
    // rocks, flowers and grass tufts
    for (let i = 0; i < 40; i++) {
      const y = HORIZON + 20 + r() * (R.y1 - HORIZON), x = R.x0 + r() * (R.x1 - R.x0);
      if (onBoard(x, y)) continue;
      rock(ctx, x, y, 4 + depth(y) * 22, "#a6a090", "#7a7466");
    }
    for (let i = 0; i < 3200; i++) {
      const y = HORIZON + 14 + r() * (R.y1 - HORIZON), x = R.x0 + r() * (R.x1 - R.x0);
      if (onBoard(x, y)) continue;
      const d = depth(y), h = 2 + d * 12;
      ctx.strokeStyle = r() < 0.5 ? "#4f8f34" : r() < 0.5 ? "#6fae46" : "#376f26"; ctx.lineWidth = 0.8 + d * 1.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * h * 0.6, y - h); ctx.stroke();
      if (r() < 0.025) { ctx.fillStyle = ["#fff3a8", "#ffd0e8", "#ffffff", "#c8b0ff"][(r() * 4) | 0]; ctx.beginPath(); ctx.arc(x, y - h, 0.8 + d * 2.2, 0, TAU); ctx.fill(); }
    }
  },
  surround(ctx, R, t) {
    clouds(ctx, t, "rgba(255,255,255,.55)", 6, 70, 5);
    // a few birds gliding far away
    ctx.strokeStyle = "rgba(40,50,70,.6)"; ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const x = ((t * 22 + i * 340) % 2000) - 200, y = 40 + i * 14 + Math.sin(t + i) * 6, w = Math.sin(t * 6 + i) * 3;
      ctx.beginPath(); ctx.moveTo(x - 7, y + w); ctx.quadraticCurveTo(x - 3, y - 3, x, y); ctx.quadraticCurveTo(x + 3, y - 3, x + 7, y + w); ctx.stroke();
    }
  },
  overlay() {},
  ambient(P, dt) {
    if (Math.random() < dt * 3) P.spawn({ x: Math.random() * 1600, y: 200 + Math.random() * 600, vy: -6, vx: 10 + Math.random() * 10, life: 6, size: 1.8, color: "#fffbe0", drag: 1 });
  },
};

// ------------------------------------------------------------------ neon
const neon = {
  name: "Neon Spire",
  tileStyle: "neon",
  ground: ["#1c2232", "#10141f"], patch: "#2a3a5a", speck: "#6fd8ff", crack: "rgba(0,0,0,.6)", grout: "rgba(80,220,255,.10)",
  tile: ["#1b2233", "#0e121c"], tileEdge: "#05070c", emblem: "rgba(90,220,255,.5)", label: "rgba(140,230,255,.9)",
  rim: ["#3a4258", "#151a26"], inlay: "#3ff0ff",
  metal: ["#5a6580", "#2a3042", "#0d1018"], trim: "#3ff0ff", engraveDark: "rgba(63,240,255,.45)", engraveLight: "rgba(0,0,0,0)",
  hex: "rgba(63,240,255,.06)", groove: "#05070c", inlayDim: "rgba(255,60,200,.45)", pulse: "rgba(255,80,210,.8)", crystal: "#ff5ad8",
  light: "rgba(80,200,255,.10)", zoneGlow: "rgba(63,240,255,.10)",
  slab: ["#2a3042", "#0b0e16"],
  scar: { dark: "rgba(0,0,0,.85)", lip: "rgba(63,240,255,.35)", soil: "#2a1a10", scorch: "rgba(0,0,0,.5)", debris: ["#5a6580", "#2a3042", "#3ff0ff"], sparks: true },
  backdrop(ctx, R) {
    const r = rng(202);
    ctx.fillStyle = vgrad(ctx, R.y0, HORIZON + 10, [[0, "#04050f"], [0.6, "#160a33"], [1, "#4a1258"]]);
    ctx.fillRect(R.x0, R.y0, R.x1 - R.x0, HORIZON - R.y0 + 12);
    glow(ctx, 800, HORIZON, 700, "rgba(255,60,200,.25)");
    for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(220,230,255,${0.2 + r() * 0.5})`; ctx.fillRect(R.x0 + r() * (R.x1 - R.x0), R.y0 + r() * 70, 1.2, 1.2); }
    // three skyline layers, far (dim, blue) to near (dark, lit)
    for (const [layer, col, winA, hmin, hmax] of [[0, "#1d1640", 0.18, 30, 80], [1, "#130f2c", 0.35, 50, 120], [2, "#0a0818", 0.6, 70, 150]]) {
      let x = R.x0;
      while (x < R.x1) {
        const w = 30 + r() * 70, h = hmin + r() * (hmax - hmin), top = HORIZON + 10 - h;
        ctx.fillStyle = col; ctx.fillRect(x, top, w, h + 4);
        if (r() < 0.3) { ctx.fillRect(x + w * 0.45, top - 22, 3, 22); }
        for (let wy = top + 6; wy < HORIZON + 6; wy += 7) for (let wx = x + 4; wx < x + w - 4; wx += 6) {
          if (r() < winA * 0.5) { ctx.fillStyle = r() < 0.7 ? "rgba(120,230,255,.7)" : "rgba(255,120,220,.7)"; ctx.fillRect(wx, wy, 2.5, 3); }
        }
        ctx.fillStyle = col;
        x += w + 2 + layer * 3;
      }
    }
    // the central spire
    ctx.fillStyle = "#07060f";
    ctx.beginPath(); ctx.moveTo(770, HORIZON + 10); ctx.lineTo(788, R.y0 - 10); ctx.lineTo(812, R.y0 - 10); ctx.lineTo(830, HORIZON + 10); ctx.closePath(); ctx.fill();
    // reflective grid floor
    ctx.fillStyle = vgrad(ctx, HORIZON, R.y1, [[0, "#1a0f33"], [0.3, "#0b0c1c"], [1, "#05060c"]]);
    ctx.fillRect(R.x0, HORIZON + 8, R.x1 - R.x0, R.y1 - HORIZON);
    ctx.strokeStyle = "rgba(63,240,255,.22)"; ctx.lineWidth = 1;
    for (let i = -40; i <= 40; i++) { ctx.beginPath(); ctx.moveTo(800 + i * 18, HORIZON + 8); ctx.lineTo(800 + i * 220, R.y1 + 300); ctx.stroke(); }
    for (let k = 1; k < 26; k++) { const y = HORIZON + 8 + Math.pow(k / 26, 2) * (R.y1 - HORIZON + 200); ctx.globalAlpha = 0.3 + k / 40; ctx.beginPath(); ctx.moveTo(R.x0, y); ctx.lineTo(R.x1, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // pylons and holo-billboards at the sides
    for (const [x, y, h, c] of [[150, 520, 260, "#ff5ad8"], [1450, 520, 260, "#3ff0ff"], [90, 820, 340, "#3ff0ff"], [1510, 820, 340, "#ff5ad8"]]) {
      ctx.fillStyle = "#0b0d16"; ctx.fillRect(x - 14, y - h, 28, h);
      ctx.fillStyle = c; ctx.fillRect(x - 15, y - h, 2, h); ctx.fillRect(x + 13, y - h, 2, h);
    }
  },
  surround(ctx, R, t) {
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    // spire beacon
    const on = Math.sin(t * 3) > 0.2;
    if (on) glow(ctx, 800, R.y0 + 6, 60, "rgba(255,60,80,.8)");
    // flying traffic streaks
    for (let i = 0; i < 8; i++) {
      const dir = i % 2 ? 1 : -1, x = dir > 0 ? ((t * 140 + i * 230) % 2000) - 200 : 1800 - ((t * 120 + i * 260) % 2000), y = 40 + i * 11;
      ctx.fillStyle = i % 3 ? "rgba(120,230,255,.8)" : "rgba(255,120,220,.8)"; ctx.fillRect(x, y, 14 * dir, 2);
    }
    // grid pulse sweeping toward the viewer
    const k = (t * 0.35) % 1, y = HORIZON + 8 + k * k * (R.y1 - HORIZON);
    ctx.fillStyle = `rgba(63,240,255,${0.18 * (1 - k)})`; ctx.fillRect(R.x0, y, R.x1 - R.x0, 2 + k * 6);
    // billboard glows
    for (const [x, y2, h, c] of [[150, 520, 260, "255,90,216"], [1450, 520, 260, "63,240,255"], [90, 820, 340, "63,240,255"], [1510, 820, 340, "255,90,216"]]) glow(ctx, x, y2 - h, 40 + Math.sin(t * 2 + x) * 8, `rgba(${c},.5)`);
    ctx.restore();
  },
  overlay() {},
  ambient(P, dt) {
    if (Math.random() < dt * 8) { const p = proj((Math.random() - 0.5) * 1100, Math.random()); P.spawn({ x: p.x, y: p.y, vy: -30, vx: 0, life: 1.6, size: 1.4, color: Math.random() < 0.5 ? "#3ff0ff" : "#ff5ad8", kind: "spark", drag: 1 }); }
  },
};

// ----------------------------------------------------------------- frost
const frost = {
  name: "Frostpeak Glacier",
  tileStyle: "stone",
  ground: ["#c9d6e6", "#a7b8cf"], patch: "#ffffff", speck: "#ffffff", crack: "rgba(60,90,130,.5)", grout: "rgba(90,120,160,.3)",
  tile: ["#e8f0fa", "#b9c8dc"], tileEdge: "#6a7f9c", emblem: "rgba(60,90,140,.45)", label: "rgba(40,60,100,.85)",
  rim: ["#dfe8f4", "#8a9cb8"], inlay: "#8fe0ff",
  metal: ["#eef4fb", "#a9b9d0", "#5d6f8c"], trim: "#ffffff", engraveDark: "rgba(50,80,130,.45)", engraveLight: "rgba(255,255,255,.6)",
  hex: "rgba(80,120,170,.06)", groove: "#53657f", inlayDim: "rgba(143,224,255,.45)", pulse: "rgba(170,235,255,.8)", crystal: "#bff0ff",
  light: "rgba(255,255,255,.16)", zoneGlow: "rgba(170,230,255,.10)", snow: true,
  slab: ["#8a9cb8", "#56688a"],
  scar: { dark: "rgba(40,70,110,.7)", lip: "rgba(255,255,255,.6)", soil: "#6f86a8", scorch: "rgba(40,60,90,.35)", debris: ["#e8f0fa", "#b9c8dc", "#8fe0ff"] },
  backdrop(ctx, R) {
    const r = rng(303);
    ctx.fillStyle = vgrad(ctx, R.y0, HORIZON + 10, [[0, "#6f8fc0"], [0.7, "#b9cfe9"], [1, "#e9f1fb"]]);
    ctx.fillRect(R.x0, R.y0, R.x1 - R.x0, HORIZON - R.y0 + 12);
    glow(ctx, 380, 20, 240, "rgba(255,255,255,.6)");
    range(ctx, r, { base: HORIZON + 6, top: 2, step: 80, color: "#c8d6ea", shadow: "rgba(90,110,160,.4)", snow: "#ffffff", haze: "rgba(235,242,252,.6)", x0: R.x0, x1: R.x1 });
    range(ctx, r, { base: HORIZON + 10, top: 50, step: 60, color: "#9fb2cf", shadow: "rgba(60,80,130,.4)", snow: "#f6faff", haze: "rgba(220,232,248,.5)", x0: R.x0, x1: R.x1 });
    ctx.fillStyle = vgrad(ctx, HORIZON, R.y1, [[0, "#eef4fb"], [0.4, "#dbe6f3"], [1, "#b9c9de"]]);
    ctx.fillRect(R.x0, HORIZON + 8, R.x1 - R.x0, R.y1 - HORIZON);
    for (let i = 0; i < 60; i++) {
      const y = HORIZON + 20 + r() * (R.y1 - HORIZON), d = depth(y);
      ctx.fillStyle = "rgba(120,150,200,.12)"; ctx.beginPath(); ctx.ellipse(R.x0 + r() * (R.x1 - R.x0), y, 60 + d * 200, 6 + d * 18, 0, 0, TAU); ctx.fill();
    }
    const trees = [];
    for (let i = 0; i < 60; i++) {
      const y = HORIZON + 12 + Math.pow(r(), 1.3) * (R.y1 - HORIZON), x = r() < 0.5 ? R.x0 + r() * 400 : R.x1 - r() * 400;
      if (!onBoard(x, y)) trees.push([x, y]);
    }
    trees.sort((a, b) => a[1] - b[1]);
    for (const [x, y] of trees) pine(ctx, x, y, 18 + depth(y) * 150, "#2c4a52", "#3d6670", "#f4f9ff");
    for (let i = 0; i < 30; i++) {
      const y = HORIZON + 20 + r() * (R.y1 - HORIZON), x = R.x0 + r() * (R.x1 - R.x0);
      if (!onBoard(x, y)) rock(ctx, x, y, 4 + depth(y) * 20, "#8a9ab4", "#62728e");
    }
  },
  surround(ctx, R, t) { clouds(ctx, t, "rgba(255,255,255,.45)", 5, 60, 3); },
  overlay() {},
  ambient(P, dt) {
    if (Math.random() < dt * 40) P.spawn({ x: Math.random() * 1700 - 50, y: -10, vy: 30 + Math.random() * 30, vx: -10 + Math.random() * 8, life: 12, size: 1.2 + Math.random() * 2, color: "#ffffff", additive: false, drag: 1 });
  },
};

export const ARENAS = { meadow, neon, frost };
export const ARENA_LIST = [
  { id: "meadow", name: "Highland Meadow", desc: "An ancient stone dais in open grassland under the mountains." },
  { id: "neon", name: "Neon Spire", desc: "A holo-arena on a rooftop above a sleepless city." },
  { id: "frost", name: "Frostpeak Glacier", desc: "Ice-crusted stone among snowy peaks and pines." },
  { id: "arena", name: "Moonlit Citadel", desc: "A floating citadel under the stars." },
];
