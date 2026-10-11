"""第 3 轮：补画（a26 改雪豹、s07 改石熊、a11/a12/s02 补候选）、版图（新底图：有厚度 + 小溪）、托盘、小麦穗、封面补候选。
python r3.py
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from PIL import Image

import boards
import pixellab
import r1
import r2_boards

ART = pixellab.ART
OUT = ART / "out" / "r3"
INIT = OUT / "init"
r1.ANIMALS["a26"] = ("grey", "a snow leopard with a thick long fluffy tail and grey-white spotted fur lying on a rocky ledge")
r1.SPIRITS["s07"] = "a big gentle spirit bear made of grey mountain stones with softly glowing cracks, on a moonlit mountain"
PIX = [("a26", 1267), ("a26", 1268), ("a26", 1269), ("a11", 1114), ("a11", 1115), ("a12", 1124), ("s02", 2024),
       ("s07", 2074), ("s07", 2075), ("s07", 2076)]
BOARDS = [("a", 60, 51), ("a", 60, 52), ("b", 60, 51), ("b", 60, 52), ("s", 60, 41)]
COVERS = {
    "cover-pixen": ("/create-image-pixen", "pixel art, top-down view of a cozy wooden tabletop with visible wood grain in warm lamp light, a "
                    "wooden player board shaped like a honeycomb of flat-top hexagon spaces, stacks of thick round wooden discs with "
                    "layered sides on the hexagons: blue water discs, grey stone discs stacked two and three high, trees made of brown "
                    "trunk discs topped with a round green canopy, yellow wheat discs, small red-roof cottages on top of stacks, a little "
                    "fox and an otter figurine standing on the board, autumn leaves around, " + r1.NO, 512, 288, (821, 822)),
}


def pix(key, seed):
    name = f"{key}-s{seed}"
    if (OUT / f"{name}.png").exists():
        return
    if key.startswith("a"):
        color, desc = r1.ANIMALS[key]
        prompt = f"{desc}, {r1.HAB[color]}, {r1.ART}"
    else:
        prompt = f"{r1.SPIRITS[key]}, {r1.SPIRIT}"
    pixellab.generate_image(name, {"description": prompt, "image_size": {"width": 64, "height": 64}, "no_background": False,
                                   "seed": seed}, OUT)
    print(name, "ok", flush=True)


def board(k, strength, seed):
    name = f"board-{k}-st{strength}-s{seed}"
    if (OUT / f"{name}.png").exists():
        return
    size = Image.open(INIT / f"{k}.png").size
    pixellab.generate_image(name, {"description": r2_boards.PROMPT[k], "image_size": {"width": size[0], "height": size[1]},
                                   "init_image": pixellab.b64_image(INIT / f"{k}.png"), "init_image_strength": strength,
                                   "seed": seed}, OUT)
    print(name, "ok", flush=True)


def cover(name, seed):
    endpoint, prompt, w, h, _ = COVERS[name]
    target = f"{name}-s{seed}"
    if (OUT / f"{target}.png").exists():
        return
    pixellab.generate_image(target, {"description": prompt, "image_size": {"width": w, "height": h}, "detail": "highly detailed",
                                     "seed": seed}, OUT, endpoint=endpoint)
    print(target, "ok", flush=True)


def wheat():
    r2_boards.OUT = OUT
    r2_boards.run_v2("top-wheat16")


def prep():
    INIT.mkdir(parents=True, exist_ok=True)
    for k in "ab":
        im = boards.base(k)
        flat = Image.new("RGBA", im.size, r2_boards.BG)
        flat.alpha_composite(im)
        flat.convert("RGB").save(INIT / f"{k}.png")
    s = boards.supply()
    flat = Image.new("RGBA", s.size, r2_boards.BG)
    flat.alpha_composite(s)
    flat.convert("RGB").save(INIT / "s.png")


if __name__ == "__main__":
    prep()
    with ThreadPoolExecutor(max_workers=10) as pool:
        fs = [pool.submit(pix, *j) for j in PIX] + [pool.submit(board, *j) for j in BOARDS] + [pool.submit(wheat)]
        fs += [pool.submit(cover, n, s) for n, v in COVERS.items() for s in v[4]]
        for f in fs:
            try:
                f.result()
            except Exception as e:
                print("失败", e, flush=True)
    print("全部完成", flush=True)


# ---- 动物小动作（animate-with-text-v3，首末帧 = 立绘） ----
PICK = {"a01": "r1/a01-s1013", "a02": "r1/a02-s1022", "a03": "r1/a03-s1032", "a04": "r1/a04-s1043", "a05": "r1/a05-s1053",
        "a06": "r1/a06-s1062", "a07": "r1/a07-s1071", "a08": "r1/a08-s1082", "a09": "r1/a09-s1092", "a10": "r1/a10-s1103",
        "a11": "r1/a11-s1113", "a12": "r1/a12-s1123", "a13": "r1/a13-s1132", "a14": "r1/a14-s1142", "a15": "r1/a15-s1152",
        "a16": "r1/a16-s1162", "a17": "r1/a17-s1171", "a18": "r1/a18-s1181", "a19": "r1/a19-s1193", "a20": "r1/a20-s1203",
        "a21": "r1/a21-s1212", "a22": "r1/a22-s1222", "a23": "r1/a23-s1232", "a24": "r1/a24-s1242", "a25": "r1/a25-s1252",
        "a27": "r1/a27-s1272", "a28": "r1/a28-s1282", "a29": "r1/a29-s1292", "a30": "r1/a30-s1301", "a31": "r1/a31-s1312",
        "a32": "r1/a32-s1322"}
ACT = {"a01": "the otter blinks and bobs gently on the water", "a02": "the duck bobs gently on the water and blinks",
       "a03": "the frog blinks and its throat puffs slightly", "a04": "the heron blinks and turns its head slightly",
       "a05": "the beaver blinks and nibbles the stick", "a06": "the kingfisher blinks and tilts its head",
       "a07": "the fish wiggles its tail and water drops splash", "a08": "the swallow blinks and tilts its head",
       "a09": "the stork blinks and turns its head slightly", "a10": "the mouse twitches its nose and ears",
       "a11": "the bat flaps its wings slightly", "a12": "the hedgehog sniffs and twitches its nose",
       "a13": "the squirrel flicks its bushy tail and blinks", "a14": "the owl blinks slowly",
       "a15": "the woodpecker pecks the tree trunk", "a16": "the raccoon blinks and moves its ears",
       "a17": "the deer blinks and flicks its ears", "a18": "the badger sniffs and blinks",
       "a19": "the boar sniffs the ground and moves its snout", "a20": "the bear breathes and blinks",
       "a21": "the ibex blinks and flicks its ears", "a22": "the marmot blinks and twitches its nose",
       "a23": "the eagle blinks and ruffles its feathers slightly", "a24": "the lynx blinks and twitches its tufted ears",
       "a25": "the wolf blinks and its fur ruffles in the wind", "a27": "the hare twitches its nose and long ears",
       "a28": "the fox swishes its tail and blinks", "a29": "the pheasant bobs its head",
       "a30": "the hamster twitches its nose and blinks", "a31": "the bee flutters its wings",
       "a32": "the mole twitches its pink nose"}
ANIM = OUT / "anim"


def anim(key, seed):
    folder = ANIM / f"{key}-s{seed}"
    if folder.exists() and any(folder.glob("*.png")):
        return
    first = ART / "out" / f"{PICK[key]}.png"
    pixellab.animate(f"{key}-s{seed}", {"first_frame": pixellab.b64_image(first), "last_frame": pixellab.b64_image(first),
                                         "action": ACT[key], "frame_count": 6, "seed": seed}, folder)
    print("anim", key, seed, "ok", flush=True)


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=10) as pool:
        for f in [pool.submit(anim, k, 3100 + int(k[1:])) for k in PICK]:
            try:
                f.result()
            except Exception as e:
                print("失败 anim", e, flush=True)
    print("动画完成", flush=True)
