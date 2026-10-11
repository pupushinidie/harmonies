import {


  cubeTargetsOnBoard,
  emptyBoard,
  emptyCount,
  landscapeScore,
  legalCellsFor,
  matchPattern,
  rankWinners,
  scorePlayer,
  stackError,
} from "./board.js";
import { ANIMAL_CARDS, cubeCount, isSpiritId, SPIRIT_CARDS } from "./cards.js";
import { createRng, type Rng } from "./rng.js";
import {
  COLORS,
  TOKEN_COUNTS,
  type Color,
  type Config,
  type EndReason,
  type FinalResult,
  type GameCommand,
  type GameEvent,
  type GameOptions,
  type GameState,
  type Player,
  type TurnState,
  type UndoSnapshot,
} from "./types.js";

/** 中央版图几个供应格、每格几个标记、牌列几张、手上最多几张没完成的卡。 */
export const SUPPLY_SPACES = 5;
export const TOKENS_PER_SPACE = 3;
export const MARKET_SIZE = 5;
export const MAX_UNFINISHED = 4;

export function defaultConfig(playerCount: number, options: Partial<GameOptions> = {}): Config {
  return {
    playerCount,
    side: options.side === "B" ? "B" : "A",
    spirits: options.spirits === true,
    turnTimeoutSec: 90,
    spiritTimeoutSec: 60,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

function freshTurn(): TurnState {
  return { took: null, taken: [], hand: [], tookCard: null, placed: [], cubes: [], undo: [], undoCount: 0 };
}

/** 从布袋随机抽一个（抽的时候才决定，布袋本身不排序）。 */
function drawToken(state: GameState, rng: Rng): Color | null {
  if (state.pouch.length === 0) return null;
  const index = rng.int(state.pouch.length);
  return state.pouch.splice(index, 1)[0]!;
}

/** 补一个供应格：抽 3 个；布袋不够就有几个放几个。 */
function refillSpace(state: GameState, space: number, rng: Rng): Color[] {
  const drawn: Color[] = [];
  for (let i = 0; i < TOKENS_PER_SPACE; i += 1) {
    const token = drawToken(state, rng);
    if (!token) break;
    drawn.push(token);
  }
  state.central[space] = drawn;
  return drawn;
}

function refillMarket(state: GameState): string[] {
  const added: string[] = [];
  while (state.market.length < MARKET_SIZE && state.deck.length > 0) {
    const card = state.deck.shift()!;
    state.market.push(card);
    added.push(card);
  }
  return added;
}

/**
 * 开局（规则书 3）：120 个标记进布袋，5 格各抽 3 个；32 张动物卡洗匀翻 5 张；随机起始玩家；
 * 自然之灵变体每人暗发 2 张，所有人同时选。
 */
export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  options: Partial<GameOptions> = {},
): GameState {
  if (players.length < 1 || players.length > 4) throw new Error("需要 1–4 位玩家才能开始。");
  const config = defaultConfig(players.length, options);
  const rng = createRng(seed);
  const pouch: Color[] = [];
  for (const color of COLORS) for (let i = 0; i < TOKEN_COUNTS[color]; i += 1) pouch.push(color);
  const deck = rng.shuffle(ANIMAL_CARDS.map((card) => card.id));
  const spirits = config.spirits ? rng.shuffle(SPIRIT_CARDS.map((card) => card.id)) : [];
  const first = rng.int(players.length);
  const state: GameState = {
    config,
    phase: config.spirits ? "spirit" : "play",
    players: players.map((player, index) => {
      const entry: Player = { id: player.id, name: player.name, board: emptyBoard(config.side), cards: [], score: 0 };
      if (config.spirits) entry.spiritChoices = spirits.slice(index * 2, index * 2 + 2);
      return entry;
    }),
    first,
    currentPlayer: first,
    round: 1,
    turn: 1,
    central: [],
    market: [],
    turnState: freshTurn(),
    lastTurn: null,
    endTriggered: null,
    events: [],
    version: 0,
    pouch,
    deck,
    seed,
  };
  for (let space = 0; space < SUPPLY_SPACES; space += 1) refillSpace(state, space, rng);
  refillMarket(state);
  for (const player of state.players) player.score = scorePlayer(player, config.side).total;
  state.rngState = rng.state;
  return state;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function playerIndex(state: GameState, playerId: string): number {
  return state.players.findIndex((player) => player.id === playerId);
}

function unfinishedCount(player: Player): number {
  return player.cards.filter((card) => card.placed < cubeCount(card.id)).length;
}

/** 这位玩家现在还能不能领卡（不看是不是他的回合）。 */
export function canTakeCard(state: GameState, player: number): boolean {
  return state.turnState.tookCard === null && unfinishedCount(state.players[player]!) < MAX_UNFINISHED && state.market.length > 0;
}

/** 当前玩家能把手里第 index 个标记放在哪些格。 */
export function legalTokenCells(state: GameState, color: Color): string[] {
  const player = state.players[state.currentPlayer];
  return player ? legalCellsFor(player.board, color) : [];
}

/** 这位玩家这张卡现在能把方块放在哪些格（卡没放完、图案成立、目标格没方块）。 */
export function cubeTargets(state: GameState, player: number, cardId: string): string[] {
  const owner = state.players[player];
  const held = owner?.cards.find((card) => card.id === cardId);
  if (!owner || !held || held.placed >= cubeCount(cardId)) return [];
  return cubeTargetsOnBoard(owner.board, cardId);
}

/** 这位玩家所有没放完的卡里，现在能放的方块（卡、格子）。 */
export function allCubeMoves(state: GameState, player: number): { cardId: string; cell: string }[] {
  const owner = state.players[player];
  if (!owner) return [];
  return owner.cards.flatMap((card) => cubeTargets(state, player, card.id).map((cell) => ({ cardId: card.id, cell })));
}

function snapshot(state: GameState): UndoSnapshot {
  const player = state.players[state.currentPlayer]!;
  const t = state.turnState;
  return clone({
    board: player.board,
    cards: player.cards,
    central: state.central,
    market: state.market,
    took: t.took,
    taken: t.taken,
    hand: t.hand,
    tookCard: t.tookCard,
    placed: t.placed,
    cubes: t.cubes,
    score: player.score,
  });
}

function pushUndo(state: GameState): void {
  state.turnState.undo.push(snapshot(state));
  state.turnState.undoCount = state.turnState.undo.length;
}

function rescore(state: GameState, player: Player): void {
  player.score = scorePlayer(player, state.config.side).total;
}

/** 下一个座位；最后一个座位是起始玩家的上家。 */
function lastSeat(state: GameState): number {
  return (state.first + state.players.length - 1) % state.players.length;
}

function finishGame(state: GameState, reason: EndReason, events: GameEvent[]): void {
  const scores = state.players.map((player) => scorePlayer(player, state.config.side));
  for (const score of scores) state.players.find((player) => player.id === score.player)!.score = score.total;
  const result: FinalResult = { scores, winners: rankWinners(scores), reason };
  state.phase = "finished";
  state.currentPlayer = -1;
  state.finalResult = result;
  state.turnState = freshTurn();
  events.push({ type: "GameEnded", result });
}

/** 预览和教程用：按现在的版图立刻结束这局并结算。 */
export function endGameNow(state: GameState, reason: EndReason = "board"): GameState {
  const next = clone(state);
  const events: GameEvent[] = [];
  finishGame(next, reason, events);
  next.events = events;
  next.version += 1;
  return next;
}

function trigger(state: GameState, player: Player, reason: EndReason, events: GameEvent[]): void {
  if (state.endTriggered) return;
  state.endTriggered = reason;
  events.push({ type: "EndTriggered", player: player.id, reason });
}

/** 回合结束（规则书 4.4）：补标记、补牌列、检查终局、换人。 */
function endTurn(state: GameState, rng: Rng, events: GameEvent[], timedOut: boolean): void {
  const index = state.currentPlayer;
  const player = state.players[index]!;
  const t = state.turnState;
  let refilled: Color[] = [];
  if (t.took !== null) {
    if (state.pouch.length === 0) {
      state.central[t.took] = [];
      trigger(state, player, "pouch", events);
    } else {
      refilled = refillSpace(state, t.took, rng);
    }
  }
  const newCards = refillMarket(state);
  events.push({ type: "TurnEnded", player: player.id, space: t.took, refilled, newCards });
  if (emptyCount(player.board) <= 2) trigger(state, player, "board", events);
  if (state.central.every((space) => space.length === 0)) trigger(state, player, "supply", events);
  state.lastTurn = {
    player: player.id,
    space: t.took,
    tokens: [...t.taken],
    placed: [...t.placed],
    cubes: [...t.cubes],
    card: t.tookCard,
    timedOut,
  };
  rescore(state, player);
  if (state.endTriggered && index === lastSeat(state)) {
    finishGame(state, state.endTriggered, events);
    return;
  }
  state.currentPlayer = (index + 1) % state.players.length;
  if (state.currentPlayer === state.first) state.round += 1;
  state.turnState = freshTurn();
  state.turn += 1;
  events.push({
    type: "TurnStarted",
    player: state.players[state.currentPlayer]!.id,
    round: state.round,
    lastRound: state.endTriggered !== null,
  });
}

function requireInt(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(message);
  return value;
}

/**
 * 纯函数：执行一个命令，返回新状态（不改输入）。rng 默认从 state.rngState 恢复；
 * 教程可以传一个按剧本出数的 rng。随机数只在 endTurn（补标记）时用到。
 */
export function apply(
  state: GameState,
  playerId: string,
  command: GameCommand,
  rng: Rng = createRng(state.rngState ?? 0),
): { state: GameState; events: GameEvent[] } {
  if (state.phase === "finished") throw new Error("这局已经结束了。");
  const next = clone(state);
  const events: GameEvent[] = [];
  const me = playerIndex(next, playerId);
  if (me < 0) throw new Error("你不在这局里。");
  const player = next.players[me]!;

  if (command?.type === "pickSpirit") {
    if (next.phase !== "spirit") throw new Error("现在不是选自然之灵的时候。");
    const choices = player.spiritChoices ?? [];
    if (!choices.includes(command.cardId)) throw new Error("只能从发给你的两张里选。");
    player.spiritPick = command.cardId;
    events.push({ type: "SpiritPicked", player: player.id, auto: false });
    revealSpiritsIfReady(next, events);
    next.version += 1;
    next.events = events;
    return { state: next, events };
  }

  if (next.phase !== "play") throw new Error("请先选好自然之灵。");
  if (me !== next.currentPlayer) throw new Error("还没轮到你。");
  const t = next.turnState;

  switch (command?.type) {
    case "takeTokens": {
      if (t.took !== null) throw new Error("这回合已经拿过标记了。");
      const space = requireInt(command.space, "没有这个供应格。");
      const tokens = next.central[space];
      if (!tokens) throw new Error("没有这个供应格。");
      if (tokens.length === 0) throw new Error("这一格已经空了。");
      pushUndo(next);
      t.took = space;
      t.hand = [...tokens];
      t.taken = [...tokens];
      next.central[space] = [];
      events.push({ type: "TokensTaken", player: player.id, space, tokens: [...t.hand] });
      break;
    }
    case "placeToken": {
      const index = requireInt(command.index, "手里没有这个标记。");
      const color = t.hand[index];
      if (!color) throw new Error("手里没有这个标记。");
      const cell = String(command.cell);
      const error = stackError(player.board[cell], color);
      if (error) throw new Error(error);
      pushUndo(next);
      const before = player.score;
      player.board[cell]!.stack.push(color);
      t.hand.splice(index, 1);
      if (!t.placed.includes(cell)) t.placed.push(cell);
      rescore(next, player);
      events.push({ type: "TokenPlaced", player: player.id, color, cell, scoreBefore: before, scoreAfter: player.score });
      break;
    }
    case "takeCard": {
      if (t.tookCard !== null) throw new Error("每回合只能领 1 张动物卡。");
      if (unfinishedCount(player) >= MAX_UNFINISHED) throw new Error("你面前已经有 4 张没完成的卡了。");
      const at = next.market.indexOf(String(command.cardId));
      if (at < 0) throw new Error("牌列里没有这张卡。");
      pushUndo(next);
      const [cardId] = next.market.splice(at, 1);
      player.cards.push({ id: cardId!, placed: 0 });
      t.tookCard = cardId!;
      events.push({ type: "CardTaken", player: player.id, cardId: cardId! });
      break;
    }
    case "placeCube": {
      const cardId = String(command.cardId);
      const held = player.cards.find((card) => card.id === cardId);
      if (!held) throw new Error("你面前没有这张卡。");
      if (held.placed >= cubeCount(cardId)) throw new Error("这张卡的方块已经放完了。");
      const cell = String(command.cell);
      const target = player.board[cell];
      if (!target) throw new Error("这一格不在你的版图上。");
      if (target.cube) throw new Error("这一格已经有方块了。");
      if (!matchPattern(player.board, cardId, cell)) throw new Error("这里还没摆出这张卡的图案。");
      pushUndo(next);
      const before = player.score;
      target.cube = cardId;
      held.placed += 1;
      t.cubes.push(cell);
      rescore(next, player);
      events.push({
        type: "CubePlaced",
        player: player.id,
        cardId,
        cell,
        completed: held.placed >= cubeCount(cardId),
        scoreBefore: before,
        scoreAfter: player.score,
      });
      break;
    }
    case "undo": {
      const snap = t.undo.pop();
      if (!snap) throw new Error("这回合没有可以撤销的了。");
      player.board = snap.board;
      player.cards = snap.cards;
      player.score = snap.score;
      next.central = snap.central;
      next.market = snap.market;
      t.took = snap.took;
      t.taken = snap.taken;
      t.hand = snap.hand;
      t.tookCard = snap.tookCard;
      t.placed = snap.placed;
      t.cubes = snap.cubes;
      t.undoCount = t.undo.length;
      events.push({ type: "Undone", player: player.id });
      break;
    }
    case "endTurn": {
      const allEmpty = next.central.every((space) => space.length === 0);
      if (t.took === null && !allEmpty) throw new Error("先从中央版图拿一格标记。");
      if (t.hand.length > 0) throw new Error("手里的标记要全部放到版图上。");
      endTurn(next, rng, events, false);
      next.rngState = rng.state;
      break;
    }
    default:
      throw new Error("未知的行动。");
  }

  next.version += 1;
  next.events = events;
  return { state: next, events };
}

function revealSpiritsIfReady(state: GameState, events: GameEvent[]): void {
  if (state.players.some((player) => !player.spiritPick)) return;
  const picks = state.players.map((player) => ({ player: player.id, cardId: player.spiritPick! }));
  for (const player of state.players) {
    player.cards.push({ id: player.spiritPick!, placed: 0 });
    delete player.spiritChoices;
    delete player.spiritPick;
  }
  state.phase = "play";
  state.turn += 1;
  events.push({ type: "SpiritsRevealed", picks });
  events.push({ type: "TurnStarted", player: state.players[state.currentPlayer]!.id, round: state.round, lastRound: false });
}

/** 服务端用：执行命令并记进动作序列（同一种子重放这串动作就能复现整局）。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  const { state: next } = apply(state, playerId, command);
  next.log = [...(state.log ?? []), { player: playerId, command }];
  return next;
}

/** 放一个标记让地貌分增加最多的格子（并列取坐标最小）。 */
export function bestTokenCell(state: GameState, color: Color): string | null {
  const player = state.players[state.currentPlayer]!;
  let best: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const cell of legalCellsFor(player.board, color)) {
    const board = clone(player.board);
    board[cell]!.stack.push(color);
    const score = landscapeScore(board, state.config.side).total;
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  return best;
}

/**
 * 超时默认动作的下一步（规则书 9.4）：
 * - 自然之灵阶段：选第一张；
 * - 没拿标记：拿第一个非空的供应格；
 * - 手里有标记：第一个标记放到地貌分增加最多的合法格（并列取坐标最小）；
 * - 不领卡；能放的方块都放上（按卡的顺序、格子坐标最小）；
 * - 然后结束回合。
 */
export function autoCommand(state: GameState, playerId?: string): GameCommand | null {
  if (state.phase === "finished") return null;
  if (state.phase === "spirit") {
    const player = playerId ? state.players[playerIndex(state, playerId)] : state.players.find((p) => !p.spiritPick);
    if (!player || player.spiritPick || !player.spiritChoices?.[0]) return null;
    return { type: "pickSpirit", cardId: player.spiritChoices[0] };
  }
  const t = state.turnState;
  if (t.took === null) {
    const space = state.central.findIndex((tokens) => tokens.length > 0);
    if (space >= 0) return { type: "takeTokens", space };
    return { type: "endTurn" };
  }
  if (t.hand.length > 0) {
    const cell = bestTokenCell(state, t.hand[0]!);
    if (!cell) throw new Error("手里的标记没有地方放（不应该发生）。");
    return { type: "placeToken", index: 0, cell };
  }
  const cube = allCubeMoves(state, state.currentPlayer)[0];
  if (cube) return { type: "placeCube", cardId: cube.cardId, cell: cube.cell };
  return { type: "endTurn" };
}

/**
 * 超时（真人）：自然之灵阶段替所有没选的人选第一张；正常回合替当前玩家把这回合按默认动作做完。
 */
export function timeoutTurn(state: GameState): GameState {
  if (state.phase === "finished") return state;
  let current = state;
  const allEvents: GameEvent[] = [];
  if (state.phase === "spirit") {
    for (const player of state.players) {
      if (player.spiritPick || current.phase !== "spirit") continue;
      const { state: after, events } = apply(current, player.id, { type: "pickSpirit", cardId: player.spiritChoices![0]! });
      allEvents.push(...events.map((event) => (event.type === "SpiritPicked" ? { ...event, auto: true } : event)));
      current = after;
    }
    current.events = allEvents;
    current.log = [...(state.log ?? []), { player: "", command: { type: "TIMEOUT" } }];
    return current;
  }
  const playerId = state.players[state.currentPlayer]!.id;
  allEvents.push({ type: "TurnTimedOut", player: playerId });
  for (let guard = 0; guard < 100; guard += 1) {
    const command = autoCommand(current);
    if (!command) break;
    const { state: after, events } = apply(current, playerId, command);
    allEvents.push(...events);
    current = after;
    if (command.type === "endTurn") {
      if (current.lastTurn) current.lastTurn = { ...current.lastTurn, timedOut: true };
      break;
    }
  }
  current.events = allEvents;
  current.log = [...(state.log ?? []), { player: playerId, command: { type: "TIMEOUT" } }];
  return current;
}

/** 布袋里各颜色剩几个。 */
export function pouchCounts(pouch: readonly Color[]): Record<Color, number> {
  const counts = { W: 0, K: 0, B: 0, G: 0, Y: 0, R: 0 } as Record<Color, number>;
  for (const color of pouch) counts[color] += 1;
  return counts;
}

/**
 * 发给客户端的视角（规则书 9.3）：布袋只给各色数量，牌堆只给张数；
 * 自然之灵发到的两张和选好的那张只给本人；撤销栈只给步数；删掉种子、随机数状态、动作序列。
 * viewerId 为空字符串是观战视角（和对手看到的一样）。
 */
export function redactGameForViewer(state: GameState, viewerId: string): GameState {
  const { pouch, deck, seed: _seed, rngState: _rngState, log: _log, ...rest } = state;
  const players = state.players.map((player) => {
    if (player.id === viewerId) return player;
    const { spiritChoices: _choices, spiritPick, ...open } = player;
    // 别人只知道「选好了没有」：用一个占位值，不带卡的编号
    return spiritPick ? { ...open, spiritPick: "?" } : open;
  });
  return {
    ...rest,
    players,
    turnState: { ...state.turnState, undo: [] },
    pouch: [],
    deck: [],
    pouchCounts: pouchCounts(pouch),
    deckCount: deck.length,
  };
}

/** 当前玩家现在能做的所有命令（测试、陪玩脚本、随机人机用）；不是他的回合返回空数组。 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (state.phase === "finished") return [];
  const me = playerIndex(state, playerId);
  if (me < 0) return [];
  const player = state.players[me]!;
  if (state.phase === "spirit") {
    return player.spiritPick ? [] : (player.spiritChoices ?? []).map((cardId) => ({ type: "pickSpirit", cardId }));
  }
  if (me !== state.currentPlayer) return [];
  const t = state.turnState;
  const actions: GameCommand[] = [];
  if (t.took === null) {
    state.central.forEach((tokens, space) => {
      if (tokens.length > 0) actions.push({ type: "takeTokens", space });
    });
  }
  const seen = new Set<Color>();
  t.hand.forEach((color, index) => {
    if (seen.has(color)) return;
    seen.add(color);
    for (const cell of legalCellsFor(player.board, color)) actions.push({ type: "placeToken", index, cell });
  });
  if (canTakeCard(state, me)) for (const cardId of state.market) actions.push({ type: "takeCard", cardId });
  for (const move of allCubeMoves(state, me)) actions.push({ type: "placeCube", ...move });
  const allEmpty = state.central.every((space) => space.length === 0);
  if ((t.took !== null || allEmpty) && t.hand.length === 0) actions.push({ type: "endTurn" });
  return actions;
}

/** 当前玩家结束回合前还能放几个方块（按「能放就放」一个个模拟，界面「确定结束吗」用）。 */
export function pendingCubeCount(state: GameState): number {
  if (state.phase !== "play") return 0;
  const player = state.players[state.currentPlayer]!;
  const board = clone(player.board);
  const cards = player.cards.map((card) => ({ ...card }));
  let count = 0;
  for (let guard = 0; guard < 40; guard += 1) {
    let placed = false;
    for (const card of cards) {
      if (card.placed >= cubeCount(card.id)) continue;
      const cell = cubeTargetsOnBoard(board, card.id)[0];
      if (!cell) continue;
      board[cell]!.cube = card.id;
      card.placed += 1;
      count += 1;
      placed = true;
      break;
    }
    if (!placed) break;
  }
  return count;
}

