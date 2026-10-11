"""画廊：生成预览图（out/gallery/）和不阻塞的拍板 JSON（assets/gallery-decision.json）。推荐项 = selection.json 里挑定的。
python gallery.py
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"
G = OUT / "gallery"
DEC = ART.parent / "assets" / "gallery-decision.json"
SEL = json.loads((ART / "selection.json").read_text())["pick"]
PY = sys.executable
NIGHT = OUT / "pick" / "bg-night-s101-fixed.png"
DAY = OUT / "r1" / "bg-day-s202.png"
sys.path.insert(0, str(ART))
import preview  # noqa: E402

ANIMAL_CN = dict(a01="水獭", a02="绿头鸭", a03="青蛙", a04="苍鹭", a05="河狸", a06="翠鸟", a07="鳟鱼", a08="家燕", a09="白鹳",
                 a10="小家鼠", a11="蝙蝠", a12="刺猬", a13="松鼠", a14="猫头鹰", a15="啄木鸟", a16="浣熊", a17="公鹿", a18="獾",
                 a19="野猪", a20="棕熊", a21="北山羊", a22="旱獭", a23="金雕", a24="猞猁", a25="狼", a26="雪豹", a27="野兔",
                 a28="狐狸", a29="雉鸡", a30="仓鼠", a31="熊蜂", a32="鼹鼠")
COLOR_CN = {**{f"a{i:02d}": "蓝·水" for i in range(1, 8)}, **{f"a{i:02d}": "红·房屋" for i in range(8, 13)},
            **{f"a{i:02d}": "绿·树" for i in range(13, 21)}, **{f"a{i:02d}": "灰·山" for i in range(21, 27)},
            **{f"a{i:02d}": "黄·田" for i in range(27, 33)}}
SPIRIT_CN = dict(s01="麦穗金光野兔", s02="蒲公英小鸟", s03="树枝鹿角白鹿", s04="青苔老乌龟", s05="炉火暖光猫", s06="萤火小狐灯",
                 s07="山石熊", s08="水晶角公羊", s09="水波锦鲤", s10="浪花水马")


def p(rel):
    return OUT / f"{rel}.png"


def bigsplit(img: Image.Image, k: int, name: str) -> str:
    """小图放大 k 倍，左半夜间背景、右半白天背景，右下角 1× 原大。"""
    big = img.resize((img.width * k, img.height * k), Image.NEAREST)
    W, H = big.width * 2 + 60, big.height + 40
    n = Image.open(NIGHT).convert("RGBA").resize((W, int(W * 288 / 512)), Image.NEAREST).crop((0, 0, W, H))
    d = Image.open(DAY).convert("RGBA").resize((W, int(W * 288 / 512)), Image.NEAREST).crop((0, 0, W, H))
    canvas = n.copy()
    canvas.paste(d.crop((W // 2, 0, W, H)), (W // 2, 0))
    canvas.alpha_composite(big, (W // 4 - big.width // 2, 20))
    canvas.alpha_composite(big, (3 * W // 4 - big.width // 2, 20))
    canvas.alpha_composite(img, (W - img.width - 6, H - img.height - 6))
    out = G / f"{name}.png"
    canvas.convert("RGB").save(out)
    return str(out)


def opt(value, label, images, desc, rec=False):
    o = {"value": value, "label": label, "images": [str(i) for i in images], "description": desc}
    if rec:
        o["recommended"] = True
    return o


def main():
    G.mkdir(parents=True, exist_ok=True)
    qs = []
    # 背景
    for k, cands, why in (("night", ["pick/bg-night-s101-fixed", "r1/bg-night-s102", "r1/bg-night-s103"],
                           "推荐：胡桃木桌铺满画面，台灯在左上，落叶和橡果在四边，中间空着给版图；右边 4px 黑边已经修掉"),
                          ("day", ["r1/bg-day-s202", "r1/bg-day-s201", "r1/bg-day-s203"],
                           "推荐：浅橡木桌铺满，左上窗光和叶影，绿植在角上，中间空")):
        qs.append({"id": f"bg-{k}", "type": "choice", "question": f"{'夜间' if k == 'night' else '白天'}背景（木桌）", "options": [
            opt(c.split("/")[-1], c.split("/")[-1], [p(c)], why if i == 0 else "备选", i == 0) for i, c in enumerate(cands)],
            "allowOther": True})
    # 标记三套
    sets = [("tok-set2", "厚 5px、塔形树冠、小房子 41 号", True), ("tok-set1", "厚 4px、圆树冠、小房子 0 号", False),
            ("tok-set3", "宽圆片、圆树冠、小房子 31 号", False)]
    opts = []
    S = ["W", "Y", "K", "KK", "KKK", "B", "BB", "G", "BG", "BBG", "R", "KR", "BR", "RR"]
    for name, desc, rec in sets:
        row = Image.new("RGBA", (14 * 34, 46), (0, 0, 0, 0))
        for i, s in enumerate(S):
            row.alpha_composite(Image.open(OUT / name / f"{s}.png"), (i * 34, 0))
        a = bigsplit(row, 3, f"{name}-row")
        preview.render(str(p(SEL["board/side-a"])), "a", str(OUT / name), str(NIGHT), str(G / f"{name}-board.png"), 3)
        opts.append(opt(name, name, [a, G / f"{name}-board.png"],
                        ("推荐：" if rec else "") + desc + "。上图 14 种摞依次是 W Y K KK KKK B BB G BG BBG R KR BR RR（3×，左夜右日）；下图是摆在 A 面版图上（3×）", rec))
    qs.append({"id": "tokens", "type": "choice", "question": "地貌标记（14 种摞，一整套）", "help": "圆片是代码画的（层数准、层缝 1px），树冠和小房子是 PixelLab 出的 64 个里挑的；田是圆片顶上一行行麦穗。整套只能选一套，不逐张混搭。", "options": opts, "allowOther": True})
    # 版图
    for side, cands in (("a", ["r3/final-board-a-st60-s52", "r3/final-board-a-st60-s51", "board-code2/side-a"]),
                        ("b", ["r3/final-board-b-st60-s52", "r3/final-board-b-st60-s51", "board-code2/side-b"])):
        opts = []
        for i, c in enumerate(cands):
            out = G / f"board-{side}-{i}.png"
            preview.render(str(p(c)), side, str(OUT / "tok-set2"), str(NIGHT if i != 1 else DAY), str(out), 3)
            desc = {("a", 0): "推荐：木框里一条小溪，两边有香蒲和卵石，河流计分的意思一眼看得出；版图有厚度",
                    ("b", 0): "推荐：沙滩边 + 浅青色海水和浪花，像一座小岛，清爽"}.get((side, i), "备选（第 2 张放在白天背景上看）" if i == 1 else "纯代码版：木框 + 一圈水道")
            opts.append(opt(c.split("/")[-1], c.split("/")[-1], [out, p(c)], desc, i == 0))
        qs.append({"id": f"board-{side}", "type": "choice", "question": f"个人版图 {side.upper()} 面（{'河流' if side == 'a' else '岛屿'}，{23 if side == 'a' else 25} 格）",
                   "help": "格子是代码按坐标公式盖上去的（每格像素都和标准格子一致，脚本核对过 0 差异），PixelLab 只画边框装饰。", "options": opts, "allowOther": True})
    # 托盘
    cands = ["r3/final-board-s-st60-s41", "r2/final-board-s-st60-s42", "r2/final-board-s-st150-s43"]
    qs.append({"id": "supply", "type": "choice", "question": "中央版图（5 个供应格的木托盘）", "options": [
        opt(c.split("/")[-1], c.split("/")[-1], [bigsplit(Image.open(p(c)).convert("RGBA"), 2, f"supply-{i}")],
            "推荐：雕花木框，凹槽干净，放 3 个标记最清楚" if i == 0 else "备选", i == 0) for i, c in enumerate(cands)], "allowOther": True})
    # 动物卡
    for i in range(1, 33):
        k = f"a{i:02d}"
        chosen = SEL[f"cards/animals/{k}"]
        cands = sorted({str(f.relative_to(OUT))[:-4] for f in OUT.glob(f"r*/{k}-s*.png")})
        cands = [chosen] + [c for c in cands if c != chosen]
        bad = {"r1/a23-s1231": "出图失败（全黑）", "r1/a26-s1261": "旧设定鼠兔，像狐狸，作废", "r1/a26-s1262": "旧设定鼠兔，作废",
               "r1/a26-s1263": "旧设定鼠兔，作废", "r2/a26-s1264": "旧设定岩雷鸟，画成了企鹅，作废", "r2/a26-s1265": "同上，作废",
               "r2/a26-s1266": "同上，作废", "r1/a12-s1121": "粉色圆球，像知名游戏角色，不用", "r1/a11-s1112": "画里没有蝙蝠",
               "r1/a04-s1041": "画成了白鹭，不是苍鹭"}
        opts = []
        for j, c in enumerate(cands):
            img = Image.open(p(c)).convert("RGBA")
            big = img.resize((192, 192), Image.NEAREST)
            out = G / f"{k}-{c.split('/')[-1]}.png"
            big.convert("RGB").save(out)
            imgs = [out]
            if j == 0 and k in SEL.get("cards/anim", {}):
                gif = G / f"{k}-anim.gif"
                strip = Image.open(p(SEL["cards/anim"][k])).convert("RGB")
                frames = [strip.crop((n * 64, 0, n * 64 + 64, 64)).resize((192, 192), Image.NEAREST) for n in range(6)]
                frames[0].save(gif, save_all=True, append_images=frames[1:], duration=150, loop=0)
                imgs.append(gif)
            opts.append(opt(c.split("/")[-1], c.split("/")[-1], imgs,
                            ("推荐（GIF 是悬停时的小动作）" if j == 0 else bad.get(c, "备选")), j == 0))
        qs.append({"id": f"card-{k}", "type": "choice", "question": f"动物卡 {k.upper()}：{ANIMAL_CN[k]}（{COLOR_CN[k]}）", "options": opts, "allowOther": True})
    for i in range(1, 11):
        k = f"s{i:02d}"
        chosen = SEL[f"cards/spirits/{k}"]
        cands = sorted({str(f.relative_to(OUT))[:-4] for f in OUT.glob(f"r*/{k}-s*.png")})
        cands = [chosen] + [c for c in cands if c != chosen]
        bad = {"r1/s02-s2022": "出图失败（全黑）", "r1/s07-s2071": "旧设定穿山甲，画成了蛇，作废", "r1/s07-s2072": "同上，作废", "r1/s07-s2073": "同上，作废"}
        opts = []
        for j, c in enumerate(cands):
            out = G / f"{k}-{c.split('/')[-1]}.png"
            Image.open(p(c)).convert("RGB").resize((192, 192), Image.NEAREST).save(out)
            opts.append(opt(c.split("/")[-1], c.split("/")[-1], [out], "推荐" if j == 0 else bad.get(c, "备选"), j == 0))
        qs.append({"id": f"spirit-{k}", "type": "choice", "question": f"自然之灵 {k.upper()}：{SPIRIT_CN[k]}", "options": opts, "allowOther": True})
    # 卡背
    for k, cands, why in (("back-animal", ["r1/back-animal-s601", "r1/back-animal-s603", "r1/back-animal-s602"], "推荐：木板 + 六边形里一片叶子，和版图同一套木头"),
                          ("back-spirit", ["r1/back-spirit-s612", "r1/back-spirit-s611", "r1/back-spirit-s613"], "推荐：深蓝夜空、月牙和一圈星星，带细框")):
        qs.append({"id": k, "type": "choice", "question": "动物卡背" if k == "back-animal" else "自然之灵卡背", "options": [
            opt(c.split("/")[-1], c.split("/")[-1], [bigsplit(Image.open(p(c)).convert("RGBA"), 3, f"{k}-{i}")], why if i == 0 else "备选", i == 0)
            for i, c in enumerate(cands)], "allowOther": True})
    # 小图（v2 64 选 1：放 3 个候选）
    small = {
        "cubes/animal": ("动物方块", ["r1/cube-animal/cube-animal-2", "r1/cube-animal/cube-animal-20", "r1/cube-animal/cube-animal"], 6),
        "cubes/spirit": ("自然之灵方块", ["r1/cube-spirit/cube-spirit-4", "r1/cube-spirit/cube-spirit", "r1/cube-spirit/cube-spirit-11"], 6),
        "icons/water": ("图标：水", ["r1/ic-water/ic-water-8", "r1/ic-water/ic-water", "r1/ic-water/ic-water-21"], 6),
        "icons/mountain": ("图标：山", ["r1/ic-mountain/ic-mountain", "r1/ic-mountain/ic-mountain-4", "r1/ic-mountain/ic-mountain-20"], 6),
        "icons/trunk": ("图标：树干", ["r1/ic-trunk/ic-trunk-4", "r1/ic-trunk/ic-trunk", "r1/ic-trunk/ic-trunk-32"], 6),
        "icons/tree": ("图标：树", ["r1/ic-tree/ic-tree", "r1/ic-tree/ic-tree-4", "r1/ic-tree/ic-tree-40"], 6),
        "icons/field": ("图标：田", ["r1/ic-field/ic-field-3", "r1/ic-field/ic-field-15", "r1/ic-field/ic-field-24"], 6),
        "icons/house": ("图标：房屋", ["r1/ic-house/ic-house", "r1/ic-house/ic-house-8", "r1/ic-house/ic-house-12"], 6),
        "icons/score": ("图标：分数（叶子）", ["r1/ic-score/ic-score-7", "r1/ic-score/ic-score", "r1/ic-score/ic-score-30"], 6),
        "icons/river": ("图标：河流（A 面计分）", ["r1/ic-river/ic-river-1", "r1/ic-river/ic-river-3", "r1/ic-river/ic-river-20"], 6),
        "icons/island": ("图标：岛屿（B 面计分）", ["r1/ic-island/ic-island", "r1/ic-island/ic-island-5", "r1/ic-island/ic-island-20"], 6),
        "icons/spirit": ("图标：自然之灵", ["r1/ic-spirit/ic-spirit-1", "r1/ic-spirit/ic-spirit-16", "r1/ic-spirit/ic-spirit"], 6),
        "ui/first": ("起始玩家标记", ["r1/ui-first/ui-first-4", "r1/ui-first/ui-first", "r1/ui-first/ui-first-22"], 5),
        "ui/bag": ("布袋", ["r1/ui-bag/ui-bag-1", "r1/ui-bag/ui-bag", "r1/ui-bag/ui-bag-16"], 4),
        "ui/result": ("结算花环", ["r1/result-s702", "r1/result-s701", "r1/result-s703"], 2),
    }
    for rel, (title, cands, k) in small.items():
        assert SEL[rel] == cands[0], (rel, SEL[rel])
        qs.append({"id": rel.replace("/", "-"), "type": "choice", "question": title, "help": "64 个候选里挑的前 3 个（左夜右日放大，右下角 1× 原大）" if "result" not in rel else None,
                   "options": [opt(c.split("/")[-1], c.split("/")[-1], [bigsplit(Image.open(p(c)).convert("RGBA"), k, rel.replace("/", "-") + f"-{i}")],
                                   "推荐" if i == 0 else "备选", i == 0) for i, c in enumerate(cands)], "allowOther": True})
    # 封面
    qs.append({"id": "cover", "type": "choice", "question": "大厅封面（384×192，没有字、没有人）", "options": [
        opt(f"harmonies-{i}", f"harmonies-{i}", [OUT / "covers" / f"harmonies-{i}.png"],
            {1: "推荐：木桌上的蜂窝版图，木圆片摞、树、麦子、小房子，狐狸和松鼠站在摞上，暖光", 2: "同一套，桌面更近", 3: "开工样张 A 裁的", 4: "等距视角小景（像别的游戏，备选）"}[i], i == 1)
        for i in (1, 2, 3, 4)], "allowOther": True})
    for q in qs:
        if q.get("help") is None:
            q.pop("help", None)
    dec = {"id": "art-gallery", "title": "自然和弦：正式美术画廊", "stage": "art", "blocking": False,
           "intro": "自然和弦正式美术（方向 A 木桌绘本风）的候选，每样一题。标「推荐」的是美术自查后挑定、已经导出到 art/out/final 的那张，不选就按推荐上线；想换哪张随时来换，都不满意选「其他」写备注，美术重画。\n\n格子、圆片层数、高亮框、卡上的小六边形、特效都是代码画的（几何要准），所以只有一个版本。动物卡的图案和分数由界面画，立绘里没有字。",
           "questions": qs}
    DEC.write_text(json.dumps(dec, ensure_ascii=False, indent=1))
    print(DEC, len(qs), "题")


if __name__ == "__main__":
    main()
