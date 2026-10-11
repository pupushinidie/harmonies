"""定稿导出：按 selection.json 把挑定的图按 spec 的文件名、尺寸导出到 out/final/（目录结构 = apps/web/public/art/）。
python export.py            导出 + 检查尺寸
"""
from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys

from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"
FINAL = OUT / "final"
SEL = json.loads((ART / "selection.json").read_text())
PY = sys.executable


def src(rel: str) -> pathlib.Path:
    return OUT / f"{rel}.png" if not rel.endswith(".png") else OUT / rel


def save(im: Image.Image, rel: str, size: tuple[int, int] | None = None):
    p = FINAL / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    if size and im.size != size:
        raise SystemExit(f"{rel} 尺寸 {im.size} 不是 spec 的 {size}")
    im.save(p)


def main():
    if FINAL.exists():
        shutil.rmtree(FINAL)
    FINAL.mkdir(parents=True)
    s = SEL["pick"]
    # 背景
    for k in ("night", "day"):
        im = Image.open(src(s[f"bg/table-{k}"])).convert("RGB")
        save(im, f"bg/table-{k}.png", (512, 288))
        save(im.resize((1536, 864), Image.NEAREST), f"bg/table-{k}@3x.png", (1536, 864))
    # 版图（已经盖好精确格子）
    save(Image.open(src(s["board/side-a"])).convert("RGBA"), "board/side-a.png", (168, 196))
    save(Image.open(src(s["board/side-b"])).convert("RGBA"), "board/side-b.png", (216, 168))
    save(Image.open(src(s["board/supply"])).convert("RGBA"), "board/supply.png", (304, 76))
    subprocess.run([PY, str(ART / "boards.py"), "hexes", str(FINAL / "board")], check=True)
    subprocess.run([PY, str(ART / "boards.py"), "minis", str(FINAL / "cards" / "mini")], check=True)
    # 标记
    tok = s["tokens"]
    env = {"TOP_CANOPY": str(src(tok["canopy"])), "TOP_COTTAGE": str(src(tok["cottage"])), "TOP_WHEAT": str(src(tok["wheat"]))}
    import os
    subprocess.run([PY, str(ART / "tokens.py"), str(FINAL / "tokens"), tok["variant"]], check=True, env=os.environ | env)
    # 卡
    for k in [f"a{i:02d}" for i in range(1, 33)]:
        save(Image.open(src(s[f"cards/animals/{k}"])).convert("RGB"), f"cards/animals/{k}.png", (64, 64))
    for k in [f"s{i:02d}" for i in range(1, 11)]:
        save(Image.open(src(s[f"cards/spirits/{k}"])).convert("RGB"), f"cards/spirits/{k}.png", (64, 64))
    for k in ("back-animal", "back-spirit"):
        save(Image.open(src(s[f"cards/{k}"])).convert("RGB"), f"cards/{k}.png", (72, 104))
    # 小图
    for rel in ("cubes/animal", "cubes/spirit", "ui/first", "ui/bag", "ui/result"):  # 透明图裁掉四周空白
        im = Image.open(src(s[rel])).convert("RGBA")
        save(im.crop(im.getbbox()), f"{rel}.png")
    for n in ("water", "mountain", "trunk", "tree", "field", "house", "score", "river", "island", "spirit"):
        save(Image.open(src(s[f"icons/{n}"])).convert("RGBA"), f"icons/{n}.png", (16, 16))
    # 特效
    subprocess.run([PY, str(ART / "fx.py"), str(FINAL / "fx")], check=True)
    # 动物小动作
    idx = {}
    for k, rel in s.get("cards/anim", {}).items():
        strip = Image.open(src(rel)).convert("RGB")
        save(strip, f"cards/anim/{k}.png", (384, 64))
        idx[k] = {"frames": 6, "frameMs": 150, "loop": True}
    (FINAL / "cards" / "anim").mkdir(parents=True, exist_ok=True)
    (FINAL / "cards" / "anim" / "index.json").write_text(json.dumps(idx, indent=1))
    n = sum(1 for _ in FINAL.rglob("*.png"))
    print("导出完成，png", n)


if __name__ == "__main__":
    main()
