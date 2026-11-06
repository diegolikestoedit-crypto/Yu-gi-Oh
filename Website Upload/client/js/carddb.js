// Card data is shared with the server (shared/cards.json). The client only reads it for display.
let cards = new Map();

export async function loadCards() {
  const res = await fetch(new URL("../../shared/cards.json", import.meta.url));
  const data = await res.json();
  cards = new Map(data.cards.map((c) => [c.id, c]));
  return cards;
}

export function card(cid) { return cid ? cards.get(cid) : null; }
export function allCards() { return [...cards.values()]; }

export const ATTR_COLORS = {
  LIGHT: ["#fff6cf", "#e6b84a"],
  DARK: ["#c79bff", "#3a1d63"],
  FIRE: ["#ffb36b", "#b3261e"],
  WATER: ["#9fe2ff", "#1e5aa8"],
  WIND: ["#b7ffd9", "#2a8f6a"],
  EARTH: ["#e6cf9a", "#6b4f2a"],
};

const SUBTYPE = { quickplay: "Quick-Play", equip: "Equip", continuous: "Continuous", field: "Field", counter: "Counter" };

// "Fusion / Effect", "Effect" or "Normal": the bracketed kind printed on monster cards.
export function monsterKind(c) {
  if (c.subtype === "fusion") return c.effect || c.piercing ? "Fusion / Effect" : "Fusion";
  return c.subtype === "effect" ? "Effect" : "Normal";
}

export function subtypeName(c) { return SUBTYPE[c.subtype] || ""; }

export function typeLine(c) {
  if (!c) return "";
  if (c.type === "monster") return `${c.attribute} · Level ${c.level} · ${c.race} / ${monsterKind(c)}`;
  const sub = subtypeName(c);
  return `${sub ? sub + " " : ""}${c.type === "spell" ? "Spell" : "Trap"}`;
}
