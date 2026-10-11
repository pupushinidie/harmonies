"""动物小动作：把 animate 返回的帧拼成 6 帧横排（去掉和首帧重复的末帧），首帧换回立绘静态图，逐条检查，过了的写进 selection.json。
python anim_pick.py   → out/anim/<编号>.png（候选条）、out/sheets/anim-*.png（总览），打印每条的检查结果
检查：和首帧比最大变化 3%–45%（太静 / 走形）；末帧→首帧接缝不超过相邻最大 1.5 倍 + 2%；坏帧（峰值 ≥ 中位 3 倍且 ≥ 25%）；
另外查「只有第 0 帧不一样」的静态重绘（第 1–5 帧彼此几乎一样，和第 0 帧差很多）。
"""
from __future__ import annotations

import json
import pathlib
import sys

import numpy as np
from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"
SEL = ART / "selection.json"


def diff(a, b):
    x, y = np.asarray(a.convert("RGB")).astype(int), np.asarray(b.convert("RGB")).astype(int)
    return float((np.abs(x - y).sum(axis=2) > 48).mean())


def check(frames):
    vs0 = [diff(frames[0], f) for f in frames[1:]]
    steps = [diff(frames[i], frames[i + 1]) for i in range(len(frames) - 1)]
    seam = diff(frames[-1], frames[0])
    probs = []
    if max(vs0) < 0.03:
        probs.append(f"太静 {max(vs0):.1%}")
    if max(vs0) > 0.45:
        probs.append(f"走形 {max(vs0):.1%}")
    if seam > max(steps) * 1.5 + 0.02:
        probs.append(f"接缝跳 {seam:.1%}")
    allst = sorted(steps + [seam])
    if allst[-1] >= 0.25 and allst[-1] >= 3 * allst[len(allst) // 2]:
        probs.append(f"坏帧 {allst[-1]:.1%}")
    inner = [diff(frames[i], frames[i + 1]) for i in range(1, len(frames) - 1)]
    if max(inner) < 0.01 and min(vs0) > 0.1:
        probs.append("静态重绘")
    return probs, f"首帧最大 {max(vs0):.1%}，相邻最大 {max(steps):.1%}，接缝 {seam:.1%}"


def main():
    sel = json.loads(SEL.read_text())
    pick = sel["pick"]
    good = {}
    (OUT / "anim").mkdir(exist_ok=True)
    rows = []
    for folder in sorted((OUT).glob("r*/anim/*-s*")):
        key = folder.name.split("-")[0]
        fs = sorted(folder.glob(f"{folder.name}-*.png"))
        if not fs:
            continue
        still = Image.open(OUT / f"{pick[f'cards/animals/{key}']}.png").convert("RGB")
        frames = [Image.open(f).convert("RGB") for f in fs]
        if frames[0].size != (64, 64):
            print(key, "尺寸不对", frames[0].size)
            continue
        if len(frames) >= 7:
            frames = frames[:6]
        frames[0] = still
        probs, info = check(frames)
        strip = Image.new("RGB", (64 * len(frames), 64))
        for i, f in enumerate(frames):
            strip.paste(f, (i * 64, 0))
        name = f"anim/{folder.name}"
        strip.save(OUT / f"{name}.png")
        rows.append((folder.name, strip, probs))
        print(("✓" if not probs else "✗"), folder.name, info, "；".join(probs))
        if not probs and len(frames) == 6 and key not in good:
            good[key] = name
    pick["cards/anim"] = dict(sorted(good.items()))
    SEL.write_text(json.dumps(sel, ensure_ascii=False, indent=1))
    # 总览
    for part in range(0, len(rows), 16):
        chunk = rows[part:part + 16]
        sheet = Image.new("RGB", (384 * 2 + 20, 140 * ((len(chunk) + 1) // 2)), (40, 30, 24))
        for i, (n, s, p) in enumerate(chunk):
            x, y = (i % 2) * (384 * 2 // 2 + 404), (i // 2) * 140
            sheet.paste(s.resize((s.width * 2 // 2 * 1, 64 * 2 // 2 * 1)), (x, y))
            if p:
                sheet.paste((200, 40, 40), (x, y + 66, x + 384, y + 70))
        sheet.save(OUT / "sheets" / f"anim-{part // 16}.png")
    print("过检查的", len(good), "条：", " ".join(good))


if __name__ == "__main__":
    main()
