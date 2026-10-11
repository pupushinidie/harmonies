import type { AnimalCard, CardColor, Kind, PatternCell, ShapeName, SpiritCard } from "./types.js";

/**
 * 5 种图案形状的轴向偏移（规则书 2.4），按「写法」里格子的顺序：
 * - two：X → 右下 Y
 * - line：X → 右下 Y → 右下 Z
 * - tri：X；X 正下方 Y；X 右下 Z
 * - v：中心 X；左下；右下
 * - fan：中心 X；左下；正下；右下（自然之灵 S02 的「菱形」也是这四格）
 */
export const SHAPES: Record<ShapeName, readonly (readonly [number, number])[]> = {
  two: [[0, 0], [1, 0]],
  line: [[0, 0], [1, 0], [2, 0]],
  tri: [[0, 0], [0, 1], [1, 0]],
  v: [[0, 0], [-1, 1], [1, 0]],
  fan: [[0, 0], [-1, 1], [0, 1], [1, 0]],
};

/** 按形状和每格地貌造图案；kinds 里用 "[X]" 标出方块目标格。 */
function pattern(shape: ShapeName, kinds: readonly string[]): PatternCell[] {
  const offsets = SHAPES[shape];
  if (offsets.length !== kinds.length) throw new Error(`图案格数不对：${shape}`);
  return offsets.map(([q, a], index) => {
    const raw = kinds[index]!;
    const target = raw.startsWith("[");
    return { q, a, kind: raw.replace(/[[\]]/g, "") as Kind, target };
  });
}

function animal(id: string, color: CardColor, shape: ShapeName, kinds: string[], scores: number[], name: string): AnimalCard {
  return { id, color, shape, cells: pattern(shape, kinds), scores, name };
}

/** 32 张动物卡（规则书 2.4；动物形象按美术规格 3 节）。 */
export const ANIMAL_CARDS: readonly AnimalCard[] = [
  animal("A01", "blue", "line", ["T3", "W", "[W]"], [4, 9, 15], "水獭"),
  animal("A02", "blue", "tri", ["K1", "K1", "[W]"], [4, 10, 16], "绿头鸭"),
  animal("A03", "blue", "two", ["K3", "[W]"], [3, 6, 10, 16], "青蛙"),
  animal("A04", "blue", "line", ["G1", "G1", "[W]"], [5, 10, 16], "苍鹭"),
  animal("A05", "blue", "two", ["G1", "[W]"], [2, 4, 6, 10, 15], "河狸"),
  animal("A06", "blue", "two", ["H", "[W]"], [2, 4, 8, 13], "翠鸟"),
  animal("A07", "blue", "tri", ["Y", "Y", "[W]"], [4, 10, 16], "鳟鱼"),
  animal("A08", "red", "line", ["Y", "Y", "[H]"], [5, 10, 16], "家燕"),
  animal("A09", "red", "v", ["[H]", "Y", "Y"], [5, 10, 17], "白鹳"),
  animal("A10", "red", "v", ["[H]", "W", "W"], [5, 10, 17], "小家鼠"),
  animal("A11", "red", "two", ["T3", "[H]"], [4, 9, 15], "蝙蝠"),
  animal("A12", "red", "tri", ["T2", "T2", "[H]"], [5, 12], "刺猬"),
  animal("A13", "green", "fan", ["[T2]", "Y", "Y", "Y"], [8, 18], "松鼠"),
  animal("A14", "green", "tri", ["K2", "K2", "[G1]"], [5, 11], "猫头鹰"),
  animal("A15", "green", "line", ["H", "G1", "[G1]"], [5, 10, 17], "啄木鸟"),
  animal("A16", "green", "tri", ["W", "W", "[T2]"], [4, 9, 14], "浣熊"),
  animal("A17", "green", "two", ["H", "[T2]"], [4, 8, 13], "公鹿"),
  animal("A18", "green", "two", ["G1", "[T2]"], [3, 6, 10, 15], "獾"),
  animal("A19", "green", "tri", ["Y", "Y", "[T3]"], [4, 10, 16], "野猪"),
  animal("A20", "green", "v", ["[T3]", "W", "W"], [5, 11, 18], "棕熊"),
  animal("A21", "gray", "v", ["[K1]", "W", "W"], [4, 10, 16], "北山羊"),
  animal("A22", "gray", "two", ["T3", "[K1]"], [3, 6, 10, 15], "旱獭"),
  animal("A23", "gray", "line", ["Y", "K1", "[K1]"], [4, 9, 16], "金雕"),
  animal("A24", "gray", "tri", ["W", "W", "[K2]"], [5, 11], "猞猁"),
  animal("A25", "gray", "two", ["Y", "[K3]"], [5, 11], "狼"),
  animal("A26", "gray", "two", ["Y", "[K1]"], [2, 5, 9, 14], "雪豹"),
  animal("A27", "yellow", "v", ["[Y]", "H", "H"], [4, 9], "野兔"),
  animal("A28", "yellow", "line", ["K2", "Y", "[Y]"], [5, 12], "狐狸"),
  animal("A29", "yellow", "v", ["[Y]", "T2", "T2"], [5, 10, 17], "雉鸡"),
  animal("A30", "yellow", "fan", ["[Y]", "W", "W", "W"], [6, 12], "仓鼠"),
  animal("A31", "yellow", "two", ["G1", "[Y]"], [2, 5, 8, 12, 17], "熊蜂"),
  animal("A32", "yellow", "line", ["T2", "T2", "[Y]"], [5, 11], "鼹鼠"),
];

function spirit(id: string, shape: ShapeName, kinds: string[], name: string, rule: string): SpiritCard {
  return { id, shape, cells: pattern(shape, kinds), name, rule };
}

/** 10 张自然之灵卡（规则书 2.5）。计分见 score.ts 的 spiritPoints。 */
export const SPIRIT_CARDS: readonly SpiritCard[] = [
  spirit("S01", "line", ["T2", "[Y]", "Y"], "麦光兔", "每片田：1–2 个得 2 分，3 个及以上得 10 分"),
  spirit("S02", "fan", ["W", "Y", "W", "[Y]"], "绒羽鸟", "每片田得 5 分"),
  spirit("S03", "line", ["T3", "[T2]", "G1"], "枝角白鹿", "每棵高 2 或高 3 的树得 4 分"),
  spirit("S04", "tri", ["G1", "G1", "[T3]"], "苔背龟", "每棵树：高 1、高 2 得 3 分，高 3 得 1 分"),
  spirit("S05", "line", ["H", "G1", "[H]"], "炉火猫", "每片相连的房屋得 4 分"),
  spirit("S06", "line", ["Y", "H", "[H]"], "萤灯狐", "每片相连 2 座及以上的房屋得 6 分"),
  spirit("S07", "two", ["K2", "[K3]"], "山石熊", "每座高 2 或高 3 的山得 4 分（孤立的也算）"),
  spirit("S08", "v", ["[K2]", "K1", "K1"], "晶角羊", "每座山：高 1、高 2 得 3 分，高 3 得 1 分（孤立的也算）"),
  spirit("S09", "line", ["T2", "[W]", "T2"], "锦鲤", "每片相连 2 个及以上的水得 7 分"),
  spirit("S10", "line", ["K2", "[W]", "W"], "浪鬃水马", "每个水标记得 2 分"),
];

const ANIMAL_BY_ID = new Map(ANIMAL_CARDS.map((card) => [card.id, card]));
const SPIRIT_BY_ID = new Map(SPIRIT_CARDS.map((card) => [card.id, card]));

export function isSpiritId(id: string): boolean {
  return SPIRIT_BY_ID.has(id);
}

export function animalCard(id: string): AnimalCard {
  const card = ANIMAL_BY_ID.get(id);
  if (!card) throw new Error(`没有这张动物卡：${id}`);
  return card;
}

export function spiritCard(id: string): SpiritCard {
  const card = SPIRIT_BY_ID.get(id);
  if (!card) throw new Error(`没有这张自然之灵卡：${id}`);
  return card;
}

/** 卡上的图案（动物卡或自然之灵卡）。 */
export function cardPattern(id: string): readonly PatternCell[] {
  return isSpiritId(id) ? spiritCard(id).cells : animalCard(id).cells;
}

/** 这张卡一共几个方块（自然之灵卡 1 个）。 */
export function cubeCount(id: string): number {
  return isSpiritId(id) ? 1 : animalCard(id).scores.length;
}

/** 动物卡放了 n 个方块得几分；自然之灵卡这里是 0（另外按地貌算）。 */
export function cardPoints(id: string, placed: number): number {
  if (isSpiritId(id) || placed <= 0) return 0;
  const scores = animalCard(id).scores;
  return scores[Math.min(placed, scores.length) - 1]!;
}
