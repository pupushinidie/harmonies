"""自然和弦 正式美术第 1 轮：背景、标记顶饰、方块、图标、动物立绘、自然之灵、卡背、结算花环、封面。
用法：python r1.py [名字前缀 ...]      一个进程、线程池 10（会员并发上限），已有的跳过。
"""
from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor

import pixellab

OUT = pixellab.ART / "out" / "r1"
NO = "no text, no letters, no numbers, no people"
ICON = "bold dark brown outline, simple, readable, cozy storybook pixel art, " + NO
ART = ("cozy storybook pixel art illustration, soft warm light from the top left, rounded friendly shapes, "
       "natural animal without clothes, full scene background filling the whole image, " + NO)
HAB = {
    "blue": "beside a calm blue pond with reeds and lily pads, blue-green water",
    "red": "at a cozy village cottage with a red tiled roof and warm brick wall",
    "green": "in a green leafy forest with mossy tree trunks",
    "grey": "on grey rocky mountain cliffs with snowy peaks behind",
    "yellow": "in a sunny golden wheat field with a haystack",
}
ANIMALS = {
    "a01": ("blue", "a playful brown river otter floating on its back in a stream"),
    "a02": ("blue", "a mallard duck with a green head swimming"),
    "a03": ("blue", "a round green frog sitting on a lily pad"),
    "a04": ("blue", "a grey heron standing on long legs in shallow water"),
    "a05": ("blue", "a brown beaver with a flat tail gnawing a stick by a river dam"),
    "a06": ("blue", "a bright blue and orange kingfisher bird perched on a reed above the water"),
    "a07": ("blue", "a speckled trout fish leaping out of a stream with splashes"),
    "a08": ("red", "a barn swallow bird perched on the eave of a cottage roof"),
    "a09": ("red", "a white stork standing in a big twig nest on top of a cottage chimney"),
    "a10": ("red", "a tiny realistic brown house mouse peeking out of a hole in a cottage wall"),
    "a11": ("red", "a small brown bat hanging upside down under the roof eaves at dusk"),
    "a12": ("red", "a round hedgehog in a cottage garden by a brick wall"),
    "a13": ("green", "a red squirrel with a bushy tail sitting on a tree branch with an acorn"),
    "a14": ("green", "a round tawny owl peeking out of a tree hollow"),
    "a15": ("green", "a black and white spotted woodpecker with a red cap clinging to a tree trunk"),
    "a16": ("green", "a raccoon peeking over a mossy fallen log"),
    "a17": ("green", "a red deer stag with big antlers standing in a forest clearing"),
    "a18": ("green", "a european badger with a black and white striped face at its den among tree roots"),
    "a19": ("green", "a bristly brown wild boar with small tusks sniffing the forest floor"),
    "a20": ("green", "a big brown bear standing among forest trees"),
    "a21": ("grey", "an alpine ibex goat with long curved ridged horns standing on a rocky ledge"),
    "a22": ("grey", "a chubby alpine marmot standing upright on a rock"),
    "a23": ("grey", "a golden eagle perched on a mountain crag with wings slightly open"),
    "a24": ("grey", "a eurasian lynx with tufted ears and a short tail sitting on rocks"),
    "a25": ("grey", "a grey wolf standing on a rocky mountain slope"),
    "a26": ("grey", "a tiny round grey-brown pika with small round ears among mountain rocks"),
    "a27": ("yellow", "a brown hare with long ears sitting up"),
    "a28": ("yellow", "a red fox with a white-tipped tail walking"),
    "a29": ("yellow", "a colorful common pheasant with a long tail walking"),
    "a30": ("yellow", "a golden hamster with full round cheeks among wheat stalks"),
    "a31": ("yellow", "a fuzzy black and yellow bumblebee on a yellow flower"),
    "a32": ("yellow", "a dark velvety mole with pink paws poking out of a molehill at the edge of the field"),
}
SPIRIT = ("cozy storybook pixel art illustration at night, a softly glowing semi-transparent pale cyan-white nature spirit, "
          "magical, calm, deep blue moonlit background filling the whole image, " + NO)
SPIRITS = {
    "s01": "a glowing spirit hare made of golden wheat ears, in a moonlit wheat field",
    "s02": "a glowing spirit bird made of floating dandelion fluff, over a moonlit meadow",
    "s03": "a glowing white spirit stag whose antlers are leafy tree branches, in a moonlit forest",
    "s04": "an ancient spirit tortoise with green moss and tiny mushrooms growing on its shell, in a moonlit forest",
    "s05": "a spirit cat glowing like warm hearth firelight, sitting on a cottage roof",
    "s06": "a small spirit fox whose tail glows like a firefly lantern, beside village cottages",
    "s07": "a spirit pangolin with a shell of grey mountain stones with glowing cracks, on a moonlit mountain",
    "s08": "a spirit ram with glowing crystal horns, on a moonlit mountain ridge",
    "s09": "a glowing spirit koi fish made of swirling water leaping from a moonlit pond",
    "s10": "a spirit water horse with a mane of foaming waves rising from a moonlit lake",
}
COVER_STYLE = "cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, crisp clean pixels, no text, no letters, no logo"
COVER = ("a cozy wooden tabletop seen from above in warm lamp light, a honeycomb board of hexagon spaces with stacks of thick "
         "colored wooden discs: blue water discs, grey stone discs, trees of brown trunk discs with round green canopies, yellow "
         "wheat discs, tiny red-roof cottages; small storybook animals (a fox, an otter, an owl) standing on the stacks, autumn "
         "leaves scattered around, no people, " + COVER_STYLE)

# 名字: (接口, 描述, 宽, 高, 透明, 种子们)
JOBS: dict[str, tuple] = {
    "bg-night": ("/create-image-pixen", "pixel art top-down view of an empty dark walnut wooden tabletop at night, visible wood grain "
                 "planks, warm pool of light from a brass desk lamp in the top left corner, a few autumn leaves, acorns and a small "
                 "wooden box near the edges, the large center of the table is empty and plain, cozy, " + NO, 512, 288, False, (101, 102, 103)),
    "bg-day": ("/create-image-pixen", "pixel art top-down view of an empty light oak wooden tabletop in daytime, visible wood grain "
               "planks, soft sunlight from a window in the top left with leaf shadows, a small potted plant, a few green leaves and "
               "acorns near the edges, the large center of the table is empty and plain, bright and fresh, " + NO, 512, 288, False, (201, 202, 203)),
    "top-canopy": ("/generate-image-v2", "pixel art game piece: a round fluffy green tree canopy crown of leaves, no trunk, seen from "
                   "slightly above, soft light from top left, bold dark outline", 24, 24, True, (301,)),
    "top-cottage": ("/generate-image-v2", "pixel art game piece: a tiny cottage house with a red tiled roof and cream walls and a small "
                    "door, seen from slightly above and front, soft light from top left, bold dark outline", 24, 24, True, (302,)),
    "top-wheat": ("/generate-image-v2", "pixel art game piece decoration: a small upright bundle of golden wheat stalks with ears, "
                  "soft light from top left, bold dark outline", 24, 24, True, (303,)),
    "cube-animal": ("/generate-image-v2", "pixel art of a single small orange wooden cube game piece seen from above at an angle, three "
                    "visible faces, soft light from top left, bold dark brown outline", 16, 16, True, (401,)),
    "cube-spirit": ("/generate-image-v2", "pixel art of a single small translucent white glowing cube game piece, soft pale cyan glow, "
                    "seen from above at an angle, three visible faces", 16, 16, True, (402,)),
    "ic-water": ("/generate-image-v2", "pixel art icon of a blue water drop with a small wave, " + ICON, 16, 16, True, (501,)),
    "ic-mountain": ("/generate-image-v2", "pixel art icon of a grey rocky mountain peak with a snowy tip, " + ICON, 16, 16, True, (502,)),
    "ic-trunk": ("/generate-image-v2", "pixel art icon of a brown wooden log slice showing tree rings, " + ICON, 16, 16, True, (503,)),
    "ic-tree": ("/generate-image-v2", "pixel art icon of a small round green leafy tree with a brown trunk, " + ICON, 16, 16, True, (504,)),
    "ic-field": ("/generate-image-v2", "pixel art icon of a golden wheat ear, " + ICON, 16, 16, True, (505,)),
    "ic-house": ("/generate-image-v2", "pixel art icon of a small cottage with a red roof, " + ICON, 16, 16, True, (506,)),
    "ic-score": ("/generate-image-v2", "pixel art icon of a single golden yellow-green leaf with a light vein, " + ICON, 16, 16, True, (507,)),
    "ic-river": ("/generate-image-v2", "pixel art icon of a winding blue river stream between green banks, " + ICON, 16, 16, True, (508,)),
    "ic-island": ("/generate-image-v2", "pixel art icon of a tiny green island with one tree surrounded by blue water, " + ICON, 16, 16, True, (509,)),
    "ic-spirit": ("/generate-image-v2", "pixel art icon of a glowing pale cyan wisp spirit flame with a tiny leaf, " + ICON, 16, 16, True, (510,)),
    "ui-first": ("/generate-image-v2", "pixel art icon of a wooden leaf-shaped arrow token pointing right, warm wood, " + ICON, 24, 24, True, (511,)),
    "ui-bag": ("/generate-image-v2", "pixel art icon of a small beige linen drawstring sack bag tied with a string, plump, " + ICON, 32, 32, True, (512,)),
    "back-animal": ("/create-image-pixflux", "pixel art card back design, a carved warm wooden panel with a hexagon honeycomb pattern and "
                    "a single green leaf emblem in the center, symmetric, cozy storybook style, " + NO, 72, 104, False, (601, 602, 603)),
    "back-spirit": ("/create-image-pixflux", "pixel art card back design, deep night blue with a glowing pale crescent moon in the center "
                    "surrounded by a ring of tiny stars and leaves, symmetric, cozy storybook style, " + NO, 72, 104, False, (611, 612, 613)),
    "result": ("/create-image-pixflux", "pixel art decorative wreath garland of green leaves, small wildflowers and golden wheat ears "
               "curving in a wide shallow arc, empty center, cozy storybook style, " + NO, 160, 64, True, (701, 702, 703)),
    "cover": ("/create-image-pixflux", COVER, 384, 192, False, (811, 812, 813)),
}
for key, (color, desc) in ANIMALS.items():
    JOBS[key] = ("/create-image-pixflux", f"{desc}, {HAB[color]}, {ART}", 64, 64, False, (1000 + int(key[1:]) * 10 + 1, 1000 + int(key[1:]) * 10 + 2, 1000 + int(key[1:]) * 10 + 3))
for key, desc in SPIRITS.items():
    JOBS[key] = ("/create-image-pixflux", f"{desc}, {SPIRIT}", 64, 64, False, (2000 + int(key[1:]) * 10 + 1, 2000 + int(key[1:]) * 10 + 2, 2000 + int(key[1:]) * 10 + 3))


def run(name: str, seed: int) -> None:
    endpoint, prompt, width, height, transparent, _ = JOBS[name]
    if endpoint == "/generate-image-v2":
        folder = OUT / name
        if folder.exists() and any(folder.glob("*.png")):
            return
        pixellab.generate_async(name, {"description": prompt, "image_size": {"width": width, "height": height},
                                       "no_background": transparent, "seed": seed}, folder, endpoint=endpoint)
    else:
        target = f"{name}-s{seed}"
        if (OUT / f"{target}.png").exists():
            return
        body = {"description": prompt, "image_size": {"width": width, "height": height}, "seed": seed}
        if endpoint == "/create-image-pixen":
            body["detail"] = "highly detailed"
        else:
            body["no_background"] = transparent
        pixellab.generate_image(target, body, OUT, endpoint=endpoint)
    print(name, seed, "ok", flush=True)


if __name__ == "__main__":
    prefixes = sys.argv[1:]
    names = [n for n in JOBS if not prefixes or any(n.startswith(p) for p in prefixes)]
    tasks = [(n, s) for n in names for s in JOBS[n][5]]
    print("任务", len(tasks), flush=True)
    with ThreadPoolExecutor(max_workers=10) as pool:
        for future in [pool.submit(run, n, s) for n, s in tasks]:
            try:
                future.result()
            except Exception as error:  # 一样失败不拖累别的
                print("失败", error, flush=True)
    print("全部完成", flush=True)
