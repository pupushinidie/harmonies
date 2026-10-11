/**
 * 新手教程的剧本（自然和弦）。做法照站内统一的教程（~/projects/pipeline/handbook/tutorial-notes.md）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器：开局的托盘、牌列、布袋顺序都是摆好的，补托盘时按布袋顺序从前往后抽，
 * 对手咕噜一号按剧本走。剧本走完接着把这局打完（练习局）：对手交给人机，布袋换成普通随机。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor，对应网页里的 data-tutorial="…"）、
 * 等玩家做什么（do 步骤的 expect）。改了规则或界面，tutorial.test.ts 会检查剧本还能不能从头走到尾。
 */
import { emptyCount, kindOf, legalCellsFor } from "./board.js";
import { ANIMAL_CARDS } from "./cards.js";
import { canTakeCard, createGame, playerIndex } from "./engine.js";
import { createRng, type Rng } from "./rng.js";
import { COLORS, TOKEN_COUNTS, type Color, type GameCommand, type GameState } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

interface StepBase {
  readonly id: string;
  /** 侧栏「新手教程」进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px）。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tutorial 的值。
   * 固定的有 my-board、my-score、supply、bag、market、my-cards、opponents、hand、undo、end-turn；
   * 托盘第 n 格是 space-<n>（0 起），自己版图上的格子是 cell:<c>,<r>，牌列里的卡是 card:<编号>，面前的卡是 held:<编号>。
   */
  readonly anchor?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: GameCommand })
  /** 对手按剧本自动走这几步，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly GameCommand[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_RIVAL = "p2";
export const TUTORIAL_RIVAL_NAME = "咕噜一号";

const take = (space: number): GameCommand => ({ type: "takeTokens", space });
const put = (cell: string): GameCommand => ({ type: "placeToken", index: 0, cell });
const END: GameCommand = { type: "endTurn" };

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    kind: "info", id: "goal", lesson: "目标", anchor: "my-board",
    say: "这是你的版图，每个六边形格子放一摞彩色标记。",
    note: "用标记摆出树、山、田、房屋和河，再给动物卡上的动物安家。终局总分最高的人赢。",
  },
  {
    kind: "do", id: "take1", lesson: "拿标记", anchor: "space-0", expect: take(0),
    say: "每回合必须从托盘拿一格：点第 1 格。",
    note: "一格里的 3 个标记全部拿走，这回合都要放到你的版图上。",
  },
  {
    kind: "do", id: "trunk", lesson: "叠出树", anchor: "cell:1,1", expect: put("1,1"),
    say: "先把树干（棕色）放在亮着的这一格。",
    note: "绿框的格子都能放。手里的标记从左到右放，点别的标记可以换着放。",
  },
  {
    kind: "do", id: "crown", anchor: "cell:1,1", expect: put("1,1"),
    say: "再把树冠（绿色）叠在树干上。",
    note: "树冠叠在 1 个树干上是高 2 的树，3 分；直接放空格只是高 1 的树，1 分。绿色上面不能再放东西。",
  },
  {
    kind: "do", id: "rock", anchor: "cell:3,1", expect: put("3,1"),
    say: "把山（灰色）放在这一格。",
    note: "山可以一层层往上叠到 3 层：高 1 / 2 / 3 得 1 / 3 / 7 分。",
  },
  {
    kind: "do", id: "card", lesson: "领动物卡", anchor: "card:A18", expect: { type: "takeCard", cardId: "A18" },
    say: "每回合可以领 1 张动物卡：点「獾」这张。",
    note: "卡下面画着一个图案，白框那格是目标格。面前没完成的卡最多 4 张。",
  },
  {
    kind: "do", id: "end1", lesson: "结束回合", anchor: "end-turn", expect: END,
    say: "三个标记都放好了，点「结束回合」。",
    note: "结束前每一步都能点「撤销」。结束时托盘拿空的那格从布袋补 3 个，牌列补到 5 张。",
  },
  {
    kind: "watch", id: "rival1", lesson: "看对手", anchor: "opponents",
    say: "轮到咕噜一号了，它的版图在这边。",
    moves: [take(4), put("2,2"), put("2,2"), put("3,2"), END],
  },
  {
    kind: "do", id: "take2", anchor: "space-1", expect: take(1),
    say: "又轮到你了，拿第 2 格。",
  },
  {
    kind: "do", id: "leaf", lesson: "摆出图案", anchor: "cell:1,0", expect: put("1,0"),
    say: "把树冠放在你那棵树的正上方。",
    note: "单放的树冠就是高 1 的树。「獾」的图案正好是一棵高 1 的树挨着一棵高 2 的树。",
  },
  {
    kind: "do", id: "rock2", lesson: "山要成片", anchor: "cell:3,2", expect: put("3,2"),
    say: "把山放在上回合那座山的下面。",
    note: "山要挨着另一座山才得分：两座高 1 的山挨在一起，各得 1 分。",
  },
  {
    kind: "do", id: "field1", anchor: "cell:0,3", expect: put("0,3"),
    say: "把田（黄色）放在这里。",
    note: "单独一个田还不得分，下回合再给它配一个。",
  },
  {
    kind: "do", id: "cube", lesson: "放方块", anchor: "cell:1,1", expect: { type: "placeCube", cardId: "A18", cell: "1,1" },
    say: "「獾」的图案摆出来了：点橙框的格子放方块。",
    note: "图案转个方向也算（卡上画的是斜着挨，你摆的是上下挨）。方块放得越多，这张卡越值钱：卡下面一排数字就是放 1、2、3… 个的分。",
  },
  {
    kind: "info", id: "cubeLock", anchor: "cell:1,1", face: "think",
    say: "放了方块的格子不能再叠东西，方块也不会拿走。",
    note: "所以先把树、山叠到想要的高度，再放方块。以后图案被别的标记盖掉，方块照样算分。",
  },
  { kind: "do", id: "end2", anchor: "end-turn", expect: END, say: "点「结束回合」。" },
  {
    kind: "watch", id: "rival2", anchor: "opponents",
    say: "咕噜一号在走。",
    moves: [take(0), put("0,0"), put("4,4"), put("4,3"), END],
  },
  { kind: "do", id: "take3", anchor: "space-2", expect: take(2), say: "拿第 3 格。" },
  {
    kind: "do", id: "field2", lesson: "田分几片", anchor: "cell:0,4", expect: put("0,4"),
    say: "把田放在上回合那个田的下面。",
    note: "两个田连成一片得 5 分。一片再大也只算 5 分，所以分成好几片、每片 2 个最划算。",
  },
  {
    kind: "do", id: "base", lesson: "盖房屋", anchor: "cell:0,2", expect: put("0,2"),
    say: "把树干放在这一格，给房屋打地基。",
  },
  {
    kind: "do", id: "roof", anchor: "cell:0,2", expect: put("0,2"),
    say: "把屋顶（红色）压在这个树干上，就是一座房屋。",
    note: "屋顶只能压在单层的山、树干或屋顶上；压在两层上不行，单放也不算房屋。",
  },
  {
    kind: "info", id: "houseRule", anchor: "cell:0,2", face: "think",
    say: "房屋周围要有 3 种颜色，才得 5 分。",
    note: "现在它旁边只有田（黄）和树（绿）两种，下回合再补一种。空格不算颜色。",
  },
  { kind: "do", id: "end3", anchor: "end-turn", expect: END, say: "点「结束回合」。" },
  {
    kind: "watch", id: "rival3", anchor: "opponents",
    say: "咕噜一号在叠一棵大树。",
    moves: [take(4), put("1,1"), put("1,1"), put("1,1"), END],
  },
  { kind: "do", id: "take4", lesson: "河流", anchor: "space-3", expect: take(3), say: "拿第 4 格，3 个都是水。" },
  {
    kind: "do", id: "water1", anchor: "cell:1,2", expect: put("1,2"),
    say: "把水放在房屋旁边。",
    note: "房屋旁边现在有田、树、水 3 种颜色了：+5 分。",
  },
  { kind: "do", id: "water2", anchor: "cell:2,2", expect: put("2,2"), say: "再把水接在后面，连成一条河。" },
  {
    kind: "do", id: "water3", anchor: "cell:1,3", expect: put("1,3"),
    say: "最后一个水接在河的另一头。",
    note: "河按最长那一条的格数算分：2 / 3 / 4 / 5 / 6 格得 2 / 5 / 8 / 11 / 15 分。分叉不加长度，尽量摆成一条线。",
  },
  {
    kind: "info", id: "score", lesson: "看分数", anchor: "my-score", face: "happy",
    say: "这里是你现在的总分，每放一步都会变。",
    note: "终局时结算框会分项列出：树、山、田、房屋、河流和动物卡各得了多少。",
  },
  { kind: "do", id: "end4", anchor: "end-turn", expect: END, say: "点「结束回合」。" },
  {
    kind: "info", id: "ending", lesson: "什么时候结束", anchor: "bag", face: "think",
    say: "有人的版图只剩 2 个空格以内，或者布袋空了，这一轮打完就结束。",
    note: "每个人的回合数一样多。同分时，放到版图上的动物方块多的人赢。",
  },
  {
    kind: "info", id: "online", lesson: "真实对局",
    say: "真实对局里每回合限时 90 秒。",
    note: "连续超时 2 次会转成托管：人机替你打，点「取消托管」就能收回。掉线时也由人机代打，回来就交还给你。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了！",
    note: "接下来和咕噜一号把这局打完。拿不准的时候点「提示」（键盘 H），我告诉你我会怎么走。开房时还能选 B 面（岛屿）和自然之灵，规则里有说明。",
  },
];

/** 开局托盘的 5 格。 */
export const TUTORIAL_CENTRAL: readonly string[] = ["BGK", "GKY", "YBR", "WWW", "KKR"];
export const TUTORIAL_MARKET: readonly string[] = ["A18", "A26", "A09", "A13", "A31"];
/** 剧本里补托盘时布袋前面这几个（按顺序抽）：咕噜一号第 2、3 回合拿到的就是它们。 */
export const TUTORIAL_POUCH_HEAD = "GWYBBGRWKYKWGYBKWRYGW";
/** 剧本里一共要从布袋抽几次（7 次结束回合 × 3 个）。 */
export const TUTORIAL_DRAWS = 21;

/** 教程开局：你先手，对手是咕噜一号；托盘、牌列、布袋前段都是摆好的。 */
export function createTutorialGame(selfName: string, seed = 20261011): GameState {
  const game = createGame([{ id: TUTORIAL_SELF, name: selfName }, { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME }], seed);
  const central = TUTORIAL_CENTRAL.map((text) => text.split("") as Color[]);
  const head = TUTORIAL_POUCH_HEAD.split("") as Color[];
  const left: Record<Color, number> = { ...TOKEN_COUNTS };
  for (const color of [...central.flat(), ...head]) left[color] -= 1;
  const rest: Color[] = [];
  for (const color of COLORS) for (let i = 0; i < left[color]; i += 1) rest.push(color);
  const rng = createRng(seed);
  game.central = central;
  game.pouch = [...head, ...rng.shuffle(rest)];
  game.market = [...TUTORIAL_MARKET];
  game.deck = rng.shuffle(ANIMAL_CARDS.map((card) => card.id).filter((id) => !TUTORIAL_MARKET.includes(id)));
  game.first = 0;
  game.currentPlayer = 0;
  game.events = [{ type: "TurnStarted", player: TUTORIAL_SELF, round: 1, lastRound: false }];
  return game;
}

/** 练习局「再练一局」：随机开一局（随机先手）。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame([{ id: TUTORIAL_SELF, name: selfName }, { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME }], seed);
}

/** 剧本随机：前 draws 次补托盘按布袋顺序抽（int 返回 0），用完以后是普通随机数。 */
export interface TutorialRng extends Rng {
  /** 还剩几次剧本抽取。 */
  readonly remaining: number;
}

export function createTutorialRng(seed: number, draws = TUTORIAL_DRAWS): TutorialRng {
  let left = draws;
  const free = createRng(seed);
  return {
    next: () => free.next(),
    int: (max) => {
      if (left > 0) {
        left -= 1;
        return 0;
      }
      return free.int(max);
    },
    pick: (items) => free.pick(items),
    shuffle: (items) => free.shuffle(items),
    get state() {
      return free.state;
    },
    get remaining() {
      return left;
    },
  };
}

/** 两条命令是不是同一步。 */
export function sameCommand(a: GameCommand, b: GameCommand): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 GameBoard 的显示条件）。
 * viewer 是看界面的人（教程里就是你）。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string): boolean {
  const me = playerIndex(state, viewer);
  const player = state.players[me];
  if (!player) return false;
  const myTurn = state.phase === "play" && state.currentPlayer === me;
  const t = state.turnState;
  if (["my-board", "my-score", "supply", "bag", "market", "my-cards"].includes(anchor)) return true;
  if (anchor === "opponents") return state.players.length > 1;
  if (anchor === "hand") return myTurn && t.hand.length > 0;
  if (anchor === "undo" || anchor === "end-turn") return myTurn;
  if (anchor.startsWith("space-")) {
    const space = Number(anchor.slice("space-".length));
    return myTurn && t.took === null && (state.central[space]?.length ?? 0) > 0;
  }
  if (anchor.startsWith("cell:")) return myTurn && player.board[anchor.slice("cell:".length)] !== undefined;
  if (anchor.startsWith("card:")) return state.market.includes(anchor.slice("card:".length));
  if (anchor.startsWith("held:")) return player.cards.some((card) => card.id === anchor.slice("held:".length));
  return false;
}

/** 剧本单测、走查脚本用：这一格现在能不能放手里第一个标记。 */
export function canPutFirst(state: GameState, cell: string): boolean {
  const player = state.players[state.currentPlayer];
  const color = state.turnState.hand[0];
  return Boolean(player && color && legalCellsFor(player.board, color).includes(cell));
}

export { canTakeCard, emptyCount, kindOf };
