import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  animalCard,
  canTakeCard,
  COLOR_NAMES,
  cubeCount,
  cubeTargets,
  isSpiritId,
  legalCellsFor,
  matchPattern,
  MAX_UNFINISHED,
  pendingCubeCount,
  spiritCard,
  type Color,
  type GameCommand,
  type GameEvent,
  type GameState,
  type HeldCard,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Player,
  type ScoreBreakdown,
} from "@harmonies/game";
import { art, CARD_HEX, SEAT_HEX, SUPPLY_PX, SUPPLY_SLOTS, supplyCenter, TOKEN } from "./art.js";
import { CardView } from "./Card.js";
import GameRules from "./GameRules.js";
import { HexBoard, type Overlay } from "./HexBoard.js";
import { STRIP_W, useLayout } from "./layout.js";
import { Coach, TipToast } from "./tutorial/Coach.js";
import { useFirstTimeTips } from "./tutorial/tips.js";
import { detectTips, GAME_ID, hintFor, TIPS, type Hint } from "./tutorialGame.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { useGameSfx } from "./game-sfx.js";
import { useSfxCountdown } from "./gm-sound.js";
import { socket } from "./socket.js";
import type { Theme } from "./theme.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly theme: Theme;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  /** 打开 / 取消自己的托管。 */
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  /** 观战的人离开。 */
  readonly onLeave: () => void;
  /** 教程、练习局用：按钮行里额外放的东西。 */
  readonly extraControls?: ReactNode;
  /** 自己在 room.members 里的 id（默认 socket.id；教程里传固定值）。 */
  readonly selfMemberId?: string;
  /** online：真实对局；tutorial：剧本进行中（不出提示和小贴士）；practice：练习局（随时能看提示）。 */
  readonly mode?: "online" | "tutorial" | "practice";
  /** 结算框里替代「再来一局」的按钮（练习局放「结束教程」「再练一局」）。 */
  readonly finalActions?: ReactNode;
}

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - Math.max(0, now - anchor.at)) / 1000));
}

function cardName(id: string): string {
  return isSpiritId(id) ? spiritCard(id).name : animalCard(id).name;
}

function colors(list: readonly Color[]): string {
  return list.map((c) => COLOR_NAMES[c]).join("、");
}

function describeEvent(event: GameEvent, name: (id: string) => string): string | null {
  switch (event.type) {
    case "TokensTaken":
      return `${name(event.player)} 拿了第 ${event.space + 1} 格：${colors(event.tokens)}`;
    case "TokenPlaced": {
      const gained = event.scoreAfter - event.scoreBefore;
      return `${name(event.player)} 放了${COLOR_NAMES[event.color]}${gained > 0 ? `，+${gained} 分` : ""}`;
    }
    case "CardTaken":
      return `${name(event.player)} 领了「${cardName(event.cardId)}」`;
    case "CubePlaced":
      return `${name(event.player)} 在「${cardName(event.cardId)}」的图案上放了方块${event.completed ? "（这张放满了）" : ""}，+${event.scoreAfter - event.scoreBefore} 分`;
    case "Undone":
      return `${name(event.player)} 撤销了一步`;
    case "EndTriggered":
      return event.reason === "board" ? `${name(event.player)} 的版图只剩 2 个空格以内：打完这一轮结束` : "布袋空了：打完这一轮结束";
    case "TurnStarted":
      return event.lastRound ? `最后一轮：轮到 ${name(event.player)}` : null;
    case "TurnTimedOut":
      return `${name(event.player)} 超时，自动替他走完这回合`;
    case "SpiritsRevealed":
      return `自然之灵亮出来了：${event.picks.map((pick) => `${name(pick.player)}「${cardName(pick.cardId)}」`).join("、")}`;
    case "GameEnded":
      return "游戏结束";
    default:
      return null;
  }
}

function unfinished(cards: readonly HeldCard[]): number {
  return cards.filter((card) => card.placed < cubeCount(card.id)).length;
}

const EMPTY: ReadonlySet<string> = new Set();

function cardHex(id: string): string {
  return isSpiritId(id) ? CARD_HEX.spirit! : CARD_HEX[animalCard(id).color]!;
}

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, theme, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave, extraControls, selfMemberId, mode = "online", finalActions }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === (selfMemberId ?? socket.id));
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const selfId = spectating ? "" : myId;
  const isHost = member?.isHost ?? false;
  const meIndex = Math.max(0, game.players.findIndex((player) => player.id === myId));
  const me = game.players[meIndex]!;
  const side = game.config.side;
  const finished = game.phase === "finished";
  const spiritPhase = game.phase === "spirit";
  const actor = finished || spiritPhase ? undefined : game.players[game.currentPlayer];
  const autoPlaying = member?.auto === true;
  const myTurn = !spectating && !finished && !spiritPhase && game.currentPlayer === meIndex;
  const canAct = myTurn && !autoPlaying;
  const secondsLeft = useCountdown(room);
  useGameSfx(game, selfId);
  useSfxCountdown(myTurn && !autoPlaying, secondsLeft);
  const opponents = game.players.filter((player) => player.id !== myId);
  const [mainRef, layout] = useLayout(side, opponents.length);
  const memberOf = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId);
  const seatOf = (playerId: string) => SEAT_HEX[Math.max(0, game.players.findIndex((player) => player.id === playerId)) % 4]!;
  const nameOf = useCallback(
    (playerId: string) => (playerId === selfId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?"),
    [game.players, selfId],
  );
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";
  const t = game.turnState;

  // 页面在后台时，轮到自己就在标题上提醒
  useEffect(() => {
    const base = "自然和弦 · 在线对战";
    const update = () => { document.title = myTurn && document.hidden ? `【轮到你】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [myTurn]);

  // ---------- 动作记录 ----------
  const [log, setLog] = useState<{ key: string; text: string }[]>([]);
  const loggedVersion = useRef(game.version);
  useEffect(() => {
    if (game.version === loggedVersion.current) return;
    loggedVersion.current = game.version;
    const lines = game.events
      .map((event, index) => ({ key: `${game.version}-${index}`, text: describeEvent(event, nameOf) }))
      .filter((line): line is { key: string; text: string } => line.text !== null);
    setLog((previous) => [...lines.reverse(), ...previous].slice(0, 80));
  }, [game.version]);

  // 这一次更新里新放的标记、方块（按玩家）
  const fresh = useMemo(() => {
    const tokens = new Map<string, Set<string>>();
    const cubes = new Map<string, Set<string>>();
    const add = (map: Map<string, Set<string>>, player: string, cell: string) => {
      if (!map.has(player)) map.set(player, new Set());
      map.get(player)!.add(cell);
    };
    for (const event of game.events) {
      if (event.type === "TokenPlaced") add(tokens, event.player, event.cell);
      if (event.type === "CubePlaced") add(cubes, event.player, event.cell);
    }
    return { tokens, cubes };
  }, [game.version]);

  // ---------- 选择：手里的哪个标记、面前的哪张卡 ----------
  const [handSel, setHandSel] = useState(0);
  const [cardSel, setCardSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    setHandSel((index) => (index < t.hand.length ? index : 0));
    setHover(null);
  }, [game.version]);
  const targetsByCard = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!canAct) return map;
    for (const card of me.cards) map.set(card.id, cubeTargets(game, meIndex, card.id));
    return map;
  }, [game.version, canAct]);
  const readyCards = me.cards.filter((card) => (targetsByCard.get(card.id)?.length ?? 0) > 0).map((card) => card.id);
  // 选中的卡没有能放的位置了就取消选中
  useEffect(() => {
    if (cardSel && !(targetsByCard.get(cardSel)?.length)) setCardSel(null);
  }, [targetsByCard, cardSel]);
  // 标记都放完、只有一张卡能放方块时，自动选中它（点卡取消后这一步不再自动选）
  useEffect(() => {
    if (canAct && t.hand.length === 0 && readyCards.length === 1 && cardSel === null) setCardSel(readyCards[0]!);
  }, [game.version, canAct]);
  const cubeMode = canAct && cardSel !== null;
  const handColor = t.hand[handSel] ?? t.hand[0];
  const tokenMode = canAct && !cubeMode && t.hand.length > 0;
  const validCells = useMemo(() => (tokenMode && handColor ? new Set(legalCellsFor(me.board, handColor)) : new Set<string>()), [tokenMode, handColor, game.version]);
  const targets = useMemo(() => new Set(cubeMode ? targetsByCard.get(cardSel!) ?? [] : []), [cubeMode, cardSel, targetsByCard]);

  const overlays = useMemo(() => {
    const map = new Map<string, Overlay>();
    // 这回合（别人看时是上一个回合）放过的格子：淡淡圈出来
    const recent = !finished && actor?.id === me.id ? t.placed : game.lastTurn?.player === me.id ? game.lastTurn.placed : [];
    for (const cell of recent) map.set(cell, "last");
    if (tokenMode) for (const cell of validCells) map.set(cell, "valid");
    if (cubeMode) {
      const pattern = hover && targets.has(hover) ? matchPattern(me.board, cardSel!, hover) ?? [] : [];
      for (const cell of pattern) map.set(cell, "pattern");
      for (const cell of targets) map.set(cell, "target");
    }
    if (hover && (tokenMode || cubeMode) && !validCells.has(hover) && !targets.has(hover)) map.set(hover, "hover");
    return map;
  }, [tokenMode, cubeMode, validCells, targets, hover, game.version]);

  const clickCell = (cell: string) => {
    if (busy || !canAct) return;
    if (cubeMode) {
      if (targets.has(cell)) onCommand({ type: "placeCube", cardId: cardSel!, cell });
      return;
    }
    if (tokenMode && validCells.has(cell)) onCommand({ type: "placeToken", index: handSel, cell });
  };
  const clickSpace = (space: number) => {
    if (busy || !canAct || t.took !== null || game.central[space]!.length === 0) return;
    onCommand({ type: "takeTokens", space });
  };
  const takeable = canAct && canTakeCard(game, meIndex);
  const clickMarket = (cardId: string) => {
    if (busy || !takeable) return;
    onCommand({ type: "takeCard", cardId });
  };
  const clickHeld = (cardId: string) => {
    if (!canAct) return;
    setCardSel((current) => (current === cardId ? null : (targetsByCard.get(cardId)?.length ?? 0) > 0 ? cardId : null));
  };

  // ---------- 「提示」：练习局随时能用；真实对局里只有自己和人机时能用 ----------
  const botsOnly = room.members.length > 1 && room.members.every((candidate) => candidate.playerId === myId || candidate.bot === true);
  const canHint = !spectating && !autoPlaying && myTurn && (mode === "practice" || (mode === "online" && botsOnly));
  const [hint, setHint] = useState<{ version: number; hint: Hint } | null>(null);
  const shownHint = hint && hint.version === game.version && canHint ? hint.hint : null;
  const toggleHint = () => {
    if (hint && hint.version === game.version) {
      setHint(null);
      return;
    }
    const next = hintFor(game, myId);
    // 先把人机会用的标记 / 卡选好，点高亮的格子就是那一步
    if (next.command?.type === "placeToken") {
      setCardSel(null);
      setHandSel(next.command.index);
    } else if (next.command?.type === "placeCube") setCardSel(next.command.cardId);
    setHint({ version: game.version, hint: next });
  };
  useEffect(() => {
    if (!canHint) return;
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key.toLowerCase() === "h") toggleHint();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [canHint, game.version, hint]);
  const tips = useFirstTimeTips(GAME_ID, game.version, () => detectTips(game, myId), TIPS, mode === "online" && !spectating);

  // ---------- 结束回合（还有方块能放时先确认） ----------
  const [confirmEnd, setConfirmEnd] = useState(0);
  const canEnd = canAct && (t.took !== null || game.central.every((space) => space.length === 0)) && t.hand.length === 0;
  const endTurn = () => {
    if (!canEnd || busy) return;
    const pending = pendingCubeCount(game);
    if (pending > 0) setConfirmEnd(pending);
    else onCommand({ type: "endTurn" });
  };
  const undo = () => {
    if (canAct && t.undoCount > 0 && !busy) {
      setCardSel(null);
      onCommand({ type: "undo" });
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Escape") setCardSel(null);
      else if ((event.key === "z" || event.key === "Z") && (event.ctrlKey || event.metaKey)) undo();
      else if (/^[1-3]$/.test(event.key) && t.hand.length >= Number(event.key)) setHandSel(Number(event.key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- 提示 ----------
  let headline = "";
  let detail = "";
  if (finished) headline = "游戏结束";
  else if (spiritPhase) {
    const waiting = game.players.filter((player) => !player.spiritPick).length;
    headline = spectating ? "大家在选自然之灵" : me.spiritPick ? `等其他人选自然之灵（还有 ${waiting} 人）` : "选一张自然之灵";
  } else if (autoPlaying) {
    headline = "托管中";
    detail = "人机正在替你走，点「取消托管」拿回来。";
  } else if (myTurn) {
    if (t.took === null) {
      headline = "轮到你：从托盘拿一格标记";
      detail = t.tookCard === null && takeable ? "点托盘里的一格，3 个标记全拿走；也可以先领一张动物卡。" : "点托盘里的一格，3 个标记全拿走。";
    } else if (t.hand.length > 0 && !cubeMode) {
      headline = `把${COLOR_NAMES[handColor!]}放到版图上（还剩 ${t.hand.length} 个）`;
      detail = "绿框的格子能放；点手里别的标记可以换着放。";
    } else if (cubeMode) {
      headline = `放「${cardName(cardSel!)}」的方块`;
      detail = "点橙色虚线框的格子；指着它能看到图案用到哪几格。再点一下卡取消。";
    } else if (readyCards.length > 0) {
      headline = "还能放方块";
      detail = "点亮着的卡，再点版图上的格子；不放也可以结束回合。";
    } else {
      headline = "可以结束回合了";
      detail = takeable && t.tookCard === null ? "还可以领一张动物卡。" : "";
    }
  } else if (actor) {
    headline = spectating ? `${actor.name} 行动中` : `等 ${nameOf(actor.id)} 行动`;
    detail = game.endTriggered ? "最后一轮了。" : "";
  }
  const lastRound = !finished && game.endTriggered !== null;

  const sideTabs = useSideTabs(room);
  const [drawer, setDrawer] = useState(false);
  const showTimer = secondsLeft !== null && !finished;
  const pouchLeft = game.pouchCounts ? Object.values(game.pouchCounts).reduce((a, b) => a + b, 0) : 0;

  // ---------- 各块 ----------
  const sk = layout.sk;
  const supply = (
    <section className="hm-panel hm-supply-panel">
      <div
        className="hm-supply"
        data-tutorial="supply"
        style={{ width: SUPPLY_PX.w * sk, height: SUPPLY_PX.h * sk, backgroundImage: `url(${art.supply})`, backgroundSize: `${SUPPLY_PX.w * sk}px ${SUPPLY_PX.h * sk}px` }}
      >
        {game.central.map((tokens, space) => {
          const c = supplyCenter(space);
          const live = canAct && t.took === null && tokens.length > 0;
          return (
            <button
              key={space}
              type="button"
              className={["hm-space", live ? "live" : "", t.took === space && !finished ? "taken" : ""].join(" ")}
              data-space={space}
              data-tutorial={`space-${space}`}
              disabled={!live || busy}
              onClick={() => clickSpace(space)}
              aria-label={tokens.length > 0 ? `第 ${space + 1} 格：${colors(tokens)}` : `第 ${space + 1} 格：空`}
              style={{ left: (c.x - 28) * sk, top: (c.y - 30) * sk, width: 56 * sk, height: 58 * sk }}
            >
              {tokens.map((color, index) => {
                const slot = SUPPLY_SLOTS[index]!;
                return (
                  <img
                    key={index}
                    src={art.token(color)}
                    alt=""
                    style={{ left: (slot[0] + 28) * sk, top: (slot[1] + 30) * sk, width: TOKEN.w * sk, height: TOKEN.h * sk }}
                  />
                );
              })}
            </button>
          );
        })}
      </div>
      <div className="hm-supply-info">
        <span className="hm-bag" data-tutorial="bag" title={game.pouchCounts ? Object.entries(game.pouchCounts).map(([c, n]) => `${COLOR_NAMES[c as Color]} ${n}`).join("、") : ""}>
          <img src={art.bag} alt="" style={{ width: 22, height: 25 }} />
          <small>布袋</small><b>{pouchLeft}</b>
        </span>
        <span className="hm-deck"><small>牌堆</small><b>{game.deckCount ?? 0}</b></span>
        <span className="hm-round">{lastRound ? <b className="hm-last">最后一轮</b> : <><small>第</small><b>{game.round}</b><small>轮</small></>}</span>
      </div>
    </section>
  );

  const marketNote = takeable
    ? "点一张领走"
    : canAct && unfinished(me.cards) >= MAX_UNFINISHED
      ? "面前已有 4 张没完成的卡"
      : canAct && t.tookCard
        ? "这回合已经领过了"
        : "每回合最多领 1 张";
  const market = (
    <section className={layout.bigMarket ? "hm-panel hm-market big" : "hm-panel hm-market"} data-tutorial="market">
      <h3>牌列 <small>{marketNote}</small></h3>
      <div className="hm-cards">
        {game.market.map((id) => (
          <CardView key={id} id={id} size={layout.bigMarket ? "big" : "small"} live={takeable} dim={canAct && !takeable} tutorial={`card:${id}`} {...(takeable ? { onClick: () => clickMarket(id) } : {})} />
        ))}
        {game.market.length === 0 && <p className="hm-muted">牌堆已经用完</p>}
      </div>
    </section>
  );

  const openCards = me.cards.filter((card) => card.placed < cubeCount(card.id));
  const doneCards = me.cards.filter((card) => card.placed >= cubeCount(card.id));
  const besideCards = !layout.mobile && !layout.stripUnder && layout.arrangement === "beside";
  const doneList = doneCards.length > 0 && (
    <div className="hm-done" title="已经放满方块的卡">
      <small>已完成</small>
      {doneCards.map((card) => (
        <span key={card.id} className="hm-chip" style={{ "--card": cardHex(card.id) } as CSSProperties}>
          {cardName(card.id)} {isSpiritId(card.id) ? "✓" : animalCard(card.id).scores[card.placed - 1]}
        </span>
      ))}
    </div>
  );
  const myCards = (
    <section className={besideCards ? `hm-panel hm-mycards beside cols-${layout.cardCols}` : "hm-panel hm-mycards"} data-tutorial="my-cards">
      <h3>{spectating ? `${me.name} 的卡` : "你的卡"} <small>{openCards.length}/{MAX_UNFINISHED}</small></h3>
      <div className="hm-cards">
        {openCards.map((card) => {
          const ready = readyCards.includes(card.id);
          return (
            <CardView
              key={card.id}
              id={card.id}
              size="small"
              placed={card.placed}
              ready={ready}
              selected={cardSel === card.id}
              live={ready}
              {...(canAct ? { onClick: () => clickHeld(card.id), sfx: ready ? "select" : "deny" } : {})}
              tutorial={`held:${card.id}`}
              badge={!isSpiritId(card.id) && card.placed > 0 ? <b className="hm-card-points">{animalCard(card.id).scores[card.placed - 1]}</b> : null}
            />
          );
        })}
        {openCards.length === 0 && <p className="hm-muted">{doneCards.length > 0 ? "卡都放满了，可以再领。" : "还没有卡。每回合可以从牌列领 1 张。"}</p>}
      </div>
      {doneList}
    </section>
  );

  const handTokens = t.hand.length > 0 && actor?.id === me.id && (
    <div className="hm-hand" data-tutorial="hand">
      <small>手里</small>
      {t.hand.map((color, index) => (
        <button
          key={`${index}-${color}`}
          type="button"
          className={index === handSel && !cubeMode ? "hm-hand-token selected" : "hm-hand-token"}
          disabled={!canAct}
          data-sfx="select"
          onClick={() => { setCardSel(null); setHandSel(index); }}
          title={COLOR_NAMES[color]}
          data-token={color}
          style={{ width: TOKEN.w * layout.hk, height: TOKEN.h * layout.hk + 4 }}
        >
          <img src={art.token(color)} alt={COLOR_NAMES[color]} style={{ width: TOKEN.w * layout.hk, height: TOKEN.h * layout.hk }} />
        </button>
      ))}
    </div>
  );

  const controls = !spectating && !finished && !spiritPhase && (
    <div className="hm-controls">
      {handTokens}
      {canAct && (
        <>
          <button className="quiet-button" type="button" disabled={t.undoCount === 0 || busy} onClick={undo} data-tutorial="undo">撤销</button>
          <button className="primary-button hm-end" type="button" disabled={!canEnd || busy} onClick={endTurn} data-tutorial="end-turn">结束回合</button>
        </>
      )}
      {canHint && (
        <button className={shownHint ? "quiet-button hm-hint on" : "quiet-button hm-hint"} type="button" data-tutorial="hint" data-hint-anchor={shownHint?.anchor ?? ""} onClick={toggleHint} title="让人机告诉你它会怎么走（键盘 H）">提示</button>
      )}
      {extraControls}
      {autoPlaying && <button className="primary-button hm-auto-cancel" type="button" onClick={() => onAuto(false)}>取消托管</button>}
      {!myTurn && !autoPlaying && actor && <span className="hm-controls-note">等 {nameOf(actor.id)} 行动</span>}
    </div>
  );
  const autoToggle = !spectating && !finished && !autoPlaying && (
    <button className="quiet-button hm-auto-toggle" type="button" onClick={() => onAuto(true)} title="让人机替你打，随时能取消">托管</button>
  );

  const feedback = (error || shownNotice) && <p className={error ? "hm-feedback error" : "hm-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</p>;
  const board = (
    <HexBoard
      board={me.board}
      side={side}
      k={layout.k}
      overlays={overlays}
      ghost={tokenMode && hover && validCells.has(hover) && handColor ? { cell: hover, color: handColor } : null}
      {...(canAct ? { onCell: clickCell, onHover: setHover } : {})}
      fresh={fresh.tokens.get(me.id) ?? EMPTY}
      freshCubes={fresh.cubes.get(me.id) ?? EMPTY}
      version={game.version}
      label={`${me.name} 的版图`}
      tutorial="my-board"
    />
  );
  const mine = layout.mobile || layout.stripUnder ? (
    <section className={["hm-mine", "stacked", myTurn ? "active" : ""].join(" ")} style={{ "--seat": seatOf(me.id) } as CSSProperties} data-tutorial="my-area">
      <div className="hm-head-row"><PlayerHead player={me} you={!spectating} member={memberOf(me.id)} game={game} big />{autoToggle}</div>
      {feedback}
      {controls}
      {board}
    </section>
  ) : (
    <section className={["hm-mine", myTurn ? "active" : ""].join(" ")} style={{ "--seat": seatOf(me.id) } as CSSProperties} data-tutorial="my-area">
      {board}
      <div className="hm-strip" style={{ width: STRIP_W }}>
        <PlayerHead player={me} you={!spectating} member={memberOf(me.id)} game={game} big />
        {!layout.side && <p className="hm-strip-detail">{detail || (spectating ? "观战中" : "")}</p>}
        {feedback}
        {controls}
      </div>
      {besideCards && myCards}
    </section>
  );

  const [oppView, setOppView] = useState<string | null>(null);
  const opps = opponents.length > 0 && (
    <section className={layout.fullOpponents || layout.mobile ? "hm-opps" : "hm-opps mini"} data-tutorial="opponents">
      {opponents.map((player) => (
        <div
          key={player.id}
          className={["hm-opp", actor?.id === player.id ? "active" : ""].join(" ")}
          style={{ "--seat": seatOf(player.id) } as CSSProperties}
        >
          <PlayerHead player={player} you={player.id === selfId} member={memberOf(player.id)} game={game} />
          <button type="button" className="hm-opp-board" onClick={() => setOppView(player.id)} title={`看 ${player.name} 的版图和卡`}>
            {layout.fullOpponents || layout.mobile ? (
              <HexBoard
                board={player.board}
                side={side}
                k={1}
                overlays={recentOverlay(game, player.id)}
                fresh={fresh.tokens.get(player.id) ?? EMPTY}
                freshCubes={fresh.cubes.get(player.id) ?? EMPTY}
                version={game.version}
                label={`${player.name} 的版图`}
              />
            ) : (
              <MiniBoard player={player} side={side} recent={recentOverlay(game, player.id)} />
            )}
          </button>
          <div className="hm-chips">
            {player.cards.length === 0 && <small className="hm-muted">还没有卡</small>}
            {player.cards.map((card) => (
              <span key={card.id} className="hm-chip" style={{ "--card": cardHex(card.id) } as CSSProperties} title={`${cardName(card.id)}：已放 ${card.placed}/${cubeCount(card.id)}`}>
                {layout.fullOpponents || layout.mobile ? `${cardName(card.id)} ` : ""}{card.placed}/{cubeCount(card.id)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
  const viewed = oppView ? game.players.find((player) => player.id === oppView) : undefined;
  const oppDialog = viewed && (
    <div className="gm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOppView(null); }}>
      <section className="gm-panel hm-opp-detail" role="dialog" aria-modal="true" aria-label={`${viewed.name} 的版图`} style={{ "--seat": seatOf(viewed.id) } as CSSProperties}>
        <PlayerHead player={viewed} you={viewed.id === selfId} member={memberOf(viewed.id)} game={game} big />
        <div className="hm-opp-detail-body">
          <HexBoard board={viewed.board} side={side} k={layout.mobile ? 1 : 2} overlays={recentOverlay(game, viewed.id)} label={`${viewed.name} 的版图`} />
          <div className="hm-cards wrap">
            {viewed.cards.map((card) => <CardView key={card.id} id={card.id} size="small" placed={card.placed} />)}
            {viewed.cards.length === 0 && <p className="hm-muted">还没有卡</p>}
          </div>
        </div>
        <div className="gm-panel-actions">
          <button className="primary-button" type="button" onClick={() => setOppView(null)}>关上</button>
        </div>
      </section>
    </div>
  );

  const status = (
    <section className="hm-panel hm-status">
      <h2>{headline}</h2>
      {detail && <p>{detail}</p>}
      {(error || shownNotice) && <p className={error ? "hm-feedback error" : "hm-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</p>}
    </section>
  );
  const scoreList = (
    <section className="hm-panel hm-scores" data-tutorial="scores">
      {[...game.players].sort((a, b) => b.score - a.score).map((player) => (
        <div key={player.id} className={player.id === myId ? "mine" : ""}>
          <i style={{ background: seatOf(player.id) }} />
          <span>{nameOf(player.id)}</span>
          <b>{player.score}</b>
        </div>
      ))}
    </section>
  );
  const sidePanel = (
    <aside className="hm-side">
      {spectating && <SpectateBar room={room} watchId={myId} onWatch={onWatch} onLeave={onLeave} />}
      {layout.side && status}
      {scoreList}
      <section className="hm-panel hm-tabs">
        <div className="hm-tab-bar" role="tablist">
          <button type="button" role="tab" aria-selected={sideTabs.tab === "log"} className={sideTabs.tab === "log" ? "active" : ""} onClick={() => sideTabs.setTab("log")}>动作记录</button>
          <button type="button" role="tab" aria-selected={sideTabs.tab === "chat"} className={sideTabs.tab === "chat" ? "active" : ""} onClick={() => sideTabs.setTab("chat")}>
            聊天{sideTabs.unread > 0 && <em>{sideTabs.unread}</em>}
          </button>
        </div>
        {sideTabs.tab === "log" ? (
          log.length === 0 ? <p className="hm-muted">还没有动作。</p> : <ul className="hm-log">{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>
        ) : <div className="hm-chat">{chat}</div>}
      </section>
    </aside>
  );
  const leftColumn = (
    <div className="hm-left">
      {mine}
      {layout.arrangement === "under" && supply}
    </div>
  );
  const rightColumn = (
    <div className="hm-right">
      {layout.arrangement !== "under" && supply}
      {layout.arrangement === "beside" ? market : <div className="hm-row">{market}{myCards}</div>}
      {opps}
    </div>
  );
  const message = error || shownNotice || detail;
  return (
    <div className={["hm-screen", layout.mobile ? "mobile" : "", layout.side ? "with-side" : ""].join(" ")}>
      <header className="hm-topbar">
        {brand}
        <div className="hm-turn" data-tutorial="turn">
          {!finished && (
            <span className={myTurn ? "hm-turn-who mine" : "hm-turn-who"}>
              {actor && <i style={{ background: seatOf(actor.id) }} />}
              {headline}
            </span>
          )}
          {showTimer && <b className={secondsLeft! <= 10 ? "hm-timer low" : "hm-timer"}>{secondsLeft}s</b>}
          {finished && <span className="hm-turn-who">游戏结束</span>}
        </div>
        <div className="hm-topbar-right">
          {!layout.mobile && !layout.stripUnder && autoToggle}
          {themeToggle}
          <GameRules />
          <GameRoomMenu room={room} />
          {spectating && <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>}
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {!layout.side && !layout.mobile && (
            <button className="quiet-button hm-drawer-toggle" type="button" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
              记录 / 聊天{sideTabs.unread > 0 ? ` · ${sideTabs.unread}` : ""}
            </button>
          )}
          {connection}
        </div>
      </header>
      {layout.mobile && message && <p className={error ? "hm-detail error" : "hm-detail"} role={error ? "alert" : "status"}>{message}</p>}
      <div className="hm-main" ref={mainRef}>
        <div className="hm-table" style={{ "--scene": `url(${art.bg(theme === "day")})` } as CSSProperties}>
          {layout.mobile ? (
            <>
              {supply}
              {mine}
              {market}
              {myCards}
              {opps}
            </>
          ) : (
            <>
              {leftColumn}
              {rightColumn}
            </>
          )}
        </div>
        {(layout.side || drawer || layout.mobile) && sidePanel}
      </div>
      {spiritPhase && !spectating && <SpiritPicker game={game} me={me} nameOf={nameOf} onPick={(cardId) => onCommand({ type: "pickSpirit", cardId })} busy={busy} />}
      {confirmEnd > 0 && (
        <div className="gm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmEnd(0); }}>
          <section className="gm-panel gm-confirm" role="alertdialog" aria-modal="true" aria-labelledby="hm-end-title" data-tutorial="end-confirm">
            <h2 id="hm-end-title">还有 {confirmEnd} 个方块可以放</h2>
            <p>版图上已经摆出了卡上的图案，放了方块就能得分。确定不放，直接结束回合吗？</p>
            <div className="gm-panel-actions">
              <button type="button" className="quiet-button" autoFocus onClick={() => setConfirmEnd(0)}>回去放方块</button>
              <button type="button" className="quiet-button danger" onClick={() => { setConfirmEnd(0); onCommand({ type: "endTurn" }); }}>结束回合</button>
            </div>
          </section>
        </div>
      )}
      {oppDialog}
      {finished && <FinalDialog game={game} room={room} myId={selfId} spectating={spectating} nameOf={nameOf} seatOf={seatOf} onRematch={onRematch} onLeave={onLeave} actions={finalActions} />}
      {shownHint && (
        <Coach
          view={{
            key: `hint-${game.version}`,
            say: shownHint.say,
            ...(shownHint.note ? { note: shownHint.note } : {}),
            anchor: shownHint.anchor,
            focus: false,
            face: "think",
            actions: <button className="quiet-button" type="button" onClick={() => setHint(null)}>知道了</button>,
          }}
        />
      )}
      {tips.tip && <TipToast tip={tips.tip} onClose={tips.dismiss} onNever={tips.never} />}
    </div>
  );
}

const MINI_COLOR: Record<string, string> = { W: "#4b8fd8", K: "#a3a8b0", B: "#a36b3c", G: "#4fae3e", Y: "#e8c040", R: "#d04a3a" };

/** 对手的小地图（放不下完整版图时）：每格画最上面的颜色，2、3 层写层数，方块画一个橙点。点开看大图。 */
function MiniBoard({ player, side, recent }: { player: Player; side: "A" | "B"; recent: Map<string, Overlay> }) {
  const cols = side === "A" ? [5, 4, 5, 4, 5] : [4, 3, 4, 3, 4, 3, 4];
  const w = 20;
  const h = 18;
  const width = (cols.length - 1) * 15 + w;
  const height = Math.max(...cols.map((rows, c) => rows * h + (c % 2 ? h / 2 : 0)));
  return (
    <span className="hm-mini" style={{ width, height }}>
      {cols.flatMap((rows, c) => Array.from({ length: rows }, (_, r) => {
        const cell = `${c},${r}`;
        const stack = player.board[cell]?.stack ?? [];
        const topColor = stack.length ? MINI_COLOR[stack[stack.length - 1]!] : undefined;
        return (
          <i
            key={cell}
            className={recent.has(cell) ? "recent" : ""}
            style={{ left: c * 15, top: r * h + (c % 2 ? h / 2 : 0), width: w, height: h, ...(topColor ? { background: topColor } : {}) }}
          >
            {stack.length > 1 ? stack.length : ""}
            {player.board[cell]?.cube && <b />}
          </i>
        );
      }))}
    </span>
  );
}

/** 对手版图上：他这回合 / 上一回合放的格子。 */
function recentOverlay(game: GameState, playerId: string): Map<string, Overlay> {
  const map = new Map<string, Overlay>();
  const current = game.phase === "play" ? game.players[game.currentPlayer]?.id : undefined;
  const cells = current === playerId ? game.turnState.placed : game.lastTurn?.player === playerId ? game.lastTurn.placed : [];
  for (const cell of cells) map.set(cell, "last");
  return map;
}

/** 侧栏的「动作记录 / 聊天」切换和未读数。 */
function useSideTabs(room: LobbyRoomSnapshot) {
  const [tab, setTab] = useState<"log" | "chat">("log");
  const [seen, setSeen] = useState(room.chat.length);
  const unread = tab === "chat" ? 0 : Math.max(0, room.chat.length - seen);
  useEffect(() => {
    if (tab === "chat") setSeen(room.chat.length);
  }, [tab, room.chat.length]);
  return {
    tab,
    setTab: (next: "log" | "chat") => {
      setTab(next);
      if (next === "chat") setSeen(room.chat.length);
    },
    unread,
  };
}

/** 玩家名牌：座位色、名字、标签、分数。 */
function PlayerHead({ player, you, member, game, big = false }: { player: Player; you: boolean; member: LobbyMember | undefined; game: GameState; big?: boolean }) {
  const offline = !member?.connected;
  const active = game.phase === "play" && game.players[game.currentPlayer]?.id === player.id;
  const first = game.players[game.first]?.id === player.id;
  return (
    <div className={["hm-head", big ? "big" : "", active ? "active" : ""].join(" ")}>
      <i className="hm-seat" />
      <strong title={player.name}>{player.name}</strong>
      {first && <img className="hm-first" src={art.first} alt="起始玩家" title="起始玩家" />}
      {you && <small className="hm-you">你</small>}
      {member?.bot && <small className="hm-bot">人机</small>}
      {!member?.bot && (member?.auto || offline) && <small className="hm-auto">托管</small>}
      {offline && !member?.bot && <small className="hm-offline">离线</small>}
      {game.phase === "spirit" && <small className="hm-muted-tag">{player.spiritPick ? "选好了" : "在选"}</small>}
      <b className="hm-score" title="现在的总分" {...(big ? { "data-tutorial": "my-score" } : {})}>{player.score}</b>
    </div>
  );
}

/** 自然之灵：开局时所有人同时从发到的两张里选一张。 */
function SpiritPicker({ game, me, nameOf, onPick, busy }: { game: GameState; me: Player; nameOf: (id: string) => string; onPick: (cardId: string) => void; busy: boolean }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return <button className="primary-button hm-show-final" type="button" onClick={() => setHidden(false)}>选自然之灵</button>;
  const choices = me.spiritChoices ?? [];
  const picked = me.spiritPick;
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel hm-spirit-pick" role="dialog" aria-modal="true" aria-labelledby="hm-spirit-title" data-tutorial="spirit-pick">
        <h2 id="hm-spirit-title">{picked ? "选好了，等其他人" : "选一张自然之灵"}</h2>
        <p>摆出卡上的图案、放上它的方块后，终局按卡上的说法另外加分。另一张移出游戏，谁也看不到。</p>
        <div className="hm-spirit-choices">
          {choices.map((id) => (
            <div key={id} className="hm-spirit-choice">
              <CardView id={id} size="big" live={!picked} selected={picked === id} {...(!picked && !busy ? { onClick: () => onPick(id) } : {})} />
              <p><b>{spiritCard(id).name}</b>{spiritCard(id).rule}</p>
            </div>
          ))}
        </div>
        <ul className="hm-spirit-status">
          {game.players.map((player) => <li key={player.id}>{nameOf(player.id)}：{player.spiritPick ? "选好了" : "还在选"}</li>)}
        </ul>
        <div className="gm-panel-actions">
          <button className="quiet-button" type="button" onClick={() => setHidden(true)}>先看看牌桌</button>
        </div>
      </section>
    </div>
  );
}

// ---------- 终局 ----------

const PARTS: { key: "trees" | "mountains" | "fields" | "houses" | "water"; label: string; icon: Parameters<typeof art.icon>[0] }[] = [
  { key: "trees", label: "树", icon: "tree" },
  { key: "mountains", label: "山", icon: "mountain" },
  { key: "fields", label: "田", icon: "field" },
  { key: "houses", label: "房屋", icon: "house" },
  { key: "water", label: "水", icon: "water" },
];

function FinalDialog({ game, room, myId, spectating, nameOf, seatOf, onRematch, onLeave, actions }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  myId: string;
  spectating: boolean;
  nameOf: (id: string) => string;
  seatOf: (id: string) => string;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
  actions?: ReactNode | undefined;
}) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const scores: ScoreBreakdown[] = [...result.scores].sort((a, b) => b.total - a.total || b.animalCubes - a.animalCubes);
  const [hidden, setHidden] = useState(false);
  const water = game.config.side === "A" ? "河流" : "岛屿";
  if (hidden) {
    return <button className="primary-button hm-show-final" type="button" onClick={() => setHidden(false)}>看结算</button>;
  }
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel hm-final" role="dialog" aria-modal="true" aria-labelledby="hm-final-title" data-tutorial="final">
        <div className="hm-final-wreath" style={{ backgroundImage: `url(${art.result})` }} aria-hidden="true" />
        <h2 id="hm-final-title">{result.winners.includes(myId) ? (result.winners.length > 1 ? "并列第一！" : "你赢了！") : "游戏结束"}</h2>
        <p className="hm-final-reason">{result.reason === "board" ? "有人的版图只剩 2 个空格以内，这一轮打完结束。" : "布袋空了，这一轮打完结束。"}</p>
        <ol className="hm-standings">
          {scores.map((score, index) => {
            const winner = result.winners.includes(score.player);
            const tie = scores.some((other) => other !== score && other.total === score.total);
            return (
              <li key={score.player} className={winner ? "winner" : ""} style={{ "--seat": seatOf(score.player) } as CSSProperties}>
                <span className="hm-rank">{winner ? "★" : index + 1}</span>
                <span className="hm-standing-name">
                  <strong>{nameOf(score.player)}</strong>
                  <span className="hm-parts">
                    {PARTS.map((part) => (
                      <span key={part.key}>
                        <img src={art.icon(part.key === "water" ? (game.config.side === "A" ? "river" : "island") : part.icon)} alt="" />
                        {part.key === "water" ? water : part.label} {score.landscape[part.key]}
                      </span>
                    ))}
                    <span><img src={art.icon("score")} alt="" />动物卡 {score.animals}</span>
                    {score.spirit && <span title={`自然之灵「${cardName(score.spirit.id)}」`}><img src={art.icon("spirit")} alt="" />自然之灵 {score.spirit.points}</span>}
                  </span>
                  {tie && <small>同分比方块：放了 {score.animalCubes} 个动物方块</small>}
                </span>
                <b className="hm-final-score">{score.total}</b>
              </li>
            );
          })}
        </ol>
        {actions ? (
          <div className="hm-rematch">
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => setHidden(true)}>看版图</button>
              {actions}
            </div>
          </div>
        ) : spectating ? (
          <div className="hm-rematch">
            <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length} 人同意）` : "对局结束"}</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => setHidden(true)}>看版图</button>
              <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>
            </div>
          </div>
        ) : room.rematch && (
          <div className="hm-rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => setHidden(true)}>看版图</button>
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
