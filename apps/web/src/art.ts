import type { BoardSide, Color, Kind } from "@harmonies/game";

/**
 * 像素美术的地址和几何（美术规格 art/spec.md）。图片在 public/art 下，夜间白天同一套（背景除外）。
 * 所有像素图只按整数倍显示，image-rendering: pixelated。
 */
const ROOT = `${import.meta.env.BASE_URL}art/`;

export const art = {
  bg: (day: boolean) => `${ROOT}bg/table-${day ? "day" : "night"}@3x.png`,
  board: (side: BoardSide) => `${ROOT}board/side-${side === "A" ? "a" : "b"}.png`,
  supply: `${ROOT}board/supply.png`,
  hex: (name: "hover" | "valid" | "pattern" | "target" | "mask" | "empty") => `${ROOT}board/hex-${name}.png`,
  stack: (stack: string) => `${ROOT}tokens/${stack}.png`,
  token: (color: Color) => `${ROOT}tokens/${color}.png`,
  shadow: `${ROOT}tokens/shadow.png`,
  cube: (spirit: boolean) => `${ROOT}cubes/${spirit ? "spirit" : "animal"}.png`,
  card: (id: string) => `${ROOT}cards/${id.startsWith("S") ? "spirits" : "animals"}/${id.toLowerCase()}.png`,
  anim: (id: string) => `${ROOT}cards/anim/${id.toLowerCase()}.png`,
  back: (spirit: boolean) => `${ROOT}cards/back-${spirit ? "spirit" : "animal"}.png`,
  mini: (kind: Kind | "target") => `${ROOT}cards/mini/${kind}.png`,
  icon: (name: "water" | "mountain" | "trunk" | "tree" | "field" | "house" | "score" | "river" | "island" | "spirit") => `${ROOT}icons/${name}.png`,
  bag: `${ROOT}ui/bag.png`,
  first: `${ROOT}ui/first.png`,
  result: `${ROOT}ui/result.png`,
  fx: (name: "place" | "cube" | "leaves") => `${ROOT}fx/${name}.png`,
};

/** 版图图片原始尺寸。 */
export const BOARD_PX: Record<BoardSide, { w: number; h: number }> = { A: { w: 168, h: 196 }, B: { w: 216, h: 168 } };
export const HEX = { w: 32, h: 28 };
/** 格子 (c, r) 在版图图片里的左上角（原始像素）。 */
export function cellOrigin(c: number, r: number): { x: number; y: number } {
  return { x: 20 + 24 * c, y: 22 + 28 * r + (c % 2 === 1 ? 14 : 0) };
}
/** 标记图 32×44，左上角 = 格子左上角 + (0, −18)。 */
export const TOKEN = { w: 32, h: 44, dy: -18 };
/** 方块图底边中点 = 标记图左上角 + 这里的坐标（tokens.json）。 */
export const CUBE_ANCHOR: Record<string, [number, number]> = {
  W: [16, 28], Y: [16, 28], K: [16, 28], KK: [16, 23], KKK: [16, 18], B: [16, 28], BB: [16, 23],
  G: [16, 26], BG: [16, 19], BBG: [16, 14], R: [16, 25], KR: [16, 18], BR: [16, 18], RR: [16, 18],
};
export const CUBE_PX = { animal: { w: 12, h: 14 }, spirit: { w: 14, h: 14 } };
/** 中央托盘 304×76：凹槽中心 (32 + 60i, 40)；三个标记左上角偏移。 */
export const SUPPLY_PX = { w: 304, h: 76 };
export const SUPPLY_SLOTS = [[-28, -34], [-4, -34], [-16, -24]] as const;
export function supplyCenter(i: number): { x: number; y: number } {
  return { x: 32 + 60 * i, y: 40 };
}

/** 动物卡 5 种颜色（卡框）。 */
export const CARD_HEX: Record<string, string> = { blue: "#3f86d0", red: "#cf4b3b", green: "#4aa548", gray: "#8a929c", yellow: "#e2b83a", spirit: "#8fd6f0" };
/** 座位色。 */
export const SEAT_HEX = ["#e8843a", "#3f86d0", "#4aa548", "#a066c8"];

/** 有小动作动画的卡（cards/anim/index.json 里都有，32 张全做了）。 */
export function hasAnim(id: string): boolean {
  return id.startsWith("A");
}
