"""预览：版图 + 一套标记摆成一局中途的样子，放在夜/日背景上。python preview.py <版图.png> <a|b> <标记目录> <背景.png> <输出> [倍数]"""
import sys, json
from PIL import Image
sys.path.insert(0, __import__("os").path.dirname(__file__))
from geom import cell_xy, cells
LAY = {"a": {(0,0):"W",(0,1):"W",(1,1):"W",(2,2):"W",(0,3):"BG",(0,4):"BBG",(1,3):"G",(2,0):"KK",(3,0):"KKK",(4,0):"K",
             (2,1):"Y",(1,0):"Y",(4,2):"KR",(3,2):"BR",(4,3):"Y",(3,3):"B",(2,4):"BB",(4,4):"RR",(3,1):"BBG",(1,2):"R"},
       "b": {(0,0):"W",(1,0):"W",(2,0):"KKK",(3,0):"KK",(4,0):"K",(5,0):"Y",(6,0):"Y",(0,1):"BG",(1,1):"BBG",(2,1):"G",(3,1):"KR",
             (4,1):"BR",(5,1):"RR",(6,1):"W",(0,2):"B",(1,2):"BB",(2,2):"R",(3,2):"Y",(4,2):"W",(6,3):"BG",(4,3):"W"}}
def render(board, side, tokdir, bgp, out, k=3, cubes=((2,1),(4,2),(1,2))):
    b = Image.open(board).convert("RGBA")
    layer = Image.new("RGBA", (b.width, b.height + 20), (0,0,0,0)); layer.alpha_composite(b, (0, 20))
    meta = json.load(open(f"{tokdir}/tokens.json"))
    cube = None
    try: cube = Image.open(f"{tokdir}/../pick/cube-animal.png").convert("RGBA")
    except Exception: pass
    order = sorted(LAY[side].items(), key=lambda kv: cell_xy(*kv[0])[1])
    for (c, r), s in order:
        x, y = cell_xy(c, r)
        t = Image.open(f"{tokdir}/{s}.png").convert("RGBA")
        layer.alpha_composite(t, (x, y - 18 + 20))
        if cube is not None and (c, r) in cubes:
            cx, cy = meta["stacks"][s]["cube"]; layer.alpha_composite(cube, (x + cx - cube.width // 2, y - 18 + 20 + cy - cube.height))
    bg = Image.open(bgp).convert("RGBA")
    W, H = layer.width * k + 120, layer.height * k + 60
    import math
    f = math.ceil(max(W / bg.width, H / bg.height))
    bgs = bg.resize((bg.width * f, bg.height * f), Image.NEAREST)
    x0, y0 = (bgs.width - W) // 2, (bgs.height - H) // 2
    bgs = bgs.crop((x0, y0, x0 + W, y0 + H))
    big = layer.resize((layer.width * k, layer.height * k), Image.NEAREST)
    bgs.alpha_composite(big, (60, 30)); bgs.save(out)
if __name__ == "__main__":
    a = sys.argv
    render(a[1], a[2], a[3], a[4], a[5], int(a[6]) if len(a) > 6 else 3)
