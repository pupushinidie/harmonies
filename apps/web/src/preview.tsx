/**
 * 预览页：用预览局面工厂造出各种界面状态，渲染真正的 GameBoard（提交进仓库，生产构建不打包它）。
 *   /preview.html?s=<场景>&theme=day|night&view=<座位>
 * 场景见下面的 SCENES；可以点：命令在本地直接跑 apply（补托盘按种子随机）。
 */
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import {
  apply,
  buildState,
  redactGameForViewer,
  scene,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type SceneName,
} from "@harmonies/game";
import GameBoard from "./GameBoard.js";
import { socket } from "./socket.js";
import { ThemeToggle, applyTheme, readTheme, type Theme } from "./theme.js";
import "./styles.css";
import "./app-pixel.css";
import "./hm.css";
import "./theme-day.css";

const params = new URLSearchParams(location.search);
const name = params.get("s") ?? "start";
const theme: Theme = params.get("theme") === "day" ? "day" : params.get("theme") === "night" ? "night" : readTheme();
applyTheme(theme);

// 冒充自己的 socket
Object.defineProperty(socket, "id", { get: () => "me", configurable: true });
socket.disconnect();

type Extra = { members?: (members: LobbyMember[]) => LobbyMember[]; turnMs?: number; spectate?: boolean; rematch?: boolean };

const BOT_NAMES = ["咕噜一号", "咕噜二号", "咕噜三号"];
function withBots(game: GameState): GameState {
  return { ...game, players: game.players.map((p, i) => (i === 0 ? { ...p, name: "小林" } : { ...p, name: BOT_NAMES[i - 1]! })) };
}

/** 场景：局面 + 房间状态（离线、超时、托管、观战）。 */
const SCENES: Record<string, () => { game: GameState; extra?: Extra }> = {
  ...Object.fromEntries(
    ([
      "start", "start3", "start4", "startB", "spiritPick", "spiritWaiting", "took", "placing", "cubeReady", "fullCards",
      "opponentTurn", "lastRound", "midB", "mid4", "mid3B", "finished", "finishedTie", "finished4", "finishedB", "finishedSpirits",
    ] as SceneName[]).map((s) => [s, () => ({ game: s === "mid4" || s === "finished4" ? withBots(scene(s)) : scene(s), extra: s.startsWith("finished") ? { rematch: true } : {} })]),
  ),
  cubeSelected: () => ({ game: scene("cubeReady"), extra: {} }),
  offline: () => ({ game: scene("opponentTurn"), extra: { members: (m) => m.map((x, i) => (i === 1 ? { ...x, connected: false } : x)) } }),
  timeout: () => ({ game: scene("took"), extra: { turnMs: 8000 } }),
  auto: () => ({ game: scene("opponentTurn"), extra: { members: (m) => m.map((x, i) => (i === 0 ? { ...x, auto: true } : x)) } }),
  bots: () => ({ game: withBots(scene("start4")), extra: { members: (m) => m.map((x, i) => (i > 0 ? { ...x, bot: true } : x)) } }),
  spectate: () => ({ game: scene("mid4"), extra: { spectate: true } }),
  endConfirm: () => ({ game: buildState({ players: [{ board: { "1,0": "G", "0,0": "W", "2,0": "W" }, cards: [["A05", 0]] }, {}], took: 0, hand: "", central: ["", "WWW", "KKK", "YYY", "RRR"], round: 3 }) }),
  error: () => ({ game: scene("took") }),
};

function makeRoom(game: GameState, extra: Extra = {}, version = 0): LobbyRoomSnapshot {
  let members: LobbyMember[] = game.players.map((player, index) => ({
    id: index === 0 && !extra.spectate ? "me" : `s-${player.id}`,
    playerId: player.id,
    name: player.name,
    isHost: index === 0,
    connected: true,
  }));
  if (extra.members) members = extra.members(members);
  void version;
  return {
    code: "HM2024",
    spectators: extra.spectate ? [{ id: "me", name: "看客" }] : [],
    access: { allowSpectators: true, spectatorsSeeAll: false, open: false },
    capacity: Math.max(2, game.players.length) as 2 | 3 | 4,
    options: { side: game.config.side, spirits: game.config.spirits },
    status: "playing",
    members,
    chat: [
      { id: "c1", senderId: "s-p2", name: game.players[1]?.name ?? "阿青", message: "这局的山好多", createdAt: new Date().toISOString() },
    ],
    voice: [],
    ...(extra.turnMs !== undefined ? { turnRemainingMs: extra.turnMs } : {}),
    ...(extra.rematch ? { rematch: { remainingMs: 52000, acceptedIds: [] } } : {}),
    game: extra.spectate ? redactGameForViewer(game, "") : redactGameForViewer(game, game.players[0]!.id),
  };
}

function Preview() {
  const build = SCENES[name] ?? SCENES.start!;
  const initial = build();
  const [game, setGame] = useState(initial.game);
  const [error, setError] = useState(name === "error" ? "这一格放不下：屋顶只能压在单层的山、树干或屋顶上。" : "");
  const [themeNow, setThemeNow] = useState<Theme>(theme);
  const room = makeRoom(game, initial.extra);
  const onCommand = (command: GameCommand) => {
    try {
      const actor = game.phase === "spirit" ? game.players[0]!.id : game.players[game.currentPlayer]!.id;
      setGame(apply(game, actor, command).state);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <main className="app-shell hm-game">
      <GameBoard
        room={room}
        busy={false}
        error={error}
        notice=""
        brand={<a className="brand" href="#"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span className="brand-name">自然和弦</span></a>}
        connection={<div className="connection-status online"><span className="connection-dot" />服务已连接</div>}
        themeToggle={<ThemeToggle theme={themeNow} onToggle={() => { const next = themeNow === "day" ? "night" : "day"; applyTheme(next); setThemeNow(next); }} />}
        theme={themeNow}
        chat={<div className="room-chat"><p className="hm-muted">（预览里聊天不可用）</p></div>}
        onCommand={onCommand}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId={game.players[0]!.id}
        onWatch={() => undefined}
        onLeave={() => undefined}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
