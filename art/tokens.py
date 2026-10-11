"""地貌标记：代码画圆片 + PixelLab 顶饰（树冠、麦穗、房子），合成 14 种摞（spec 2.3）。

python tokens.py <输出目录> [变体]    变体：v1 / v2 / v3（圆片质感和厚度不同，见 VARIANTS）
顶饰图从 out/pick/top-canopy.png、top-cottage.png、top-wheat.png 读（已抠好的透明图，裁过空白），可用环境变量换路径。
每张 32×44，格子中心在 (16, 32)。同时写 tokens.json（每种摞的方块位置）。
"""
from __future__ import annotations

import json
import math
import os
import pathlib
import random
import sys

from PIL import Image

from geom import P, rgb

ART = pathlib.Path(__file__).resolve().parent
W, H = 32, 44
CX, GROUND = 16, 33          # 圆片中心 x；最下面一片底面中心 y
STACKS = ["W", "Y", "K", "KK", "KKK", "B", "BB", "G", "BG", "BBG", "R", "KR", "BR", "RR"]

VARIANTS = {
    # rx, ry, 厚, 层缝, 顶面纹理强度
    "v1": dict(rx=11, ry=6, th=4, gap=True, tex=1.0),
    "v2": dict(rx=11, ry=5, th=5, gap=True, tex=0.6),
    "v3": dict(rx=12, ry=6, th=4, gap=True, tex=1.2),
}


def topper(name: str) -> Image.Image | None:
    p = pathlib.Path(os.environ.get(f"TOP_{name.upper()}", ART / "out" / "pick" / f"top-{name}.png"))
    if not p.exists():
        return None
    im = Image.open(p).convert("RGBA")
    return im.crop(im.getbbox())


def inside(x, y, cx, cy, rx, ry):
    return ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0


def draw_disc(px, code: str, bottom_cy: float, v: dict, seed: int, top: bool):
    """画一片圆片：底面中心 y = bottom_cy。返回顶面中心 y。"""
    rx, ry, th = v["rx"], v["ry"], v["th"]
    face, light, side, dark = (rgb(c) for c in P[code])
    top_cy = bottom_cy - th
    rnd = random.Random(seed)
    cx = CX
    # 侧面：顶面椭圆到底面椭圆之间
    for y in range(H):
        for x in range(W):
            in_side = (inside(x, y, cx, bottom_cy, rx, ry) or (top_cy <= y + 0.5 <= bottom_cy and abs(x + 0.5 - cx) <= rx))
            if not in_side:
                continue
            t = (x + 0.5 - (cx - rx)) / (2 * rx)       # 0 左 … 1 右
            col = side if 0.18 < t < 0.72 else (dark if t >= 0.72 else tuple(min(255, int(a * 0.55 + b * 0.45)) for a, b in zip(side, light)))
            if code == "B" and rnd.random() < 0.18:      # 树皮竖纹
                col = dark
            px[x, y] = col
    if v["gap"]:  # 层缝：底面椭圆最下沿暗一圈
        for x in range(W):
            for y in range(H - 1, -1, -1):
                if inside(x, y, cx, bottom_cy, rx, ry) and not inside(x, y + 1, cx, bottom_cy, rx, ry):
                    px[x, y] = rgb(P["ol"])
                    break
    # 顶面
    for y in range(H):
        for x in range(W):
            if not inside(x, y, cx, top_cy, rx, ry):
                continue
            dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - top_cy) / ry
            col = face
            if dx * 0.7 + dy < -0.55 and dx * dx + dy * dy > 0.35:   # 左上亮边
                col = light
            if dx * 0.7 + dy > 0.75 and dx * dx + dy * dy > 0.55:     # 右下暗边
                col = side
            px[x, y] = col
    # 顶面纹理
    tex = v["tex"]
    if code == "B":  # 年轮
        for k, rr in enumerate((0.7, 0.42)):
            for a in range(0, 360, 8):
                x = round(cx - 0.5 + rx * rr * math.cos(math.radians(a)))
                y = round(top_cy - 0.5 + ry * rr * math.sin(math.radians(a)))
                if inside(x, y, cx, top_cy, rx - 1, ry - 1):
                    px[x, y] = rgb(P["B"][2])
        px[cx - 1, int(top_cy)] = rgb(P["B"][3])
    elif code == "W":  # 水波
        for (ox, oy) in ((-6, -2), (1, 1)):
            for i, d in enumerate((0, -1, -1, 0, 1, 1, 0)):
                x, y = cx + ox + i - 1, int(top_cy) + oy + d
                if inside(x, y, cx, top_cy, rx - 1, ry - 1):
                    px[x, y] = rgb(P["W"][1])
    elif code == "K":  # 石纹
        for _ in range(int(9 * tex)):
            x, y = rnd.randint(cx - rx + 2, cx + rx - 2), rnd.randint(int(top_cy - ry + 2), int(top_cy + ry - 2))
            if inside(x, y, cx, top_cy, rx - 1, ry - 1):
                px[x, y] = rgb(P["K"][2]) if rnd.random() < 0.6 else rgb(P["K"][1])
    elif code == "Y":  # 一行行麦穗：每穗上亮下暗两个像素，行与行错开
        for row, dy in enumerate((-3, 0, 3)):
            for x in range(cx - rx + 2 + (row % 2) * 2, cx + rx - 1, 4):
                y = int(top_cy) + dy
                if inside(x, y, cx, top_cy, rx - 1.5, ry - 0.5) and inside(x, y - 1, cx, top_cy, rx - 1, ry - 0.5):
                    px[x, y - 1] = rgb(P["Y"][1])
                    px[x, y] = rgb(P["Y"][3])
                    if inside(x + 1, y, cx, top_cy, rx - 1, ry - 0.5):
                        px[x + 1, y] = rgb(P["Y"][2])
    elif code == "R":
        for x in range(cx - rx + 3, cx + rx - 2, 3):
            y = int(top_cy)
            if inside(x, y, cx, top_cy, rx - 1, ry - 1):
                px[x, y] = rgb(P["R"][2])
    return top_cy


def outline(im: Image.Image) -> Image.Image:
    """外轮廓描 1px 深棕边（只描透明像素挨着不透明像素的那一圈）。"""
    src = im.load()
    out = im.copy()
    o = out.load()
    for y in range(H):
        for x in range(W):
            if src[x, y][3] > 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and src[nx, ny][3] > 200:
                    o[x, y] = rgb(P["ol"])
                    break
    return out


def paste_bottom(im: Image.Image, sprite: Image.Image, bottom_y: int):
    x = CX - sprite.width // 2
    im.alpha_composite(sprite, (x, max(0, bottom_y - sprite.height)))


def shadow_img(v):
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    p = sh.load()
    for y in range(H):
        for x in range(W):
            if inside(x, y, CX + 1, GROUND + 1, v["rx"] + 1.5, v["ry"] - 0.5):
                p[x, y] = (30, 18, 10, 80)
    return sh


def build(stack: str, v: dict, tops: dict) -> tuple[Image.Image, list[int]]:
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    body = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = body.load()
    discs = list(stack)
    cap = None
    if discs[-1] in "GR":
        cap = discs.pop()
    if stack == "RR":   # 下面那片红是圆片
        discs, cap = ["R"], "R"
    y = GROUND
    top_cy = GROUND + 0.0
    for i, code in enumerate(discs):
        top_cy = draw_disc(px, code, y, v, seed=hash((stack, i)) & 0xFFFF, top=(i == len(discs) - 1 and cap is None))
        y = top_cy
    body = outline(body)
    if cap or code_needs_tuft(stack):
        name = {"G": "canopy", "R": "cottage"}.get(cap or "", "wheat")
        spr = tops.get(name)
        if spr is None and name == "wheat":
            spr = tuft() if os.environ.get("WHEAT_TUFT", "0") == "1" else None
        if spr is not None:
            base = int(round(top_cy)) + (2 if discs else 1) + (1 if name == "wheat" else 0)
            if not discs:
                base = GROUND + 4
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            paste_bottom(layer, spr, base)
            body.alpha_composite(layer)
    im.alpha_composite(shadow_img(v))
    im.alpha_composite(body)
    bb = body.getbbox()
    cube = [CX, bb[1] + 6] if bb else [CX, GROUND]  # 方块底边中点落在这里
    return im, cube


def tuft() -> Image.Image:
    """代码画的一小撮麦子（约 15×9）：6 根麦秆，顶上 3px 麦穗，左上亮右下暗，外圈描边。"""
    im = Image.new("RGBA", (17, 11), (0, 0, 0, 0))
    px = im.load()
    stem, ear, hi, dk = rgb(P["Y"][2]), rgb(P["Y"][0]), rgb(P["Y"][1]), rgb(P["Y"][3])
    for x0, h, lean in ((2, 5, -1), (4, 7, -1), (7, 8, 0), (9, 7, 0), (12, 7, 1), (14, 5, 1)):
        for i in range(h):
            top = i >= h - 3
            x = x0 + (lean if i >= h - 2 else 0)
            y = 10 - i
            px[x, y] = (hi if (i == h - 1 or x < 8) else ear) if top else (stem if i > 0 else dk)
            if top and i == h - 2:
                px[x + (1 if lean >= 0 else -1), y] = dk if x >= 8 else ear
    out = Image.new("RGBA", (19, 13), (0, 0, 0, 0))
    out.alpha_composite(im, (1, 1))
    src = out.copy().load()
    o = out.load()
    for y in range(13):
        for x in range(19):
            if src[x, y][3] == 0 and any(0 <= x + dx < 19 and 0 <= y + dy < 13 and src[x + dx, y + dy][3] > 200
                                         for dx, dy in ((1, 0), (-1, 0), (0, -1))):
                o[x, y] = rgb(P["ol"])
    return out.crop(out.getbbox())


def code_needs_tuft(stack: str) -> bool:
    return stack == "Y"


def main(out: pathlib.Path, variant: str = "v1"):
    v = VARIANTS[variant]
    tops = {n: topper(n) for n in ("canopy", "cottage", "wheat")}
    out.mkdir(parents=True, exist_ok=True)
    meta = {}
    for s in STACKS:
        im, cube = build(s, v, tops)
        im.save(out / f"{s}.png")
        meta[s] = {"cube": cube}
    shadow_img(v).crop((0, GROUND - 6, W, GROUND + 6)).save(out / "shadow.png")
    (out / "tokens.json").write_text(json.dumps({"size": [W, H], "hexCenter": [16, 32], "offsetFromCell": [0, -18],
                                                 "cubeAnchor": "方块图底边中点对准 stacks.<摞>.cube（相对标记图左上角）", "stacks": meta}, indent=1))


if __name__ == "__main__":
    main(pathlib.Path(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else "v1")
