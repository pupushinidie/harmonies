"""代码特效（spec 2.8）：fx/place.png、fx/cube.png、fx/leaves.png。python fx.py <输出目录>"""
from __future__ import annotations

import math
import pathlib
import random
import sys

from PIL import Image

from geom import P, rgb

OL = rgb(P["ol"])


def put(px, w, h, x, y, c):
    x, y = int(round(x)), int(round(y))
    if 0 <= x < w and 0 <= y < h:
        px[x, y] = c


def leaf(px, w, h, x, y, ang, col, dark, size=2):
    """一片 3–5px 的小叶子。"""
    dx, dy = math.cos(ang), math.sin(ang)
    for i in range(-size, size + 1):
        put(px, w, h, x + dx * i, y + dy * i, col if i != size else dark)
    put(px, w, h, x - dy, y + dx, col)


def place(out: pathlib.Path):
    """落子：一圈木屑尘土向外扩散 + 2 片小叶子弹起，8 帧，末帧空。48×40，中心 (24, 24)。"""
    w, h, n = 48, 40, 8
    sheet = Image.new("RGBA", (w * n, h), (0, 0, 0, 0))
    rnd = random.Random(7)
    dust = [(rnd.uniform(0, math.tau), rnd.uniform(0.7, 1.0)) for _ in range(18)]
    leaves = [(-0.9, rnd.uniform(0, 6)), (0.7, rnd.uniform(0, 6))]
    for f in range(n - 1):
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        px = im.load()
        t = (f + 1) / (n - 1)
        for a, sp in dust:
            r = 6 + 16 * t * sp
            x, y = 24 + math.cos(a) * r, 26 + math.sin(a) * r * 0.45
            alpha = int(230 * (1 - t) + 40)
            c = rgb("#e9d6ac", alpha) if (a * 10) % 2 < 1 else rgb("#b88250", alpha)
            put(px, w, h, x, y, c)
            if t < 0.6:
                put(px, w, h, x + 1, y, c)
        for k, (vx, rot) in enumerate(leaves):
            x = 24 + vx * 14 * t
            y = 22 - 18 * t + 26 * t * t
            leaf(px, w, h, x, y, rot + t * 4, rgb(P["G"][1]), rgb(P["G"][3]))
        sheet.paste(im, (f * w, 0))
    sheet.save(out / "place.png")


def cube(out: pathlib.Path):
    """放方块：一圈 6 颗四角星向外，8 帧，末帧空。40×40，中心 (20, 20)。"""
    w, h, n = 40, 40, 8
    sheet = Image.new("RGBA", (w * n, h), (0, 0, 0, 0))
    for f in range(n - 1):
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        px = im.load()
        t = (f + 1) / (n - 1)
        for i in range(6):
            a = i * math.tau / 6 + 0.3
            r = 5 + 13 * t
            x, y = 20 + math.cos(a) * r, 20 + math.sin(a) * r
            s = 2 if t < 0.7 else 1
            col = rgb("#fff6c8") if i % 2 else rgb(P["cube"][1])
            for d in range(-s, s + 1):
                put(px, w, h, x + d, y, col)
                put(px, w, h, x, y + d, col)
            put(px, w, h, x, y, (255, 255, 255, 255))
        if f < 3:  # 中心一下亮
            for dx in range(-3 + f, 4 - f):
                for dy in range(-3 + f, 4 - f):
                    if abs(dx) + abs(dy) <= 3 - f:
                        put(px, w, h, 20 + dx, 20 + dy, rgb("#fff6c8", 200 - f * 50))
        sheet.paste(im, (f * w, 0))
    sheet.save(out / "cube.png")


def leaves(out: pathlib.Path):
    """一张卡放满：一阵叶子从下往上飘散，12 帧，末帧空。128×96。"""
    w, h, n = 128, 96, 12
    sheet = Image.new("RGBA", (w * n, h), (0, 0, 0, 0))
    rnd = random.Random(11)
    cols = [(rgb(P["G"][1]), rgb(P["G"][3])), (rgb(P["Y"][0]), rgb(P["Y"][3])), (rgb("#e8843a"), rgb("#a8521e")), (rgb(P["G"][0]), rgb(P["G"][3]))]
    parts = [(rnd.uniform(24, 104), rnd.uniform(60, 92), rnd.uniform(-1, 1), rnd.uniform(28, 60), rnd.uniform(0, 6), rnd.choice(cols), rnd.uniform(0, 0.25)) for _ in range(26)]
    for f in range(n - 1):
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        px = im.load()
        t = (f + 1) / n
        for x0, y0, vx, rise, rot, (c, d), delay in parts:
            tt = (t - delay) / (1 - delay)
            if tt <= 0 or tt >= 1:
                continue
            x = x0 + vx * 20 * tt + math.sin(tt * 6 + rot) * 4
            y = y0 - rise * tt
            leaf(px, w, h, x, y, rot + tt * 5, c, d, size=2 if tt < 0.8 else 1)
        sheet.paste(im, (f * w, 0))
    sheet.save(out / "leaves.png")


if __name__ == "__main__":
    o = pathlib.Path(sys.argv[1])
    o.mkdir(parents=True, exist_ok=True)
    place(o), cube(o), leaves(o)
