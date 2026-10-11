"""牌桌示意图（1440×790，整数倍摆放），夜/日各一张，自查用：python mock.py"""
import json, sys
from PIL import Image, ImageDraw
sys.path.insert(0, ".")
from geom import cell_xy
import preview
F = "out/final/"
def table(theme):
    bg = Image.open(F + f"bg/table-{theme}@3x.png").convert("RGBA").crop((48, 37, 48 + 1440, 37 + 790))
    veil = Image.new("RGBA", bg.size, (0, 0, 0, 77) if theme == "night" else (255, 255, 255, 38))
    bg.alpha_composite(veil)
    # 自己的版图 A 面 3×
    b = Image.open(F + "board/side-a.png").convert("RGBA")
    layer = Image.new("RGBA", (b.width, b.height + 20), (0, 0, 0, 0)); layer.alpha_composite(b, (0, 20))
    meta = json.load(open(F + "tokens/tokens.json"))["stacks"]
    cube = Image.open(F + "cubes/animal.png").convert("RGBA")
    for (c, r), s in sorted(preview.LAY["a"].items(), key=lambda kv: cell_xy(*kv[0])[1]):
        x, y = cell_xy(c, r)
        layer.alpha_composite(Image.open(F + f"tokens/{s}.png").convert("RGBA"), (x, y - 18 + 20))
        if (c, r) in ((2, 1), (4, 2), (1, 2)):
            cx, cy = meta[s]["cube"]; layer.alpha_composite(cube, (x + cx - cube.width // 2, y - 18 + 20 + cy - cube.height))
    hv = Image.open(F + "board/hex-valid.png").convert("RGBA")
    for c, r in ((2, 3), (0, 2), (4, 1)):
        x, y = cell_xy(c, r); layer.alpha_composite(hv, (x, y + 20))
    bg.alpha_composite(layer.resize((layer.width * 3, layer.height * 3), Image.NEAREST), (20, 20))
    # 中央托盘 2×
    sup = Image.open(F + "board/supply.png").convert("RGBA")
    codes = ["WKY", "BGR", "KKW", "YGB", "RWK"]
    for i, cs in enumerate(codes):
        cx, cy = 32 + 60 * i, 40
        for j, (dx, dy) in enumerate(((-28, -34), (-4, -34), (-16, -24))):
            sup.alpha_composite(Image.open(F + f"tokens/{cs[j]}.png").convert("RGBA"), (cx + dx, cy + dy)) if 0 <= cx + dx and cx + dx + 32 <= sup.width and cy + dy >= 0 else None
    bg.alpha_composite(sup.resize((608, 152), Image.NEAREST), (560, 30))
    bag = Image.open(F + "ui/bag.png").convert("RGBA").resize((64, 64), Image.NEAREST); bg.alpha_composite(bag, (1180, 70))
    # 牌列 5 张 2×
    d = ImageDraw.Draw(bg)
    cols = {"blue": "#3f86d0", "red": "#cf4b3b", "green": "#4aa548", "grey": "#8a929c", "yellow": "#e2b83a"}
    for i, (k, col) in enumerate((("a01", "blue"), ("a09", "red"), ("a14", "green"), ("a21", "grey"), ("a28", "yellow"))):
        x, y = 560 + i * 156, 210
        d.rectangle((x, y, x + 143, y + 207), fill="#2a1c14"); d.rectangle((x + 2, y + 2, x + 141, y + 205), fill=col)
        d.rectangle((x + 8, y + 136, x + 135, y + 199), fill="#f3e8cf")
        bg.paste(Image.open(F + f"cards/animals/{k}.png").resize((128, 128), Image.NEAREST), (x + 8, y + 8))
        mini = Image.open(F + "cards/mini/W.png").convert("RGBA").resize((24, 22), Image.NEAREST)
        for j in range(3): bg.alpha_composite(mini, (x + 14 + j * 22, y + 150 + (j % 2) * 11))
    back = Image.open(F + "cards/back-animal.png").resize((144, 208), Image.NEAREST); bg.paste(back, (560 + 5 * 156, 210))
    # 手里两张 + 自然之灵 1×… 2×
    for i, k in enumerate(("a17", "a31")):
        bg.paste(Image.open(F + f"cards/animals/{k}.png").resize((128, 128), Image.NEAREST), (560 + i * 140, 450))
    bg.paste(Image.open(F + "cards/spirits/s03.png").resize((128, 128), Image.NEAREST), (860, 450))
    bg.paste(Image.open(F + "cards/back-spirit.png").resize((144, 208), Image.NEAREST), (1000, 450))
    # 对手版图 B 面 1×
    ob = Image.open(F + "board/side-b.png").convert("RGBA")
    for (c, r), s in sorted(preview.LAY["b"].items(), key=lambda kv: cell_xy(*kv[0])[1]):
        x, y = cell_xy(c, r); ob.alpha_composite(Image.open(F + f"tokens/{s}.png").convert("RGBA"), (x, max(0, y - 18)))
    bg.alpha_composite(ob, (1200, 470)); bg.alpha_composite(ob.resize((432, 336), Image.NEAREST), (1000, 690 - 0)) if False else None
    for n, ic in enumerate(("water", "mountain", "trunk", "tree", "field", "house", "score", "river", "island", "spirit")):
        bg.alpha_composite(Image.open(F + f"icons/{ic}.png").convert("RGBA").resize((32, 32), Image.NEAREST), (560 + n * 40, 690))
    bg.alpha_composite(Image.open(F + "ui/result.png").convert("RGBA").resize((320, 128), Image.NEAREST), (1000, 650))
    bg.convert("RGB").save(f"out/mock-{theme}.png")
for t in ("night", "day"): table(t)
