// 本地测试用的陪玩机器人（先 npm run dev）。
//   node scripts/test-bot.mjs host [人数] [机器人数]  → 机器人建房、拉够机器人，等真人加入凑满后自动开局
//   node scripts/test-bot.mjs join <房间码> [昵称]   → 以一个机器人身份加入别人的房间
// 机器人轮到自己时随机选一个合法行动（直接调 @harmonies/game 的 legalActions，不撤销、多半先放完再结束）；BOT_SMART=1 时用人机的走法。
// 环境变量 BOT_DELAY_MS 控制每步的思考时间（默认 1500），BOT_IDLE=1 时只挂着不动（等超时自动行动）。
// BOT_STAY=1：一局结束后不退出，自动同意「再来一局」（测再来一局用）。
// 建房时的变体：HM_SIDE=B（个人版图 B 面）、HM_SPIRITS=1（自然之灵）。
import { io } from "socket.io-client";
import { botCommand, legalActions } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? `http://localhost:${process.env.SERVER_PORT ?? 3023}`;
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 1500);
const IDLE = process.env.BOT_IDLE === "1";
const SMART = process.env.BOT_SMART === "1";
const STAY = process.env.BOT_STAY === "1";
const NAMES = ["小溪", "松林", "麦田", "山岗", "村舍", "湖畔", "石桥"];
const OPTIONS = { side: process.env.HM_SIDE === "B" ? "B" : "A", spirits: process.env.HM_SPIRITS === "1" };

function bot(name, onRoom) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  let acting = false;
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  let latest = null;
  // 每次收到更新、每次行动的回执之后都按最新状态再看一遍（连续两步都是自己时不会漏掉）
  const tick = async () => {
    const room = latest;
    const game = room?.game;
    if (!room || IDLE || !game || game.phase === "finished" || acting) return;
    const seat = room.members.find((member) => member.id === socket.id)?.playerId;
    if (!seat || legalActions(game, seat).length === 0) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, DELAY));
    try {
      const fresh = latest.game;
      if (fresh.version !== game.version) return;
      let actions = legalActions(fresh, seat).filter((action) => action.type !== "undo");
      if (actions.length === 0) return;
      if (actions.some((action) => action.type !== "endTurn") && Math.random() < 0.85) actions = actions.filter((action) => action.type !== "endTurn");
      const command = SMART ? botCommand(fresh, seat) : actions[Math.floor(Math.random() * actions.length)];
      const result = await emit("game:command", command);
      if (!result.ok) console.log(name, "行动失败", result.error);
      else latest = result.data;
    } finally {
      acting = false;
      void tick();
    }
  };
  socket.on("room:updated", (room) => {
    latest = room;
    onRoom?.(room, socket);
    const game = room.game;
    if (game?.phase === "finished") {
      const scores = game.finalResult?.scores.map((s) => `${s.player.slice(0, 2)}:${s.total}`).join(" ") ?? "";
      console.log(name, "游戏结束，得分", scores);
      if (STAY) {
        if (room.rematch && !room.rematch.acceptedIds.includes(socket.id)) void emit("room:rematch", true);
        return;
      }
      setTimeout(() => process.exit(0), 200);
      return;
    }
    void tick();
  });
  socket.on("room:closed", ({ reason }) => { console.log(name, "房间关闭：", reason); process.exit(0); });
  return { socket, emit };
}

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === "join") {
  const { socket, emit } = bot(arg2 ?? NAMES[0]);
  socket.on("connect", async () => console.log("join", (await emit("room:join", { name: arg2 ?? NAMES[0], code: arg1 })).ok));
} else {
  const capacity = Number(arg1 ?? 2);
  const bots = Number(arg2 ?? capacity - 1);
  let started = false;
  const host = bot(NAMES[0], async (room, socket) => {
    if (!started && room.status === "waiting" && room.members.length === capacity) {
      started = true;
      const result = await host.emit("room:start");
      console.log("开局", result.ok || result.error);
    }
    void socket;
  });
  host.socket.on("connect", async () => {
    const created = await host.emit("room:create", { name: NAMES[0], capacity, options: OPTIONS });
    if (!created.ok) { console.log(created.error); process.exit(1); }
    console.log("房间码", created.data.code);
    for (let index = 1; index < bots; index += 1) {
      const name = NAMES[index];
      const other = bot(name);
      other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: created.data.code })).ok));
    }
  });
}
