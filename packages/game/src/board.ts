import { cardPattern, cardPoints, isSpiritId } from "./cards.js";
import type {
  Board,
  BoardSide,
  Cell,
  Color,
  HeldCard,
  Kind,
  LandscapeScore,
  Player,
  ScoreBreakdown,
} from "./types.js";

/** 每一面每列有几格：A 面 5 列 5/4/5/4/5，B 面 7 列 4/3/4/3/4/3/4（规则书 2.3）。 */
export const SIDE_COLUMNS: Record<BoardSide, readonly number[]> = {
  A: [5, 4, 5, 4, 5],
  B: [4, 3, 4, 3, 4, 3, 4],
};

export function key(c: number, r: number): string {
  return `${c},${r}`;
}

export function parseKey(cell: string): [number, number] {
  const [c, r] = cell.split(",").map(Number);
  return [c!, r!];
}

/** 这一面所有格子，按列、再按行排好（「坐标最小」就是这个顺序里靠前）。 */
export function sideCells(side: BoardSide): string[] {
  const cells: string[] = [];
  SIDE_COLUMNS[side].forEach((rows, c) => {
    for (let r = 0; r < rows; r += 1) cells.push(key(c, r));
  });
  return cells;
}

const CELL_SETS: Record<BoardSide, Set<string>> = {
  A: new Set(sideCells("A")),
  B: new Set(sideCells("B")),
};

export function isCell(side: BoardSide, cell: string): boolean {
  return CELL_SETS[side].has(cell);
}

export function emptyBoard(side: BoardSide): Board {
  const board: Board = {};
  for (const cell of sideCells(side)) board[cell] = { stack: [], cube: null };
  return board;
}

/** 偏移坐标 → 轴向坐标：q = c，a = r − (c − (c & 1)) / 2。 */
export function toAxial(c: number, r: number): [number, number] {
  return [c, r - (c - (c & 1)) / 2];
}

export function fromAxial(q: number, a: number): [number, number] {
  return [q, a + (q - (q & 1)) / 2];
}

/** 6 个方向的轴向偏移：上、下、右上、右下、左上、左下。 */
export const AXIAL_DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [-1, 0],
  [-1, 1],
];

/** 这一格在该面上的邻居（坐标超出这一面的不算）。 */
export function neighbors(side: BoardSide, cell: string): string[] {
  const [c, r] = parseKey(cell);
  const [q, a] = toAxial(c, r);
  const result: string[] = [];
  for (const [dq, da] of AXIAL_DIRS) {
    const [nc, nr] = fromAxial(q + dq, a + da);
    const next = key(nc, nr);
    if (isCell(side, next)) result.push(next);
  }
  return result;
}

export function sideOf(board: Board): BoardSide {
  return Object.keys(board).length === 23 ? "A" : "B";
}

export function top(cell: Cell | undefined): Color | null {
  return cell && cell.stack.length > 0 ? cell.stack[cell.stack.length - 1]! : null;
}

/** 一摞标记是什么地貌（规则书 9.1）；B、BB、单个 R 这种不成地貌的返回 null。 */
export function kindOf(stack: readonly Color[]): Kind | null {
  const n = stack.length;
  if (n === 0) return null;
  const t = stack[n - 1]!;
  if (t === "W") return "W";
  if (t === "Y") return "Y";
  if (stack.every((color) => color === "K")) return (["K1", "K2", "K3"] as const)[n - 1] ?? null;
  if (t === "G" && stack.slice(0, -1).every((color) => color === "B")) return (["G1", "T2", "T3"] as const)[n - 1] ?? null;
  if (t === "R" && n === 2) return "H";
  return null;
}

/**
 * 叠放规则（规则书 4.1）：空格放什么都行；K 叠在 K、KK 上；B 叠在 B 上；
 * G 叠在 B、BB 上；R 叠在单层的 K、B、R 上。有方块的格子不能再放。
 * 返回错误原因，能放返回 null。
 */
export function stackError(cell: Cell | undefined, color: Color): string | null {
  if (!cell) return "这一格不在你的版图上。";
  if (cell.cube) return "有方块的格子上面不能再放标记。";
  const s = cell.stack;
  if (s.length === 0) return null;
  if (s.length >= 3) return "最多叠 3 层。";
  const below = s.join("");
  switch (color) {
    case "K":
      return below === "K" || below === "KK" ? null : "山只能叠在山上（最多 3 层）。";
    case "B":
      return below === "B" ? null : "树干只能叠在 1 个树干上。";
    case "G":
      return below === "B" || below === "BB" ? null : "树冠只能放在空格或树干上。";
    case "R":
      return below === "K" || below === "B" || below === "R" ? null : "屋顶只能压在单层的山、树干或屋顶上。";
    default:
      return "水和田只能放在空格上。";
  }
}

export function canStack(cell: Cell | undefined, color: Color): boolean {
  return stackError(cell, color) === null;
}

/** 这个颜色能放到版图的哪些格（按坐标顺序）。 */
export function legalCellsFor(board: Board, color: Color): string[] {
  return Object.keys(board).filter((cell) => canStack(board[cell], color)).sort(compareCells);
}

export function compareCells(x: string, y: string): number {
  const [xc, xr] = parseKey(x);
  const [yc, yr] = parseKey(y);
  return xc - yc || xr - yr;
}

export function emptyCount(board: Board): number {
  return Object.values(board).filter((cell) => cell.stack.length === 0).length;
}

/** 顺时针转 60°：(q, a) → (−a, q + a)。 */
function rotate(q: number, a: number): [number, number] {
  return [-a, q + a];
}

/**
 * 图案能不能以 cell 为目标格摆出来（任意旋转，规则书 4.3）：每格的地貌和要求一致。
 * 只检查地貌，不检查目标格有没有方块。返回所有能成立的旋转下用到的格子（第一个找到的）。
 */
export function matchPattern(board: Board, cardId: string, cell: string): string[] | null {
  const pattern = cardPattern(cardId);
  const target = pattern.find((p) => p.target)!;
  const [c, r] = parseKey(cell);
  const [tq, ta] = toAxial(c, r);
  for (let rot = 0; rot < 6; rot += 1) {
    const used: string[] = [];
    let ok = true;
    for (const p of pattern) {
      let dq = p.q - target.q;
      let da = p.a - target.a;
      for (let k = 0; k < rot; k += 1) [dq, da] = rotate(dq, da);
      const [nc, nr] = fromAxial(tq + dq, ta + da);
      const at = key(nc, nr);
      const here = board[at];
      if (!here || kindOf(here.stack) !== p.kind) {
        ok = false;
        break;
      }
      used.push(at);
    }
    if (ok) return used;
  }
  return null;
}

/** 这张卡现在能把下一个方块放在哪些格（目标格没方块、图案成立）。 */
export function cubeTargetsOnBoard(board: Board, cardId: string): string[] {
  return Object.keys(board)
    .filter((cell) => board[cell]!.cube === null && matchPattern(board, cardId, cell) !== null)
    .sort(compareCells);
}

/** 连通块（按 6 方向）：只看满足 test 的格子。 */
export function groups(board: Board, side: BoardSide, test: (cell: Cell) => boolean): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const start of sideCells(side)) {
    if (seen.has(start) || !test(board[start]!)) continue;
    const group: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const cell = queue.shift()!;
      group.push(cell);
      for (const next of neighbors(side, cell)) {
        if (!seen.has(next) && test(board[next]!)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    result.push(group);
  }
  return result;
}

/** 河长：一片水里任意两点最短路径经过的格子数的最大值（直径，规则书 6.1 / 待确认 2）。 */
export function riverLength(board: Board, side: BoardSide): number {
  let best = 0;
  for (const group of groups(board, side, (cell) => top(cell) === "W")) {
    const members = new Set(group);
    for (const start of group) {
      const dist = new Map<string, number>([[start, 1]]);
      const queue = [start];
      while (queue.length > 0) {
        const cell = queue.shift()!;
        const d = dist.get(cell)!;
        if (d > best) best = d;
        for (const next of neighbors(side, cell)) {
          if (members.has(next) && !dist.has(next)) {
            dist.set(next, d + 1);
            queue.push(next);
          }
        }
      }
    }
  }
  return best;
}

/** 河长对应的分数：1 = 0，2 = 2，3 = 5，4 = 8，5 = 11，6 = 15，之后每多 1 格 +4。 */
export function riverPoints(length: number): number {
  const table = [0, 0, 2, 5, 8, 11, 15];
  if (length <= 6) return table[length] ?? 0;
  return 15 + 4 * (length - 6);
}

/** 岛屿数（B 面）：最上层不是水的格子（包括空格）按相邻分片。 */
export function islandCount(board: Board, side: BoardSide): number {
  return groups(board, side, (cell) => top(cell) !== "W").length;
}

const HEIGHT_POINTS = [0, 1, 3, 7];

/** 地貌分（规则书 6.1）。 */
export function landscapeScore(board: Board, side: BoardSide = sideOf(board)): LandscapeScore {
  let trees = 0;
  let mountains = 0;
  let houses = 0;
  for (const cell of sideCells(side)) {
    const here = board[cell]!;
    const kind = kindOf(here.stack);
    if (kind === "G1" || kind === "T2" || kind === "T3") trees += HEIGHT_POINTS[here.stack.length]!;
    else if (kind === "K1" || kind === "K2" || kind === "K3") {
      const touching = neighbors(side, cell).some((next) => isMountain(board[next]!));
      if (touching) mountains += HEIGHT_POINTS[here.stack.length]!;
    } else if (kind === "H") {
      const colors = new Set<Color>();
      for (const next of neighbors(side, cell)) {
        const color = top(board[next]);
        if (color) colors.add(color);
      }
      if (colors.size >= 3) houses += 5;
    }
  }
  const fields = groups(board, side, (cell) => top(cell) === "Y").filter((group) => group.length >= 2).length * 5;
  const water = side === "A" ? riverPoints(riverLength(board, side)) : islandCount(board, side) * 5;
  return { trees, mountains, fields, houses, water, total: trees + mountains + fields + houses + water };
}

function isMountain(cell: Cell): boolean {
  const kind = kindOf(cell.stack);
  return kind === "K1" || kind === "K2" || kind === "K3";
}

/** 自然之灵另外加的分（规则书 2.5；只看地貌本身，不看平时的得分条件）。 */
export function spiritPoints(cardId: string, board: Board, side: BoardSide = sideOf(board)): number {
  const kinds = sideCells(side).map((cell) => kindOf(board[cell]!.stack));
  const count = (...want: Kind[]) => kinds.filter((kind) => kind !== null && want.includes(kind)).length;
  const kindGroups = (want: Kind) => groups(board, side, (cell) => kindOf(cell.stack) === want);
  switch (cardId) {
    case "S01":
      return kindGroups("Y").reduce((sum, group) => sum + (group.length >= 3 ? 10 : 2), 0);
    case "S02":
      return kindGroups("Y").length * 5;
    case "S03":
      return count("T2", "T3") * 4;
    case "S04":
      return count("G1", "T2") * 3 + count("T3") * 1;
    case "S05":
      return kindGroups("H").length * 4;
    case "S06":
      return kindGroups("H").filter((group) => group.length >= 2).length * 6;
    case "S07":
      return count("K2", "K3") * 4;
    case "S08":
      return count("K1", "K2") * 3 + count("K3") * 1;
    case "S09":
      return kindGroups("W").filter((group) => group.length >= 2).length * 7;
    case "S10":
      return count("W") * 2;
    default:
      return 0;
  }
}

/** 版图上的动物方块数（不含自然之灵方块）。 */
export function animalCubesOnBoard(board: Board): number {
  return Object.values(board).filter((cell) => cell.cube !== null && !isSpiritId(cell.cube)).length;
}

/** 一位玩家的完整计分（终局和实时显示都用这个）。 */
export function scorePlayer(player: Pick<Player, "id" | "board" | "cards">, side: BoardSide): ScoreBreakdown {
  const landscape = landscapeScore(player.board, side);
  const cards = player.cards
    .filter((card) => !isSpiritId(card.id))
    .map((card) => ({ id: card.id, placed: card.placed, points: cardPoints(card.id, card.placed) }));
  const animals = cards.reduce((sum, card) => sum + card.points, 0);
  const held = player.cards.find((card) => isSpiritId(card.id));
  const spirit = held
    ? { id: held.id, placed: held.placed > 0, points: held.placed > 0 ? spiritPoints(held.id, player.board, side) : 0 }
    : null;
  return {
    player: player.id,
    landscape,
    cards,
    animals,
    spirit,
    total: landscape.total + animals + (spirit?.points ?? 0),
    animalCubes: animalCubesOnBoard(player.board),
  };
}

/** 没完成的卡（动物卡加上没放方块的自然之灵卡），领卡上限是 4 张。 */
export function unfinishedCards(cards: readonly HeldCard[], cubesOf: (id: string) => number): HeldCard[] {
  return cards.filter((card) => card.placed < cubesOf(card.id));
}

/** 胜负：总分高者胜；平分比放了多少动物方块；还平就并列（规则书 7）。 */
export function rankWinners(scores: readonly ScoreBreakdown[]): string[] {
  const best = Math.max(...scores.map((score) => score.total));
  const top1 = scores.filter((score) => score.total === best);
  const cubes = Math.max(...top1.map((score) => score.animalCubes));
  return top1.filter((score) => score.animalCubes === cubes).map((score) => score.player);
}

/** 按「X Y」这种从下到上的写法造版图（测试和预览用）：{"0,0": "KK", "1,0": "BG"}。 */
export function boardFrom(side: BoardSide, layout: Record<string, string>, cubes: Record<string, string> = {}): Board {
  const board = emptyBoard(side);
  for (const [cell, stack] of Object.entries(layout)) {
    if (!board[cell]) throw new Error(`格子不在 ${side} 面上：${cell}`);
    board[cell] = { stack: stack.replace(/\s+/g, "").split("") as Color[], cube: null };
  }
  for (const [cell, cardId] of Object.entries(cubes)) {
    if (!board[cell]) throw new Error(`格子不在 ${side} 面上：${cell}`);
    board[cell]!.cube = cardId;
  }
  return board;
}
