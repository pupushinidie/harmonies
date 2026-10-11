import { legalActions } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

/**
 * 人机（占位实现，人机阶段会换成正式策略）：从合法行动里随机挑一个，不撤销。
 * 输入必须是 redactGameForViewer 处理过的状态。
 */
export function botCommand(state: GameState, playerId: string, random: () => number = Math.random): GameCommand | null {
  const actions = legalActions(state, playerId).filter((action) => action.type !== "undo");
  if (actions.length === 0) return null;
  return actions[Math.floor(random() * actions.length)]!;
}
