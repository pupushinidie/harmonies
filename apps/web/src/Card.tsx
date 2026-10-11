import type { CSSProperties, ReactNode } from "react";
import { animalCard, cubeCount, isSpiritId, KIND_NAMES, spiritCard, type PatternCell } from "@harmonies/game";
import { art, CARD_HEX, hasAnim } from "./art.js";

/** 小六边形 12×11：列距 9、行距 11、奇数列（按轴向坐标算）低半格。2× 显示。 */
const MINI = { w: 12, h: 11, col: 9, row: 11 };

/** 卡上的图案示意（代码画，数据和画面对得上）。 */
export function PatternView({ cells, m = 2 }: { cells: readonly PatternCell[]; m?: number }) {
  const pos = cells.map((cell) => ({ cell, x: cell.q * MINI.col, y: (cell.a + cell.q / 2) * MINI.row }));
  const minX = Math.min(...pos.map((p) => p.x));
  const minY = Math.min(...pos.map((p) => p.y));
  const w = Math.max(...pos.map((p) => p.x)) - minX + MINI.w + 2;
  const h = Math.max(...pos.map((p) => p.y)) - minY + MINI.h + 2;
  return (
    <span className="hm-pattern" style={{ width: w * m, height: h * m }} title={cells.map((c) => (c.target ? `[${KIND_NAMES[c.kind]}]` : KIND_NAMES[c.kind])).join(" + ")}>
      {pos.map(({ cell, x, y }, index) => {
        const left = Math.round((x - minX + 1) * m);
        const top = Math.round((y - minY + 1) * m);
        return (
          <span key={index}>
            <img src={art.mini(cell.kind)} alt="" style={{ left, top, width: MINI.w * m, height: MINI.h * m }} />
            {cell.target && <img src={art.mini("target")} alt="" style={{ left: left - m, top: top - m, width: 14 * m, height: 13 * m }} />}
          </span>
        );
      })}
    </span>
  );
}

export interface CardProps {
  readonly id: string;
  /** big：立绘 2×、分数表 24px；small：立绘 1×。 */
  readonly size: "big" | "small";
  /** 已经放了几个方块（牌列里的卡不传）。 */
  readonly placed?: number;
  readonly onClick?: () => void;
  /** 能点（高亮）。 */
  readonly live?: boolean;
  readonly selected?: boolean;
  /** 不能点（压暗）。 */
  readonly dim?: boolean;
  /** 现在能放方块。 */
  readonly ready?: boolean;
  readonly title?: string;
  readonly tutorial?: string;
  readonly badge?: ReactNode;
}

function cardColor(id: string): string {
  return isSpiritId(id) ? CARD_HEX.spirit! : CARD_HEX[animalCard(id).color]!;
}

export function describeCard(id: string): string {
  if (isSpiritId(id)) {
    const card = spiritCard(id);
    return `自然之灵「${card.name}」：摆出图案放上方块后，${card.rule}`;
  }
  const card = animalCard(id);
  return `「${card.name}」：摆出图案就能放方块，${card.scores.map((score, index) => `${index + 1} 个 ${score} 分`).join("、")}`;
}

/** 动物卡 / 自然之灵卡：立绘 + 代码画的图案和分数表。 */
export function CardView({ id, size, placed, onClick, live, selected, dim, ready, title, tutorial, badge }: CardProps) {
  const spirit = isSpiritId(id);
  const big = size === "big";
  const s = big ? 2 : 1;
  const cells = spirit ? spiritCard(id).cells : animalCard(id).cells;
  const scores = spirit ? [] : animalCard(id).scores;
  const total = cubeCount(id);
  const done = placed !== undefined && placed >= total;
  const name = spirit ? spiritCard(id).name : animalCard(id).name;
  const classes = ["hm-card", size, live ? "live" : "", selected ? "selected" : "", dim ? "dim" : "", ready ? "ready" : "", done ? "done" : "", spirit ? "spirit" : ""].join(" ");
  const anim = !spirit && hasAnim(id);
  const content = (
    <>
      <span className="hm-card-art" style={{ width: 64 * s, height: 64 * s, backgroundImage: `url(${art.card(id)})` }}>
        {anim && <span className="hm-card-anim" style={{ backgroundImage: `url(${art.anim(id)})` }} />}
        <span className="hm-card-name">{name}</span>
        {badge}
      </span>
      <span className="hm-card-pattern"><PatternView cells={cells} m={big ? 3 : 2} /></span>
      {spirit ? (
        <span className="hm-card-scores spirit">{placed !== undefined && placed > 0 ? "已放好" : "终局另加分"}</span>
      ) : (
        <span className="hm-card-scores">
          {scores.map((score, index) => (
            <i key={index} className={placed !== undefined && index < placed ? "got" : placed === index ? "next" : ""}>{score}</i>
          ))}
        </span>
      )}
    </>
  );
  const style = { "--card": cardColor(id) } as CSSProperties;
  const tip = title ?? describeCard(id);
  if (onClick) {
    return (
      <button type="button" className={classes} style={style} onClick={onClick} title={tip} data-tutorial={tutorial} data-card={id} aria-pressed={selected}>
        {content}
      </button>
    );
  }
  return (
    <div className={classes} style={style} title={tip} data-tutorial={tutorial} data-card={id}>
      {content}
    </div>
  );
}
