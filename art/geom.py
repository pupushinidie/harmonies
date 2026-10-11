"""格子几何和调色板（spec 第 1、2.2 节）。其他脚本都从这里取。"""
from __future__ import annotations

HEX_W, HEX_H = 32, 28
COL_STEP, ROW_STEP, ODD_DY = 24, 28, 14
OX, OY = 20, 22

SIDES = {
    "a": {"cols": 5, "rows": lambda c: 5 if c % 2 == 0 else 4, "size": (168, 196)},
    "b": {"cols": 7, "rows": lambda c: 4 if c % 2 == 0 else 3, "size": (216, 168)},
}

P = {
    "ol": "#2a1c14",
    "W": ["#4b8fd8", "#9fd0f4", "#2f62a8", "#1d3f70"],
    "K": ["#a3a8b0", "#d4d8de", "#6c727c", "#474c56"],
    "B": ["#a36b3c", "#c99260", "#6e4423", "#4a2c16"],
    "G": ["#4fae3e", "#94d660", "#2e7a2c", "#1f5422"],
    "Y": ["#e8c040", "#f8e490", "#b88a22", "#82601a"],
    "R": ["#d04a3a", "#f07a5a", "#8e2a22", "#5e1a16"],
    "wall": "#f0e2c4",
    "wood": ["#b88250", "#8a5a34", "#5c3a22"],
    "well": ["#e3cfa0", "#c4aa78", "#6b4a2e", "#f1e2bc"],
    "cube": ["#e8843a", "#f8b46c", "#a8521e"],
}


def rgb(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def inset(y: int) -> int:
    """平顶六边形第 y 行（0..27）左右各缩进几像素。上下对称；保证相邻列正好拼满。"""
    t = y if y < 14 else 27 - y
    return round(8 * (13 - t) / 13)


def hex_cells(x0: int = 0, y0: int = 0):
    """格子内的像素 (x, y)。"""
    for y in range(HEX_H):
        k = inset(y)
        for x in range(k, HEX_W - k):
            yield x0 + x, y0 + y


def cells(side: str):
    s = SIDES[side]
    return [(c, r) for c in range(s["cols"]) for r in range(s["rows"](c))]


def cell_xy(c: int, r: int) -> tuple[int, int]:
    return OX + COL_STEP * c, OY + ROW_STEP * r + (ODD_DY if c % 2 else 0)
