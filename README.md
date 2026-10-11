# 自然和弦（Harmonies 类）

2–4 人（一个人也能和人机开局）的叠放拼图桌游，网页联机版。规则按 `~/Desktop/游戏规则/自然和弦.md` 实现；美术（PixelLab，木桌绘本风）和规则说明文字都是自己的，不用原版名字和插画。

线上地址：<https://gulugagame.com/harmonies/>（付费网关后面，要登录）

## 怎么玩（自己的话）

每人一块六边形格子的小版图。轮到你时：

1. **必须**从中央托盘 5 个凹槽里挑一个，把里面的 3 个地貌标记全拿走，一个个放到自己版图上（单放或者叠起来）。
2. **可以**从公开的 5 张动物卡里领 1 张（面前没完成的卡最多 4 张）。
3. **可以**放动物方块：版图上摆出了卡上的小图案（可以转着摆），就把卡上的一个方块放到图案的目标格上；不限次数。

2、3 可以穿插在放标记中间，三个标记都放完才能点「结束回合」。结束回合时托盘被拿空的凹槽从布袋补 3 个，牌列补到 5 张。

**怎么叠**：任何标记都能放空格；山（灰）叠在 1–2 层山上；树干（棕）叠在 1 个树干上；树冠（绿）放在空格或 1–2 层树干上；屋顶（红）压在单层的山、树干或屋顶上成房屋；水和田只能放空格。有方块的格子不能再叠。

**怎么算分**（终局）：
- 树：高 1 / 2 / 3 得 1 / 3 / 7；山：同样 1 / 3 / 7，但不挨着别的山就是 0；
- 田：每片相连的田（至少 2 个）得 5，再大也是 5；
- 房屋：周围 6 格最上层至少有 3 种颜色得 5；
- 水：A 面数最长的那条河（一片水里两点之间最短路的格数，分叉不加长）：2/3/4/5/6 格 = 2/5/8/11/15，之后每格 +4；B 面数岛（不是水的格子，包括空格，相连成一片算一个岛），每个岛 5 分；
- 动物卡：按放了几个方块查卡上的分数表；
- 自然之灵（变体）：方块放上去了才按卡上的说法另外加分。

**什么时候结束**：有人结束回合时版图只剩 ≤ 2 个空格，或者要补托盘时布袋空了，就打完这一轮（轮到起始玩家之前的那个人为止）结束。总分最高的赢；平分比谁放到版图上的动物方块多；还平就并列。

## 本地运行

```bash
npm install
npm run dev          # 服务端 :3023（SERVER_PORT），网页 :5294（WEB_PORT）
npm test             # 规则引擎（规则书 TC1–TC14 + 各节场景 + 每种人数 300 局随机对局）和服务器（房间流程、每种行动、超时、重连、抓包、人机、观战、挤登录）
npm run typecheck
BASE_PATH=/harmonies/ npm run build
```

端口都能用环境变量改：`WEB_PORT`（vite 端口，默认 5294）、`SERVER_PORT`（vite 代理目标、陪玩脚本，默认 3023）；服务器自己读 `PORT`（默认 3023）、`WEB_PORT`（允许的开发来源）。

一个人测试：
- `node scripts/test-bot.mjs host 2 1`：机器人建一个 2 人房、打印房间码，你在网页里用房间码加入凑满后自动开局。`node scripts/test-bot.mjs join <房间码> [昵称]` 让机器人加入你的房间。机器人随机走合法的一步（不撤销）；`BOT_SMART=1` 用人机的走法，`BOT_DELAY_MS` 调思考时间（默认 1500），`BOT_IDLE=1` 只挂着不动（等超时），`BOT_STAY=1` 一局结束后自动同意再来一局；`HM_SIDE=B`、`HM_SPIRITS=1` 建房时开 B 面、自然之灵。
- 也可以在等候房间里直接点空座位的「加人机」。
- 抓包：`node scripts/spy.mjs [回合数]` 连上正在跑的服务器，甲乙两个 socket 开一局自然之灵，检查乙收到的每一条更新里没有甲的自然之灵、布袋顺序、牌堆顺序、种子、撤销栈。

## 目录

| 路径 | 内容 |
|---|---|
| `packages/game/src/types.ts` | 状态、命令、事件的类型 |
| `packages/game/src/cards.ts` | 32 张动物卡、10 张自然之灵（图案用轴向偏移写，单测核对颜色、方块数） |
| `packages/game/src/board.ts` | 版图几何（A 面 23 格、B 面 25 格、odd-q 偏移 ↔ 轴向）、叠放规则、图案匹配（6 种旋转）、地貌计分、河长（直径）、岛屿、自然之灵计分、胜负 |
| `packages/game/src/engine.ts` | 规则引擎 `apply(state, playerId, command, rng?) → { state, events }`（纯函数）；回合结束补充和终局；撤销；超时默认动作；`redactGameForViewer` |
| `packages/game/src/scenes.ts` | 预览局面工厂（见下「对外接口」） |
| `packages/game/src/bot.ts` | 人机 |
| `apps/server` | Socket.IO 房间（建房、重连、踢人、解散、再来一局、聊天、语音、观战、人机、托管、挤登录、管理员解散），开房选 A/B 面和自然之灵 |
| `apps/web` | 网页 |
| `art/` | 美术 agent 的出图脚本和规格 `art/spec.md`；定稿在 `art/out/final/`，已经复制进 `apps/web/public/art/` |

## 对外接口（界面、教程、测试都用）

从 `@harmonies/game` 导出：

- `createGame(players, seed?, { side, spirits })`：开一局。
- `apply(state, playerId, command, rng?)`：执行命令，不改输入。命令：`pickSpirit {cardId}`、`takeTokens {space}`、`placeToken {index, cell}`、`takeCard {cardId}`、`placeCube {cardId, cell}`、`undo`、`endTurn`。格子写成 `"c,r"`（规则书 2.3 的偏移坐标）。`rng` 默认从 state 里恢复；教程传 `scriptedRng()`，补托盘时就按 `state.pouch` 的顺序从前往后抽。
- `legalActions(state, playerId)`、`legalTokenCells(state, color)`、`cubeTargets(state, playerIndex, cardId)`、`allCubeMoves`、`canTakeCard`、`pendingCubeCount`（结束回合前还能放几个方块）。
- `scorePlayer(player, side)`：完整分项（地貌五项、每张卡、自然之灵、动物方块数），`landscapeScore`、`spiritPoints`、`riverLength`、`islandCount`。
- `matchPattern(board, cardId, cell)`：图案能不能以这一格为目标格摆出来，返回用到的格子（界面高亮「图案已经摆出」用）。
- `timeoutTurn(state)`、`autoCommand(state)`：超时默认动作。
- `redactGameForViewer(state, viewerId)`：某个人（空字符串 = 观战）看到的状态。
- **预览局面工厂**：
  - `buildState(spec)` 按参数造任意精确局面：`{ side, spirits, players: [{ id, name, board: {"0,0": "KK"}, cubes: {"2,1": "A05"}, cards: [["A05", 3]], spiritChoices, spiritPick }], first, current, round, central: ["BGK", …], market, deck, pouch: "RRW…", took, hand: "BG", tookCard, phase, endTriggered, finished: "board" | "pouch", seed }`。没给的部分按种子随机补齐，标记总数守恒（超了会报错）。
  - `scene(name)` 按名字造常见局面，名字在 `SCENE_NAMES`：`start`、`start3`、`start4`、`startB`、`spiritPick`、`spiritWaiting`、`took`（刚拿了 3 个）、`placing`（放了一个）、`cubeReady`（图案摆出能放方块）、`fullCards`（4 张没完成，不能再领）、`opponentTurn`、`lastRound`（已触发终局）、`midB`、`finished`、`finishedTie`（并列）、`finished4`（4 人铺满）、`finishedB`、`finishedSpirits`。自己都是 `p1`。
  - 对手离线、超时这类房间状态不在对局状态里：预览页改房间快照的 `members[i].connected`、`turnRemainingMs` 就行。
  - `EXAMPLE_1`（规则书例 1 的版图）、`playout(人数, 种子, 面, 自然之灵)`（随机下完一整局）、`endGameNow(state, reason)`（按现在的版图立刻结算）。

## 默认规则和规则书没写死的地方

开工拍板（2026-10-10）全按推荐：

| # | 问题 | 处理 |
|---|---|---|
| 1 | 动物方块用完了 | 视为不限量 |
| 2 | A 面河长 | 一片水里任意两点最短路径经过的格数的最大值（直径），只算最长的一片 |
| 3 | B 面岛屿 | 空格算陆地；整块都是水就是 0 个岛 |
| 4 | 平分 | 只数放在版图上的动物方块，不数自然之灵方块 |
| 5 | 自然之灵计分 | 只看地貌本身（孤立的山、没挨够颜色的房屋都算；只有树干没有树冠的不算树） |
| 6 | 自然之灵什么时候选 | 开局时所有人同时选；选的时候别人只看到「选好了」，全部选完一起亮出；没选的那张删掉，谁也看不到 |
| 7 | 个人版图 | 开房选 A 面（河流，默认）或 B 面（岛屿），所有人同一面，开局后锁定；自然之灵是开房选项，默认关 |
| 8 | 单人计分模式（太阳） | 不做；一个人可以加人机开局（2–4 人房） |
| 9 | 起始玩家 | 随机 |
| 10 | 撤销 | 结束回合之前，拿标记、放标记、领卡、放方块都能一步步撤销；补托盘和补牌都在结束回合时才发生，所以撤销不泄露信息 |
| 11 | 布袋只剩 1–2 个时补托盘 | 有几个放几个；下次要补时布袋空了才触发终局 |
| 12 | 中央托盘全空了（正常不会发生） | 保险：轮到的人可以直接结束回合，并触发终局 |
| 13 | 局中分数 | 实时显示每人的总分（地貌 + 动物卡 + 已放好的自然之灵），都是公开信息算出来的 |
| 14 | 随机数 | 都在服务器：开局洗牌、补托盘时从布袋随机抽；种子、布袋内容顺序、牌堆顺序、动作序列都不发给客户端（布袋只给各色数量，牌堆只给张数） |

**超时**（规则书 9.4）：每回合 90 秒，自然之灵选卡 60 秒（所有没选的真人共用一个倒计时）。同一回合里的操作不重置倒计时。超时时替他把这回合做完：没拿标记就拿第一个非空的凹槽；手里的标记一个个放到「地貌分加得最多」的合法格（并列取坐标最小，先列后行）；不领卡；能放的方块都放上；结束回合。自然之灵超时选第一张。

**全站约定覆盖规则书的地方**：人机叫咕噜一号 / 二号 / 三号，带「人机」标签，只有「普通」难度；房主点空座位「加人机」，一个人加满人机也能开；连续超时 2 次转托管（托管 = 人机代打，不是超时默认动作），自己动一下或点「取消托管」交还；离线的人轮到时先等 3 秒再由人机接手这回合（不算超时），原昵称回来交还座位。

## 人机

`packages/game/src/bot.ts`：只看 `redactGameForViewer` 之后的局面，一次给一步（`botAdvice` 同时给一句理由，教程「提示」用）。回合开始先决定领不领卡（缺卡、图案好摆、离终局远），再对每个凹槽做集束搜索（3 个标记任意顺序，每层留 5 个），评估 = 地貌分 + 动物卡分（含这回合能放的方块）+ 差 1–3 个标记的图案期望 + 树干、单个田、单个屋顶等半成品 + 空格；快结束时只领马上能放方块的卡。

强度（`npx tsx packages/game/sim/sim-harmonies.ts`，2026-10-11）：对随机 2 人胜 100%（平均 75.8 : 20.3 分）；对贪心基线 2 人 A 面 91.5%（200 局，81.8 : 63.0）、B 面 95.5%、3 人 91.0%（公平 33%）、4 人 83.0%（公平 25%）、2 人 + 自然之灵 92.0%；对超时默认打法 100%。自对弈 2/3/4 人各 300 局全部合法打完（最多 243 步），平均每人 84–91 分。决策耗时平均 14.9 ms，p99 137 ms，最坏 232 ms（本机）。

## 画面：白天版和夜间版

只有像素风一种画面，配色分夜间（深色，默认）和白天（白底），顶栏随时切换，记在浏览器的 `gm-pixel-theme` 里（全站共用）。夜间配色写在 CSS 里；白天版由 `apps/web/day-theme.ts`（Vite 插件）按 `apps/web/day-palette.ts` 的调色表换色生成，机械换色不合适的地方在 `src/theme-day.css` 手写。

## 部署

服务器上 `~/harmonies`，pm2 进程 `harmonies`（端口 3023），网页在 `/var/www/harmonies`，Caddy `handle_path /harmonies/*`（在付费网关 `@games` 里）。pm2 按仓库根目录的 `ecosystem.config.cjs` 直接启动一个 `node --import tsx` 进程。端口和密钥（PORT、ADMIN_TOKEN、TURN_*、WEB_ORIGINS）存在 pm2 里，不进仓库。
