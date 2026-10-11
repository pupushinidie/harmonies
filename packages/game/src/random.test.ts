import { describe, expect, it } from "vitest";
import {
  ANIMAL_CARDS,
  apply,
  COLORS,
  createGame,
  createRng,
  cubeCount,
  isSpiritId,
  legalActions,
  redactGameForViewer,
  scorePlayer,
  TOKEN_COUNTS,
  type BoardSide,
  type GameCommand,
  type GameState,
} from "./index.js";

const VALID_STACKS = new Set(["W", "Y", "K", "KK", "KKK", "B", "BB", "G", "BG", "BBG", "R", "KR", "BR", "RR"]);

function check(state: GameState, problems: string[]): void {
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0])) as Record<string, number>;
  for (const c of state.pouch) counts[c]! += 1;
  for (const space of state.central) for (const c of space) counts[c]! += 1;
  for (const c of state.turnState.hand) counts[c]! += 1;
  for (const p of state.players) for (const cell of Object.values(p.board)) for (const c of cell.stack) counts[c]! += 1;
  for (const c of COLORS) if (counts[c] !== TOKEN_COUNTS[c]) problems.push(`标记 ${c} 不守恒：${counts[c]}`);

  const animals = [...state.deck, ...state.market, ...state.players.flatMap((p) => p.cards.map((c) => c.id).filter((id) => !isSpiritId(id)))];
  if (animals.length !== ANIMAL_CARDS.length || new Set(animals).size !== ANIMAL_CARDS.length) problems.push(`动物卡不守恒：${animals.length}`);
  if (state.market.length > 5) problems.push("牌列超过 5 张");

  for (const p of state.players) {
    let cubesOnBoard = 0;
    for (const [cellKey, cell] of Object.entries(p.board)) {
      if (cell.stack.length > 0 && !VALID_STACKS.has(cell.stack.join(""))) problems.push(`非法叠放 ${cellKey}=${cell.stack.join("")}`);
      if (cell.cube) {
        cubesOnBoard += 1;
        if (!p.cards.some((c) => c.id === cell.cube)) problems.push(`方块 ${cell.cube} 不是自己的卡`);
        if (cell.stack.length === 0) problems.push("方块放在空格上");
      }
    }
    const placed = p.cards.reduce((sum, c) => sum + c.placed, 0);
    if (placed !== cubesOnBoard) problems.push(`方块数对不上 ${placed} vs ${cubesOnBoard}`);
    for (const c of p.cards) if (c.placed > cubeCount(c.id)) problems.push(`卡 ${c.id} 方块超量`);
    const unfinished = p.cards.filter((c) => c.placed < cubeCount(c.id)).length;
    if (unfinished > 4) problems.push(`没完成的卡超过 4 张：${unfinished}`);
    const score = scorePlayer(p, state.config.side).total;
    if (state.phase !== "spirit" && score !== p.score) problems.push(`分数不一致 ${p.score} vs ${score}`);
  }
}

function actorOf(state: GameState): string {
  if (state.phase === "spirit") return state.players.find((p) => !p.spiritPick)!.id;
  return state.players[state.currentPlayer]!.id;
}

function playRandom(n: number, seed: number, side: BoardSide, spirits: boolean, problems: string[]) {
  let state = createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `p${i}` })), seed, { side, spirits });
  const rng = createRng(seed * 7 + 1);
  const turnsBy = new Map<string, number>();
  let steps = 0;
  let lastTurnKey = state.turn;
  while (state.phase !== "finished") {
    steps += 1;
    if (steps > 3000) {
      problems.push(`seed ${seed}：3000 步还没结束`);
      break;
    }
    const actor = actorOf(state);
    let actions: GameCommand[] = legalActions(state, actor);
    if (actions.length === 0) {
      problems.push(`seed ${seed}：${actor} 没有合法行动（${state.phase}）`);
      break;
    }
    // 偶尔撤销一步，测撤销
    if (state.turnState.undoCount > 0 && rng.next() < 0.05) actions = [{ type: "undo" }];
    else if (actions.some((a) => a.type !== "endTurn") && rng.next() < 0.85) actions = actions.filter((a) => a.type !== "endTurn");
    const command = actions[rng.int(actions.length)]!;
    const before = steps % 9 === 0 ? JSON.stringify(state) : "";
    const next = apply(state, actor, command).state;
    if (before && JSON.stringify(state) !== before) problems.push("apply 修改了输入");
    if (next.version !== state.version + 1) problems.push("version 没有 +1");
    if (command.type === "endTurn") {
      turnsBy.set(actor, (turnsBy.get(actor) ?? 0) + 1);
      if (next.phase !== "finished" && next.turn !== lastTurnKey + 1) problems.push("换人时 turn 没有 +1");
      lastTurnKey = next.turn;
    } else if (command.type !== "pickSpirit" && next.turn !== state.turn) {
      problems.push(`回合内操作改了 turn：${command.type}`);
    } else if (command.type === "pickSpirit") {
      lastTurnKey = next.turn;
    }
    state = next;
    check(state, problems);
    if (steps % 25 === 0) {
      const view = JSON.stringify(redactGameForViewer(state, "p0"));
      if (view.includes('"pouch":["') || view.includes('"deck":["') || view.includes('"seed"') || view.includes('"rngState"')) problems.push("视角里有隐藏信息");
    }
  }
  if (state.phase === "finished") {
    const counts = state.players.map((p) => turnsBy.get(p.id) ?? 0);
    if (new Set(counts).size !== 1) problems.push(`seed ${seed}：每人回合数不同 ${counts.join(",")}`);
    const result = state.finalResult!;
    if (result.winners.length < 1) problems.push("没有赢家");
    const best = Math.max(...result.scores.map((s) => s.total));
    for (const w of result.winners) if (result.scores.find((s) => s.player === w)!.total !== best) problems.push("赢家不是最高分");
    const reason = result.reason;
    if (reason === "board" && !state.players.some((p) => Object.values(p.board).filter((c) => c.stack.length === 0).length <= 2)) problems.push("board 结束但没人只剩 ≤2 空格");
  }
  return { state, steps, turns: [...turnsBy.values()].reduce((a, b) => a + b, 0) };
}

describe("随机对局：每种人数 300 局", () => {
  for (const n of [2, 3, 4]) {
    it(`${n} 人：A/B 面、带不带自然之灵各占一部分，全部打到终局且不变量成立`, () => {
      const problems: string[] = [];
      const reasons = new Map<string, number>();
      for (let i = 0; i < 300; i += 1) {
        const side: BoardSide = i % 2 === 0 ? "A" : "B";
        const spirits = i % 3 === 0;
        const { state } = playRandom(n, 1000 * n + i, side, spirits, problems);
        const reason = state.finalResult?.reason ?? "unfinished";
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        if (problems.length > 0) break;
      }
      expect(problems.slice(0, 5)).toEqual([]);
      expect(reasons.get("unfinished") ?? 0).toBe(0);
    }, 60000);
  }
  it("1 人（引擎支持，网页是 1 人 + 人机）：也能打完", () => {
    const problems: string[] = [];
    for (let i = 0; i < 50; i += 1) playRandom(1, 77 + i, "A", false, problems);
    expect(problems.slice(0, 5)).toEqual([]);
  });
});
