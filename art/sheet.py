"""候选总览：python sheet.py <输出.png> <缩放> <图...|目录>  目录里的 png 按编号排；每张下面写编号。"""
from __future__ import annotations

import pathlib
import re
import sys

from PIL import Image, ImageDraw


def key(p: pathlib.Path):
    m = re.findall(r"\d+", p.stem)
    return (p.stem.rstrip("0123456789-"), int(m[-1]) if m else -1)


def main(out, scale, items, cols=None, bg=(227, 207, 160)):
    files = []
    for it in items:
        p = pathlib.Path(it)
        files += sorted(p.glob("*.png"), key=key) if p.is_dir() else [p]
    ims = [Image.open(f).convert("RGBA") for f in files]
    w = max(i.width for i in ims) * scale
    h = max(i.height for i in ims) * scale
    cols = cols or min(len(ims), max(1, 1600 // (w + 6)))
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * (w + 6), rows * (h + 18)), (40, 30, 24, 255))
    d = ImageDraw.Draw(sheet)
    for n, (f, im) in enumerate(zip(files, ims)):
        x, y = (n % cols) * (w + 6), (n // cols) * (h + 18)
        tile = Image.new("RGBA", (w, h), bg + (255,))
        big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        tile.alpha_composite(big, ((w - big.width) // 2, (h - big.height) // 2))
        sheet.paste(tile, (x, y))
        m = re.findall(r"\d+", f.stem)
        d.text((x + 2, y + h + 2), (f.stem if len(f.stem) < 18 else f.stem[-16:]), fill=(255, 255, 255))
    sheet.save(out)
    print(out, len(ims))


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]), sys.argv[3:])
