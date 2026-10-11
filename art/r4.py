"""第 4 轮：动画补做（a09、a23 太静换种子换动作；a26 雪豹定稿后补做）。python r4.py"""
from concurrent.futures import ThreadPoolExecutor
import pixellab
import r3

r3.ANIM = pixellab.ART / "out" / "r4" / "anim"
r3.PICK["a26"] = "r3/a26-s1269"
r3.ACT.update({"a09": "the stork turns its head side to side and clatters its beak", "a23": "the eagle turns its head and ruffles its wing feathers",
               "a26": "the snow leopard blinks and swishes its long fluffy tail"})
JOBS = [("a09", 3209), ("a09", 3309), ("a23", 3223), ("a23", 3323), ("a26", 3226), ("a26", 3326)]
with ThreadPoolExecutor(max_workers=10) as pool:
    for f in [pool.submit(r3.anim, k, s) for k, s in JOBS]:
        try:
            f.result()
        except Exception as e:
            print("失败", e, flush=True)
print("全部完成", flush=True)
