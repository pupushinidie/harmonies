"""个人版图 A/B 面、中央托盘、格子高亮、卡上小六边形（spec 2.2、2.4、2.5）。

python boards.py base <输出目录>             代码底图（给 pixflux 当 init，也是纯代码候选）
python boards.py stamp <装饰图> <a|b> <输出>  把精确的格子重新盖到装饰图上（PixelLab 改过的格子不算数）
python boards.py hexes <输出目录>             hex-mask/hover/valid/pattern/target/empty
python boards.py minis <输出目录>             cards/mini/*
python boards.py check <版图图> <a|b>         量每个格子：格内像素是不是都是格子色、格线在不在
"""
from __future__ import annotations

import pathlib
import random
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

from geom import HEX_H, HEX_W, P, SIDES, cell_xy, cells, hex_cells, inset, rgb

ART = pathlib.Path(__file__).resolve().parent


def cell_mask(side: str) -> np.ndarray:
    w, h = SIDES[side]["size"]
    m = np.zeros((h, w), bool)
    for c, r in cells(side):
        x0, y0 = cell_xy(c, r)
        for x, y in hex_cells(x0, y0):
            m[y, x] = True
    return m


def well(px, x0, y0, light=False):
    """一个嵌进木板的浅木格：格线 1px，左上内沿阴影（凹进去），右下内沿亮。"""
    face, shade, line, hi = (rgb(c) for c in P["well"])
    for y in range(HEX_H):
        k = inset(y)
        for x in range(k, HEX_W - k):
            edge = x == k or x == HEX_W - k - 1 or y == 0 or y == HEX_H - 1
            col = face
            if not edge:
                # 离左上边近 → 阴影；离右下边近 → 亮
                if y <= 2 or x <= k + 1:
                    col = shade
                elif y >= HEX_H - 3 or x >= HEX_W - k - 3:
                    col = hi
            px[x0 + x, y0 + y] = line if edge else col


def base(side: str, rnd_seed=5) -> Image.Image:
    w, h = SIDES[side]["size"]
    m = cell_mask(side)
    dist = ndimage.distance_transform_edt(~m)
    img = np.zeros((h, w, 4), np.uint8)
    rnd = random.Random(rnd_seed)
    wl, wm, wd = (np.array(rgb(c)) for c in P["wood"])
    if side == "a":
        # 木版：厚 11px，外圈暗、内圈亮，横向木纹；外面一条小溪绕半圈（左下）
        frame = dist <= 11
        img[frame] = wm
        grain = np.sin(np.arange(h)[:, None] * 0.9 + np.sin(np.arange(w)[None, :] * 0.07) * 3) > 0.75
        img[frame & grain] = (wm * 0.85 + wd * 0.15).astype(np.uint8)
        img[frame & (dist > 8.5)] = wd
        img[frame & (dist > 10.2)] = np.array(rgb(P["ol"]))
        img[(dist <= 3) & (dist > 0)] = wl
    else:
        # 海岛：格子外 5px 沙滩、再 4px 浅水和浪花，外面透明
        sand, sand_d = np.array(rgb("#ecd49a")), np.array(rgb("#c9a866"))
        sea, foam, deep = np.array(rgb("#5fb8d8")), np.array(rgb("#e8f6fa")), np.array(rgb("#3a8ec0"))
        img[dist <= 11] = deep
        img[dist <= 9] = sea
        ring = (dist > 5.5) & (dist <= 7)
        wav = (np.add.outer(np.arange(h), np.arange(w)) // 3) % 3 == 0
        img[ring & wav] = foam
        img[dist <= 5.5] = sand
        img[(dist <= 5.5) & (dist > 4.3)] = sand_d
        img[(dist > 10.2) & (dist <= 11)] = np.array(rgb("#2a5a80"))
    # 版图厚度：外形往下错 5px 的那一条是侧面，再往下 2px 是桌上的影子
    shape = img[:, :, 3] > 0
    side_m = np.zeros_like(shape)
    for k in range(1, 6):
        side_m[k:] |= shape[:-k]
    side_m &= ~shape
    shadow = np.zeros_like(shape)
    for k in range(6, 9):
        shadow[k:] |= shape[:-k]
    shadow &= ~shape & ~side_m
    img[shadow] = (20, 12, 8, 90)
    if side == "a":
        img[side_m] = np.array(rgb(P["wood"][2]))
        img[side_m & (np.arange(w)[None, :] % 9 == 0)] = np.array(rgb("#4a2c18"))
        # 小溪：木框中间刻一条蓝色水道，绕版图一圈，亮点是水波
        brook = frame & (dist > 4.2) & (dist <= 7.2)
        img[brook] = np.array(rgb(P["W"][2]))
        img[brook & (dist > 5.0) & (dist <= 6.4)] = np.array(rgb(P["W"][0]))
        ripple = brook & ((np.add.outer(np.arange(h), np.arange(w) * 2) % 11) == 0) & (dist > 5.0) & (dist <= 6.4)
        img[ripple] = np.array(rgb(P["W"][1]))
    else:
        img[side_m] = np.array(rgb("#2a6e9c"))
        img[side_m & (np.arange(w)[None, :] % 7 == 0)] = np.array(rgb("#9fd8ec"))
    img[side_m & ~np.vstack([side_m[1:], np.zeros((1, w), bool)])] = np.array(rgb(P["ol"]))
    im = Image.fromarray(img, "RGBA")
    return stamp(im, side)


def stamp(im: Image.Image, side: str) -> Image.Image:
    im = im.convert("RGBA").copy()
    px = im.load()
    for c, r in cells(side):
        well(px, *cell_xy(c, r))
    return im


def check(path: str, side: str) -> int:
    im = Image.open(path).convert("RGBA")
    ref = stamp(Image.new("RGBA", im.size), side)
    m = cell_mask(side)
    a, b = np.array(im), np.array(ref)
    bad = int((np.abs(a[m].astype(int) - b[m].astype(int)).sum(axis=1) > 0).sum())
    print(f"{path}: {len(cells(side))} 格，格内和标准格子不一样的像素 {bad}")
    return bad


def hexes(out: pathlib.Path):
    out.mkdir(parents=True, exist_ok=True)
    def blank():
        return Image.new("RGBA", (HEX_W, HEX_H), (0, 0, 0, 0))
    def edge_pixels(width):
        res = []
        for y in range(HEX_H):
            k = inset(y)
            for x in range(k, HEX_W - k):
                d = min(x - k, HEX_W - k - 1 - x, y, HEX_H - 1 - y)
                if d < width:
                    res.append((x, y, d))
        return res
    m = blank(); [m.putpixel((x, y), (255, 255, 255, 255)) for x, y in hex_cells()]; m.save(out / "hex-mask.png")
    e = blank(); well(e.load(), 0, 0); e.save(out / "hex-empty.png")
    hv = blank()
    for x, y in hex_cells():
        hv.putpixel((x, y), (255, 255, 255, 26))
    for x, y, d in edge_pixels(3):
        if d >= 1:
            hv.putpixel((x, y), (255, 255, 240, 230))
    hv.save(out / "hex-hover.png")
    va = blank()
    for x, y in hex_cells():
        va.putpixel((x, y), (120, 220, 90, 64))
    for x, y, d in edge_pixels(2):
        if d == 1:
            va.putpixel((x, y), (90, 200, 70, 230))
    va.save(out / "hex-valid.png")
    pa = blank()
    for x, y, d in edge_pixels(3):
        if d in (1, 2):
            pa.putpixel((x, y), (250, 210, 70, 255) if d == 1 else (190, 140, 30, 255))
    pa.save(out / "hex-pattern.png")
    ta = blank()
    for x, y, d in edge_pixels(3):
        if d in (1, 2) and ((x + y) // 3) % 2 == 0:
            ta.putpixel((x, y), (248, 140, 60, 255))
    ta.save(out / "hex-target.png")


MW, MH = 12, 11


def mini_hex():
    pts = []
    for y in range(MH):
        t = y if y < MH // 2 + 1 else MH - 1 - y
        k = max(0, 3 - t)
        for x in range(k, MW - k):
            pts.append((x, y, x == k or x == MW - k - 1 or y == 0 or y == MH - 1))
    return pts


def minis(out: pathlib.Path):
    out.mkdir(parents=True, exist_ok=True)
    kinds = {"W": ("W", 0), "Y": ("Y", 0), "G1": ("G", 1), "T2": ("G", 2), "T3": ("G", 3),
             "K1": ("K", 1), "K2": ("K", 2), "K3": ("K", 3), "H": ("R", 0)}
    for name, (code, n) in kinds.items():
        im = Image.new("RGBA", (MW, MH), (0, 0, 0, 0))
        face, light, side, dark = (rgb(c) for c in P[code])
        for x, y, e in mini_hex():
            im.putpixel((x, y), rgb(P["ol"]) if e else (light if y <= 2 else face))
        # 高度：n 道横纹（白），从下往上
        for i in range(n):
            y = MH - 3 - i * 2
            for x in range(3, MW - 3):
                im.putpixel((x, y), (255, 255, 255, 255) if code != "Y" else rgb(P["ol"]))
        if name == "H":  # 红顶房：小三角屋顶 + 墙
            for y in range(2, 6):
                for x in range(6 - (y - 1), 6 + (y - 1)):
                    im.putpixel((x, y), rgb(P["R"][2]))
            for y in range(6, 9):
                for x in range(3, 9):
                    im.putpixel((x, y), rgb(P["wall"]))
        im.save(out / f"{name}.png")
    t = Image.new("RGBA", (MW + 2, MH + 2), (0, 0, 0, 0))
    for x, y, e in mini_hex():
        if e:
            t.putpixel((x + 1, y + 1), (255, 255, 255, 255))
    t.save(out / "target.png")


def supply(empty_only=False) -> Image.Image:
    """木托盘 304×76，5 个圆凹槽，中心 x = 32 + 60i，y = 40。"""
    w, h = 304, 76
    yy, xx = np.mgrid[0:h, 0:w]
    img = np.zeros((h, w, 4), np.uint8)
    wl, wm, wd = (np.array(rgb(c)) for c in P["wood"])
    # 圆角长条托盘
    r = 18
    body = np.zeros((h, w), bool)
    body[r:h - r, 2:w - 2] = True
    body[4:h - 4, r:w - r] = True
    for cx, cy in ((r, r), (w - r - 1, r), (r, h - r - 1), (w - r - 1, h - r - 1)):
        body |= (xx - cx) ** 2 + (yy - cy) ** 2 <= (r - 2) ** 2
    dist = ndimage.distance_transform_edt(body)
    img[body] = wm
    grain = np.sin(yy * 0.8 + np.sin(xx * 0.05) * 3) > 0.8
    img[body & grain] = (wm * 0.85 + wd * 0.15).astype(np.uint8)
    img[body & (dist <= 3)] = wd
    img[body & (dist <= 1)] = np.array(rgb(P["ol"]))
    img[body & (dist > 3) & (dist <= 4.5) & (yy < h / 2)] = wl
    face, shade, line, hi = (np.array(rgb(c)) for c in P["well"])
    for i in range(5):
        cx, cy = 32 + 60 * i, 40
        e = ((xx - cx) / 27) ** 2 + ((yy - cy) / 26) ** 2
        img[e <= 1] = line
        img[e <= 0.88] = shade
        img[(e <= 0.88) & ((yy - cy) > -14)] = face
        img[(e <= 0.6) & ((yy - cy) > 14)] = hi
    return Image.fromarray(img, "RGBA")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "base":
        o = pathlib.Path(sys.argv[2]); o.mkdir(parents=True, exist_ok=True)
        for s in "ab":
            base(s).save(o / f"side-{s}.png")
        supply().save(o / "supply.png")
    elif cmd == "stamp":
        stamp(Image.open(sys.argv[2]), sys.argv[3]).save(sys.argv[4])
    elif cmd == "hexes":
        hexes(pathlib.Path(sys.argv[2]))
    elif cmd == "minis":
        minis(pathlib.Path(sys.argv[2]))
    elif cmd == "check":
        sys.exit(1 if check(sys.argv[2], sys.argv[3]) else 0)
