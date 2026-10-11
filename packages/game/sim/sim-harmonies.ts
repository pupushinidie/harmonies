// 自然和弦人机强度：人机 vs 随机、人机 vs 贪心基线、人机 vs 超时默认动作；自对弈每种人数 300 局。
// 用法：cd ~/projects/harmonies && npx tsx packages/game/sim/sim-harmonies.ts [局数倍数]
import {
  allCubeMoves,
  apply,
  autoCommand,
  botCommand,
  canTakeCard,
  createGame,
  cubeTargetsOnBoard,
  landscapeScore,
  legalActions,
  legalCellsFor,
  missingForCard,
  redactGameForViewer,
  type BoardSide,
  type GameCommand,
  type GameState,
} from "../src/index.ts";

type Bot = (s: GameState, id: string) => GameCommand;
let seedR = 777;
const rand = () => (seedR = (seedR * 1103515245 + 12345) % 2147483648) / 2147483648;

/** 随机：随机拿一格、随机放、能领就随机领、能放方块就随机放（规则书 9.7 的测试基线）。 */
const random: Bot = (s, id) => {
  let acts = legalActions(s, id).filter((a) => a.type !== "undo");
  const cubes = acts.filter((a) => a.type === "placeCube");
  if (cubes.length) return cubes[Math.floor(rand() * cubes.length)]!;
  if (acts.some((a) => a.type !== "endTurn")) acts = acts.filter((a) => a.type !== "endTurn");
  return acts[Math.floor(rand() * acts.length)]!;
};

/** 贪心：只看本回合；每个标记放到「地貌分 + 本回合方块分」增加最多的格子；挑总增量最大的凹槽；少于 2 张没完成的卡就领一张最容易摆的。 */
const greedy: Bot = (s, id) => {
  const me = s.currentPlayer;
  const p = s.players[me]!;
  if (s.phase === "spirit") return autoCommand(s, id)!;
  const t = s.turnState;
  const open = p.cards.filter((c) => c.placed < (c.id.startsWith("S") ? 1 : 99)).length;
  if (t.took === null && canTakeCard(s, me) && open < 2) {
    const best = [...s.market].sort((a, b) => missingForCard(p.board, s.config.side, a) - missingForCard(p.board, s.config.side, b))[0]!;
    return { type: "takeCard", cardId: best };
  }
  const value = (board: typeof p.board) => {
    let v = landscapeScore(board, s.config.side).total;
    for (const c of p.cards) v += cubeTargetsOnBoard(board, c.id).length > 0 ? 3 : 0;
    return v;
  };
  const greedyPlace = (board: typeof p.board, hand: string[]) => {
    const b = structuredClone(board);
    let total = 0;
    let first: { index: number; cell: string } | null = null;
    const left = [...hand];
    while (left.length) {
      let best: { i: number; cell: string; v: number } | null = null;
      left.forEach((color, i) => {
        for (const cell of legalCellsFor(b, color as never)) {
          b[cell]!.stack.push(color as never);
          const v = value(b);
          b[cell]!.stack.pop();
          if (!best || v > best.v) best = { i, cell, v };
        }
      });
      const chosen = best as unknown as { i: number; cell: string; v: number };
      if (!first) first = { index: chosen.i, cell: chosen.cell };
      b[chosen.cell]!.stack.push(left[chosen.i] as never);
      left.splice(chosen.i, 1);
      total = chosen.v;
    }
    return { total, first };
  };
  if (t.took === null) {
    let best = { space: s.central.findIndex((x) => x.length > 0), v: -1 };
    s.central.forEach((tokens, space) => {
      if (!tokens.length) return;
      const r = greedyPlace(p.board, tokens);
      if (r.total > best.v) best = { space, v: r.total };
    });
    return best.space >= 0 ? { type: "takeTokens", space: best.space } : { type: "endTurn" };
  }
  if (t.hand.length) {
    const r = greedyPlace(p.board, t.hand);
    return { type: "placeToken", index: r.first!.index, cell: r.first!.cell };
  }
  const cube = allCubeMoves(s, me)[0];
  if (cube) return { type: "placeCube", ...cube };
  return { type: "endTurn" };
};

const timeoutBot: Bot = (s, id) => autoCommand(s, id)!;
const times: number[] = [];
const mine: Bot = (s, id) => {
  const t0 = performance.now();
  const c = botCommand(redactGameForViewer(s, id), id)!;
  times.push(performance.now() - t0);
  return c;
};

function play(bots: Bot[], seed: number, side: BoardSide, spirits: boolean) {
  let s = createGame(bots.map((_, i) => ({ id: `p${i}`, name: `b${i}` })), seed, { side, spirits });
  let n = 0;
  while (s.phase !== "finished") {
    if (++n > 1500) throw new Error(`seed ${seed} 1500 步没结束`);
    const actor = s.phase === "spirit" ? s.players.findIndex((p) => !p.spiritPick) : s.currentPlayer;
    const id = s.players[actor]!.id;
    const cmd = bots[actor]!(s, id);
    s = apply(s, id, cmd).state; // 不合法会抛错
  }
  return { winners: s.finalResult!.winners.map((w) => Number(w.slice(1))), scores: s.finalResult!.scores.map((x) => x.total), steps: n };
}

function match(name: string, a: Bot, b: Bot, n: number, players = 2, side: BoardSide = "A", spirits = false) {
  let w = 0, sa = 0, sb = 0, rank = 0;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const seat = i % players;
    const bots = Array.from({ length: players }, (_, k) => (k === seat ? a : b));
    const res = play(bots, 5000 + i * 13, side, spirits);
    if (res.winners.includes(seat)) w += 1 / res.winners.length;
    sa += res.scores[seat]!;
    sb += res.scores.filter((_, k) => k !== seat).reduce((x, y) => x + y, 0) / (players - 1);
    rank += 1 + res.scores.filter((x) => x > res.scores[seat]!).length;
  }
  console.log(`${name} ${players}人${side}面${spirits ? "+灵" : ""}：胜率 ${(100 * w / n).toFixed(1)}%（公平 ${(100 / players).toFixed(0)}%）平均名次 ${(rank / n).toFixed(2)}  平均分 ${(sa / n).toFixed(1)} vs ${(sb / n).toFixed(1)}  ${((Date.now() - t0) / n).toFixed(0)}ms/局  n=${n}`);
}

function selfPlay(players: number, n: number) {
  let maxSteps = 0, total = 0;
  for (let i = 0; i < n; i++) {
    const res = play(Array.from({ length: players }, () => mine), 9000 + i * 7, i % 2 ? "B" : "A", i % 3 === 0);
    maxSteps = Math.max(maxSteps, res.steps);
    total += res.scores.reduce((x, y) => x + y, 0) / players;
  }
  console.log(`自对弈 ${players} 人 ${n} 局：全部合法打完，最多 ${maxSteps} 步，平均每人 ${(total / n).toFixed(1)} 分`);
}

const k = Number(process.argv[2] ?? 1);
match("人机 vs 随机", mine, random, 100 * k);
match("贪心 vs 随机", greedy, random, 100 * k);
match("人机 vs 贪心", mine, greedy, 200 * k);
match("人机 vs 超时默认", mine, timeoutBot, 100 * k);
match("人机 vs 贪心", mine, greedy, 100 * k, 2, "B");
match("人机 vs 贪心", mine, greedy, 100 * k, 3);
match("人机 vs 贪心", mine, greedy, 100 * k, 4);
match("人机 vs 贪心", mine, greedy, 100 * k, 2, "A", true);
for (const n of [2, 3, 4]) selfPlay(n, Number(process.env.SELF ?? 300));
times.sort((x, y) => x - y);
console.log(`决策耗时：${times.length} 步，平均 ${(times.reduce((x, y) => x + y, 0) / times.length).toFixed(1)}ms，p99 ${times[Math.floor(times.length * 0.99)]!.toFixed(1)}ms，最坏 ${times[times.length - 1]!.toFixed(1)}ms`);
