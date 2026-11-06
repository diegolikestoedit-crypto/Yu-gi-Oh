// Persistent player preferences (localStorage). Every access is guarded: storage can be unavailable.
const KEY = "living-duel-settings-v1";
const DEFAULTS = {
  name: "",
  guide: true,
  guideMin: false,
  guideHints: true,
  animSpeed: 1,
  quality: "high",
  // Respect the system's reduced-motion preference for the default camera.
  camera: !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches),
  figures: "always",
  autoPass: true,
  confirmEnd: true,
  logOpen: false,
  lastDeck: "",
  lastProfile: "citadel",
  music: 0.45,
  sfx: 0.8,
  monster: 0.8,
  ui: 0.6,
  muted: false,
};

const listeners = new Set();
let values = { ...DEFAULTS };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) values = { ...DEFAULTS, ...JSON.parse(raw) };
} catch { /* storage blocked: use defaults */ }

export const settings = {
  get(k) { return values[k]; },
  set(k, v) {
    values[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* ignore */ }
    for (const fn of listeners) fn(k, v);
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
