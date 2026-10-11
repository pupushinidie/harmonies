"""立绘总览：python cardsheet.py <输出> <编号...>  每个编号一行 3 个候选（2×），两栏。"""
import sys, glob
from PIL import Image, ImageDraw
out, ids = sys.argv[1], sys.argv[2:]
S = 2; W = 64 * S; rows = (len(ids) + 1) // 2
sheet = Image.new('RGB', (6 * (W + 6) + 20, rows * (W + 16)), (40, 30, 24)); d = ImageDraw.Draw(sheet)
for k, a in enumerate(ids):
    fs = sorted(glob.glob(f'out/r*/{a}-s*.png'))[-3:] if '--last' in sys.argv else sorted(glob.glob(f'out/r1/{a}-s*.png'))
    for j, f in enumerate(fs[:3]):
        x = ((k // rows) * 3 + j) * (W + 6) + (20 if k >= rows else 0); y = (k % rows) * (W + 16)
        sheet.paste(Image.open(f).convert('RGB').resize((W, W), Image.NEAREST), (x, y)); d.text((x + 2, y + W + 2), f.split('/')[-1][:-4], fill=(255, 255, 255))
sheet.save(out)
