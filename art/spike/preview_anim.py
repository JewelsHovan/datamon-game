"""Spike: cut a generated strip into frames, anchor them, and render an in-game-timed GIF at three sizes."""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
a = np.array(im)[..., 3]
solid = a >= 128
from scipy import ndimage
lab, n = ndimage.label(solid, structure=np.ones((3, 3)))
sizes = ndimage.sum(solid, lab, range(1, n + 1))
big = [i + 1 for i, sz in enumerate(sizes) if sz > 0.15 * sizes.max()]
cent = {i: ndimage.center_of_mass(solid, lab, i) for i in range(1, n + 1)}
owner = {}
for i in range(1, n + 1):
    owner[i] = i if i in big else min(big, key=lambda b: (cent[b][1] - cent[i][1]) ** 2 + (cent[b][0] - cent[i][0]) ** 2)
big.sort(key=lambda b: cent[b][1])
print("figures found:", len(big))
rgba = np.array(im)
frames = []
for b in big:
    mask = np.isin(lab, [i for i in owner if owner[i] == b])
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub = rgba[y0:y1, x0:x1].copy()
    sub[..., 3] = np.where(mask[y0:y1, x0:x1], 255, 0)
    m = sub[..., 3] > 0
    bottom = m.shape[0] - 1
    feet = m[bottom - 25: bottom + 1]
    back_x = np.nonzero(feet.any(axis=0))[0].min()
    frames.append((Image.fromarray(sub), back_x, bottom, 0))
stance_h = frames[0][2] - frames[0][3]

def scaled(fr, target_h):
    img, bx, by, _ = fr
    k = target_h / stance_h
    small = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.BOX)
    arr = np.array(small); arr[..., 3] = np.where(arr[..., 3] >= 140, 255, 0)
    return Image.fromarray(arr), bx * k, by * k

def stage(W, H):
    bg = Image.new("RGBA", (W, H), (34, 32, 86, 255)); d = ImageDraw.Draw(bg)
    for y in range(0, int(H * 0.8), max(2, H // 54)): d.line((0, y, W, y), fill=(42, 40, 100, 255))
    fy = int(H * 0.86); d.rectangle((0, fy, W, H), fill=(59, 47, 57, 255)); d.line((0, fy, W, fy), fill=(138, 106, 114, 255), width=max(1, H // 120))
    return bg, fy

SIZES = [("384x216 / 84px (current spec)", 384, 216, 84),
         ("640x360 / 140px", 640, 360, 140),
         ("960x540 / 210px", 960, 540, 210)]
# timeline in 60 Hz ticks: idle, wind-up, travel, impact (hit-stop feel), follow, recover, idle
timeline = [(0, 18), (1, 4), (2, 3), (3, 9), (4, 5), (5, 6), (0, 14)]
DISP_H = 440
try: font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 15)
except Exception: font = None
panels_w = []
gif = []
for fi, ticks in timeline:
    tiles = []
    for label, W, H, th in SIZES:
        bg, fy = stage(W, H)
        spr, bx, by = scaled(frames[fi], th)
        x = round(W * 0.38 - bx); y = round(fy - by)
        bg.alpha_composite(spr, (x, y))
        cx0 = round(W * 0.38 - 0.45 * th); cy0 = round(fy - 1.2 * th)
        crop = bg.crop((cx0, cy0, cx0 + round(1.6 * th), fy + round(0.1 * th)))
        k = DISP_H / crop.height
        tiles.append((label, crop.resize((round(crop.width * k), DISP_H), Image.NEAREST)))
    W_total = sum(t.width for _, t in tiles) + 12 * (len(tiles) + 1)
    sheet = Image.new("RGB", (W_total, DISP_H + 40), (18, 17, 40)); d = ImageDraw.Draw(sheet)
    x = 12
    for label, t in tiles:
        d.text((x, 10), label, fill=(240, 236, 255), font=font)
        sheet.paste(t.convert("RGB"), (x, 34)); x += t.width + 12
    gif.append((sheet, ticks))
imgs = [g for g, _ in gif]
imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=[round(t * 1000 / 60) for _, t in gif], loop=0)
imgs[3].save(out.replace(".gif", "-impact.png"))
print(out)
