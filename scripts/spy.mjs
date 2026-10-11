// 抓包脚本：连上真实服务器（先起服务），甲建房、乙加入（开自然之灵），记录乙收到的每一条 room:updated，
// 检查里面没有甲发到的自然之灵、布袋顺序、牌堆顺序、种子、撤销栈。用法：node scripts/spy.mjs [轮数]
import { io } from "socket.io-client";
import { legalActions } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? `http://localhost:${process.env.SERVER_PORT ?? 3023}`;
const TURNS = Number(process.argv[2] ?? 6);
const connect = () => new Promise((resolve) => { const s = io(URL, { transports: ["websocket"] }); s.on("connect", () => resolve(s)); });
const emit = (s, event, ...args) => new Promise((resolve) => s.emit(event, ...args, resolve));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const a = await connect();
const b = await connect();
const packets = { a: [], b: [] };
let latestA, latestB;
a.on("room:updated", (room) => { latestA = room; packets.a.push(JSON.stringify(room)); });
b.on("room:updated", (room) => { latestB = room; packets.b.push(JSON.stringify(room)); });
const created = await emit(a, "room:create", { name: "间谍甲", capacity: 2, options: { spirits: true } });
await emit(b, "room:join", { name: "间谍乙", code: created.data.code });
await emit(a, "room:start");
await wait(200);
const seatOf = (room, s) => room.members.find((m) => m.id === s.id).playerId;
const aSeat = seatOf(latestA, a);
const aChoices = latestA.game.players.find((p) => p.id === aSeat).spiritChoices;
const bSeat = seatOf(latestB, b);
const bChoices = latestB.game.players.find((p) => p.id === bSeat).spiritChoices;
await emit(a, "game:command", { type: "pickSpirit", cardId: aChoices[1] });
await wait(100);
await emit(b, "game:command", { type: "pickSpirit", cardId: bChoices[0] });
await wait(100);
let turns = 0;
while (turns < TURNS && latestA.game.phase !== "finished") {
  for (const [s, seat] of [[a, aSeat], [b, bSeat]]) {
    const room = s === a ? latestA : latestB;
    const actions = legalActions(room.game, seat);
    if (actions.length === 0) continue;
    const pick = actions.find((x) => x.type === "placeToken") ?? actions.find((x) => x.type === "takeCard" && Math.random() < 0.5) ?? actions.find((x) => x.type === "endTurn") ?? actions[0];
    const r = await emit(s, "game:command", pick);
    if (r.ok) { if (s === a) latestA = r.data; else latestB = r.data; }
    if (pick.type === "endTurn") turns += 1;
    await wait(30);
  }
}
const problems = [];
const check = (who, text) => {
  if (/"seed"|"rngState"|"log"/.test(text)) problems.push(`${who}：种子或动作序列`);
  if (/"pouch":\["/.test(text)) problems.push(`${who}：布袋顺序`);
  if (/"deck":\["/.test(text)) problems.push(`${who}：牌堆顺序`);
  if (/"undo":\[\{/.test(text)) problems.push(`${who}：撤销栈`);
};
for (const t of packets.b) { check("乙", t); if (t.includes(`"${aChoices[0]}"`)) problems.push("乙看到了甲没选的自然之灵"); }
for (const t of packets.a) { check("甲", t); if (t.includes(`"${bChoices[1]}"`)) problems.push("甲看到了乙没选的自然之灵"); }
const beforeReveal = packets.b.filter((t) => t.includes('"phase":"spirit"'));
for (const t of beforeReveal) if (t.includes(`"${aChoices[1]}"`)) problems.push("选卡阶段乙就看到了甲选的那张");
console.log(`甲收到 ${packets.a.length} 条、乙收到 ${packets.b.length} 条更新，打了 ${turns} 个回合`);
console.log(problems.length === 0 ? "没有泄露" : `发现问题：\n${[...new Set(problems)].join("\n")}`);
a.disconnect(); b.disconnect();
process.exit(problems.length === 0 ? 0 : 1);
