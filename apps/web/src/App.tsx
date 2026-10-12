import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode, useRef } from "react";
import { CAPACITY_OPTIONS, type Capacity, type GameCommand, type GameOptions, type LobbyRoomSnapshot, type PublicRoomSummary } from "@harmonies/game";
import { art, SEAT_HEX } from "./art.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import GameRules from "./GameRules.js";
import OnlineRooms from "./OnlineRooms.js";
import RoomChat from "./RoomChat.js";
import { roomRole, RoomSettingsPanel, SeatSwitch } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { ThemeToggle, useTheme } from "./theme.js";
import { useRoomSfx, sfx, type BgmTrack, SoundToggle, useBgm } from "./gm-sound.js";
import { useVoice } from "./voice.js";
import { TutorialInvite } from "./tutorial/Invite.js";
import { readTutorial } from "./tutorial/storage.js";
import { GAME_ID } from "./tutorialGame.js";
import TutorialMode from "./TutorialMode.js";

type EntryMode = "create" | "join";

const validRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;

// 线上游戏中心在站点根路径；本地开发时跑在 5175 端口。
const CENTER_URL = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5175/` : "/";

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

// 背景音乐：进了房间（等候房间、对局、观战）和新手教程里放，首页和房间列表不放。gain / start / end 按这首曲子量（见 gm-sound.tsx）。
const BGM: BgmTrack = { src: `${import.meta.env.BASE_URL}bgm/harmonies.mp3`, gain: 0.98, start: 0.05, end: 162.5 };

function App() {
  const [mode, setMode] = useState<EntryMode>("create");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState<Capacity>(2);
  const [confirmAction, confirmDialog] = useConfirm();
  // 白天 / 夜间画面：首页、等候房间、牌桌共用，顶栏按钮随时切换；和游戏中心、其他游戏共用同一个选择。
  const [theme, toggleTheme] = useTheme();
  const themeToggle = <><ThemeToggle theme={theme} onToggle={toggleTheme} /><SoundToggle /></>;
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<LobbyRoomSnapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lobbyRooms, setLobbyRooms] = useState<PublicRoomSummary[]>([]);
  // 观战时从谁的座位看（默认第一位玩家）。
  const [watchId, setWatchId] = useState("");
  const voice = useVoice(room);
  // 新手教程：首页或等候房间点进来（地址带 ?tutorial 时直接打开，游戏中心可以直接链过来）
  const [tutorialOpen, setTutorialOpen] = useState(() => new URLSearchParams(window.location.search).has("tutorial"));
  // 声音：进了房间（等候房间、对局、观战）和新手教程里顶栏有 ♪ 面板（音效、语音音量）；这款还没有背景音乐。
  useBgm(room || tutorialOpen ? BGM : null);
  // 房间里的提示音：有人进出、开局、收到别人的聊天（聊天只留最近几条，按最后一条的 id 数新消息）
  const lastChat = room ? room.chat[room.chat.length - 1] : undefined;
  const chatSeen = useRef<{ id: string | undefined; count: number }>({ id: undefined, count: 0 });
  if (lastChat?.id !== chatSeen.current.id) chatSeen.current = { id: lastChat?.id, count: chatSeen.current.count + 1 };
  useRoomSfx(room ? { members: room.members.length, playing: room.status === "playing", chatCount: chatSeen.current.count, lastChatMine: lastChat?.senderId === socket.id } : null);

  function closeTutorial() {
    setTutorialOpen(false);
    const params = new URLSearchParams(window.location.search);
    if (params.has("tutorial")) {
      params.delete("tutorial");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }

  // 在等候房间里看教程时，房主一开局就回到牌桌（不然这一步会超时、转成托管）
  useEffect(() => {
    if (tutorialOpen && room?.status === "playing") {
      closeTutorial();
      setNotice("对局开始了，教程先停在这里。");
    }
  }, [tutorialOpen, room?.status]);

  // 在房间里时服务端不推送在线牌桌列表；回到首页时主动拉一次最新的。
  useEffect(() => {
    if (room || !socket.connected) return;
    socket.emit("lobby:get", (response) => {
      if (response.ok) setLobbyRooms(response.data);
    });
  }, [room === null]);

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      socket.emit("lobby:get", (response) => {
        if (response.ok) setLobbyRooms(response.data);
      });
    };
    const handleDisconnect = () => setConnected(false);
    const handleRoomUpdate = (snapshot: LobbyRoomSnapshot) => setRoom(snapshot);
    const handleRoomError = (message: string) => {
      sfx.error();
      setError(message);
    };
    const handleLobbyUpdate = (rooms: PublicRoomSummary[]) => setLobbyRooms(rooms);
    const handleRoomClosed = ({ reason }: { reason: string }) => {
      setRoom(null);
      setBusy(false);
      setError("");
      setNotice(reason);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:updated", handleRoomUpdate);
    socket.on("room:error", handleRoomError);
    socket.on("lobby:updated", handleLobbyUpdate);
    socket.on("room:closed", handleRoomClosed);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:updated", handleRoomUpdate);
      socket.off("room:error", handleRoomError);
      socket.off("lobby:updated", handleLobbyUpdate);
      socket.off("room:closed", handleRoomClosed);
      socket.disconnect();
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!connected || busy || name.trim().length < 2 || name.trim().length > 18) return false;
    return mode === "create" || validRoomCode.test(roomCode);
  }, [busy, connected, mode, name, roomCode]);

  /** 从首页列表加入空座位或进去观战（用上面填的昵称）。 */
  function joinListed(roomId: string, spectate: boolean) {
    const nickname = name.trim();
    if (nickname.length < 2 || nickname.length > 18) {
      setNotice("");
      setError("先在上面填好你的昵称（2–18 个字符）。");
      document.getElementById("player-name")?.focus();
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    socket.emit("room:join", { name: nickname, roomId, spectate }, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice(spectate ? "正在观战。" : "已加入房间。");
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const nickname = name.trim();

    const complete = (response: { ok: true; data: LobbyRoomSnapshot } | { ok: false; error: string }) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice(mode === "create"
        ? "房间已创建，可以邀请朋友加入。"
        : response.data.status === "playing" ? "已回到对局，继续游戏吧。" : "已加入房间。");
    };

    if (mode === "create") {
      socket.emit("room:create", { name: nickname, capacity }, complete);
    } else {
      socket.emit("room:join", { name: nickname, code: roomCode }, complete);
    }
  }

  function startGame() {
    setError("");
    setBusy(true);
    socket.emit("room:start", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice("对局已开始，祝你好运。" );
    });
  }

  function leaveRoom() {
    setBusy(true);
    socket.emit("room:leave", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(null);
      setError("");
      setNotice("已离开房间。" );
    });
  }

  function submitGameCommand(command: GameCommand) {
    setBusy(true);
    setError("");
    setNotice("");
    socket.emit("game:command", command, (response) => {
      setBusy(false);
      if (!response.ok) {
        sfx.error();
        setError(response.error);
        return;
      }
      setRoom(response.data);
    });
  }

  /** 房间管理类操作：只关心成败，界面更新由服务端广播。 */
  function roomCommand(send: (ack: (response: { ok: true; data: void } | { ok: false; error: string }) => void) => void) {
    setError("");
    send((response) => {
      if (!response.ok) setError(response.error);
    });
  }

  const kickMember = (memberId: string) => roomCommand((ack) => socket.emit("room:kick", memberId, ack));
  const addBot = () => roomCommand((ack) => socket.emit("room:add-bot", ack));
  const setAuto = (enabled: boolean) => roomCommand((ack) => socket.emit("room:auto", enabled, ack));
  const voteRematch = (accept: boolean) => roomCommand((ack) => socket.emit("room:rematch", accept, ack));
  async function dissolveRoom() {
    const ok = await confirmAction({
      title: "解散房间？",
      detail: "所有玩家都会被移出，当前对局也会结束。",
      confirmLabel: "解散",
    });
    if (ok) roomCommand((ack) => socket.emit("room:dissolve", ack));
  }

  async function copyRoomCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("房间码已复制。" );
    } catch {
      setNotice("请手动复制房间码。" );
    }
  }

  if (tutorialOpen && room?.status !== "playing") {
    return (
      <main data-gc-table className="app-shell hm-game tut-on">
        <TutorialMode name={name} brand={<Brand />} themeToggle={themeToggle} theme={theme} waitingRoom={room?.code} onExit={closeTutorial} />
        {confirmDialog}
      </main>
    );
  }

  if (room?.status === "playing" && room.game) {
    const players = room.game.players;
    const watched = players.some((player) => player.id === watchId) ? watchId : players[0]!.id;
    return (
      <main data-gc-table className="app-shell hm-game">
        <GameBoard
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          brand={<Brand />}
          connection={<ConnectionStatus connected={connected} />}
          themeToggle={themeToggle}
          theme={theme}
          chat={<RoomChat room={room} voice={voice} />}
          onCommand={submitGameCommand}
          onRematch={voteRematch}
          onAuto={setAuto}
          onDissolve={dissolveRoom}
          watchId={watched}
          onWatch={setWatchId}
          onLeave={leaveRoom}
        />
        {confirmDialog}
      </main>
    );
  }

  if (room) {
    return (
      <main className="app-shell hm-room">
        <header className="topbar">
          <Brand />
          <div className="topbar-right">
            {themeToggle}
            <GameRules />
            <ConnectionStatus connected={connected} />
          </div>
        </header>
        <RoomView
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          onCopyCode={copyRoomCode}
          onLeave={leaveRoom}
          onStart={startGame}
          onKick={kickMember}
          onAddBot={addBot}
          onDissolve={dissolveRoom}
          chat={<RoomChat room={room} voice={voice} />}
          invite={
            <TutorialInvite
              record={readTutorial(GAME_ID)}
              title="等人的时候，先学一下？"
              text="咕噜嘎带你在真牌桌上走一局，不会离开房间，房主一开局就自动回来。"
              again="再看一遍新手教程（不会离开房间）"
              onOpen={() => setTutorialOpen(true)}
            />
          }
        />
        {confirmDialog}
      </main>
    );
  }

  return (
    <main className="app-shell hm-home">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          <a className="center-link" href={CENTER_URL}>← 游戏中心</a>
          {themeToggle}
          <GameRules />
          <ConnectionStatus connected={connected} />
        </div>
      </header>

      <section className="welcome-grid">
        <div className="welcome-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> 在线对战 · 2—4 人 · 一个人也能和人机玩</div>
          <h1>自然和弦</h1>
          <p className="welcome-description">
            每人一块六边形的小版图。轮到你时从中央托盘拿 3 个彩色木片，单放或者叠起来，
            摆出树林、山峦、麦田、村舍和小河；再领动物卡，版图上摆出卡上的小图案，就给动物安个家。
          </p>
          <ul className="hm-home-points">
            <li><b>拿</b>每回合从托盘拿一整格 3 个标记，全部放到版图上</li>
            <li><b>叠</b>树、山越高分越高；房屋要挨着 3 种颜色</li>
            <li><b>家</b>摆出动物卡的图案就放方块，方块越多这张卡越值钱</li>
          </ul>
          <TutorialInvite
            record={readTutorial(GAME_ID)}
            title="第一次玩？3 分钟学会"
            text="咕噜嘎在真牌桌上带你走一局，学完和人机练一局。"
            again="再看一遍新手教程"
            onOpen={() => setTutorialOpen(true)}
          />
          <Hero />
        </div>

        <div className="hm-home-side">
          <section className="entry-card" aria-labelledby="entry-title">
            <div className="entry-card-heading">
              <div>
                <span className="section-kicker">准备开始</span>
                <h2 id="entry-title">进入牌桌</h2>
              </div>
              <span className="step-indicator">01 <i /> 02</span>
            </div>

            <div className="mode-switch" role="tablist" aria-label="选择房间操作">
              <button
                className={mode === "create" ? "mode-tab active" : "mode-tab"}
                type="button"
                role="tab"
                aria-selected={mode === "create"}
                onClick={() => { setMode("create"); setError(""); }}
              >
                创建房间
              </button>
              <button
                className={mode === "join" ? "mode-tab active" : "mode-tab"}
                type="button"
                role="tab"
                aria-selected={mode === "join"}
                onClick={() => { setMode("join"); setError(""); }}
              >
                加入房间
              </button>
            </div>

            <form className="entry-form" onSubmit={handleSubmit}>
              <label className="field-label" htmlFor="player-name">你的昵称</label>
              <input
                id="player-name"
                className="text-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="输入 2–18 个字符"
                minLength={2}
                maxLength={18}
                autoComplete="nickname"
                required
              />

              {mode === "create" ? (
                <>
                  <label className="field-label field-label-spaced" htmlFor="room-capacity">房间人数</label>
                  <div className="capacity-options capacity-many" id="room-capacity" role="group" aria-label="选择房间人数">
                    {CAPACITY_OPTIONS.map((seats) => (
                      <button
                        key={seats}
                        type="button"
                        className={capacity === seats ? "capacity-option selected" : "capacity-option"}
                        aria-pressed={capacity === seats}
                        onClick={() => setCapacity(seats)}
                      >
                        <strong>{seats}</strong>
                        <span>位玩家</span>
                      </button>
                    ))}
                  </div>
                  <p className="field-hint">至少 2 位玩家后房主就能开始，空座位可以加人机（一个人也能开）。版图 A / B 面和自然之灵进房间后房主可以选。</p>
                </>
              ) : (
                <>
                  <label className="field-label field-label-spaced" htmlFor="room-code">房间码</label>
                  <input
                    id="room-code"
                    className="text-input room-code-input"
                    value={roomCode}
                    onChange={(event) => setRoomCode(normalizeRoomCode(event.target.value))}
                    placeholder="例如：7KQ2TX"
                    autoComplete="off"
                    maxLength={6}
                    required
                  />
                  <p className="field-hint">房间码为 6 位字母或数字，不含易混淆字符。掉线后用原昵称和房间码可回到进行中的对局。</p>
                </>
              )}

              {error && <p className="feedback feedback-error" role="alert">{error}</p>}
              {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

              <button className="primary-button" type="submit" disabled={!canSubmit}>
                {busy ? <><span className="spinner" /> 正在连接</> : mode === "create" ? "创建私人房间" : "加入牌桌"}
                {!busy && <span aria-hidden="true">↗</span>}
              </button>
            </form>
            <div className="entry-footnote"><span className="lock-icon">◇</span> 默认邀请制 · 房主可以设为公开</div>
          </section>
          <OnlineRooms rooms={lobbyRooms} connected={connected} busy={busy} onJoin={joinListed} />
        </div>
      </section>
    </main>
  );
}

/** 首页主图：木桌背景 + 一块摆了几摞标记的版图。 */
function Hero() {
  const [theme] = useTheme();
  const tokens: [string, number, number][] = [["W", 0, 1], ["W", 1, 1], ["BBG", 1, 0], ["KK", 2, 1], ["KR", 2, 2], ["Y", 3, 1], ["Y", 3, 2], ["BG", 4, 2], ["K", 2, 0]];
  return (
    <div className="hm-hero" style={{ backgroundImage: `url(${art.bg(theme === "day")})` }}>
      <div className="hm-showcase" aria-hidden="true">
        <div className="hm-showcase-board" style={{ backgroundImage: `url(${art.board("A")})` }}>
          {[...tokens].sort((a, b) => a[2] * 2 + (a[1] % 2) - (b[2] * 2 + (b[1] % 2))).map(([stack, c, r]) => (
            <img key={`${c},${r}`} src={art.stack(stack)} alt="" style={{ left: (20 + 24 * c) * 1, top: (22 + 28 * r + (c % 2 ? 14 : 0) - 18) * 1 }} />
          ))}
        </div>
        <img className="hm-showcase-card" src={art.card("A05")} alt="" />
        <img className="hm-showcase-card" src={art.card("A13")} alt="" />
      </div>
    </div>
  );
}

function Brand() {
  return (
    <a className="brand" href={import.meta.env.BASE_URL} aria-label="自然和弦首页">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span className="brand-name">自然和弦</span>
    </a>
  );
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className={connected ? "connection-status online" : "connection-status"}>
      <span className="connection-dot" />
      {connected ? "服务已连接" : "连接中…"}
    </div>
  );
}

function RoomView({
  room,
  busy,
  error,
  notice,
  onCopyCode,
  onLeave,
  onStart,
  onKick,
  onAddBot,
  onDissolve,
  chat,
  invite,
}: {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  onCopyCode: () => void;
  onLeave: () => void;
  onStart: () => void;
  onKick: (memberId: string) => void;
  onAddBot: () => void;
  onDissolve: () => void;
  chat: ReactNode;
  invite: ReactNode;
}) {
  const { isHost, spectating } = roomRole(room);
  const openSeats = Math.max(0, room.capacity - room.members.length);

  return (
    <section className="room-layout">
      <div className="room-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> {room.status === "waiting" ? "等待大厅" : "对局已创建"} · 自然和弦</div>
          <h1>{spectating ? "你在观战。" : room.status === "waiting" ? "牌桌准备中。" : "好戏即将开始。"}</h1>
          <p>{spectating ? "等房主开始对局；有空座位时可以坐下一起玩。" : "把房间码分享给朋友，等大家就位后开始；空座位可以加人机。"}</p>
        </div>
        <div className="room-heading-actions">
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve} disabled={busy}>解散房间</button>}
          <button className="quiet-button" type="button" onClick={onLeave} disabled={busy || (room.status === "playing" && !spectating)}>
            {spectating ? "离开观战" : "离开房间"}
          </button>
        </div>
      </div>

      {room.status === "waiting" ? (
        <div className="room-grid">
          <section className="room-panel room-code-panel">
            <div className="panel-label">房间码 <span>仅分享给朋友</span></div>
            {room.code ? (
              <>
                <button className="room-code-display" type="button" onClick={onCopyCode} title="复制房间码">
                  {room.code}<span aria-hidden="true">⧉</span>
                </button>
                <div className="room-code-caption">点击复制 · 6 位邀请代码</div>
              </>
            ) : (
              <div className="room-code-caption">从首页列表进来观战，看不到房间码</div>
            )}
            <OptionsPanel room={room} />
            {invite}
          </section>

          <section className="room-panel player-panel">
            <div className="panel-topline">
              <div className="panel-label">玩家 <span>{room.members.length} / {room.capacity}</span></div>
              <span className="waiting-pill"><i /> 等待中</span>
            </div>
            <div className="player-list">
              {room.members.map((member, index) => (
                <div className="player-row" key={member.id}>
                  <div className="player-avatar hm-member-avatar" style={{ background: SEAT_HEX[index % 4] }}>
                    <img src={art.token((["W", "G", "Y", "R"] as const)[index % 4]!)} alt="" />
                  </div>
                  <div className="player-details">
                    <strong>{member.name}{member.id === socket.id ? <small>你</small> : null}</strong>
                    <span>{member.isHost ? "房主" : member.bot ? "人机 · 普通难度" : "已加入"}</span>
                  </div>
                  {member.isHost && <span className="host-badge">房主</span>}
                  {member.bot && <span className="bot-badge">人机</span>}
                  {isHost && !member.isHost && (
                    <button className="kick-button" type="button" onClick={() => onKick(member.id)} title={`把 ${member.name} 移出房间`}>移出</button>
                  )}
                </div>
              ))}
              {Array.from({ length: openSeats }, (_, index) => (
                <div className="player-row open-seat" key={`open-${index}`}>
                  <div className="empty-avatar"><span>＋</span></div>
                  <div className="player-details"><strong>等待玩家加入</strong><span>{room.access.open ? "公开房间，路过的人也能加入" : "分享房间码邀请朋友"}</span></div>
                  {isHost && <button className="quiet-button add-bot-button" type="button" onClick={onAddBot} disabled={busy}>加人机</button>}
                </div>
              ))}
            </div>
            <p className="field-hint">每回合 90 秒，超时自动替你走完这回合（拿第一格、放在地貌分最高的地方）；连续超时 2 次转托管，掉线时由人机代打，回来能接上。</p>
            <RoomSettingsPanel room={room} />
            <SeatSwitch room={room} />
            <div className="room-actions">
              {isHost ? (
                <button className="primary-button" type="button" onClick={onStart} disabled={busy || room.members.length < 2}>
                  {busy ? <><span className="spinner" /> 正在开始</> : "开始对局"}<span aria-hidden="true">↗</span>
                </button>
              ) : (
                <div className="host-wait-note"><span className="pulse-dot" /> {spectating ? "等房主开始，开始后在这里观战" : "等待房主开始对局"}</div>
              )}
              {isHost && room.members.length < 2 && <p className="field-hint centered">还需要至少 {2 - room.members.length} 位玩家加入，也可以点空座位上的「加人机」。</p>}
            </div>
          </section>
          <div className="hm-room-chat">{chat}</div>
        </div>
      ) : null}

      {error && <p className="feedback feedback-error room-feedback" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success room-feedback" role="status">{notice}</p>}
      <div className="room-secure-note"><span>◇</span> {room.access.open ? "公开房间：首页列表里的人可以直接加入空座位。" : "邀请制：要有房间码才能加入；首页列表不显示房间码。"}</div>
    </section>
  );
}

type Ack = { ok: true; data: void } | { ok: false; error: string };

/** 开房变体：房主在等候房间里开关，其他人只看。 */
function OptionsPanel({ room }: { room: LobbyRoomSnapshot }) {
  const { isHost } = roomRole(room);
  const [error, setError] = useState("");
  const change = (patch: Partial<GameOptions>) => socket.emit("room:settings", patch, (response: Ack) => setError(response.ok ? "" : response.error));
  return (
    <div className="hm-options">
      <div className="panel-label">开房选项 <span>{isHost ? "房主可以改" : "只有房主能改"}</span></div>
      <div className="hm-side-pick" role="group" aria-label="个人版图用哪一面">
        {(["A", "B"] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={room.options.side === side ? "room-setting on" : "room-setting"}
            aria-pressed={room.options.side === side}
            disabled={!isHost}
            onClick={() => change({ side })}
          >
            <img src={art.icon(side === "A" ? "river" : "island")} alt="" />
            <span><b>{side} 面 · {side === "A" ? "河流" : "岛屿"}</b><small>{side === "A" ? "最长的一条河得分（默认）" : "被水隔开的每个岛 5 分"}</small></span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className={room.options.spirits ? "room-setting on" : "room-setting"}
        aria-pressed={room.options.spirits}
        disabled={!isHost}
        onClick={() => change({ spirits: !room.options.spirits })}
      >
        <img src={art.icon("spirit")} alt="" />
        <span><b>自然之灵</b><small>开局每人从 2 张里选 1 张，摆出图案终局另加分</small></span>
      </button>
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
    </div>
  );
}

export default App;
