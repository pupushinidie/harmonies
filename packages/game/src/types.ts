/** 6 种地貌标记：水、山、树干、树冠、田、房屋（规则书 2.2）。 */
export const COLORS = ["W", "K", "B", "G", "Y", "R"] as const;
export type Color = (typeof COLORS)[number];

export const COLOR_NAMES: Record<Color, string> = {
  W: "水",
  K: "山",
  B: "树干",
  G: "树冠",
  Y: "田",
  R: "屋顶",
};

/** 每种标记的数量，共 120 个。 */
export const TOKEN_COUNTS: Record<Color, number> = { W: 23, K: 23, B: 21, G: 19, Y: 19, R: 15 };

/**
 * 一格的地貌（卡上图案的要求，也是 kindOf(stack) 的结果）：
 * W 水、Y 田、G1/T2/T3 高 1/2/3 的树、K1/K2/K3 高 1/2/3 的山、H 房屋。
 */
export type Kind = "W" | "Y" | "G1" | "T2" | "T3" | "K1" | "K2" | "K3" | "H";

export const KIND_NAMES: Record<Kind, string> = {
  W: "水",
  Y: "田",
  G1: "高 1 的树",
  T2: "高 2 的树",
  T3: "高 3 的树",
  K1: "高 1 的山",
  K2: "高 2 的山",
  K3: "高 3 的山",
  H: "房屋",
};

/** 卡的颜色（侧边色条 = 目标格的地貌）。 */
export type CardColor = "blue" | "red" | "green" | "gray" | "yellow";

/** 图案里的一格：轴向偏移 (q, a)、要求的地貌、是不是方块目标格。 */
export interface PatternCell {
  readonly q: number;
  readonly a: number;
  readonly kind: Kind;
  readonly target: boolean;
}

export type ShapeName = "two" | "line" | "tri" | "v" | "fan";

export interface AnimalCard {
  readonly id: string;
  readonly color: CardColor;
  readonly shape: ShapeName;
  readonly cells: readonly PatternCell[];
  /** 放了 1、2、3… 个方块分别得几分；长度就是方块数。 */
  readonly scores: readonly number[];
  readonly name: string;
}

/** 自然之灵卡：图案规则和动物卡一样，只有 1 个方块，终局另外加分（规则书 2.5）。 */
export interface SpiritCard {
  readonly id: string;
  readonly shape: ShapeName;
  readonly cells: readonly PatternCell[];
  readonly name: string;
  /** 一句话说明计分方式。 */
  readonly rule: string;
}

export type BoardSide = "A" | "B";

/** 个人版图的一格：从下到上的标记、方块（放的是哪张卡的方块）。 */
export interface Cell {
  stack: Color[];
  cube: string | null;
}

/** 键是 "c,r"（规则书 2.3 的偏移坐标）。 */
export type Board = Record<string, Cell>;

/** 面前的一张卡（动物卡或选定的自然之灵卡）和已经放了几个方块。 */
export interface HeldCard {
  readonly id: string;
  placed: number;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  board: Board;
  cards: HeldCard[];
  /** 自然之灵：发到的 2 张（只有本人看得到），选完删掉。 */
  spiritChoices?: string[];
  /** 自然之灵：开局阶段选好的那张，只有本人看得到；全部选完后放进 cards。 */
  spiritPick?: string;
  /** 实时总分（地貌 + 动物 + 自然之灵，都是公开信息算得出来的）。 */
  score: number;
}

export interface GameOptions {
  /** 个人版图用 A 面（河流）还是 B 面（岛屿），所有人同一面。 */
  readonly side: BoardSide;
  /** 自然之灵变体。 */
  readonly spirits: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { side: "A", spirits: false };

export interface Config {
  readonly playerCount: number;
  readonly side: BoardSide;
  readonly spirits: boolean;
  /** 每回合时限（秒），规则书 9.4。 */
  readonly turnTimeoutSec: number;
  /** 自然之灵选卡的时限（秒）。 */
  readonly spiritTimeoutSec: number;
}

export type GameCommand =
  | { readonly type: "pickSpirit"; readonly cardId: string }
  | { readonly type: "takeTokens"; readonly space: number }
  | { readonly type: "placeToken"; readonly index: number; readonly cell: string }
  | { readonly type: "takeCard"; readonly cardId: string }
  | { readonly type: "placeCube"; readonly cardId: string; readonly cell: string }
  | { readonly type: "undo" }
  | { readonly type: "endTurn" };

/** 撤销用的快照：只含当前玩家自己的版图和卡、中央版图、牌列、回合进度（都是公开信息）。 */
export interface UndoSnapshot {
  readonly board: Board;
  readonly cards: HeldCard[];
  readonly central: Color[][];
  readonly market: string[];
  readonly took: number | null;
  readonly taken: Color[];
  readonly hand: Color[];
  readonly tookCard: string | null;
  readonly placed: string[];
  readonly cubes: string[];
  readonly score: number;
}

export interface TurnState {
  /** 本回合拿的是第几格（0–4），还没拿是 null。 */
  took: number | null;
  /** 本回合拿到的标记（原样，界面和记录用）。 */
  taken: Color[];
  /** 拿了还没放的标记。 */
  hand: Color[];
  /** 本回合领的卡（每回合最多 1 张）。 */
  tookCard: string | null;
  /** 本回合放了标记的格子（界面高亮用）。 */
  placed: string[];
  /** 本回合放了方块的格子。 */
  cubes: string[];
  /** 撤销栈：只在服务端；发给客户端时清空，只给 undoCount。 */
  undo: UndoSnapshot[];
  undoCount: number;
}

/** 上一个回合的摘要（换人后给别人看「他刚才放了哪些格」）。 */
export interface LastTurn {
  readonly player: string;
  readonly space: number | null;
  readonly tokens: Color[];
  readonly placed: string[];
  readonly cubes: string[];
  readonly card: string | null;
  readonly timedOut: boolean;
}

export interface LandscapeScore {
  readonly trees: number;
  readonly mountains: number;
  readonly fields: number;
  readonly houses: number;
  readonly water: number;
  readonly total: number;
}

export interface ScoreBreakdown {
  readonly player: string;
  readonly landscape: LandscapeScore;
  /** 每张动物卡的得分。 */
  readonly cards: { readonly id: string; readonly placed: number; readonly points: number }[];
  readonly animals: number;
  readonly spirit: { readonly id: string; readonly placed: boolean; readonly points: number } | null;
  readonly total: number;
  /** 放到版图上的动物方块数（平分时比较，不含自然之灵方块）。 */
  readonly animalCubes: number;
}

/** 终局原因：有人版图只剩 ≤ 2 个空格 / 布袋空了 / 中央版图拿空了（保险，正常不会发生）。 */
export type EndReason = "board" | "pouch" | "supply";

export interface FinalResult {
  readonly scores: ScoreBreakdown[];
  readonly winners: string[];
  readonly reason: EndReason;
}

export type GameEvent =
  | { readonly type: "SpiritPicked"; readonly player: string; readonly auto: boolean }
  | { readonly type: "SpiritsRevealed"; readonly picks: { readonly player: string; readonly cardId: string }[] }
  | { readonly type: "TokensTaken"; readonly player: string; readonly space: number; readonly tokens: Color[] }
  | { readonly type: "TokenPlaced"; readonly player: string; readonly color: Color; readonly cell: string; readonly scoreBefore: number; readonly scoreAfter: number }
  | { readonly type: "CardTaken"; readonly player: string; readonly cardId: string }
  | { readonly type: "CubePlaced"; readonly player: string; readonly cardId: string; readonly cell: string; readonly completed: boolean; readonly scoreBefore: number; readonly scoreAfter: number }
  | { readonly type: "Undone"; readonly player: string }
  | { readonly type: "TurnEnded"; readonly player: string; readonly space: number | null; readonly refilled: Color[]; readonly newCards: string[] }
  | { readonly type: "EndTriggered"; readonly player: string; readonly reason: EndReason }
  | { readonly type: "TurnStarted"; readonly player: string; readonly round: number; readonly lastRound: boolean }
  | { readonly type: "GameEnded"; readonly result: FinalResult }
  | { readonly type: "TurnTimedOut"; readonly player: string };

export interface GameState {
  readonly config: Config;
  /** spirit：自然之灵开局同时选卡；play：正常回合；finished：结束。 */
  phase: "spirit" | "play" | "finished";
  players: Player[];
  /** 起始玩家（players 下标）。 */
  first: number;
  /** 正在行动的玩家（players 下标）；spirit 阶段是起始玩家，结束后是 −1。 */
  currentPlayer: number;
  /** 第几轮（每人各一回合算一轮），从 1 开始。 */
  round: number;
  /** 每换一个人（或换阶段）+1，用作回合计时的键；同一回合里的操作不改它。 */
  turn: number;
  /** 中央版图 5 个供应格。 */
  central: Color[][];
  /** 公开牌列（≤ 5 张）。 */
  market: string[];
  turnState: TurnState;
  lastTurn: LastTurn | null;
  /** 已经触发终局（打完这一轮结束）。 */
  endTriggered: EndReason | null;
  events: GameEvent[];
  finalResult?: FinalResult;
  version: number;
  /** 以下只在服务端：布袋、牌堆顺序、没选中的自然之灵、种子、随机数状态、动作序列。发给客户端前清空，只给数量。 */
  pouch: Color[];
  deck: string[];
  seed?: number;
  rngState?: number;
  log?: { player: string; command: GameCommand | { type: "TIMEOUT" } }[];
  /** 客户端视角：布袋里各颜色剩几个、牌堆剩几张。 */
  pouchCounts?: Record<Color, number>;
  deckCount?: number;
}
