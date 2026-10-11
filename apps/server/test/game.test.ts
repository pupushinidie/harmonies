import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  buildState,
  legalActions,
  type AckResponse,
  type ClientToServerEvents,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
  type ServerToClientEvents,
} from "@harmonies/game";

// 每回合 1.5 秒超时、人机立刻行动（服务端在导入时读）
process.env.TURN_MS = "1500";
process.env.BOT_DELAY_SCALE = "0";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
/** 每个客户端收到的每一条 room:updated 原文（抓包用）。 */
const wire = new Map<TestSocket, string[]>();
let serverUrl = "";
let server: typeof import("../src/index.js");
let seq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    wire.set(client, []);
    client.on("room:updated", (room) => {
      latest.set(client, room);
      wire.get(client)!.push(JSON.stringify(room));
    });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

const nick = (p: string) => `${p}${(seq += 1)}`;
function call<T>(send: (ack: (r: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}
function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, ms = 8000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) return resolve(current);
    const timer = setTimeout(() => reject(new Error("等不到这次更新")), ms);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}
const seat = (c: TestSocket) => latest.get(c)?.members.find((m) => m.id === c.id)?.playerId ?? "";
const command = (c: TestSocket, cmd: GameCommand) => call<LobbyRoomSnapshot>((ack) => c.emit("game:command", cmd, ack));

async function room2(options: Record<string, unknown> = {}) {
  const a = await connect();
  const b = await connect();
  const nameA = nick("甲");
  const created = await call<LobbyRoomSnapshot>((ack) => a.emit("room:create", { name: nameA, capacity: 2, options } as never, ack));
  if (!created.ok) throw new Error(created.error);
  const code = created.data.code;
  expect((await call<LobbyRoomSnapshot>((ack) => b.emit("room:join", { name: nick("乙"), code }, ack))).ok).toBe(true);
  return { a, b, code, nameA };
}

/** 真人按「拿第一格 → 放到第一个合法格 → 结束」走一步。 */
function simpleMove(game: GameState, me: string): GameCommand | null {
  const actions = legalActions(game, me);
  return actions.find((x) => x.type === "pickSpirit") ?? actions.find((x) => x.type === "placeToken") ?? actions.find((x) => x.type === "endTurn") ?? actions.find((x) => x.type === "takeTokens") ?? null;
}

async function playToEnd(players: TestSocket[]): Promise<LobbyRoomSnapshot> {
  for (let guard = 0; guard < 600; guard += 1) {
    const snap = latest.get(players[0]!)!;
    if (snap.game?.phase === "finished") return snap;
    const mover = players.find((c) => legalActions(latest.get(c)!.game!, seat(c)).length > 0);
    if (!mover) {
      await new Promise((r) => setTimeout(r, 10));
      continue;
    }
    const version = latest.get(mover)!.game!.version;
    const move = simpleMove(latest.get(mover)!.game!, seat(mover));
    if (!move) continue;
    const r = await command(mover, move);
    if (!r.ok) throw new Error(r.error);
    const target = r.data.game!.version;
    for (const c of players) await updateWhere(c, (s) => (s.game?.version ?? 0) >= target || s.game?.phase === "finished");
    void version;
  }
  throw new Error("600 步没打完");
}

describe("房间流程和对局", () => {
  beforeAll(async () => {
    server = await import("../src/index.js");
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", () => resolve()));
    serverUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    for (const c of clients) c.disconnect();
    server.io.close();
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  });

  it("建房 → 加入 → 开局（B 面 + 自然之灵）→ 同时选卡 → 打到终局 → 再来一局", async () => {
    const { a, b } = await room2({ side: "B", spirits: true });
    expect((await call<LobbyRoomSnapshot>((ack) => a.emit("room:start", ack))).ok).toBe(true);
    const started = await updateWhere(b, (s) => s.game !== undefined);
    expect(started.game!.config.side).toBe("B");
    expect(started.game!.phase).toBe("spirit");
    expect(Object.keys(started.game!.players[0]!.board).length).toBe(25);
    const finished = await playToEnd([a, b]);
    expect(finished.game!.finalResult!.scores.length).toBe(2);
    expect(finished.rematch).toBeDefined();
    expect((await call<void>((ack) => a.emit("room:rematch", true, ack))).ok).toBe(true);
    expect((await call<void>((ack) => b.emit("room:rematch", true, ack))).ok).toBe(true);
    const again = await updateWhere(a, (s) => s.game?.phase === "spirit" && s.game.version <= 2);
    expect(again.game!.players.every((p) => p.cards.length === 0)).toBe(true);
  }, 30_000);

  it("每种行动走一遍：拿标记、放标记、领卡、放方块、撤销、结束回合；同一回合里的操作不重置倒计时", async () => {
    const { a, b, code } = await room2();
    expect((await call<LobbyRoomSnapshot>((ack) => a.emit("room:start", ack))).ok).toBe(true);
    await updateWhere(a, (s) => s.game !== undefined);
    const [pa, pb] = [seat(a), seat(b)];
    // 固定局面：甲的版图上 (1,0) 是高 1 的树；牌列里有河狸 A05（G1 → [W]）
    server.testHooks.setGame(
      code,
      buildState({
        players: [{ id: pa, name: "甲", board: { "1,0": "G" } }, { id: pb, name: "乙" }],
        central: ["WBK", "WWY", "KKR", "YGB", "WBR"],
        market: ["A05", "A26", "A09", "A13", "A18"],
        pouch: "RRRWWWKKK",
        seed: 5,
      }),
    );
    const s0 = await updateWhere(a, (s) => s.game!.market[0] === "A05" && s.game!.turnState.took === null && s.game!.players[0]!.board["1,0"]!.stack[0] === "G");
    const remaining0 = s0.turnRemainingMs!;
    expect((await command(a, { type: "takeTokens", space: 0 })).ok).toBe(true);
    expect((await command(b, { type: "takeTokens", space: 1 })).ok).toBe(false);
    expect((await command(a, { type: "placeToken", index: 0, cell: "0,0" })).ok).toBe(true);
    expect((await command(a, { type: "takeCard", cardId: "A05" })).ok).toBe(true);
    const cube = await command(a, { type: "placeCube", cardId: "A05", cell: "0,0" });
    expect(cube.ok).toBe(true);
    if (cube.ok) {
      expect(cube.data.game!.players[0]!.board["0,0"]!.cube).toBe("A05");
      expect(cube.data.turnRemainingMs!).toBeLessThanOrEqual(remaining0);
      expect(cube.data.game!.turnState.undoCount).toBe(4);
      expect(cube.data.game!.turnState.undo).toEqual([]);
    }
    const undone = await command(a, { type: "undo" });
    expect(undone.ok && undone.data.game!.players[0]!.board["0,0"]!.cube).toBe(null);
    expect((await command(a, { type: "placeCube", cardId: "A05", cell: "0,0" })).ok).toBe(true);
    expect((await command(a, { type: "endTurn" })).ok).toBe(false); // 手里还有标记
    expect((await command(a, { type: "placeToken", index: 0, cell: "2,0" })).ok).toBe(true);
    expect((await command(a, { type: "placeToken", index: 0, cell: "3,0" })).ok).toBe(true);
    const ended = await command(a, { type: "endTurn" });
    expect(ended.ok).toBe(true);
    if (ended.ok) {
      expect(ended.data.game!.players[ended.data.game!.currentPlayer]!.id).toBe(pb);
      expect(ended.data.game!.central[0]).toEqual(expect.any(Array));
      expect(ended.data.game!.central[0]!.length).toBe(3);
      expect(ended.data.game!.market.length).toBe(5);
    }
    const seenByB = await updateWhere(b, (s) => s.game!.players[s.game!.currentPlayer]!.id === pb);
    expect(seenByB.game!.lastTurn).toMatchObject({ player: pa, space: 0, card: "A05", cubes: ["0,0"] });
  }, 20_000);

  it("超时：没动的人这回合由默认动作做完，换人；断线后用原昵称回到原座位", async () => {
    const { a, b, code, nameA } = await room2();
    expect((await call<LobbyRoomSnapshot>((ack) => a.emit("room:start", ack))).ok).toBe(true);
    const s = await updateWhere(a, (x) => x.game !== undefined);
    const first = s.game!.players[s.game!.currentPlayer]!.id;
    const timed = await updateWhere(a, (x) => x.game!.events.some((e) => e.type === "TurnTimedOut" && e.player === first), 6000);
    expect(timed.game!.players[timed.game!.currentPlayer]!.id).not.toBe(first);
    expect(timed.game!.lastTurn).toMatchObject({ player: first, timedOut: true });
    const placedTokens = Object.values(timed.game!.players.find((p) => p.id === first)!.board).reduce((n, c) => n + c.stack.length, 0);
    expect(placedTokens).toBe(3);

    const seatA = seat(a);
    a.disconnect();
    await updateWhere(b, (x) => x.members.find((m) => m.playerId === seatA)?.connected === false);
    const back = await connect();
    const rejoined = await call<LobbyRoomSnapshot>((ack) => back.emit("room:join", { name: nameA, code }, ack));
    expect(rejoined.ok && rejoined.data.members.find((m) => m.id === back.id)).toMatchObject({ playerId: seatA, connected: true });
    expect(rejoined.ok && rejoined.data.game).toBeDefined();
  }, 20_000);

  it("自然之灵选卡超时：替没选的人选第一张，进入正常回合", async () => {
    const { a } = await room2({ spirits: true });
    expect((await call<LobbyRoomSnapshot>((ack) => a.emit("room:start", ack))).ok).toBe(true);
    const s = await updateWhere(a, (x) => x.game?.phase === "spirit");
    const mine = s.game!.players.find((p) => p.id === seat(a))!.spiritChoices!;
    expect(mine.length).toBe(2);
    const played = await updateWhere(a, (x) => x.game?.phase === "play", 6000);
    expect(played.game!.players.find((p) => p.id === seat(a))!.cards[0]!.id).toBe(mine[0]);
  }, 15_000);

  it("抓包：乙收到的每一条更新里都没有布袋顺序、牌堆顺序、种子，也没有甲的自然之灵", async () => {
    const { a, b } = await room2({ spirits: true });
    expect((await call<LobbyRoomSnapshot>((ack) => a.emit("room:start", ack))).ok).toBe(true);
    const sa = await updateWhere(a, (x) => x.game?.phase === "spirit");
    const aChoices = sa.game!.players.find((p) => p.id === seat(a))!.spiritChoices!;
    const bChoices = (await updateWhere(b, (x) => x.game?.phase === "spirit")).game!.players.find((p) => p.id === seat(b))!.spiritChoices!;
    // 甲先选第二张，乙收到「甲选好了」但看不到是哪张
    expect((await command(a, { type: "pickSpirit", cardId: aChoices[1]! })).ok).toBe(true);
    await updateWhere(b, (x) => x.game!.players.find((p) => p.id === seat(a))!.spiritPick === "?");
    for (const text of wire.get(b)!) {
      expect(text).not.toContain(`"${aChoices[0]}"`);
      expect(text).not.toContain(`"${aChoices[1]}"`);
      expect(text).not.toMatch(/"seed"|"rngState"|"log"/);
      expect(text).not.toMatch(/"pouch":\["/);
      expect(text).not.toMatch(/"deck":\["/);
      expect(text).not.toMatch(/"undo":\[\{/);
    }
    // 乙选完：甲选中的那张公开，甲没选的那张永远看不到
    expect((await command(b, { type: "pickSpirit", cardId: bChoices[0]! })).ok).toBe(true);
    const revealed = await updateWhere(b, (x) => x.game?.phase === "play");
    expect(revealed.game!.players.find((p) => p.id === seat(a))!.cards[0]!.id).toBe(aChoices[1]);
    // 打几步，再查一遍所有的包
    const game = revealed.game!;
    const mover = game.players[game.currentPlayer]!.id === seat(a) ? a : b;
    expect((await command(mover, { type: "takeTokens", space: 0 })).ok).toBe(true);
    const other = mover === a ? b : a;
    await updateWhere(other, (x) => x.game!.turnState.took === 0);
    for (const client of [a, b]) {
      for (const text of wire.get(client)!) {
        expect(text).not.toMatch(/"seed"|"rngState"|"log"/);
        expect(text).not.toMatch(/"pouch":\["/);
        expect(text).not.toMatch(/"deck":\["/);
        expect(text).not.toMatch(/"undo":\[\{/);
      }
    }
    for (const text of wire.get(b)!) expect(text).not.toContain(`"${aChoices[0]}"`);
    for (const text of wire.get(a)!) expect(text).not.toContain(`"${bChoices[1]}"`);
  }, 15_000);
});
