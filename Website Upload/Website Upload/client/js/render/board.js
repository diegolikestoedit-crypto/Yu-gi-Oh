// Tabletop board geometry. The board is a tilted plane: z = 0 is the near edge (the viewer's side),
// z = 1 the far edge. Columns are in board units; proj() maps them to the 1600x900 logical screen.
export const W = 1600, H = 900;
// The far edge sits lower and smaller than before, leaving a horizon for landscapes and stronger depth.
const CX = 800, Y_NEAR = 846, Y_FAR = 158, S_FAR = 0.68;
export const COL = 150;            // column spacing at the near edge
export const TILE_W = 128, TILE_H = 132;
export const CARD_W = 84, CARD_H = 120;
export const FORE = 0.82;          // vertical foreshortening of things lying on the board
export const Z = { st0: 0.14, mon0: 0.335, mid: 0.5, mon1: 0.665, st1: 0.86 };
export const HALF_NEAR = 3 * COL + TILE_W / 2 + 54;

export function proj(x, z) {
  const s = 1 + (S_FAR - 1) * z;
  return { x: CX + x * s, y: Y_NEAR + (Y_FAR - Y_NEAR) * z, s };
}
// Screen point back to board space (on the board plane).
export function unproj(px, py) {
  const z = (py - Y_NEAR) / (Y_FAR - Y_NEAR);
  const s = 1 + (S_FAR - 1) * z;
  return { x: (px - CX) / s, z };
}
export const HORIZON_Y = 92;

// side 0 = the viewer (near half), side 1 = the opponent (far half, columns mirrored across the table).
function zone(side, row, col) {
  const z = row === "mon" ? (side === 0 ? Z.mon0 : Z.mon1) : side === 0 ? Z.st0 : Z.st1;
  return proj((side === 0 ? col : -col) * COL, z);
}
export const monsterZone = (side, slot) => zone(side, "mon", slot - 2);
export const stZone = (side, slot) => zone(side, "st", slot - 2);
export const fieldZone = (side) => zone(side, "mon", -3);
export const gyZone = (side) => zone(side, "mon", 3);
export const deckZone = (side) => zone(side, "st", 3);
export const extraZone = (side) => zone(side, "st", -3);
export const sideCenter = (side) => proj(0, side === 0 ? Z.mon0 : Z.mon1);
// Where a duelist "stands" for direct attacks and life-point hits: just past their back edge.
export const duelistPoint = (side) => (side === 0 ? { x: CX, y: Y_NEAR - 20, s: 1 } : proj(0, 0.97));

export function allZones() {
  const out = [];
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < 5; i++) {
      out.push({ side, kind: "mon", slot: i, ...monsterZone(side, i) });
      out.push({ side, kind: "st", slot: i, ...stZone(side, i) });
    }
    out.push({ side, kind: "field", ...fieldZone(side) }, { side, kind: "gy", ...gyZone(side) });
    out.push({ side, kind: "deck", ...deckZone(side) }, { side, kind: "extra", ...extraZone(side) });
  }
  return out;
}

// Board outline as a polygon (with an optional margin in board units).
export function outline(margin = 0) {
  const hw = HALF_NEAR + margin;
  const a = proj(-hw, -0.015), b = proj(hw, -0.015), c = proj(hw, 1.015), d = proj(-hw, 1.015);
  return [a, b, c, d];
}
