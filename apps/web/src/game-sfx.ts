import { useEffect, useRef } from "react";
import type { GameEvent, GameState } from "@harmonies/game";
import { sfx, synth, type SfxName } from "./gm-sound.js";

/**
 * 自然和弦的动作音效：对比前后两次对局快照（version 和这一步的 events），把刚发生的动作配上声音。
 * 自己的动作响亮，别人的减半（观战时都算别人的）。第一次拿到快照（进房间、重连、观战刚进来）不出声；
 * version 一下跳了好几步、或者换了一局，动作不补响，只提示轮到你。
 *
 * - 从中央版图拿方块 TokensTaken：几块木头方块碰在一起的「嗒嗒」（几块就几声）
 * - 放方块 TokenPlaced：招牌「木块落下」（摞得越高音越亮）；地貌分涨了 3 分以上再响一声得分
 * - 领动物卡 CardTaken：一张卡拍到面前
 * - 放动物 CubePlaced：招牌「动物落脚」（一声木头落下 + 一声上扬的小鸟叫）；分数涨了响得分，这张卡放满再加 sparkle
 * - 撤销 Undone：pass
 * - 结束回合 TurnEnded：补满中央版图的哗啦声 + 牌列补卡的擦声；自己的再响 turnPassed
 * - 有人触发终局 EndTriggered / 最后一轮：reveal
 * - 自然之灵：选好 SpiritPicked = 一张卡；大家一起亮出 SpiritsRevealed = 翻牌 + sparkle
 * - 超时 TurnTimedOut：自己的响 timeout；服务器替人把整回合一口气做完时，放方块、放动物各只响一下
 * - 轮到你 yourTurn；终局 gameOver(赢/输)
 */

function log(name: string) {
  if (import.meta.env.DEV) {
    const w = window as unknown as { __sfxLog?: string[] };
    (w.__sfxLog ??= []).push(name);
  }
}

function play<K extends SfxName>(name: K, ...args: Parameters<(typeof sfx)[K]>) {
  log(name);
  (sfx[name] as (...a: Parameters<(typeof sfx)[K]>) => void)(...args);
}

const later = (ms: number, fn: () => void) => (ms <= 0 ? fn() : window.setTimeout(fn, ms));

/** 招牌：一块木头方块放到版图上，摞得越高（height 1–3）越清脆。 */
function tokenDown(mine: boolean, height: number) {
  log("tokenDown");
  const v = synth.level(mine);
  const p = 1 + (height - 1) * 0.18;
  synth.noise({ duration: 0.04, volume: 0.28 * v, filter: "lowpass", freq: 1300 * p });
  synth.tone(240 * p * synth.jitter(), { duration: 0.1, volume: 0.2 * v, type: "triangle" });
  synth.tone(720 * p * synth.jitter(), { at: 0.005, duration: 0.05, volume: 0.06 * v, type: "triangle" });
}

/** 招牌：动物方块落到版图上——木头「咚」+ 一声上扬的小鸟叫。 */
function animalDown(mine: boolean) {
  log("animalDown");
  sfx.place(mine);
  const v = synth.level(mine);
  synth.tone(1400 * synth.jitter(), { at: 0.08, duration: 0.09, volume: 0.07 * v, type: "sine", glideTo: 2100 });
  synth.tone(1700 * synth.jitter(), { at: 0.19, duration: 0.11, volume: 0.06 * v, type: "sine", glideTo: 2500 });
}

/** 结束回合：中央版图补满（几块木头倒进去）、牌列补卡。 */
function refill(tokens: number, cards: number) {
  log("refill");
  for (let i = 0; i < Math.min(tokens, 4); i += 1) {
    const at = i * 0.07 + Math.random() * 0.02;
    synth.noise({ at, duration: 0.03, volume: 0.1, filter: "lowpass", freq: 1500 * synth.jitter(0.2) });
    synth.tone(300 * synth.jitter(0.2), { at, duration: 0.06, volume: 0.05, type: "triangle" });
  }
  if (cards > 0) window.setTimeout(() => sfx.draw(false, cards), Math.min(tokens, 4) * 70 + 80);
}

export function useGameSfx(game: GameState, selfId: string) {
  const previous = useRef<GameState | null>(null);
  useEffect(() => {
    const prev = previous.current;
    previous.current = game;
    if (!prev || prev === game || prev.version === game.version) return;
    const mineOf = (id: string | undefined) => id !== undefined && id !== "" && id === selfId;
    const currentId = (state: GameState) => (state.phase === "play" ? state.players[state.currentPlayer]?.id : undefined);
    // 超时时服务器替你把整个回合一口气做完（一次更新里 version 跳好几步）：照样响，但每种只响一下
    const timedOut = game.events.some((event) => event.type === "TurnTimedOut");
    if (game.version < prev.version || (game.version - prev.version > 2 && !timedOut)) {
      if (mineOf(currentId(game)) && !mineOf(currentId(prev))) later(400, () => play("yourTurn"));
      return;
    }

    let t = 0;
    let ended: (GameEvent & { type: "GameEnded" }) | null = null;
    let yourTurn = false;
    let passed = false;
    let tokensPlayed = false;
    let cubesPlayed = false;
    const step = (gap: number, fn: () => void) => {
      later(t, fn);
      t += gap;
    };
    for (const event of game.events) {
      switch (event.type) {
        case "TurnTimedOut":
          if (mineOf(event.player)) step(350, () => play("timeout"));
          break;
        case "SpiritPicked": {
          const mine = mineOf(event.player);
          step(150, () => play("card", mine));
          break;
        }
        case "SpiritsRevealed":
          step(250, () => play("flip", true));
          step(300, () => play("sparkle", false));
          break;
        case "TokensTaken": {
          const mine = mineOf(event.player);
          const count = event.tokens.length;
          step(220, () => play("tile", mine, Math.max(1, Math.min(count, 3)), 0.8));
          break;
        }
        case "TokenPlaced": {
          const mine = mineOf(event.player);
          const height = game.players.find((p) => p.id === event.player)?.board[event.cell]?.stack.length ?? 1;
          const gain = event.scoreAfter - event.scoreBefore;
          if (timedOut && tokensPlayed) break;
          tokensPlayed = true;
          step(180, () => tokenDown(mine, Math.max(1, Math.min(height, 3))));
          if (gain >= 3 && !timedOut) step(250, () => play("score", mine, false));
          break;
        }
        case "CardTaken": {
          const mine = mineOf(event.player);
          step(200, () => play("card", mine));
          break;
        }
        case "CubePlaced": {
          const mine = mineOf(event.player);
          const gain = event.scoreAfter - event.scoreBefore;
          if (timedOut && cubesPlayed) break;
          cubesPlayed = true;
          step(300, () => animalDown(mine));
          if (event.completed) step(300, () => play("sparkle", mine));
          else if (gain > 0) step(250, () => play("score", mine, gain >= 8));
          break;
        }
        case "Undone": {
          const mine = mineOf(event.player);
          step(150, () => play("pass", mine));
          break;
        }
        case "TurnEnded": {
          if (mineOf(event.player)) passed = true;
          const tokens = event.refilled.length;
          const cards = event.newCards.length;
          if (tokens > 0 || cards > 0) step(300, () => refill(tokens, cards));
          break;
        }
        case "EndTriggered":
          step(400, () => play("reveal", true));
          break;
        case "TurnStarted":
          if (mineOf(event.player)) yourTurn = true;
          break;
        case "GameEnded":
          ended = event;
          break;
      }
    }

    if (ended) {
      const won = selfId !== "" && ended.result.winners.includes(selfId);
      later(t + 500, () => play("gameOver", won));
      return;
    }
    if (yourTurn) later(Math.max(t, 450), () => play("yourTurn"));
    else if (passed) later(Math.max(t, 300), () => play("turnPassed"));
  }, [game, selfId]);
}
