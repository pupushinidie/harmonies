"""第 2 轮：版图 A/B 面、中央托盘的装饰（pixflux，代码底图作 init），出图后用 boards.stamp 盖回精确格子、按外形裁透明。
python r2_boards.py
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image
from scipy import ndimage

import boards
import pixellab

ART = pixellab.ART
OUT = ART / "out" / "r2"
INIT = OUT / "init"
NO = "no text, no letters, no numbers, no people"
PROMPT = {
    "a": ("pixel art top-down game board, a carved warm wooden player board with a honeycomb of empty light wooden hexagon "
          "spaces, the thick wooden frame is decorated with a small carved blue stream, tiny reeds and pebbles along the edge, "
          "cozy storybook style, soft light from top left, " + NO),
    "b": ("pixel art top-down game board shaped like a small island, a honeycomb of empty light wooden hexagon spaces, a sandy "
          "beach rim with tiny shells and pebbles, shallow turquoise water with white foam around the edge, cozy storybook "
          "style, soft light from top left, " + NO),
    "s": ("pixel art top-down long wooden tray with five round empty bowl-shaped wells in a row, carved warm wood with leaf "
          "carvings at the ends, cozy storybook style, soft light from top left, " + NO),
}
BG = (52, 34, 24, 255)
JOBS = [(k, st, sd) for k in "abs" for st, sd in ((60, 41), (60, 42), (150, 43))]


def prep():
    INIT.mkdir(parents=True, exist_ok=True)
    for k in "ab":
        im = boards.base(k)
        flat = Image.new("RGBA", im.size, BG)
        flat.alpha_composite(im)
        flat.convert("RGB").save(INIT / f"{k}.png")
    s = boards.supply()
    flat = Image.new("RGBA", s.size, BG)
    flat.alpha_composite(s)
    flat.convert("RGB").save(INIT / "s.png")


def run(k, strength, seed):
    name = f"board-{k}-st{strength}-s{seed}"
    if (OUT / f"{name}.png").exists():
        return
    size = Image.open(INIT / f"{k}.png").size
    pixellab.generate_image(name, {"description": PROMPT[k], "image_size": {"width": size[0], "height": size[1]},
                                   "init_image": pixellab.b64_image(INIT / f"{k}.png"), "init_image_strength": strength,
                                   "seed": seed}, OUT)
    print(name, "ok", flush=True)


EXTRA = {  # v2 小图
    "top-wheat16": ("pixel art game piece decoration: a tiny tuft of five golden wheat stalks with ears, short and wide, soft light "
                    "from top left, bold dark outline", 16, 16, 304),
}


def run_v2(name):
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        return
    prompt, w, h, seed = EXTRA[name]
    pixellab.generate_async(name, {"description": prompt, "image_size": {"width": w, "height": h}, "no_background": True,
                                   "seed": seed}, folder, endpoint="/generate-image-v2")
    print(name, "ok", flush=True)


import r1
r1.ANIMALS["a26"] = ("grey", "a plump grey and white rock ptarmigan bird with feathered feet sitting among mountain rocks")
EXTRA_PIX = [("a23", 1234), ("a26", 1264), ("a26", 1265), ("a26", 1266)]


def run_pix(key, seed):
    color, desc = r1.ANIMALS[key]
    name = f"{key}-s{seed}"
    if (OUT / f"{name}.png").exists():
        return
    pixellab.generate_image(name, {"description": f"{desc}, {r1.HAB[color]}, {r1.ART}", "image_size": {"width": 64, "height": 64},
                                   "no_background": False, "seed": seed}, OUT)
    print(name, "ok", flush=True)


def finish():
    """盖回精确格子、裁外形。"""
    for k, st, sd in JOBS:
        src = OUT / f"board-{k}-st{st}-s{sd}.png"
        if not src.exists():
            continue
        im = Image.open(src).convert("RGBA")
        if k == "s":
            ref = boards.supply()
            alpha = np.array(ref)[:, :, 3]
        else:
            m = boards.cell_mask(k)
            alpha = (ndimage.distance_transform_edt(~m) <= 11).astype(np.uint8) * 255
        a = np.array(im)
        a[:, :, 3] = alpha
        im = Image.fromarray(a, "RGBA")
        if k != "s":
            im = boards.stamp(im, k)
        im.save(OUT / f"final-{src.name}")


if __name__ == "__main__":
    prep()
    with ThreadPoolExecutor(max_workers=10) as pool:
        for f in [pool.submit(run, *j) for j in JOBS] + [pool.submit(run_v2, n) for n in EXTRA] + [pool.submit(run_pix, *j) for j in EXTRA_PIX]:
            try:
                f.result()
            except Exception as e:
                print("失败", e, flush=True)
    finish()
    print("全部完成", flush=True)
