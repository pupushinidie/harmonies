import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { BoardSide } from "@harmonies/game";
import { BOARD_PX, SUPPLY_PX } from "./art.js";

/**
 * 按牌桌区域的实际尺寸挑摆法：像素图只按整数倍放大。
 *
 * 桌面分左右两栏，几块东西有三种摆法（arrangement）：
 * - beside：左边是「自己的版图 + 窄栏（名牌、提示、手里的标记、按钮）+ 一列自己的卡」；右边 托盘 / 牌列 / 对手。
 * - right：左边是「版图 + 窄栏」；右边 托盘 / 牌列 / 自己的卡 / 对手。
 * - under：左边是「版图 + 窄栏」，下面是托盘；右边 牌列 / 自己的卡 / 对手。
 * 在放得下的里面挑：版图最大 → 摆法 beside > right > under → 对手完整版图 → 大卡牌列 → 托盘 2×。
 * 版图 4× 只在牌列也能用大卡时才用（不然右边太挤）。
 * 手机：从上到下 托盘、自己的版图和按钮、牌列、自己的卡、对手，可以往下滚。
 */
export type Arrangement = "beside" | "right" | "under";

export interface Layout {
  readonly mobile: boolean;
  /** 侧栏（状态、分数、记录 / 聊天）放得下就常驻，否则是抽屉。 */
  readonly side: boolean;
  readonly arrangement: Arrangement;
  /** 自己的版图倍数。 */
  readonly k: number;
  /** 托盘倍数。 */
  readonly sk: number;
  /** 牌列用大卡。 */
  readonly bigMarket: boolean;
  /** beside 时自己的卡排几列。 */
  readonly cardCols: number;
  /** 对手用完整版图（1×）还是小地图。 */
  readonly fullOpponents: boolean;
  /** 窄栏放在版图下面（B 面这种又宽又矮的版图在小屏幕上）。 */
  readonly stripUnder: boolean;
  /** 手里的标记倍数。 */
  readonly hk: number;
}

export const CARD = {
  big: { w: 136, h: 244 },
  small: { w: 72, h: 144 },
};
const GAP = 12;
const SIDE_W = 300;
/** 窄栏宽度、里面的东西（名牌、提示、手里的标记、两个按钮、已完成的卡）大约要多高。 */
export const STRIP_W = 132;
const STRIP_H = { 1: 350, 2: 470 } as const;
const PANEL_HEAD = 28 + 12;

function rowWidth(count: number, w: number, gap: number): number {
  return count * w + Math.max(0, count - 1) * gap;
}

export function opponentBox(side: BoardSide, full: boolean): { w: number; h: number } {
  return full ? { w: BOARD_PX[side].w + 16, h: BOARD_PX[side].h + 28 + 24 + 16 } : { w: 132, h: 150 };
}

const MARKET = {
  big: { w: rowWidth(5, CARD.big.w, 4) + 16, h: CARD.big.h + PANEL_HEAD },
  small: { w: rowWidth(5, CARD.small.w, 4) + 16, h: CARD.small.h + PANEL_HEAD },
};
/** 自己没完成的卡最多 4 张（完成的收成一行小字）。 */
const MY_CARDS = { w: rowWidth(4, CARD.small.w, 4) + 16, h: CARD.small.h + PANEL_HEAD };

type Box = { w: number; h: number };
function column(boxes: Box[]): Box {
  const shown = boxes.filter((box) => box.h > 0);
  return { w: Math.max(0, ...shown.map((box) => box.w)), h: shown.reduce((sum, box) => sum + box.h, 0) + GAP * Math.max(0, shown.length - 1) };
}

export function pickLayout(width: number, height: number, side: BoardSide, opponents: number): Layout {
  if (width < 760) {
    const k = width >= BOARD_PX[side].w * 2 + 24 ? 2 : 1;
    return { mobile: true, side: false, arrangement: "right", k, sk: width >= SUPPLY_PX.w * 2 + 24 ? 2 : 1, bigMarket: false, cardCols: 4, fullOpponents: true, stripUnder: true, hk: 1 };
  }
  const withSide = width >= 1600;
  const tableW = width - (withSide ? SIDE_W + GAP : 0) - 24;
  const tableH = height - 24;
  const board = BOARD_PX[side];
  for (const k of [4, 3, 2]) {
    const boardW = board.w * k;
    const boardH = board.h * k;
    if (boardH + 20 > tableH) continue;
    for (const [arrangement, stripUnder] of [["beside", false], ["right", false], ["under", false], ["right", true], ["under", true]] as const) {
      const hk = k >= 3 && !stripUnder ? 2 : 1;
      if (!stripUnder && STRIP_H[hk] > boardH) continue;
      const cardCols = boardH >= rowWidth(4, CARD.small.h, 4) + PANEL_HEAD ? 1 : 2;
      if (arrangement === "beside" && cardCols === 2 && boardH < rowWidth(2, CARD.small.h, 4) + PANEL_HEAD) continue;
      for (const full of [true, false]) {
        const opp = opponentBox(side, full);
        const opps: Box = opponents > 0 ? { w: rowWidth(opponents, opp.w, GAP), h: opp.h } : { w: 0, h: 0 };
        for (const big of [true, false]) {
          if (k === 4 && !big) continue;
          const market = big ? MARKET.big : MARKET.small;
          for (const sk of [2, 1]) {
            const supply: Box = { w: SUPPLY_PX.w * sk + 16, h: SUPPLY_PX.h * sk + 16 + 28 };
            const mine: Box = stripUnder
              ? { w: boardW + 20, h: boardH + 20 + 156 }
              : { w: boardW + GAP + STRIP_W + 20 + (arrangement === "beside" ? GAP + rowWidth(cardCols, CARD.small.w, 4) : 0), h: boardH + 20 };
            let left: Box;
            let right: Box;
            if (arrangement === "beside") {
              left = mine;
              right = column([supply, market, opps]);
            } else if (arrangement === "right") {
              left = mine;
              const pair = market.w + GAP + MY_CARDS.w;
              right = column([supply, ...(big ? [market, MY_CARDS] : [{ w: pair, h: market.h }]), opps]);
              // 小卡牌列放不下和自己的卡并排时，分两行
              if (!big && pair > tableW - left.w - GAP) right = column([supply, market, MY_CARDS, opps]);
            } else {
              left = column([mine, supply]);
              right = column([market, MY_CARDS, opps]);
            }
            if (left.w + GAP + right.w <= tableW && Math.max(left.h, right.h) <= tableH) {
              return { mobile: false, side: withSide, arrangement, k, sk, bigMarket: big, cardCols, fullOpponents: full, stripUnder, hk };
            }
          }
        }
      }
    }
  }
  return { mobile: false, side: withSide, arrangement: "under", k: 2, sk: 1, bigMarket: false, cardCols: 2, fullOpponents: false, stripUnder: true, hk: 1 };
}

export function useLayout(side: BoardSide, opponents: number): [RefObject<HTMLDivElement | null>, Layout, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: window.innerWidth, height: window.innerHeight - 60 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setBox({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const mobile = window.innerWidth < 760;
  return [ref, pickLayout(mobile ? window.innerWidth : box.width, box.height, side, opponents), box];
}
