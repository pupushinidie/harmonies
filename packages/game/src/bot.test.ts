import { describe, expect, it } from "vitest";
import {
  apply,
  botAdvice,
  botCommand,
  buildState,
  createGame,
  kindOf,
  legalActions,
  redactGameForViewer,
  type GameCommand,
  type GameState,
} from "./index.js";

const view = (s: GameState, id = "p1") => redactGameForViewer(s, id);
const same = (x: GameCommand | null, y: GameCommand | null) => JSON.stringify(x) === JSON.stringify(y);

describe("人机只用自己看得到的信息", () => {
  it("输入是 redact 之后的状态：布袋、牌堆清空了也能正常给出一步", () => {
    const s = createGame([{ id: "a", name: "a" }, { id: "b", name: "b" }], 3);
    const id = s.players[s.currentPlayer]!.id;
    const v = view(s, id);
    expect(v.pouch).toEqual([]);
    expect(v.deck).toEqual([]);
    expect(botCommand(v, id)).not.toBeNull();
  });
  it("布袋顺序、牌堆顺序、别人的自然之灵不同，人机的选择完全一样", () => {
    const base = createGame([{ id: "a", name: "a" }, { id: "b", name: "b" }], 21, { spirits: true });
    const other: GameState = structuredClone(base);
    other.pouch.reverse();
    other.deck.reverse();
    const bIndex = 1;
    other.players[bIndex]!.spiritChoices = ["S09", "S06"].filter((x) => !base.players[0]!.spiritChoices!.includes(x));
    expect(same(botCommand(view(base, "a"), "a"), botCommand(view(other, "a"), "a"))).toBe(true);
    // 选完自然之灵、拿完标记以后也一样
    let s1 = base;
    let s2 = other;
    for (const p of base.players) {
      s1 = apply(s1, p.id, { type: "pickSpirit", cardId: s1.players.find((x) => x.id === p.id)!.spiritChoices![0]! }).state;
      s2 = apply(s2, p.id, { type: "pickSpirit", cardId: s2.players.find((x) => x.id === p.id)!.spiritChoices![0]! }).state;
    }
    const id = s1.players[s1.currentPlayer]!.id;
    for (let step = 0; step < 4; step += 1) {
      const c1 = botCommand(view(s1, id), id)!;
      const c2 = botCommand(view(s2, id), id)!;
      expect(c1).toEqual(c2);
      if (c1.type === "endTurn") break;
      s1 = apply(s1, id, c1).state;
      s2 = apply(s2, id, c2).state;
    }
  });
  it("不是自己的回合返回 null", () => {
    const s = buildState({ players: [{}, {}], current: 1 });
    expect(botCommand(view(s), "p1")).toBeNull();
  });
});

describe("人机的关键决策", () => {
  it("挑凹槽：能把山叠成高 3 的那一格（山山山）比零散的好", () => {
    const s = buildState({
      players: [{ board: { "0,0": "KK", "0,1": "K", "2,2": "BB" }, cards: [["A01", 0]] }, {}],
      central: ["WYR", "KKK", "YWR", "RWY", "WRY"],
      tookCard: "A01",
    });
    const c = botCommand(view(s), "p1");
    expect(c).toEqual({ type: "takeTokens", space: 1 });
  });
  it("放标记：树冠放到两层树干上成高 3 的树（7 分）", () => {
    const s = buildState({ players: [{ board: { "2,2": "BB", "4,4": "B" } }, {}], took: 0, hand: "G", central: ["", "WWW", "KKK", "YYY", "RRR"] });
    const c = botCommand(view(s), "p1");
    expect(c).toEqual({ type: "placeToken", index: 0, cell: "2,2" });
    const after = apply(s, "p1", c!).state;
    expect(kindOf(after.players[0]!.board["2,2"]!.stack)).toBe("T3");
  });
  it("标记放完、图案摆好了：先放方块再结束回合", () => {
    const s = buildState({ players: [{ board: { "1,0": "G", "0,0": "W" }, cards: [["A05", 0]] }, {}], took: 0, hand: "", central: ["", "WWW", "KKK", "YYY", "RRR"] });
    const advice = botAdvice(view(s), "p1")!;
    expect(advice.command).toEqual({ type: "placeCube", cardId: "A05", cell: "0,0" });
    expect(advice.reason).toContain("河狸");
  });
  it("面前已经 4 张没完成的卡：不领卡", () => {
    const s = buildState({ players: [{ cards: [["A01", 0], ["A02", 0], ["A03", 0], ["A04", 0]] }, {}], central: ["BGK", "WWY", "KKR", "YGB", "WBR"] });
    expect(botCommand(view(s), "p1")!.type).toBe("takeTokens");
  });
  it("开局手上没卡：先领一张", () => {
    const s = buildState({ players: [{}, {}], central: ["BGK", "WWY", "KKR", "YGB", "WBR"], market: ["A18", "A05", "A26", "A09", "A13"] });
    expect(botCommand(view(s), "p1")!.type).toBe("takeCard");
  });
  it("已经触发终局（最后一回合）：不领摆不出来的新卡", () => {
    const s = buildState({ players: [{}, {}], central: ["BGK", "WWY", "KKR", "YGB", "WBR"], market: ["A12", "A13", "A14", "A19", "A20"], endTriggered: "board" });
    expect(botCommand(view(s), "p1")!.type).toBe("takeTokens");
  });
  it("自然之灵：从发到的两张里按经验挑", () => {
    const s = buildState({ spirits: true, phase: "spirit", players: [{ spiritChoices: ["S06", "S02"] }, { spiritChoices: ["S01", "S07"] }] });
    expect(botCommand(view(s), "p1")).toEqual({ type: "pickSpirit", cardId: "S02" });
  });
});

describe("人机自对弈（每一步合法、都有理由；完整 300 局在 sim/sim-harmonies.ts）", () => {
  for (const n of [2, 3, 4]) {
    it(`${n} 人 3 局：步步合法，最多 600 步内结束`, () => {
      for (let g = 0; g < 3; g += 1) {
        let s = createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `${i}` })), 400 + g * 11 + n, { side: g % 2 ? "B" : "A", spirits: g % 3 === 0 });
        let steps = 0;
        while (s.phase !== "finished") {
          steps += 1;
          expect(steps).toBeLessThan(600);
          const actor = s.phase === "spirit" ? s.players.find((p) => !p.spiritPick)!.id : s.players[s.currentPlayer]!.id;
          const advice = botAdvice(view(s, actor), actor)!;
          expect(advice.reason.length).toBeGreaterThan(4);
          const legal = legalActions(s, actor);
          expect(legal.some((a) => same(a, advice.command))).toBe(true);
          s = apply(s, actor, advice.command).state;
        }
      }
    }, 60_000);
  }
});
