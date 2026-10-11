/**
 * 自然和弦和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botAdvice, cubeCount, type GameCommand, type GameState } from "@harmonies/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "harmonies";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个元素（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
  /** 人机会走的那一步（界面据此先选好手里的标记 / 面前的卡）。 */
  readonly command?: GameCommand;
}

/** 「提示」：让人机从你的位置算一步（它本来就只看你能看到的信息），配一句原因。 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase === "finished") return { say: "这局已经结束了。", anchor: null };
  const current = game.players[game.currentPlayer];
  if (game.phase !== "play" || current?.id !== playerId) return { say: `等 ${current?.name ?? "别人"} 走完再问我。`, anchor: null };
  const advice = botAdvice(game, playerId);
  if (!advice) return { say: "现在没什么要做的。", anchor: null };
  const { command, reason } = advice;
  switch (command.type) {
    case "takeTokens":
      return { say: `我会拿第 ${command.space + 1} 格。`, note: reason, anchor: `space-${command.space}`, command };
    case "placeToken":
      return { say: "我会把手里的标记放在亮着的这一格。", note: reason, anchor: `cell:${command.cell}`, command };
    case "takeCard":
      return { say: "我会先领这张卡。", note: reason, anchor: `card:${command.cardId}`, command };
    case "placeCube":
      return { say: "我会在这里放方块。", note: reason, anchor: `cell:${command.cell}`, command };
    case "endTurn":
      return { say: "我会结束回合。", note: reason, anchor: "end-turn", command };
    default:
      return { say: reason, anchor: null, command };
  }
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  "pattern-ready": { title: "图案摆出来了", text: "面前亮着的卡可以放方块了：点这张卡，再点版图上橙框的格子。图案转个方向也算。" },
  "card-done": { title: "一张卡放满了", text: "放满的卡不再占「最多 4 张没完成」的名额，可以再领新卡。" },
  "four-cards": { title: "面前有 4 张没完成的卡", text: "要先放满其中一张，才能再领新卡。卡不能弃掉。" },
  "cube-lock": { title: "方块放下了", text: "这一格以后不能再叠标记，方块也不会拿走；图案以后被盖掉也照样算分。" },
  "last-round": { title: "最后一轮", text: "有人的版图快满了（或布袋空了）：这一轮打完就结束，抓紧把卡上的方块放满。" },
  "lonely-mountain": { title: "山要挨着山", text: "一座山旁边没有别的山就不得分。把山放在一起，越高分越多。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  const me = game.players.find((player) => player.id === selfId);
  if (!me) return ids;
  for (const event of game.events) {
    if (event.type === "EndTriggered") ids.push("last-round");
    if (event.type === "CubePlaced" && event.player === selfId) ids.push(event.completed ? "card-done" : "cube-lock");
  }
  const myTurn = game.phase === "play" && game.players[game.currentPlayer]?.id === selfId;
  if (myTurn) {
    const open = me.cards.filter((card) => card.placed < cubeCount(card.id)).length;
    if (open >= 4) ids.push("four-cards");
    const placedMountain = game.events.some((event) => event.type === "TokenPlaced" && event.player === selfId && event.color === "K" && event.scoreAfter === event.scoreBefore);
    if (placedMountain) ids.push("lonely-mountain");
  }
  return ids;
}
