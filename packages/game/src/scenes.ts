/**
 * 预览局面工厂（对外接口）：界面预览页、教程、测试都用它造局面。
 * - buildState(spec)：按参数造任意精确局面（版图、手上的卡、中央版图、牌列、布袋顺序、回合进度）。
 * - scene(name)：按名字造常见局面（开局、每种行动之前、特殊选择、终局含并列、版图铺满……）。
 * 造出来的都是服务端完整状态；要模拟某个人看到的画面，再过一遍 redactGameForViewer。
 */
import { boardFrom, emptyBoard, scorePlayer } from "./board.js";
import { ANIMAL_CARDS, SPIRIT_CARDS } from "./cards.js";
import { apply, createGame, defaultConfig, endGameNow, legalActions } from "./engine.js";
import { createRng } from "./rng.js";
import { COLORS, TOKEN_COUNTS, type BoardSide, type Color, type EndReason, type GameState, type HeldCard, type Player } from "./types.js";

export interface PlayerSpec {
  readonly id?: string;
  readonly name?: string;
  /** {"0,0": "KK", "1,0": "BG"}：从下到上的标记。 */
  readonly board?: Record<string, string>;
  /** {"2,1": "A05"}：哪一格放了哪张卡的方块。 */
  readonly cubes?: Record<string, string>;
  /** 面前的卡：[编号, 已放方块数]。 */
  readonly cards?: readonly (readonly [string, number])[];
  /** 自然之灵：发到的 2 张、已经选好的。 */
  readonly spiritChoices?: readonly string[];
  readonly spiritPick?: string;
}

export interface StateSpec {
  readonly side?: BoardSide;
  readonly spirits?: boolean;
  readonly players: readonly PlayerSpec[];
  readonly first?: number;
  readonly current?: number;
  readonly round?: number;
  /** 5 个供应格，每格写成 "BGK" 这样；没给就从布袋随机抽。 */
  readonly central?: readonly string[];
  readonly market?: readonly string[];
  /** 动物卡牌堆从顶到底；没给就把剩下的卡按 seed 洗匀。 */
  readonly deck?: readonly string[];
  /** 布袋（按 scriptedRng 抽的顺序，从前往后）；没给就是剩下的标记按 seed 洗匀。 */
  readonly pouch?: string;
  /** 本回合已经拿了哪一格、手里还剩哪些标记（"BG"）、领了哪张卡。 */
  readonly took?: number | null;
  readonly hand?: string;
  readonly tookCard?: string | null;
  readonly phase?: "spirit" | "play";
  readonly endTriggered?: EndReason | null;
  /** 造好后直接结算（终局画面）。 */
  readonly finished?: EndReason;
  readonly seed?: number;
}

const DEFAULT_NAMES = ["小林", "阿青", "木木", "大熊"];

function colors(text: string | undefined): Color[] {
  return (text ?? "").replace(/\s+/g, "").split("").filter(Boolean) as Color[];
}

export function buildState(spec: StateSpec): GameState {
  const side = spec.side ?? "A";
  const spirits = spec.spirits ?? false;
  const seed = spec.seed ?? 1;
  const rng = createRng(seed);
  const config = defaultConfig(spec.players.length, { side, spirits });
  const players: Player[] = spec.players.map((p, index) => {
    const cards: HeldCard[] = (p.cards ?? []).map(([id, placed]) => ({ id, placed }));
    const player: Player = {
      id: p.id ?? `p${index + 1}`,
      name: p.name ?? DEFAULT_NAMES[index] ?? `玩家${index + 1}`,
      board: p.board || p.cubes ? boardFrom(side, p.board ?? {}, p.cubes ?? {}) : emptyBoard(side),
      cards,
      score: 0,
    };
    if (p.spiritChoices) player.spiritChoices = [...p.spiritChoices];
    if (p.spiritPick) player.spiritPick = p.spiritPick;
    player.score = scorePlayer(player, side).total;
    return player;
  });

  // 标记守恒：120 个 = 版图上 + 中央 + 手里 + 布袋
  const used: Record<Color, number> = { W: 0, K: 0, B: 0, G: 0, Y: 0, R: 0 };
  for (const player of players) for (const cell of Object.values(player.board)) for (const c of cell.stack) used[c] += 1;
  const hand = colors(spec.hand);
  for (const c of hand) used[c] += 1;
  let central: Color[][];
  const remaining: Color[] = [];
  const fillRemaining = () => {
    remaining.length = 0;
    for (const color of COLORS) for (let i = used[color]; i < TOKEN_COUNTS[color]; i += 1) remaining.push(color);
  };
  if (spec.central) {
    central = spec.central.map(colors);
    for (const space of central) for (const c of space) used[c] += 1;
    fillRemaining();
  } else {
    fillRemaining();
    const shuffled = rng.shuffle(remaining);
    central = [0, 1, 2, 3, 4].map(() => shuffled.splice(0, 3));
    if (spec.took !== undefined && spec.took !== null) {
      shuffled.push(...central[spec.took]!);
      central[spec.took] = [];
    }
    remaining.length = 0;
    remaining.push(...shuffled);
  }
  let pouch: Color[];
  if (spec.pouch !== undefined) {
    pouch = colors(spec.pouch);
  } else {
    pouch = spec.central ? rng.shuffle(remaining) : remaining;
  }
  const overUsed = COLORS.find((color) => used[color] > TOKEN_COUNTS[color]);
  if (overUsed) throw new Error(`${overUsed} 标记超过 ${TOKEN_COUNTS[overUsed]} 个`);

  const held = new Set(players.flatMap((player) => player.cards.map((card) => card.id)));
  const market = spec.market ? [...spec.market] : [];
  const rest = ANIMAL_CARDS.map((card) => card.id).filter((id) => !held.has(id) && !market.includes(id));
  const deck = spec.deck ? [...spec.deck] : rng.shuffle(rest);
  if (!spec.market) market.push(...deck.splice(0, 5));

  const first = spec.first ?? 0;
  const current = spec.current ?? first;
  const phase = spec.phase ?? (spirits && players.some((p) => p.spiritChoices) ? "spirit" : "play");
  let state: GameState = {
    config,
    phase,
    players,
    first,
    currentPlayer: current,
    round: spec.round ?? 1,
    turn: 1,
    central,
    market,
    turnState: {
      took: spec.took ?? null,
      taken: spec.took !== undefined && spec.took !== null ? [...hand] : [],
      hand,
      tookCard: spec.tookCard ?? null,
      placed: [],
      cubes: [],
      undo: [],
      undoCount: 0,
    },
    lastTurn: null,
    endTriggered: spec.endTriggered ?? null,
    events: [],
    version: 1,
    pouch,
    deck,
    seed,
    rngState: rng.state,
  };
  if (spec.finished) state = endGameNow(state, spec.finished);
  return state;
}

/** 规则书 6 例 1 的版图（A 面）。 */
export const EXAMPLE_1: Record<string, string> = {
  "0,0": "KK", "1,0": "BG", "2,0": "G", "3,0": "BB",
  "0,1": "K", "1,1": "BR", "2,1": "BBG", "3,1": "W",
  "0,2": "W", "1,2": "Y", "2,2": "W", "3,2": "Y",
  "0,3": "KKK", "1,3": "Y", "2,3": "W", "3,3": "Y",
  "2,4": "W", "4,3": "Y", "4,4": "Y",
};

/** 一块下到一半的 A 面版图（预览用）。 */
const MID_A: Record<string, string> = {
  "0,0": "BG", "1,0": "G", "0,1": "KK", "1,1": "K",
  "2,2": "W", "2,3": "W", "3,2": "W", "1,2": "Y", "1,3": "Y", "3,0": "BR",
};

const MID_B: Record<string, string> = {
  "1,0": "W", "1,1": "W", "1,2": "W", "0,0": "BBG", "0,1": "Y", "0,2": "Y",
  "2,1": "KK", "2,2": "K", "3,1": "RR", "4,0": "G",
};

/** 随机下完一整局（终局铺满的版图用）：每个人从合法行动里按种子随机挑。 */
export function playout(playerCount: number, seed: number, side: BoardSide = "A", spirits = false): GameState {
  let state = createGame(
    Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: DEFAULT_NAMES[i]! })),
    seed,
    { side, spirits },
  );
  const rng = createRng(seed ^ 0x5bd1e995);
  for (let guard = 0; guard < 4000 && state.phase !== "finished"; guard += 1) {
    const actor = state.phase === "spirit" ? state.players.find((p) => !p.spiritPick)! : state.players[state.currentPlayer]!;
    let actions = legalActions(state, actor.id);
    // 有方块能放就放、有卡能领先领，让版图像一局真的对局
    const cubes = actions.filter((a) => a.type === "placeCube");
    const cards = actions.filter((a) => a.type === "takeCard");
    if (cubes.length > 0) actions = cubes;
    else if (cards.length > 0 && rng.next() < 0.6) actions = cards;
    else if (actions.some((a) => a.type !== "endTurn" && a.type !== "takeCard")) actions = actions.filter((a) => a.type !== "endTurn" && a.type !== "takeCard");
    state = apply(state, actor.id, actions[rng.int(actions.length)]!).state;
  }
  return state;
}

export const SCENE_NAMES = [
  "start",
  "start3",
  "start4",
  "startB",
  "spiritPick",
  "spiritWaiting",
  "took",
  "placing",
  "cubeReady",
  "fullCards",
  "opponentTurn",
  "lastRound",
  "midB",
  "finished",
  "finishedTie",
  "finished4",
  "finishedB",
  "finishedSpirits",
] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

/**
 * 按名字造常见局面（自己都是 p1；opponentTurn 是轮到 p2）：
 * start/start3/start4/startB 开局；spiritPick 自然之灵选卡；spiritWaiting 自己选好了在等别人；
 * took 刚拿了 3 个标记；placing 放了一个还剩两个；cubeReady 图案已经摆出能放方块；
 * fullCards 面前 4 张没完成的卡（不能再领）；opponentTurn 别人的回合；lastRound 已经触发终局；
 * midB B 面下到一半；finished 终局；finishedTie 终局并列；finished4 4 人铺满的终局；finishedB B 面终局；
 * finishedSpirits 带自然之灵的终局。
 */
export function scene(name: SceneName): GameState {
  const two = [{}, {}] as PlayerSpec[];
  switch (name) {
    case "start":
      return buildState({ players: two, central: ["BGK", "WWY", "KKR", "YGB", "WBR"], market: ["A18", "A05", "A26", "A09", "A13"] });
    case "start3":
      return buildState({ players: [{}, {}, {}], seed: 3 });
    case "start4":
      return buildState({ players: [{}, {}, {}, {}], seed: 4 });
    case "startB":
      return buildState({ side: "B", players: two, seed: 5 });
    case "spiritPick":
      return buildState({
        spirits: true,
        players: [{ spiritChoices: ["S01", "S07"] }, { spiritChoices: ["S03", "S10"] }],
        phase: "spirit",
        seed: 6,
      });
    case "spiritWaiting":
      return buildState({
        spirits: true,
        players: [{ spiritChoices: ["S01", "S07"], spiritPick: "S07" }, { spiritChoices: ["S03", "S10"] }],
        phase: "spirit",
        seed: 6,
      });
    case "took":
      return buildState({
        players: [{ board: MID_A, cards: [["A18", 0], ["A05", 1]], cubes: { "2,2": "A05" } }, { board: { "0,0": "W", "1,0": "W", "2,1": "K" } }],
        central: ["", "WWY", "KKR", "YGB", "WBR"],
        took: 0,
        hand: "BGK",
        round: 4,
        market: ["A26", "A09", "A13", "A31"],
        seed: 7,
      });
    case "placing":
      return buildState({
        players: [{ board: { ...MID_A, "4,0": "B" }, cards: [["A18", 0], ["A05", 1]], cubes: { "2,2": "A05" } }, { board: { "0,0": "W", "1,0": "W", "2,1": "K" } }],
        central: ["", "WWY", "KKR", "YGB", "WBR"],
        took: 0,
        hand: "GK",
        round: 4,
        market: ["A26", "A09", "A13", "A31"],
        seed: 7,
      });
    case "cubeReady":
      return buildState({
        players: [
          { board: { ...MID_A, "4,0": "BG", "4,1": "G" }, cards: [["A18", 0], ["A05", 1]], cubes: { "2,2": "A05" } },
          { board: { "0,0": "W", "1,0": "W", "2,1": "K" } },
        ],
        central: ["", "WWY", "KKR", "YGB", "WBR"],
        took: 0,
        hand: "K",
        round: 4,
        market: ["A26", "A09", "A13", "A31"],
        seed: 7,
      });
    case "fullCards":
      return buildState({
        players: [
          { board: MID_A, cards: [["A18", 0], ["A05", 1], ["A26", 0], ["A09", 0]], cubes: { "2,2": "A05" } },
          { board: { "0,0": "W", "1,0": "W", "2,1": "K" } },
        ],
        round: 5,
        seed: 8,
      });
    case "opponentTurn":
      return buildState({
        players: [{ board: MID_A, cards: [["A18", 0]] }, { board: { "0,0": "W", "1,0": "W", "2,1": "KK", "2,2": "K" }, cards: [["A21", 0]] }],
        current: 1,
        round: 4,
        seed: 9,
      });
    case "lastRound":
      return buildState({
        players: [
          { board: { ...EXAMPLE_1, "4,0": "Y" }, cards: [["A05", 3], ["A12", 0]] },
          { board: { ...MID_A, "4,0": "K", "4,1": "KK" }, cards: [["A21", 1]] },
        ],
        current: 1,
        round: 9,
        endTriggered: "board",
        seed: 10,
      });
    case "midB":
      return buildState({ side: "B", players: [{ board: MID_B, cards: [["A12", 0], ["A30", 0]] }, { board: { "0,0": "W" } }], round: 4, seed: 11 });
    case "finished":
      return buildState({
        players: [
          { board: EXAMPLE_1, cards: [["A05", 3], ["A12", 0]], cubes: { "3,1": "A05", "2,2": "A05", "0,2": "A05" } },
          { board: { ...MID_A, "4,0": "K", "4,1": "KK", "4,2": "W", "4,3": "W", "4,4": "Y", "0,2": "B", "0,3": "BR", "0,4": "G", "2,0": "Y", "2,1": "Y", "3,1": "G", "3,3": "W" }, cards: [["A21", 1]], cubes: { "1,1": "A21" } },
        ],
        round: 10,
        finished: "board",
        seed: 12,
      });
    case "finishedTie":
      return buildState({
        players: [
          { board: EXAMPLE_1, cards: [["A05", 3]], cubes: { "3,1": "A05", "2,2": "A05", "0,2": "A05" } },
          { board: EXAMPLE_1, cards: [["A05", 3]], cubes: { "3,1": "A05", "2,2": "A05", "0,2": "A05" } },
        ],
        round: 10,
        finished: "board",
        seed: 13,
      });
    case "finished4":
      return playout(4, 2024);
    case "finishedB":
      return playout(2, 77, "B");
    case "finishedSpirits":
      return playout(3, 31, "A", true);
  }
}

export { SPIRIT_CARDS };
