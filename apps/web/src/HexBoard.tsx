import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isSpiritId, parseKey, sideCells, type Board, type BoardSide, type Color } from "@harmonies/game";
import { art, BOARD_PX, cellOrigin, CUBE_ANCHOR, CUBE_PX, HEX, TOKEN } from "./art.js";

export type Overlay = "valid" | "target" | "pattern" | "hover" | "last";

/** 平顶六边形的点击区域（32×28 原图里的形状）。 */
const HEX_CLIP = "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)";

interface HexBoardProps {
  readonly board: Board;
  readonly side: BoardSide;
  /** 显示倍数。 */
  readonly k: number;
  readonly overlays?: ReadonlyMap<string, Overlay>;
  /** 拿着标记悬停时的预览（60% 透明）。 */
  readonly ghost?: { readonly cell: string; readonly color: Color } | null;
  readonly onCell?: (cell: string) => void;
  readonly onHover?: (cell: string | null) => void;
  /** 这一次更新新放上去的格子（落下动画 + 木屑特效）；放方块的格子（星光）。 */
  readonly fresh?: ReadonlySet<string>;
  readonly freshCubes?: ReadonlySet<string>;
  /** 动画只看这个变没变。 */
  readonly version?: number;
  readonly label: string;
  readonly tutorial?: string;
  readonly children?: ReactNode;
}

/** 一块个人版图：版图图片 + 每格的高亮、标记摞、方块；可点的格子盖一层六边形按钮。 */
export function HexBoard({ board, side, k, overlays, ghost, onCell, onHover, fresh, freshCubes, version = 0, label, tutorial, children }: HexBoardProps) {
  const size = BOARD_PX[side];
  const cells = sideCells(side);
  // 下面的格子后画，盖住上面格子伸上来的部分
  const order = [...cells].sort((x, y) => {
    const a = cellOrigin(...parseKey(x));
    const b = cellOrigin(...parseKey(y));
    return a.y - b.y || a.x - b.x;
  });
  const effects = useEffects(version, fresh, freshCubes);
  return (
    <div
      className="hm-board"
      role="group"
      aria-label={label}
      data-tutorial={tutorial}
      style={{ width: size.w * k, height: size.h * k, backgroundImage: `url(${art.board(side)})`, backgroundSize: `${size.w * k}px ${size.h * k}px` } as CSSProperties}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
    >
      {order.map((cell) => {
        const here = board[cell]!;
        const showGhost = ghost?.cell === cell;
        if (here.stack.length === 0 && !showGhost) return null;
        const o = cellOrigin(...parseKey(cell));
        const stack = here.stack.join("");
        const ghostStack = showGhost ? stack + ghost.color : "";
        const isFresh = fresh?.has(cell) === true;
        return (
          <div key={`t-${cell}`} className="hm-stack" style={{ left: o.x * k, top: (o.y + TOKEN.dy) * k, width: TOKEN.w * k, height: TOKEN.h * k }}>
            {stack && <img className={isFresh ? `hm-token fresh v${version % 2}` : "hm-token"} src={art.stack(stack)} alt="" />}
            {showGhost && validStackArt(ghostStack) && <img className="hm-token ghost" src={art.stack(ghostStack)} alt="" />}
            {here.cube && <Cube stack={stack} spirit={isSpiritId(here.cube)} k={k} fresh={freshCubes?.has(cell) === true} />}
          </div>
        );
      })}
      {cells.map((cell) => {
        const overlay = overlays?.get(cell);
        if (!overlay) return null;
        const o = cellOrigin(...parseKey(cell));
        return (
          <img
            key={`o-${cell}`}
            className={`hm-hex-overlay ${overlay}`}
            src={art.hex(overlay === "last" ? "hover" : overlay)}
            alt=""
            style={{ left: o.x * k, top: o.y * k, width: HEX.w * k, height: HEX.h * k }}
          />
        );
      })}
      {cells.map((cell) => {
        if (overlays?.get(cell) !== "target") return null;
        const o = cellOrigin(...parseKey(cell));
        const stack = board[cell]!.stack.join("");
        const anchor = CUBE_ANCHOR[stack] ?? [16, 28];
        return (
          <img
            key={`h-${cell}`}
            className="hm-cube-hint"
            src={art.cube(false)}
            alt=""
            style={{ left: (o.x + anchor[0] - CUBE_PX.animal.w / 2) * k, top: (o.y + TOKEN.dy + anchor[1] - CUBE_PX.animal.h) * k, width: CUBE_PX.animal.w * k, height: CUBE_PX.animal.h * k }}
          />
        );
      })}
      {effects.map((effect) => {
        const o = cellOrigin(...parseKey(effect.cell));
        const cx = (o.x + HEX.w / 2) * k;
        const cy = (o.y + HEX.h / 2) * k;
        const w = (effect.kind === "place" ? 48 : 40) * k;
        const h = 40 * k;
        return (
          <span
            key={effect.id}
            className={`hm-fx ${effect.kind}`}
            style={{ left: cx - w / 2, top: cy - h / 2 - (effect.kind === "cube" ? 10 * k : 0), width: w, height: h, backgroundImage: `url(${art.fx(effect.kind)})` }}
          />
        );
      })}
      {onCell &&
        cells.map((cell) => {
          const o = cellOrigin(...parseKey(cell));
          const overlay = overlays?.get(cell);
          const live = overlay === "valid" || overlay === "target";
          return (
            <button
              key={`b-${cell}`}
              type="button"
              className={live ? "hm-hit live" : "hm-hit"}
              data-cell={cell}
              data-tutorial={tutorial ? `cell:${cell}` : undefined}
              aria-label={`格子 ${cell}`}
              style={{ left: o.x * k, top: o.y * k, width: HEX.w * k, height: HEX.h * k, clipPath: HEX_CLIP }}
              onClick={() => onCell(cell)}
              onPointerEnter={onHover ? () => onHover(cell) : undefined}
            />
          );
        })}
      {children}
    </div>
  );
}

const VALID = new Set(["W", "Y", "K", "KK", "KKK", "B", "BB", "G", "BG", "BBG", "R", "KR", "BR", "RR"]);
function validStackArt(stack: string): boolean {
  return VALID.has(stack);
}

function Cube({ stack, spirit, k, fresh }: { stack: string; spirit: boolean; k: number; fresh: boolean }) {
  const anchor = CUBE_ANCHOR[stack] ?? [16, 28];
  const px = spirit ? CUBE_PX.spirit : CUBE_PX.animal;
  return (
    <img
      className={fresh ? "hm-cube fresh" : "hm-cube"}
      src={art.cube(spirit)}
      alt={spirit ? "自然之灵方块" : "动物方块"}
      style={{ left: (anchor[0] - px.w / 2) * k, top: (anchor[1] - px.h) * k, width: px.w * k, height: px.h * k }}
    />
  );
}

interface Effect {
  readonly id: string;
  readonly cell: string;
  readonly kind: "place" | "cube";
}

/** 临时特效：每次 version 变化时把新放的格子加进来，播完（0.4–0.5 秒）自己删掉；计时器只在卸载时清空。 */
function useEffects(version: number, fresh?: ReadonlySet<string>, freshCubes?: ReadonlySet<string>): Effect[] {
  const [effects, setEffects] = useState<Effect[]>([]);
  const timers = useRef(new Set<number>());
  const seen = useRef(version);
  useEffect(() => {
    if (version === seen.current) return;
    seen.current = version;
    const added: Effect[] = [
      ...[...(fresh ?? [])].map((cell) => ({ id: `${version}-p-${cell}`, cell, kind: "place" as const })),
      ...[...(freshCubes ?? [])].map((cell) => ({ id: `${version}-c-${cell}`, cell, kind: "cube" as const })),
    ];
    if (added.length === 0) return;
    setEffects((previous) => [...previous, ...added]);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setEffects((previous) => previous.filter((effect) => !added.includes(effect)));
    }, 600);
    timers.current.add(timer);
  }, [version]);
  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer);
  }, []);
  return effects;
}
