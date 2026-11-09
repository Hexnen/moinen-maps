# Lens "no squares" crops: before | after of the same CSS box of two builds' shots (dev/lens-smooth.mjs capture), 5 x, LANCZOS
# (smooth: it neither hides squares by blurring nor invents blocks; at DPR 2 a CSS px is 2 device px, the crop is scaled 2.5 x).
#   python dev/lens-smooth-crops.py <mm-rec dir> A B <out dir> <case> <i> <x> <y> <w> <h> [diff]
# One png per view (z, DPR, day/night) of the case: ls-crop-<case>-z<z>-d<dpr>-n<dark>-<x>-<y>.png. With "diff": the lens's own
# picture instead (the shot minus the lens-off shot ls-OFF-..., x 3 around grey; DPR 1 only).
import os
import sys

from PIL import Image, ImageDraw
import numpy as np

D, A, B, OUT, case, i, x, y, w, h = sys.argv[1:11]
diff = len(sys.argv) > 11 and sys.argv[11] == "diff"
i, x, y, w, h = int(i), int(x), int(y), int(w), int(h)
K = 5
for name in sorted(os.listdir(D)):
    pre = f"ls-{A}-{case}-"
    if not name.startswith(pre) or not name.endswith(f"-{i}.png"):
        continue
    view = name[len(pre):-len(f"-{i}.png")]
    dpr = int(view.split("-d")[1][0])
    other = os.path.join(D, f"ls-{B}-{case}-{view}-{i}.png")
    if not os.path.exists(other) or (diff and dpr != 1):
        continue
    tiles = []
    for f in (os.path.join(D, name), other):
        im = Image.open(f).convert("RGB")
        if diff:
            off = np.asarray(Image.open(os.path.join(D, f"ls-OFF-{case}-{view}-{i}.png")).convert("RGB")).astype(np.int16)
            im = Image.fromarray(np.clip(128 + (np.asarray(im).astype(np.int16) - off) * 3, 0, 255).astype(np.uint8))
        im = im.crop((x * dpr, y * dpr, (x + w) * dpr, (y + h) * dpr)).resize((w * K, h * K), Image.LANCZOS)
        tiles.append(im)
    o = Image.new("RGB", (w * K * 2 + 10, h * K + 26), (255, 255, 255))
    g = ImageDraw.Draw(o)
    for j, (t, lab) in enumerate(zip(tiles, ("before", "after"))):
        o.paste(t, (j * (w * K + 10), 26))
        g.text((j * (w * K + 10) + 6, 6), f"{lab}  {case} {view}  {'lens only x3' if diff else ''}  {w}x{h} CSS px at 5x, lanczos", fill=(0, 0, 0))
    p = os.path.join(OUT, f"ls-crop{'-diff' if diff else ''}-{case}-{view}-{x}-{y}.png")
    o.save(p)
    print(p)
