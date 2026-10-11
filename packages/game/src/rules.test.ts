import { describe, expect, it } from "vitest";
import {
  apply,
  boardFrom,
  buildState,
  createGame,
  cubeTargets,
  emptyBoard,
  islandCount,
  kindOf,
  landscapeScore,
  legalActions,
  neighbors,
  pendingCubeCount,
  rankWinners,
  redactGameForViewer,
  riverLength,
  riverPoints,
  scorePlayer,
  scriptedRng,
  spiritPoints,
  stackError,
  timeoutTurn,
  type Board,
  type Color,
  type GameCommand,
  type GameState,
  type ScoreBreakdown,
} from "./index.js";
import { EXAMPLE_1 } from "./scenes.js";

const FILL = ["Y", "W", "K", "B", "G", "R"];
function fill(cells: string[]): Record<string, string> {
  return Object.fromEntries(cells.map((c, i) => [c, FILL[i % FILL.length]!]));
}

function run(state: GameState, player: string, ...commands: GameCommand[]): GameState {
  let current = state;
  for (const command of commands) current = apply(current, player, command, scriptedRng()).state;
  return current;
}

function push(board: Board, cell: string, ...colors: Color[]): string | null {
  for (const color of colors) {
    const error = stackError(board[cell], color);
    if (error) return error;
    board[cell]!.stack.push(color);
  }
  return null;
}

/** 只有 p1 的局面，手上拿着 hand，方便连续放标记。 */
function soloWith(board: Record<string, string>, cards: [string, number][] = [], cubes: Record<string, string> = {}) {
  return buildState({ players: [{ board, cards, cubes }, {}], took: 0, hand: "", central: ["", "WWW", "KKK", "YYY", "BBB"] });
}

describe("规则书#TC1 叠放规则", () => {
  it("山最多 3 层", () => {
    const b = emptyBoard("A");
    expect(push(b, "0,0", "K", "K", "K")).toBeNull();
    expect(push(b, "0,0", "K")).not.toBeNull();
  });
  it("B 上放 R 成房屋，房屋上不能再放", () => {
    const b = emptyBoard("A");
    expect(push(b, "2,0", "B", "R")).toBeNull();
    expect(kindOf(b["2,0"]!.stack)).toBe("H");
    for (const c of ["W", "K", "B", "G", "Y", "R"] as Color[]) expect(stackError(b["2,0"], c)).not.toBeNull();
  });
  it("KK 上不能放 R（红只能压在单层上）", () => {
    const b = emptyBoard("A");
    push(b, "2,1", "K", "K");
    expect(stackError(b["2,1"], "R")).not.toBeNull();
  });
  it("BB 上不能再放 B、R，可以放 G 成高 3 的树", () => {
    const b = emptyBoard("A");
    push(b, "2,2", "B", "B");
    expect(stackError(b["2,2"], "B")).not.toBeNull();
    expect(stackError(b["2,2"], "R")).not.toBeNull();
    expect(push(b, "2,2", "G")).toBeNull();
    expect(kindOf(b["2,2"]!.stack)).toBe("T3");
  });
  it("水、田上面不能放任何东西", () => {
    const b = emptyBoard("A");
    push(b, "1,0", "W");
    push(b, "1,1", "Y");
    for (const c of ["W", "K", "B", "G", "Y", "R"] as Color[]) {
      expect(stackError(b["1,0"], c)).not.toBeNull();
      expect(stackError(b["1,1"], c)).not.toBeNull();
    }
  });
  it("绿上面不能放绿", () => {
    const b = emptyBoard("A");
    push(b, "1,2", "G");
    expect(stackError(b["1,2"], "G")).not.toBeNull();
  });
  it("R 上放 R 成房屋", () => {
    const b = emptyBoard("A");
    expect(push(b, "1,3", "R", "R")).toBeNull();
    expect(kindOf(b["1,3"]!.stack)).toBe("H");
  });
  it("有方块的格子不能再放", () => {
    const b = boardFrom("A", { "3,0": "K" }, { "3,0": "A21" });
    expect(stackError(b["3,0"], "K")).not.toBeNull();
  });
  it("通过 apply 放标记也按叠放规则拒绝", () => {
    const s = buildState({ players: [{ board: { "2,1": "KK" } }, {}], took: 0, hand: "R", central: ["", "WWW", "KKK", "YYY", "BBB"] });
    expect(() => run(s, "p1", { type: "placeToken", index: 0, cell: "2,1" })).toThrow();
    expect(() => run(s, "p1", { type: "placeToken", index: 0, cell: "9,9" })).toThrow();
  });
});

describe("规则书#TC2 / §6 例 1 完整计分", () => {
  it("树 11、山 4、田 10、房屋 5、水 8，地貌 38；动物 6；总分 44", () => {
    const board = boardFrom("A", EXAMPLE_1);
    const s = scorePlayer({ id: "p1", board, cards: [{ id: "A05", placed: 3 }, { id: "A12", placed: 0 }] }, "A");
    expect(s.landscape).toEqual({ trees: 11, mountains: 4, fields: 10, houses: 5, water: 8, total: 38 });
    expect(s.animals).toBe(6);
    expect(s.total).toBe(44);
  });
  it("(3,0) 的 BB 没有树冠不得分；单独的 R 不是房屋", () => {
    expect(landscapeScore(boardFrom("A", { "3,0": "BB" })).trees).toBe(0);
    expect(kindOf(["R"])).toBeNull();
    expect(landscapeScore(boardFrom("A", { "1,1": "R", "1,0": "W", "1,2": "Y", "0,1": "K" })).houses).toBe(0);
  });
});

describe("规则书#TC3 河流（A 面）", () => {
  it("7 个蓝标记但支流不增加长度：河长 5，水分 11", () => {
    const b = boardFrom("A", { "0,0": "W", "0,1": "W", "0,2": "W", "0,3": "W", "0,4": "W", "1,1": "W", "2,1": "W" });
    expect(riverLength(b, "A")).toBe(5);
    expect(landscapeScore(b).water).toBe(11);
  });
  it("斜着连成一条：河长 7，水分 19", () => {
    const b = boardFrom("A", { "0,0": "W", "1,0": "W", "2,1": "W", "3,1": "W", "4,2": "W", "4,3": "W", "4,4": "W" });
    expect(riverLength(b, "A")).toBe(7);
    expect(landscapeScore(b).water).toBe(19);
  });
  it("只有 1 个蓝标记：0 分；两片长 3 和 2：只算最长的 5 分", () => {
    expect(landscapeScore(boardFrom("A", { "2,2": "W" })).water).toBe(0);
    const b = boardFrom("A", { "0,0": "W", "0,1": "W", "0,2": "W", "4,3": "W", "4,4": "W" });
    expect(landscapeScore(b).water).toBe(5);
  });
  it("分数表：1=0, 2=2, 3=5, 4=8, 5=11, 6=15, 7=19, 8=23", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(riverPoints)).toEqual([0, 2, 5, 8, 11, 15, 19, 23]);
  });
  it("环形水取直径，不是格子数", () => {
    // (1,1) 周围一圈 6 格都是水：直径 3（对边之间隔着中心那格，绕圈也只要 4 步，最短路径 4 格）
    const ring = neighbors("A", "1,1");
    const layout = Object.fromEntries(ring.map((c) => [c, "W"]));
    const b = boardFrom("A", layout);
    expect(riverLength(b, "A")).toBe(4);
  });
});

describe("规则书#TC4 岛屿（B 面）", () => {
  it("B 面空版图：1 个岛，5 分", () => {
    expect(islandCount(emptyBoard("B"), "B")).toBe(1);
    expect(landscapeScore(emptyBoard("B"), "B").water).toBe(5);
  });
  it("第 1、3 列全是水：3 个岛，15 分（空格算陆地）", () => {
    const b = boardFrom("B", { "1,0": "W", "1,1": "W", "1,2": "W", "3,0": "W", "3,1": "W", "3,2": "W", "0,0": "Y", "5,1": "K" });
    expect(islandCount(b, "B")).toBe(3);
    expect(landscapeScore(b, "B").water).toBe(15);
  });
  it("整块版图都是水：0 个岛", () => {
    const layout: Record<string, string> = {};
    for (const cell of Object.keys(emptyBoard("B"))) layout[cell] = "W";
    expect(islandCount(boardFrom("B", layout), "B")).toBe(0);
  });
});

describe("规则书#TC5 房屋的颜色条件", () => {
  const base = { "2,2": "KR", "2,1": "W", "1,2": "W", "3,2": "Y" };
  it("只有 2 种颜色：0 分", () => {
    expect(landscapeScore(boardFrom("A", base)).houses).toBe(0);
  });
  it("(2,3) 放 K：3 种，5 分", () => {
    expect(landscapeScore(boardFrom("A", { ...base, "2,3": "K" })).houses).toBe(5);
  });
  it("(2,3) 放 BG：最上层是 G，3 种，5 分", () => {
    expect(landscapeScore(boardFrom("A", { ...base, "2,3": "BG" })).houses).toBe(5);
  });
  it("(2,1) 的 W 上放了方块：颜色不变，仍按 W 算", () => {
    expect(landscapeScore(boardFrom("A", { ...base, "2,3": "K" }, { "2,1": "A21" })).houses).toBe(5);
  });
  it("红色邻居也算一种颜色（6 色都算）", () => {
    expect(landscapeScore(boardFrom("A", { ...base, "2,3": "R" })).houses).toBe(5);
  });
});

describe("规则书#TC6 放方块：旋转、两次放置、目标格被占", () => {
  const s0 = buildState({
    players: [{ board: { "0,0": "Y", "1,0": "Y", "2,1": "BR", "4,0": "Y", "4,1": "Y", "4,2": "KR" }, cards: [["A08", 0]] }, {}],
  });
  it("右下方向的直线：合法，得 5", () => {
    const s1 = run(s0, "p1", { type: "placeCube", cardId: "A08", cell: "2,1" });
    expect(s1.players[0]!.cards[0]!.placed).toBe(1);
    expect(scorePlayer(s1.players[0]!, "A").animals).toBe(5);
    const s2 = run(s1, "p1", { type: "placeCube", cardId: "A08", cell: "4,2" });
    expect(s2.players[0]!.cards[0]!.placed).toBe(2);
    expect(scorePlayer(s2.players[0]!, "A").animals).toBe(10);
    expect(() => run(s2, "p1", { type: "placeCube", cardId: "A08", cell: "2,1" })).toThrow();
    expect(() => run(s2, "p1", { type: "placeCube", cardId: "A08", cell: "0,0" })).toThrow();
  });
});

describe("规则书#TC7 V 形图案的方向", () => {
  const ok = (layout: Record<string, string>) =>
    cubeTargets(buildState({ players: [{ board: { "2,2": "RR", ...layout }, cards: [["A09", 0]] }, {}] }), 0, "A09").includes("2,2");
  it("左下、右下：合法", () => expect(ok({ "1,2": "Y", "3,2": "Y" })).toBe(true));
  it("上、右下（隔一个方向）：合法", () => expect(ok({ "2,1": "Y", "3,2": "Y" })).toBe(true));
  it("上、下（正对着）：拒绝", () => expect(ok({ "2,1": "Y", "2,3": "Y" })).toBe(false));
  it("左下、右上：拒绝", () => expect(ok({ "1,2": "Y", "3,1": "Y" })).toBe(false));
});

describe("规则书#TC8 高度必须一致", () => {
  it("T3 → W → [W]：高 3 合法，高 2 拒绝", () => {
    const good = buildState({ players: [{ board: { "0,0": "BBG", "1,0": "W", "2,1": "W" }, cards: [["A01", 0]] }, {}] });
    expect(() => run(good, "p1", { type: "placeCube", cardId: "A01", cell: "2,1" })).not.toThrow();
    const bad = buildState({ players: [{ board: { "0,0": "BG", "1,0": "W", "2,1": "W" }, cards: [["A01", 0]] }, {}] });
    expect(() => run(bad, "p1", { type: "placeCube", cardId: "A01", cell: "2,1" })).toThrow();
  });
});

describe("规则书#TC9 三角图案的左右两种朝向", () => {
  const targets = (layout: Record<string, string>) =>
    cubeTargets(buildState({ players: [{ board: layout, cards: [["A02", 0]] }, {}] }), 0, "A02");
  it("水在右边：合法", () => expect(targets({ "2,2": "K", "2,3": "K", "3,2": "W" })).toContain("3,2"));
  it("水在左边：也合法", () => expect(targets({ "2,2": "K", "2,3": "K", "1,2": "W" })).toContain("1,2"));
  it("一座是高 2：拒绝", () => expect(targets({ "2,2": "KK", "2,3": "K", "3,2": "W" })).toEqual([]));
});

describe("规则书#TC10 卡数上限", () => {
  const four = buildState({
    players: [{ board: { "0,0": "G", "0,1": "W" }, cards: [["A05", 4], ["A06", 0], ["A07", 0], ["A08", 0]] }, {}],
    market: ["A09", "A10", "A11", "A12", "A13"],
  });
  it("4 张没完成的卡：不能领", () => {
    expect(() => run(four, "p1", { type: "takeCard", cardId: "A09" })).toThrow();
  });
  it("一张放完最后一个方块后，同一回合能领；再领一张拒绝", () => {
    const done = run(four, "p1", { type: "placeCube", cardId: "A05", cell: "0,1" });
    expect(done.players[0]!.cards[0]!.placed).toBe(5);
    const took = run(done, "p1", { type: "takeCard", cardId: "A09" });
    expect(took.players[0]!.cards.map((c) => c.id)).toContain("A09");
    expect(took.market).not.toContain("A09");
    expect(() => run(took, "p1", { type: "takeCard", cardId: "A10" })).toThrow();
  });
  it("变体：3 张动物卡 + 1 张没放方块的自然之灵卡，不能领", () => {
    const s = buildState({
      spirits: true,
      players: [{ cards: [["A06", 0], ["A07", 0], ["A08", 0], ["S01", 0]] }, { cards: [["S02", 0]] }],
      phase: "play",
    });
    expect(() => run(s, "p1", { type: "takeCard", cardId: s.market[0]! })).toThrow();
  });
});

/** 把 3 人局一回合一回合打下去：每回合拿第一个非空格，标记都放进空格，回合结束后可选地清空所有版图。 */
function playSimpleTurn(state: GameState): GameState {
  const player = state.players[state.currentPlayer]!;
  let s = state;
  const space = s.central.findIndex((t) => t.length > 0);
  s = apply(s, player.id, { type: "takeTokens", space }).state;
  while (s.turnState.hand.length > 0) {
    const board = s.players[s.currentPlayer]!.board;
    const cell = Object.keys(board).find((c) => board[c]!.stack.length === 0)!;
    s = apply(s, player.id, { type: "placeToken", index: 0, cell }).state;
  }
  return apply(s, player.id, { type: "endTurn" }).state;
}

describe("规则书#TC11 终局触发与打完一轮", () => {
  /** 版图只剩 n 个空格（只用田填，不影响别的）。 */
  const filled = (empties: number) => {
    const cells = Object.keys(emptyBoard("A"));
    return fill(cells.slice(0, cells.length - empties));
  };
  const three = (current: number, board: Record<string, string>) =>
    buildState({
      players: [0, 1, 2].map((i) => (i === current ? { board } : {})),
      first: 0,
      current,
      took: 0,
      hand: "",
      central: ["", "WWW", "KKK", "BBB", "GGG"],
    });
  it("P2 结束回合剩 2 个空格：触发，P3 再打一回合后结束，P1 不再行动", () => {
    let s = run(three(1, filled(2)), "p2", { type: "endTurn" });
    expect(s.endTriggered).toBe("board");
    expect(s.phase).toBe("play");
    expect(s.players[s.currentPlayer]!.id).toBe("p3");
    s = playSimpleTurn(s);
    expect(s.phase).toBe("finished");
    expect(s.finalResult?.reason).toBe("board");
  });
  it("P3（最后一个座位）结束回合剩 1 个空格：立刻结束", () => {
    const s = run(three(2, filled(1)), "p3", { type: "endTurn" });
    expect(s.phase).toBe("finished");
  });
  it("P1 结束回合剩 3 个空格：不触发", () => {
    const s = run(three(0, filled(3)), "p1", { type: "endTurn" });
    expect(s.endTriggered).toBeNull();
  });
  it("布袋：开局 105 个，第 35 回合补完最后 3 个不触发，第 36 回合补不了就触发并立刻结束（3 人）", () => {
    let s = createGame([{ id: "p1", name: "a" }, { id: "p2", name: "b" }, { id: "p3", name: "c" }], 99);
    expect(s.pouch.length).toBe(105);
    let turns = 0;
    while (s.phase !== "finished" && turns < 100) {
      s = playSimpleTurn(s);
      turns += 1;
      // 只测布袋：每回合后把版图清空，不让「空格 ≤ 2」先触发
      for (const p of s.players) p.board = emptyBoard("A");
      if (turns === 35) {
        expect(s.pouch.length).toBe(0);
        expect(s.endTriggered).toBeNull();
      }
    }
    expect(turns).toBe(36);
    expect(s.finalResult?.reason).toBe("pouch");
  });
});

describe("规则书#TC12 动物卡计分", () => {
  const animals = (id: string, placed: number) => scorePlayer({ id: "p", board: emptyBoard("A"), cards: [{ id, placed }] }, "A").animals;
  it("A05：0 → 0，3 → 6，5 → 15", () => {
    expect(animals("A05", 0)).toBe(0);
    expect(animals("A05", 3)).toBe(6);
    expect(animals("A05", 5)).toBe(15);
  });
  it("A13：1 → 8", () => expect(animals("A13", 1)).toBe(8));
});

describe("规则书#TC13 平分", () => {
  const score = (player: string, total: number, animalCubes: number) => ({ player, total, animalCubes }) as unknown as ScoreBreakdown;
  it("都是 102 分，P2 放了更多方块：P2 胜；方块也一样：并列", () => {
    expect(rankWinners([score("P1", 102, 9), score("P2", 102, 11)])).toEqual(["P2"]);
    expect(rankWinners([score("P1", 102, 11), score("P2", 102, 11)])).toEqual(["P1", "P2"]);
  });
  it("平分只数动物方块，不数自然之灵方块（待确认 3）", () => {
    const board = boardFrom("A", { "0,0": "Y", "1,0": "Y" }, { "0,0": "S02" });
    expect(scorePlayer({ id: "p", board, cards: [{ id: "S02", placed: 1 }] }, "A").animalCubes).toBe(0);
  });
  it("终局真的按分数 → 方块数排名", () => {
    const s = buildState({
      players: [
        { board: EXAMPLE_1, cards: [["A05", 3]], cubes: { "3,1": "A05", "2,2": "A05", "0,2": "A05" } },
        { board: EXAMPLE_1, cards: [["A05", 3]], cubes: { "3,1": "A05", "2,2": "A05", "0,2": "A05" } },
      ],
      finished: "board",
    });
    expect(s.finalResult?.winners).toEqual(["p1", "p2"]);
  });
});

describe("规则书#TC14 / §6 例 2 自然之灵计分", () => {
  it("S01：田 1、2、3 个各一片 → 另加 14；正常田分 10", () => {
    const b = boardFrom("A", { "0,0": "Y", "2,0": "Y", "2,1": "Y", "4,0": "Y", "4,1": "Y", "4,2": "Y" });
    expect(spiritPoints("S01", b)).toBe(14);
    expect(landscapeScore(b).fields).toBe(10);
  });
  it("S08：高 1（孤立）、高 2、高 3（相邻）→ 另加 7；正常山分 10", () => {
    const b = boardFrom("A", { "0,0": "K", "4,0": "KK", "4,1": "KKK" });
    expect(spiritPoints("S08", b)).toBe(7);
    expect(landscapeScore(b).mountains).toBe(10);
  });
  it("S10 方块没放：9 个蓝标记也是 0", () => {
    const layout: Record<string, string> = {};
    Object.keys(emptyBoard("A")).slice(0, 9).forEach((c) => (layout[c] = "W"));
    const s = scorePlayer({ id: "p", board: boardFrom("A", layout), cards: [{ id: "S10", placed: 0 }] }, "A");
    expect(s.spirit).toEqual({ id: "S10", placed: false, points: 0 });
    const placed = scorePlayer({ id: "p", board: boardFrom("A", layout), cards: [{ id: "S10", placed: 1 }] }, "A");
    expect(placed.spirit?.points).toBe(18);
  });
  it("自然之灵只看地貌本身：房屋不管周围颜色、BB 不算树（待确认 4）", () => {
    const b = boardFrom("A", { "0,0": "KR", "0,1": "BR", "4,4": "RR", "2,2": "BB", "2,0": "G" });
    expect(landscapeScore(b).houses).toBe(0);
    expect(spiritPoints("S05", b)).toBe(8); // {(0,0),(0,1)} 一片 + (4,4) 一片
    expect(spiritPoints("S06", b)).toBe(6);
    expect(spiritPoints("S04", b)).toBe(3); // 只有 (2,0) 一棵高 1 的树
  });
  it("其余几张：S02、S03、S07、S09", () => {
    const b = boardFrom("A", {
      "0,0": "Y", "0,1": "Y", "4,4": "Y",
      "1,0": "BG", "2,0": "BBG", "3,0": "G",
      "0,3": "KK", "4,0": "KKK", "4,1": "K",
      "2,2": "W", "2,3": "W", "1,3": "W",
    });
    expect(spiritPoints("S02", b)).toBe(10);
    expect(spiritPoints("S03", b)).toBe(8);
    expect(spiritPoints("S07", b)).toBe(8);
    expect(spiritPoints("S09", b)).toBe(7);
  });
});

describe("规则书§2 配件", () => {
  it("32 张动物卡（蓝 7、红 5、绿 8、灰 6、黄 6），方块位一共 96；10 张自然之灵", async () => {
    const { ANIMAL_CARDS, SPIRIT_CARDS } = await import("./cards.js");
    expect(ANIMAL_CARDS.length).toBe(32);
    const byColor = (c: string) => ANIMAL_CARDS.filter((card) => card.color === c).length;
    expect([byColor("blue"), byColor("red"), byColor("green"), byColor("gray"), byColor("yellow")]).toEqual([7, 5, 8, 6, 6]);
    expect(ANIMAL_CARDS.reduce((sum, card) => sum + card.scores.length, 0)).toBe(96);
    expect(SPIRIT_CARDS.length).toBe(10);
    for (const card of [...ANIMAL_CARDS, ...SPIRIT_CARDS]) expect(card.cells.filter((c) => c.target).length).toBe(1);
  });
  it("A 面 23 格、B 面 25 格；邻居表和规则书 2.3 一致", () => {
    expect(Object.keys(emptyBoard("A")).length).toBe(23);
    expect(Object.keys(emptyBoard("B")).length).toBe(25);
    // 偶数列 (2,2)：上 (2,1)、下 (2,3)、右上 (3,1)、右下 (3,2)、左上 (1,1)、左下 (1,2)
    expect(neighbors("A", "2,2").sort()).toEqual(["1,1", "1,2", "2,1", "2,3", "3,1", "3,2"]);
    // 奇数列 (1,1)：上 (1,0)、下 (1,2)、右上 (2,1)、右下 (2,2)、左上 (0,1)、左下 (0,2)
    expect(neighbors("A", "1,1").sort()).toEqual(["0,1", "0,2", "1,0", "1,2", "2,1", "2,2"]);
    expect(neighbors("A", "0,0").sort()).toEqual(["0,1", "1,0"]);
  });
  it("规则书 2.4 的一条：每张卡的目标格颜色和卡色一致", async () => {
    const { ANIMAL_CARDS } = await import("./cards.js");
    const color: Record<string, string[]> = { blue: ["W"], red: ["H"], green: ["G1", "T2", "T3"], gray: ["K1", "K2", "K3"], yellow: ["Y"] };
    for (const card of ANIMAL_CARDS) expect(color[card.color]).toContain(card.cells.find((c) => c.target)!.kind);
  });
});

describe("规则书§3 开局", () => {
  it("2–4 人：中央 5 格各 3 个、布袋 105、牌列 5 张、牌堆 27、版图全空、没有卡", () => {
    for (const n of [2, 3, 4]) {
      const s = createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `${i}` })), n * 17);
      expect(s.central.map((t) => t.length)).toEqual([3, 3, 3, 3, 3]);
      expect(s.pouch.length).toBe(105);
      expect(s.market.length).toBe(5);
      expect(s.deck.length).toBe(27);
      expect(s.first).toBeGreaterThanOrEqual(0);
      expect(s.first).toBeLessThan(n);
      expect(s.currentPlayer).toBe(s.first);
      for (const p of s.players) {
        expect(Object.values(p.board).every((c) => c.stack.length === 0)).toBe(true);
        expect(p.cards).toEqual([]);
      }
    }
  });
  it("B 面：所有人都是 25 格的版图", () => {
    const s = createGame([{ id: "a", name: "a" }, { id: "b", name: "b" }], 3, { side: "B" });
    for (const p of s.players) expect(Object.keys(p.board).length).toBe(25);
  });
  it("自然之灵：每人暗发 2 张，互不重复，先进入选卡阶段", () => {
    const s = createGame([{ id: "a", name: "a" }, { id: "b", name: "b" }, { id: "c", name: "c" }, { id: "d", name: "d" }], 5, { spirits: true });
    expect(s.phase).toBe("spirit");
    const all = s.players.flatMap((p) => p.spiritChoices ?? []);
    expect(all.length).toBe(8);
    expect(new Set(all).size).toBe(8);
  });
});

describe("规则书§4.1 拿标记并放好", () => {
  const s0 = buildState({ players: [{}, {}], central: ["BGK", "WWY", "KKR", "YGB", "WBR"] });
  it("拿走一整格，供应格空了；一回合只能拿一次；拿空格拒绝", () => {
    const s1 = run(s0, "p1", { type: "takeTokens", space: 0 });
    expect(s1.turnState.hand).toEqual(["B", "G", "K"]);
    expect(s1.central[0]).toEqual([]);
    expect(() => run(s1, "p1", { type: "takeTokens", space: 1 })).toThrow();
    const empty = buildState({ players: [{}, {}], central: ["", "WWY", "KKR", "YGB", "WBR"] });
    expect(() => run(empty, "p1", { type: "takeTokens", space: 0 })).toThrow();
  });
  it("按任意顺序放：G 叠在 B 上成高 2 的树；三个都放完才能结束回合", () => {
    let s = run(s0, "p1", { type: "takeTokens", space: 0 }, { type: "placeToken", index: 0, cell: "1,1" });
    expect(() => run(s, "p1", { type: "endTurn" })).toThrow();
    s = run(s, "p1", { type: "placeToken", index: 0, cell: "1,1" }, { type: "placeToken", index: 0, cell: "0,1" });
    expect(s.players[0]!.board["1,1"]!.stack).toEqual(["B", "G"]);
    expect(kindOf(s.players[0]!.board["1,1"]!.stack)).toBe("T2");
    expect(s.turnState.placed).toEqual(["1,1", "0,1"]);
    s = run(s, "p1", { type: "endTurn" });
    expect(s.players[s.currentPlayer]!.id).toBe("p2");
  });
  it("还没拿标记不能结束回合；不是自己的回合不能动", () => {
    expect(() => run(s0, "p1", { type: "endTurn" })).toThrow();
    expect(() => run(s0, "p2", { type: "takeTokens", space: 0 })).toThrow();
  });
  it("apply 不修改输入", () => {
    const before = JSON.stringify(s0);
    run(s0, "p1", { type: "takeTokens", space: 0 }, { type: "placeToken", index: 0, cell: "1,1" });
    expect(JSON.stringify(s0)).toBe(before);
  });
});

describe("规则书§4.2 领动物卡", () => {
  it("领卡在拿标记之前、之间、之后都行，领到的卡离开牌列，回合结束才补", () => {
    const s0 = buildState({ players: [{}, {}], central: ["BGK", "WWY", "KKR", "YGB", "WBR"], market: ["A18", "A05", "A26", "A09", "A13"], deck: ["A01", "A02"] });
    let s = run(s0, "p1", { type: "takeTokens", space: 0 }, { type: "placeToken", index: 0, cell: "1,1" }, { type: "takeCard", cardId: "A18" });
    expect(s.market).toEqual(["A05", "A26", "A09", "A13"]);
    expect(s.players[0]!.cards).toEqual([{ id: "A18", placed: 0 }]);
    s = run(s, "p1", { type: "placeToken", index: 0, cell: "1,1" }, { type: "placeToken", index: 0, cell: "0,1" }, { type: "endTurn" });
    expect(s.market).toEqual(["A05", "A26", "A09", "A13", "A01"]);
    expect(s.deck).toEqual(["A02"]);
  });
});

describe("规则书§4.3 放动物方块", () => {
  it("图案摆好再领卡，当回合就能放（§5-7）；图案被破坏后方块保留（§5-8）", () => {
    const s0 = buildState({
      players: [{ board: { "0,0": "K", "1,0": "W", "2,0": "K" } }, {}],
      central: ["RYY", "WWY", "KKR", "YGB", "WBR"],
      market: ["A22", "A26", "A21", "A09", "A13"],
    });
    let s = run(s0, "p1", { type: "takeTokens", space: 0 }, { type: "placeToken", index: 1, cell: "0,1" }, { type: "takeCard", cardId: "A26" });
    expect(cubeTargets(s, 0, "A26")).toEqual(["0,0"]);
    s = run(s, "p1", { type: "placeCube", cardId: "A26", cell: "0,0" });
    expect(s.players[0]!.board["0,0"]!.cube).toBe("A26");
    // 方块那一格不能再叠
    expect(() => run(s, "p1", { type: "placeToken", index: 0, cell: "0,0" })).toThrow();
    // 红压在 (2,0) 的山上成房屋，不影响已放的方块
    s = run(s, "p1", { type: "placeToken", index: 0, cell: "2,0" }, { type: "placeToken", index: 0, cell: "4,0" });
    expect(s.players[0]!.cards[0]!.placed).toBe(1);
  });
  it("同一个标记可以属于好几个图案，但一格只能有 1 个方块（§5-6）", () => {
    // (1,0) 是 G1，挨着 (0,0)、(2,0) 两块水：A05（G1 → [W]）能放两次
    const s0 = buildState({ players: [{ board: { "1,0": "G", "0,0": "W", "2,0": "W" }, cards: [["A05", 0], ["A04", 0]] }, {}] });
    let s = run(s0, "p1", { type: "placeCube", cardId: "A05", cell: "0,0" }, { type: "placeCube", cardId: "A05", cell: "2,0" });
    expect(s.players[0]!.cards[0]!.placed).toBe(2);
    expect(() => run(s, "p1", { type: "placeCube", cardId: "A05", cell: "0,0" })).toThrow();
    expect(pendingCubeCount(s)).toBe(0);
    s = buildState({ players: [{ board: { "1,0": "G", "0,0": "W", "2,0": "W" }, cards: [["A05", 0]] }, {}] });
    expect(pendingCubeCount(s)).toBe(2);
  });
  it("不在面前的卡不能放；放完的卡不能再放", () => {
    const s0 = buildState({ players: [{ board: { "1,0": "G", "0,0": "W", "2,0": "W" }, cards: [["A05", 5]] }, {}] });
    expect(() => run(s0, "p1", { type: "placeCube", cardId: "A05", cell: "0,0" })).toThrow();
    expect(() => run(s0, "p1", { type: "placeCube", cardId: "A04", cell: "0,0" })).toThrow();
  });
});

describe("规则书§4.4 回合结束", () => {
  it("从布袋补 3 个进被拿空的格子，布袋少 3 个", () => {
    const s0 = buildState({ players: [{}, {}], central: ["BGK", "WWY", "KKR", "YGB", "WBR"], pouch: "RRRWWW" });
    const s = run(s0, "p1", { type: "takeTokens", space: 2 }, { type: "placeToken", index: 0, cell: "0,0" }, { type: "placeToken", index: 0, cell: "0,1" }, { type: "placeToken", index: 0, cell: "0,2" }, { type: "endTurn" });
    expect(s.central[2]).toEqual(["R", "R", "R"]);
    expect(s.pouch).toEqual(["W", "W", "W"]);
  });
  it("牌堆空了就不补，牌列可以少于 5 张（§5-3）", () => {
    const s0 = buildState({ players: [{}, {}], market: ["A01", "A02"], deck: [], central: ["BGK", "WWY", "KKR", "YGB", "WBR"] });
    const s = run(s0, "p1", { type: "takeTokens", space: 0 }, { type: "takeCard", cardId: "A01" }, { type: "placeToken", index: 0, cell: "0,0" }, { type: "placeToken", index: 0, cell: "0,0" }, { type: "placeToken", index: 0, cell: "1,0" }, { type: "endTurn" });
    expect(s.market).toEqual(["A02"]);
  });
  it("布袋只剩 1–2 个：有几个放几个，下次再补不了才触发（§5-5）", () => {
    const s0 = buildState({ players: [{}, {}], central: ["BGK", "WWY", "KKR", "YGB", "WBR"], pouch: "RW" });
    let s = run(s0, "p1", { type: "takeTokens", space: 0 }, { type: "placeToken", index: 0, cell: "0,0" }, { type: "placeToken", index: 0, cell: "0,0" }, { type: "placeToken", index: 0, cell: "1,0" }, { type: "endTurn" });
    expect(s.central[0]!.length).toBe(2);
    expect(s.endTriggered).toBeNull();
    s = run(s, "p2", { type: "takeTokens", space: 1 }, { type: "placeToken", index: 0, cell: "0,0" }, { type: "placeToken", index: 0, cell: "0,1" }, { type: "placeToken", index: 0, cell: "0,2" }, { type: "endTurn" });
    expect(s.phase).toBe("finished");
    expect(s.finalResult?.reason).toBe("pouch");
  });
  it("两个终局条件同时满足只触发一次（§5-10）", () => {
    const cells = Object.keys(emptyBoard("A"));
    const layout = fill(cells.slice(0, 20));
    const s0 = buildState({ players: [{ board: layout }, {}], central: ["BGK", "WWY", "KKR", "YGB", "WBR"], pouch: "" });
    const empties = cells.slice(20);
    const s1 = apply(
      run(s0, "p1", { type: "takeTokens", space: 0 }, ...empties.map((cell) => ({ type: "placeToken", index: 0, cell }) as GameCommand)),
      "p1",
      { type: "endTurn" },
      scriptedRng(),
    );
    expect(s1.events.filter((e) => e.type === "EndTriggered").length).toBe(1);
    expect(s1.state.endTriggered).toBe("pouch");
  });
});

describe("规则书§4.5 / §9.3 隐藏信息", () => {
  const s = createGame([{ id: "a", name: "a" }, { id: "b", name: "b" }], 42, { spirits: true });
  it("布袋只给各色数量、牌堆只给张数、种子和动作序列都删掉", () => {
    for (const viewer of ["a", "b", ""]) {
      const v = redactGameForViewer(s, viewer);
      expect(v.pouch).toEqual([]);
      expect(v.deck).toEqual([]);
      expect(v.seed).toBeUndefined();
      expect(v.rngState).toBeUndefined();
      expect(v.log).toBeUndefined();
      expect(Object.values(v.pouchCounts!).reduce((x, y) => x + y, 0)).toBe(105);
      expect(v.deckCount).toBe(27);
    }
  });
  it("自然之灵：发到的两张只有本人看得到；选好的那张别人只知道「选好了」", () => {
    const a = redactGameForViewer(s, "a");
    expect(a.players[0]!.spiritChoices).toEqual(s.players[0]!.spiritChoices);
    expect(a.players[1]!.spiritChoices).toBeUndefined();
    const spectator = redactGameForViewer(s, "");
    expect(spectator.players.every((p) => p.spiritChoices === undefined)).toBe(true);
    const picked = run(s, "b", { type: "pickSpirit", cardId: s.players[1]!.spiritChoices![1]! });
    const seenByA = redactGameForViewer(picked, "a");
    expect(seenByA.players[1]!.spiritPick).toBe("?");
    expect(JSON.stringify(seenByA)).not.toContain(s.players[1]!.spiritChoices![1]!);
    expect(JSON.stringify(seenByA)).not.toContain(s.players[1]!.spiritChoices![0]!);
  });
  it("全部选完：选中的公开，没选中的谁也看不到", () => {
    const [a0, a1] = s.players[0]!.spiritChoices!;
    const [b0, b1] = s.players[1]!.spiritChoices!;
    const done = run(run(s, "a", { type: "pickSpirit", cardId: a0! }), "b", { type: "pickSpirit", cardId: b1! });
    expect(done.phase).toBe("play");
    const text = JSON.stringify(redactGameForViewer(done, ""));
    expect(text).toContain(a0!);
    expect(text).toContain(b1!);
    expect(text).not.toContain(`"${a1}"`);
    expect(text).not.toContain(`"${b0}"`);
    expect(JSON.stringify(done)).not.toContain(`"${a1}"`);
  });
  it("撤销栈不下发，只给步数", () => {
    const p = createGame([{ id: "a", name: "a" }, { id: "b", name: "b" }], 7);
    const first = p.players[p.currentPlayer]!.id;
    const t = run(p, first, { type: "takeTokens", space: 0 });
    const v = redactGameForViewer(t, first === "a" ? "b" : "a");
    expect(v.turnState.undo).toEqual([]);
    expect(v.turnState.undoCount).toBe(1);
  });
});

describe("规则书§7 胜负和§8 人数差异", () => {
  it("2、3、4 人规则一样：起始玩家的上家结束回合后才结束", () => {
    for (const n of [2, 3, 4]) {
      const cells = Object.keys(emptyBoard("A"));
      const layout = fill(cells.slice(0, 20));
      const players = Array.from({ length: n }, (_, i) => (i === 0 ? { board: layout } : {}));
      let s = buildState({ players, first: 0, central: ["BGK", "WWY", "KKR", "YGB", "WBR"] });
      s = playSimpleTurn(s);
      expect(s.endTriggered).toBe("board");
      for (let i = 1; i < n; i += 1) {
        expect(s.phase).toBe("play");
        s = playSimpleTurn(s);
      }
      expect(s.phase).toBe("finished");
    }
  });
  it("起始玩家不是 0 号时，最后一个座位是 first − 1", () => {
    const cells = Object.keys(emptyBoard("A"));
    const layout = fill(cells.slice(0, 20));
    let s = buildState({ players: [{}, { board: layout }, {}], first: 2, current: 1, central: ["BGK", "WWY", "KKR", "YGB", "WBR"] });
    s = playSimpleTurn(s);
    expect(s.phase).toBe("finished");
  });
  it("轮数：起始玩家每开始一次新回合，round + 1", () => {
    let s = buildState({ players: [{}, {}], first: 1, current: 1, central: ["BGK", "WWY", "KKR", "YGB", "WBR"] });
    s = playSimpleTurn(s);
    expect(s.round).toBe(1);
    s = playSimpleTurn(s);
    expect(s.round).toBe(2);
  });
});

describe("规则书§8 自然之灵变体", () => {
  it("所有人同时选；都选完进入正常回合；没选完不能拿标记", () => {
    const s = createGame([{ id: "a", name: "a" }, { id: "b", name: "b" }], 11, { spirits: true });
    const first = s.players[s.first]!.id;
    expect(() => run(s, first, { type: "takeTokens", space: 0 })).toThrow();
    expect(() => run(s, "a", { type: "pickSpirit", cardId: "S99" })).toThrow();
    const a = run(s, "a", { type: "pickSpirit", cardId: s.players[0]!.spiritChoices![0]! });
    expect(a.phase).toBe("spirit");
    const both = run(a, "b", { type: "pickSpirit", cardId: s.players[1]!.spiritChoices![0]! });
    expect(both.phase).toBe("play");
    expect(both.players.map((p) => p.cards.length)).toEqual([1, 1]);
    expect(both.turn).toBe(s.turn + 1);
  });
  it("自然之灵方块按图案放（算放方块的一次），放好后算完成，并另外加分", () => {
    // S07：K2 → [K3]
    const s0 = buildState({ spirits: true, players: [{ board: { "0,0": "KK", "1,0": "KKK" }, cards: [["S07", 0]] }, { cards: [["S01", 0]] }], phase: "play" });
    const s = run(s0, "p1", { type: "placeCube", cardId: "S07", cell: "1,0" });
    expect(s.players[0]!.board["1,0"]!.cube).toBe("S07");
    const score = scorePlayer(s.players[0]!, "A");
    expect(score.spirit).toEqual({ id: "S07", placed: true, points: 8 });
    expect(score.total).toBe(score.landscape.total + 8);
  });
});

describe("规则书§9.4 超时默认动作", () => {
  it("没拿就拿第一个非空格；标记放在地貌分增加最多的格（并列取坐标最小）；不领卡；能放的方块都放；结束回合", () => {
    const s0 = buildState({
      players: [{ board: { "0,0": "K", "4,4": "G" }, cards: [["A05", 0]] }, {}],
      central: ["", "KWW", "BGK", "YGB", "WBR"],
      market: ["A01", "A02", "A03", "A04", "A06"],
    });
    const s = timeoutTurn(s0);
    expect(s.players[s.currentPlayer]!.id).toBe("p2");
    const board = s.players[0]!.board;
    // K 叠到 (0,0) 不加分，放 (0,1) 和 (0,0) 相邻：两座山都得分 → +2，最优
    expect(board["0,1"]!.stack).toEqual(["K"]);
    expect(s.players[0]!.cards.length).toBe(1);
    // 两个 W：第一个放在地貌分最高的地方（形成河），第二个接上
    const waterCells = Object.keys(board).filter((c) => board[c]!.stack[0] === "W");
    expect(waterCells.length).toBe(2);
    // A05 的方块：G1 挨着水才能放；放了的话 placed ≥ 1
    const adjacentWater = waterCells.some((c) => neighbors("A", "4,4").includes(c));
    expect(s.players[0]!.cards[0]!.placed > 0).toBe(adjacentWater);
    expect(s.events[0]).toEqual({ type: "TurnTimedOut", player: "p1" });
    expect(s.lastTurn?.timedOut).toBe(true);
  });
  it("自然之灵选卡超时：替没选的人选第一张", () => {
    const s = createGame([{ id: "a", name: "a" }, { id: "b", name: "b" }], 11, { spirits: true });
    const picked = run(s, "a", { type: "pickSpirit", cardId: s.players[0]!.spiritChoices![1]! });
    const t = timeoutTurn(picked);
    expect(t.phase).toBe("play");
    expect(t.players[0]!.cards[0]!.id).toBe(s.players[0]!.spiritChoices![1]);
    expect(t.players[1]!.cards[0]!.id).toBe(s.players[1]!.spiritChoices![0]);
  });
  it("拿了一半的回合超时：接着把剩下的放完", () => {
    const s0 = buildState({ players: [{}, {}], took: 0, hand: "BG", central: ["", "WWY", "KKR", "YGB", "WBR"] });
    const s = timeoutTurn(s0);
    expect(s.currentPlayer).toBe(1);
    expect(Object.values(s.players[0]!.board).reduce((n, c) => n + c.stack.length, 0)).toBe(2);
  });
});

describe("规则书§9.6 同一回合内可以逐步撤销", () => {
  it("拿标记、放标记、领卡、放方块都能一步步撤销，回到回合开始的样子", () => {
    const s0 = buildState({
      players: [{ board: { "1,0": "G" }, cards: [] }, {}],
      central: ["WBK", "WWY", "KKR", "YGB", "WBR"],
      market: ["A05", "A26", "A09", "A13", "A18"],
    });
    const steps: GameCommand[] = [
      { type: "takeTokens", space: 0 },
      { type: "placeToken", index: 0, cell: "0,0" },
      { type: "takeCard", cardId: "A05" },
      { type: "placeCube", cardId: "A05", cell: "0,0" },
    ];
    const s = run(s0, "p1", ...steps);
    expect(s.turnState.undoCount).toBe(4);
    let u = s;
    for (let i = 0; i < 4; i += 1) u = run(u, "p1", { type: "undo" });
    expect(u.players[0]!.board).toEqual(s0.players[0]!.board);
    expect(u.players[0]!.cards).toEqual([]);
    expect(u.central).toEqual(s0.central);
    expect(u.market).toEqual(s0.market);
    expect(u.turnState.took).toBeNull();
    expect(u.players[0]!.score).toBe(s0.players[0]!.score);
    expect(() => run(u, "p1", { type: "undo" })).toThrow();
  });
  it("结束回合后不能撤销上一回合", () => {
    const s0 = buildState({ players: [{}, {}], central: ["BGK", "WWY", "KKR", "YGB", "WBR"] });
    const s = playSimpleTurn(s0);
    expect(s.turnState.undoCount).toBe(0);
    expect(() => run(s, "p2", { type: "undo" })).toThrow();
  });
});

describe("合法行动列表", () => {
  it("开局只有拿标记和领卡；拿了以后有放标记；放完才有结束回合", () => {
    const s0 = buildState({ players: [{}, {}], central: ["BGK", "WWY", "KKR", "YGB", "WBR"] });
    const types = (s: GameState) => new Set(legalActions(s, "p1").map((a) => a.type));
    expect(types(s0)).toEqual(new Set(["takeTokens", "takeCard"]));
    const s1 = run(s0, "p1", { type: "takeTokens", space: 0 });
    expect(types(s1).has("placeToken")).toBe(true);
    expect(types(s1).has("endTurn")).toBe(false);
    expect(legalActions(s1, "p2")).toEqual([]);
  });
});
