import { describe, expect, it } from "vitest";
import { botCommand } from "./bot.js";
import { apply, legalActions, redactGameForViewer } from "./engine.js";
import { kindOf, landscapeScore, riverLength, scorePlayer } from "./board.js";
import {
  anchorVisible,
  createPracticeGame,
  createTutorialGame,
  createTutorialRng,
  sameCommand,
  TUTORIAL_DRAWS,
  TUTORIAL_RIVAL,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  type TutorialRng,
} from "./tutorial.js";
import { TOKEN_COUNTS, type GameState } from "./types.js";

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length, rng: TutorialRng = createTutorialRng(1)): GameState {
  let game = createTutorialGame("小蒲");
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = apply(game, TUTORIAL_SELF, step.expect, rng).state;
    if (step.kind === "watch") for (const move of step.moves) game = apply(game, TUTORIAL_RIVAL, move, rng).state;
  }
  return game;
}

const stepIndex = (id: string) => TUTORIAL_STEPS.findIndex((step) => step.id === id);
const me = (game: GameState) => game.players.find((p) => p.id === TUTORIAL_SELF)!;

describe("新手教程剧本", () => {
  it("开局：托盘、牌列摆好，标记总数还是 120", () => {
    const game = createTutorialGame("小蒲");
    expect(game.central.map((s) => s.join(""))).toEqual(["BGK", "GKY", "YBR", "WWW", "KKR"]);
    expect(game.market[0]).toBe("A18");
    expect(game.pouch.length + 15).toBe(120);
    const count = (c: string) => game.pouch.filter((x) => x === c).length + game.central.flat().filter((x) => x === c).length;
    for (const [color, n] of Object.entries(TOKEN_COUNTS)) expect(count(color)).toBe(n);
    expect(game.players[game.currentPlayer]!.id).toBe(TUTORIAL_SELF);
  });

  it("从头走到尾：每一步要你做的都合法、轮到的是对的人，高亮的东西在界面上看得见", () => {
    let game = createTutorialGame("小蒲");
    const rng = createTutorialRng(1);
    for (const step of TUTORIAL_STEPS) {
      if (step.anchor) expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」高亮的 ${step.anchor} 看不见`).toBe(true);
      if (step.kind === "do") {
        expect(game.players[game.currentPlayer]!.id, `「${step.id}」没轮到你`).toBe(TUTORIAL_SELF);
        expect(legalActions(game, TUTORIAL_SELF).some((command) => sameCommand(command, step.expect)), `「${step.id}」这一步不合法`).toBe(true);
        game = apply(game, TUTORIAL_SELF, step.expect, rng).state;
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          expect(legalActions(game, TUTORIAL_RIVAL).some((command) => sameCommand(command, move)), `「${step.id}」里对手的 ${JSON.stringify(move)} 不合法`).toBe(true);
          game = apply(game, TUTORIAL_RIVAL, move, rng).state;
        }
      }
    }
    // 剧本里的补托盘正好用完：多一次少一次，后面托盘里的东西都会错位
    expect(rng.remaining).toBe(0);
    expect(game.phase).toBe("play");
    expect(game.players[game.currentPlayer]!.id).toBe(TUTORIAL_RIVAL);
  });

  it("关键的几幕一定发生：叠出高 2 的树、两座山挨着得分、獾的图案转着摆也能放方块", () => {
    const tree = playScript(stepIndex("crown") + 1);
    expect(kindOf(me(tree).board["1,1"]!.stack)).toBe("T2");
    expect(landscapeScore(me(tree).board).trees).toBe(3);

    const rocks = playScript(stepIndex("rock2") + 1);
    expect(landscapeScore(me(rocks).board).mountains).toBe(2);

    const cube = playScript(stepIndex("cube") + 1);
    expect(me(cube).board["1,1"]!.cube).toBe("A18");
    expect(me(cube).cards).toEqual([{ id: "A18", placed: 1 }]);
    expect(scorePlayer(me(cube), "A").animals).toBe(3);
    // 结束回合时没有还能放的方块（不会弹「确定结束吗」挡住教程）
    expect(legalActions(cube, TUTORIAL_SELF).some((a) => a.type === "placeCube")).toBe(false);
  });

  it("第三、四回合：田连成一片 5 分、房屋凑齐 3 种颜色 5 分、河长 3 得 5 分", () => {
    const before = playScript(stepIndex("houseRule"));
    expect(landscapeScore(me(before).board).fields).toBe(5);
    expect(kindOf(me(before).board["0,2"]!.stack)).toBe("H");
    expect(landscapeScore(me(before).board).houses).toBe(0);
    const water = playScript(stepIndex("water1") + 1);
    expect(landscapeScore(me(water).board).houses).toBe(5);
    const river = playScript(stepIndex("water3") + 1);
    expect(riverLength(me(river).board, "A")).toBe(3);
    expect(landscapeScore(me(river).board).water).toBe(5);
    expect(scorePlayer(me(river), "A").total).toBe(24);
    // 咕噜一号第 3 回合叠了一棵高 3 的树
    const rival = river.players.find((p) => p.id === TUTORIAL_RIVAL)!;
    expect(kindOf(rival.board["1,1"]!.stack)).toBe("T3");
  });

  it("剧本本身：步骤 id 不重复，最后一步是唯一的收尾，说明文字不空", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) expect(step.say.trim().length).toBeGreaterThan(0);
  });

  it("剧本随机：前面按布袋顺序抽，用完以后是普通随机数", () => {
    const rng = createTutorialRng(7);
    expect(Array.from({ length: TUTORIAL_DRAWS }, () => rng.int(50))).toEqual(Array(TUTORIAL_DRAWS).fill(0));
    expect(rng.remaining).toBe(0);
    const rolls = Array.from({ length: 200 }, () => rng.int(10));
    expect(new Set(rolls).size).toBeGreaterThan(5);
  });

  it("剧本走完接练习局：两边都交给人机，16 局都能正常打完", () => {
    const stuck: string[] = [];
    for (let seed = 1; seed <= 16; seed += 1) {
      const rng = createTutorialRng(seed);
      let game = seed % 2 === 0 ? playScript(TUTORIAL_STEPS.length, rng) : createPracticeGame("小蒲", seed);
      let moves = 0;
      while (game.phase !== "finished" && moves < 1500) {
        const actor = game.players[game.currentPlayer]!.id;
        const command = botCommand(redactGameForViewer(game, actor), actor);
        if (!command) break;
        game = apply(game, actor, command, rng).state;
        moves += 1;
      }
      if (game.phase !== "finished" || !game.finalResult) stuck.push(`第 ${seed} 局（${moves} 步）`);
    }
    expect(stuck).toEqual([]);
  }, 120_000);
});
