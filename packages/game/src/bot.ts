/**
 * 人机（普通）：像一个认真玩、会算账的普通玩家，不作弊。
 * 输入必须是 redactGameForViewer(game, playerId) 处理过的状态（只用自己座位看得到的东西：
 * 布袋只知道各色数量，牌堆只知道张数）。
 *
 * 每次只给出一步（服务器每走一步再问一次），全部是确定性的：
 * - 自然之灵：按「好拿分」的经验顺序挑；
 * - 回合开始：先看要不要领卡（缺卡、图案好摆、离终局还远），再对 5 个凹槽各做一次集束搜索
 *   （3 个标记按任意顺序放，每层留最好的几个），挑评估值最高的凹槽；
 * - 手里有标记：对剩下的标记再搜一次，放第一步；
 * - 标记放完：能放的方块都放上，再看有没有「现在就能放方块」的卡值得领，结束回合。
 * 评估值 = 地貌分 + 动物卡分（含这回合能放的方块）+ 离摆成还差 1–3 个标记的图案的期望 + 树干、单个田、
 * 单个屋顶这些「半成品」的期望 + 留着的空格。离终局越近，期望项越不值钱。
 */
import {
  compareCells,
  cubeTargetsOnBoard,
  emptyCount,
  fromAxial,
  key,
  kindOf,
  landscapeScore,
  legalCellsFor,
  neighbors,
  parseKey,
  sideCells,
  spiritPoints,
  toAxial,
  top,
} from "./board.js";
import { animalCard, cardPattern, cardPoints, cubeCount, isSpiritId, spiritCard } from "./cards.js";
import { legalActions, MAX_UNFINISHED, playerIndex } from "./engine.js";
import { COLOR_NAMES, KIND_NAMES, type Board, type BoardSide, type Color, type GameCommand, type GameState, type HeldCard, type Kind } from "./types.js";

export interface BotAdvice {
  readonly command: GameCommand;
  /** 一句玩家听得懂的理由（教程的「提示」用）。 */
  readonly reason: string;
  /** 这一步涉及的格子（提示时高亮）。 */
  readonly cells?: string[];
}

/** 集束搜索每层留几个。 */
const BEAM = 5;

/** 自然之灵的经验顺序：越靠前越好拿分（规则书 2.5 的计分方式，普通对局里大致的期望）。 */
const SPIRIT_PREFERENCE = ["S02", "S10", "S04", "S08", "S01", "S05", "S03", "S07", "S09", "S06"];

export function botCommand(state: GameState, playerId: string): GameCommand | null {
  return botAdvice(state, playerId)?.command ?? null;
}

function clone(board: Board): Board {
  const next: Board = {};
  for (const [cell, value] of Object.entries(board)) next[cell] = { stack: [...value.stack], cube: value.cube };
  return next;
}

function cardName(id: string): string {
  return isSpiritId(id) ? spiritCard(id).name : animalCard(id).name;
}

/** 估计自己还剩几个回合（包括这一回合）：看谁的空格最少、布袋还够补几次。 */
export function turnsLeft(state: GameState): number {
  if (state.endTriggered) return 1;
  const n = state.players.length;
  const minEmpty = Math.min(...state.players.map((p) => emptyCount(p.board)));
  // 每回合大约多占 2.2 个空格；剩 ≤ 2 个就结束
  const byBoard = Math.max(1, Math.ceil((minEmpty - 2) / 2.2));
  const pouch = state.pouchCounts ? Object.values(state.pouchCounts).reduce((a, b) => a + b, 0) : state.pouch.length;
  const byPouch = Math.max(1, Math.ceil((pouch / 3 + 1) / n));
  return Math.min(byBoard, byPouch);
}

const NEED: Record<Kind, Record<string, number>> = {
  W: { "": 1 },
  Y: { "": 1 },
  G1: { "": 1 },
  T2: { "": 2, B: 1 },
  T3: { "": 3, B: 2, BB: 1 },
  K1: { "": 1 },
  K2: { "": 2, K: 1 },
  K3: { "": 3, K: 2, KK: 1 },
  H: { "": 2, K: 1, B: 1, R: 1 },
};

/** 这一格要变成 kind 还差几个标记；变不成返回 null。 */
function tokensNeeded(stack: readonly Color[], cube: string | null, kind: Kind): number | null {
  if (kindOf(stack) === kind) return 0;
  if (cube) return null;
  return NEED[kind][stack.join("")] ?? null;
}

const ROT = (q: number, a: number): [number, number] => [-a, q + a];

/** 这张卡离再摆出一个图案最少还差几个标记（目标格要没方块）；摆不出来返回 Infinity。 */
export function missingForCard(board: Board, side: BoardSide, cardId: string): number {
  return missingInfo(board, side, cardId).need;
}

/** 同上，还给出差得最少的那个目标格（差 0 个时就是能放方块的格子）。 */
function missingInfo(board: Board, side: BoardSide, cardId: string): { need: number; cell: string | null } {
  const pattern = cardPattern(cardId);
  const target = pattern.find((p) => p.target)!;
  let best = Number.POSITIVE_INFINITY;
  let bestCell: string | null = null;
  for (const cell of sideCells(side)) {
    const here = board[cell]!;
    if (here.cube) continue;
    // 目标格本身变不成要求的地貌就不用看了
    if (tokensNeeded(here.stack, null, target.kind) === null) continue;
    const [c, r] = parseKey(cell);
    const [tq, ta] = toAxial(c, r);
    for (let rot = 0; rot < 6; rot += 1) {
      let need = 0;
      for (const p of pattern) {
        let dq = p.q - target.q;
        let da = p.a - target.a;
        for (let k = 0; k < rot; k += 1) [dq, da] = ROT(dq, da);
        const [nc, nr] = fromAxial(tq + dq, ta + da);
        const at = board[key(nc, nr)];
        const n = at ? tokensNeeded(at.stack, at.cube, p.kind) : null;
        if (n === null) {
          need = Number.POSITIVE_INFINITY;
          break;
        }
        need += n;
        if (need >= best) break;
      }
      if (need < best) {
        best = need;
        bestCell = cell;
      }
      if (best === 0) return { need: 0, cell: bestCell };
    }
  }
  return { need: best, cell: bestCell };
}

/** 下一个方块值多少分（没放的自然之灵卡按 8 分估）。 */
function nextCubeValue(card: HeldCard): number {
  if (isSpiritId(card.id)) return card.placed > 0 ? 0 : 8;
  if (card.placed >= cubeCount(card.id)) return 0;
  return cardPoints(card.id, card.placed + 1) - cardPoints(card.id, card.placed);
}

/** 半成品的期望：没树冠的树干、没配对的田、单个屋顶、孤立的山、只差颜色的房屋。 */
function structureBonus(board: Board, side: BoardSide): number {
  let bonus = 0;
  for (const cell of sideCells(side)) {
    const here = board[cell]!;
    if (here.cube || here.stack.length === 0) continue;
    const s = here.stack.join("");
    const around = neighbors(side, cell);
    const empties = () => around.filter((n) => board[n]!.stack.length === 0).length;
    if (s === "B") bonus += 1.2;
    else if (s === "BB") bonus += 3;
    else if (s === "R") bonus += 1;
    else if (s === "K" || s === "KK") {
      const touching = around.some((n) => kindOf(board[n]!.stack)?.startsWith("K"));
      if (!touching && empties() > 0) bonus += s === "K" ? 0.4 : 1.2;
      if (s === "KK") bonus += 1;
    } else if (s === "Y") {
      const paired = around.some((n) => top(board[n]) === "Y");
      if (!paired && empties() > 0) bonus += 1.6;
    } else if (kindOf(here.stack) === "H") {
      const colors = new Set(around.map((n) => top(board[n])).filter(Boolean));
      if (colors.size === 2 && empties() > 0) bonus += 2;
      else if (colors.size === 1 && empties() > 1) bonus += 0.8;
    }
  }
  return bonus;
}

/** 评估一块版图（加上面前的卡）。会把能放的方块模拟放上，所以 board 要是可以改的副本。 */
function evaluate(board: Board, cards: readonly HeldCard[], side: BoardSide, left: number): number {
  const b = board;
  const future = left > 1 ? Math.min(1, (left - 1) / 3) : 0;
  let value = 0;
  const placedCubes: string[] = [];
  for (const card of cards) {
    let placed = card.placed;
    const total = cubeCount(card.id);
    let info = placed < total ? missingInfo(b, side, card.id) : { need: Number.POSITIVE_INFINITY, cell: null };
    while (placed < total && info.need === 0 && info.cell) {
      b[info.cell]!.cube = card.id;
      placedCubes.push(info.cell);
      placed += 1;
      info = placed < total ? missingInfo(b, side, card.id) : { need: Number.POSITIVE_INFINITY, cell: null };
    }
    value += cardPoints(card.id, placed);
    if (isSpiritId(card.id) && placed > 0) value += spiritPoints(card.id, b, side);
    if (future > 0 && placed < total) {
      const gain = nextCubeValue({ id: card.id, placed });
      const miss = info.need;
      const weight = miss <= 1 ? 0.6 : miss === 2 ? 0.35 : miss === 3 ? 0.15 : 0;
      value += gain * weight * future;
    }
  }
  value += landscapeScore(b, side).total;
  if (future > 0) {
    value += structureBonus(b, side) * future;
    value += emptyCount(b) * 0.5 * future;
  }
  for (const cell of placedCubes) b[cell]!.cube = null;
  return value;
}

interface Step {
  readonly color: Color;
  readonly index: number;
  readonly cell: string;
}

interface Plan {
  readonly value: number;
  readonly steps: Step[];
  readonly board: Board;
}

function signature(board: Board, side: BoardSide, rest: readonly Color[]): string {
  return sideCells(side).map((c) => board[c]!.stack.join("")).join("|") + "#" + [...rest].sort().join("");
}

/** 集束搜索：把 hand 里的标记按任意顺序放到版图上，返回最好的放法。 */
function searchPlacements(board: Board, hand: readonly Color[], cards: readonly HeldCard[], side: BoardSide, left: number): Plan {
  let beam: { board: Board; hand: Color[]; steps: Step[]; value: number }[] = [{ board, hand: [...hand], steps: [], value: 0 }];
  for (let depth = 0; depth < hand.length; depth += 1) {
    const next: typeof beam = [];
    const seen = new Set<string>();
    for (const node of beam) {
      const tried = new Set<Color>();
      node.hand.forEach((color, index) => {
        if (tried.has(color)) return;
        tried.add(color);
        for (const cell of legalCellsFor(node.board, color)) {
          const b = clone(node.board);
          b[cell]!.stack.push(color);
          const rest = node.hand.filter((_, i) => i !== index);
          const sig = signature(b, side, rest);
          if (seen.has(sig)) continue;
          seen.add(sig);
          next.push({ board: b, hand: rest, steps: [...node.steps, { color, index, cell }], value: evaluate(b, cards, side, left) });
        }
      });
    }
    next.sort((x, y) => y.value - x.value || compareCells(x.steps[x.steps.length - 1]!.cell, y.steps[y.steps.length - 1]!.cell));
    beam = next.slice(0, BEAM);
    if (beam.length === 0) break;
  }
  const best = beam[0]!;
  return { value: best.value, steps: best.steps, board: best.board };
}

/** 一张卡对这块版图值多少（领卡时比较用）。 */
function cardWorth(board: Board, side: BoardSide, cardId: string, held: readonly HeldCard[], left: number): number {
  const card = animalCard(cardId);
  const miss = missingForCard(board, side, cardId);
  const cubes = card.scores.length;
  const size = card.cells.length;
  // 剩下的回合里大概能放几个：每个图案约要 size 个新标记（有的格子能和别的图案共用）
  const perPattern = Math.max(1.5, size - 0.5);
  const expected = Math.max(0, Math.min(cubes, Math.floor(((left - 0.5) * 2.2) / perPattern) + (miss === 0 ? 1 : 0)));
  const points = expected > 0 ? card.scores[expected - 1]! : 0;
  // 目标地貌和已有的卡重复：互相抢目标格
  const targetKind = card.cells.find((c) => c.target)!.kind;
  const clash = held.some(
    (h) => !isSpiritId(h.id) && h.placed < cubeCount(h.id) && animalCard(h.id).cells.find((c) => c.target)!.kind === targetKind,
  );
  return points * (miss === 0 ? 1 : miss <= 2 ? 0.85 : 0.7) - (clash ? 3 : 0);
}

function unfinished(cards: readonly HeldCard[]): number {
  return cards.filter((card) => card.placed < cubeCount(card.id)).length;
}

/** 看要不要领卡；afterTokens 时只考虑现在就能放方块的卡。 */
function chooseCard(state: GameState, me: number, afterTokens: boolean): { id: string; worth: number; immediate: boolean } | null {
  const player = state.players[me]!;
  if (state.turnState.tookCard !== null || state.market.length === 0) return null;
  const open = unfinished(player.cards);
  if (open >= MAX_UNFINISHED) return null;
  const side = state.config.side;
  const left = turnsLeft(state);
  let best: { id: string; worth: number; immediate: boolean } | null = null;
  for (const id of state.market) {
    const immediate = cubeTargetsOnBoard(player.board, id).length > 0;
    if (afterTokens && !immediate) continue;
    const worth = cardWorth(player.board, side, id, player.cards, left);
    if (!best || worth > best.worth) best = { id, worth, immediate };
  }
  if (!best) return null;
  // 快结束了：只领马上就能放方块的
  if (left <= 2 && !best.immediate) return null;
  const threshold = open === 0 ? 2 : open === 1 ? 4 : open === 2 ? 7 : 11;
  if (best.worth < (best.immediate ? threshold * 0.5 : threshold)) return null;
  return best;
}

function describeColors(colors: readonly Color[]): string {
  return colors.map((c) => COLOR_NAMES[c]).join("、");
}

/** 这一步放下去，地貌变成了什么（给理由用）。 */
function describePlacement(before: Board, after: Board, cell: string, side: BoardSide): string {
  const stack = after[cell]!.stack.join("");
  const kind = kindOf(after[cell]!.stack);
  const gain = landscapeScore(after, side).total - landscapeScore(before, side).total;
  const what = kind ? `成了${KIND_NAMES[kind]}` : stack === "B" || stack === "BB" ? "先垫好树干，之后放树冠" : stack === "R" ? "先放屋顶，之后可以叠成房屋" : "先占好位置";
  return gain > 0 ? `${what}，地貌分 +${gain}` : what;
}

/** 能放的方块里挑一个：分最高的卡优先；山上的目标格往后放（山还可能长高），少占别的卡的目标格。 */
function bestCube(board: Board, cards: readonly HeldCard[]): { cardId: string; cell: string } | null {
  let best: { cardId: string; cell: string; score: number } | null = null;
  for (const card of cards) {
    if (card.placed >= cubeCount(card.id)) continue;
    const gain = nextCubeValue(card);
    for (const cell of cubeTargetsOnBoard(board, card.id)) {
      const kind = kindOf(board[cell]!.stack);
      const growable = kind === "K1" || kind === "K2" ? 0.5 : 0;
      const blocks = cards.some(
        (other) => other.id !== card.id && other.placed < cubeCount(other.id) && cubeTargetsOnBoard(board, other.id).includes(cell),
      )
        ? 0.3
        : 0;
      const score = gain - growable - blocks;
      if (!best || score > best.score) best = { cardId: card.id, cell, score };
    }
  }
  return best ? { cardId: best.cardId, cell: best.cell } : null;
}

export function botAdvice(state: GameState, playerId: string): BotAdvice | null {
  if (state.phase === "finished") return null;
  const me = playerIndex(state, playerId);
  if (me < 0) return null;
  const player = state.players[me]!;
  const side = state.config.side;

  if (state.phase === "spirit") {
    if (player.spiritPick || !player.spiritChoices?.length) return null;
    const choices = [...player.spiritChoices].sort((x, y) => SPIRIT_PREFERENCE.indexOf(x) - SPIRIT_PREFERENCE.indexOf(y));
    const pick = choices[0]!;
    return { command: { type: "pickSpirit", cardId: pick }, reason: `选「${spiritCard(pick).name}」：${spiritCard(pick).rule}，比较好拿分。` };
  }
  if (me !== state.currentPlayer) return null;
  const t = state.turnState;
  const left = turnsLeft(state);

  if (t.took === null) {
    // 回合开始：先决定领不领卡
    const card = chooseCard(state, me, false);
    if (card) {
      const miss = missingForCard(player.board, side, card.id);
      const how = miss === 0 ? "图案已经摆好了，马上能放方块" : miss <= 2 ? `图案只差 ${miss} 个标记` : "图案不难摆";
      return { command: { type: "takeCard", cardId: card.id }, reason: `领「${cardName(card.id)}」：${how}。` };
    }
    // 挑凹槽：每个凹槽都试着放一遍
    let best: { space: number; plan: Plan } | null = null;
    for (let space = 0; space < state.central.length; space += 1) {
      const tokens = state.central[space]!;
      if (tokens.length === 0) continue;
      const plan = searchPlacements(player.board, tokens, player.cards, side, left);
      if (!best || plan.value > best.plan.value) best = { space, plan };
    }
    if (!best) return { command: { type: "endTurn" }, reason: "中央托盘已经拿空了，结束回合。" };
    const gain = landscapeScore(best.plan.board, side).total - landscapeScore(player.board, side).total;
    return {
      command: { type: "takeTokens", space: best.space },
      reason: `拿第 ${best.space + 1} 格（${describeColors(state.central[best.space]!)}）：${gain > 0 ? `放好后地貌分能多 ${gain} 分` : "能给后面的图案和地貌打好底子"}。`,
    };
  }

  if (t.hand.length > 0) {
    const plan = searchPlacements(player.board, t.hand, player.cards, side, left);
    const step = plan.steps[0];
    if (!step) {
      const action = legalActions(state, playerId).find((a) => a.type === "placeToken");
      return action ? { command: action, reason: "放下手里的标记。" } : null;
    }
    const after = clone(player.board);
    after[step.cell]!.stack.push(step.color);
    return {
      command: { type: "placeToken", index: step.index, cell: step.cell },
      reason: `把${COLOR_NAMES[step.color]}放在这里：${describePlacement(player.board, after, step.cell, side)}。`,
      cells: [step.cell],
    };
  }

  const cube = bestCube(player.board, player.cards);
  if (cube) {
    const held = player.cards.find((c) => c.id === cube.cardId)!;
    const gain = nextCubeValue(held);
    return {
      command: { type: "placeCube", cardId: cube.cardId, cell: cube.cell },
      reason: isSpiritId(cube.cardId)
        ? `「${cardName(cube.cardId)}」的图案摆出来了，放上自然之灵方块，终局另外加分。`
        : `「${cardName(cube.cardId)}」的图案摆出来了，放方块 +${gain} 分。`,
      cells: [cube.cell],
    };
  }
  const card = chooseCard(state, me, true);
  if (card) {
    return { command: { type: "takeCard", cardId: card.id }, reason: `领「${cardName(card.id)}」：版图上已经摆出它的图案，领了马上能放方块。` };
  }
  return { command: { type: "endTurn" }, reason: "标记都放好了，没有能放的方块了，结束回合。" };
}
