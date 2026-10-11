import { useEffect, useState } from "react";

/** 规则说明：一个按钮，点开是像素弹窗。用自己的话写，不照搬原版规则书。 */
function GameRules({ className = "quiet-button" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className={`${className} hm-rules-button`} type="button" aria-expanded={open} onClick={() => setOpen(true)}>规则</button>
      {open && (
        <div className="gm-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="gm-panel hm-rules" role="dialog" aria-modal="true" aria-labelledby="hm-rules-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="hm-rules-title">自然和弦怎么玩</h2>
            <div className="game-rules-block">
              <h3>目标</h3>
              <p>每人一块六边形格子的版图。用彩色标记摆出树、山、田、房屋和水，再给动物卡上的动物安家。终局时<b>地貌分 + 动物卡分</b>最高的人赢。</p>
            </div>
            <div className="game-rules-block">
              <h3>轮到你时</h3>
              <ol>
                <li><b>必须</b>从中央托盘挑一格，3 个标记全拿走，一个个放到自己版图上。</li>
                <li><b>可以</b>从牌列领 1 张动物卡（面前没完成的卡最多 4 张）。</li>
                <li><b>可以</b>放方块：版图上摆出了卡上的图案（转着摆也行），就在橙框标出的目标格上放一个方块，次数不限。</li>
                <li>这几件事顺序随意，结束回合之前每一步都能撤销。三个标记都放完才能结束回合。</li>
              </ol>
            </div>
            <div className="game-rules-block">
              <h3>怎么叠</h3>
              <ul>
                <li>任何标记都能放空格。山叠在山上（最多 3 层）；树干叠在 1 个树干上；树冠放在空格或树干上（这就是 1–3 高的树）。</li>
                <li>屋顶要压在<b>单层</b>的山、树干或屋顶上才是房屋；单放的屋顶不算房屋。</li>
                <li>水、田、树冠、房屋上面不能再放东西；放了方块的格子也不能再叠。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>怎么算分</h3>
              <ul>
                <li><b>树</b>：高 1 / 2 / 3 得 1 / 3 / 7。<b>山</b>：一样，但要挨着另一座山，否则 0 分。</li>
                <li><b>田</b>：每片相连的田（至少 2 个）得 5，再大也只 5 分，所以分成好几片。</li>
                <li><b>房屋</b>：四周 6 格最上面至少有 3 种颜色得 5。</li>
                <li><b>水</b>：A 面数最长的一条河（分叉不算长度），2 / 3 / 4 / 5 / 6 格得 2 / 5 / 8 / 11 / 15，之后每格 +4；B 面数被水隔开的岛（空格也算陆地），每个岛 5 分。</li>
                <li><b>动物卡</b>：按放了几个方块查卡下面的分数；没放完也照算。方块放下就不拿走，图案后来被盖掉也照样算。</li>
                <li><b>自然之灵</b>（开房选项）：开局从 2 张里选 1 张，放上它的方块后，终局按卡上的说法另外加分。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>什么时候结束</h3>
              <p>有人结束回合时版图只剩 2 个空格以内，或者托盘要补时布袋空了，就打完这一轮（每人回合数一样）后结束。同分时放到版图上的动物方块多的赢，再一样就并列。</p>
            </div>
            <div className="game-rules-block">
              <h3>时间和托管</h3>
              <p>每回合 90 秒，超时自动替你走完：拿第一格、标记放在地貌分最高的地方、能放的方块放上。连续超时 2 次转托管（人机替你打），掉线时也由人机代打，回来就交还给你。</p>
            </div>
            <div className="gm-panel-actions">
              <button className="primary-button" type="button" onClick={() => setOpen(false)}>知道了</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default GameRules;
