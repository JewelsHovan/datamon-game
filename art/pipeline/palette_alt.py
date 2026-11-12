"""Build P2's alternate palette for mirror matches (spec 003, R8).

Usage:  uv run --with pillow --with numpy python -I art/pipeline/palette_alt.py SLUG [--preview OUT.png]

Finds the dominant top-garment hue (torso band of the idle frames, saturated colors outside the
skin and brown range), and rotates only that hue family to whichever of red, blue or gold is
farthest from it. Writes art/fighters/SLUG/palette-alt.json as {"#from": "#to"} for every
palette color, and copies it to public/fighters/SLUG/palette-alt.json for the game.
"""

from __future__ import annotations

import argparse
import colorsys
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

TARGETS = (0.0, 215.0, 45.0)  # red, blue, gold
FAMILY = 35.0  # degrees around the dominant hue that get rotated
SKIN = (5.0, 45.0)  # hue range left alone (skin, brown hair, shoes)


def hsv(hexcolor: str) -> tuple[float, float, float]:
    r, g, b = (int(hexcolor[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    return h * 360, s, v


def hue_dist(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


def build(slug: str) -> dict[str, str]:
    fdir = common.fighter_dir(slug)
    palette = json.loads((fdir / "palette.json").read_text())
    counts = {c: 0 for c in palette}
    for f in sorted((fdir / "idle").glob("*.png")):
        a = np.array(Image.open(f).convert("RGBA"))
        h = a.shape[0]
        a = a[int(h * 0.24): int(h * 0.58)]  # torso band: the top garment defines the fighter's look
        for p in a[a[..., 3] > 0][:, :3]:
            key = "#%02x%02x%02x" % tuple(p)
            if key in counts:
                counts[key] += 1
    weights = np.zeros(36)
    for c, n in counts.items():
        h, s, v = hsv(c)
        if s > 0.18 and v > 0.12 and not (SKIN[0] <= h <= SKIN[1]):
            weights[int(h // 10) % 36] += n
    dominant = float(weights.argmax() * 10 + 5)
    target = max(TARGETS, key=lambda t: hue_dist(dominant, t))
    shift = (target - dominant) % 360
    out = {}
    for c in palette:
        h, s, v = hsv(c)
        if s > 0.12 and hue_dist(h, dominant) <= FAMILY and not (SKIN[0] <= h <= SKIN[1]):
            r, g, b = colorsys.hsv_to_rgb(((h + shift) % 360) / 360, min(1.0, s * 1.8), min(1.0, v * 1.15))
            out[c] = "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))
        else:
            out[c] = c
    print(f"{slug}: dominant hue {dominant:.0f}, rotated to {target:.0f}, {sum(1 for k, v in out.items() if k != v)} of {len(out)} colors changed")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug")
    ap.add_argument("--preview", type=Path)
    args = ap.parse_args()
    mapping = build(args.slug)
    text = json.dumps(mapping, indent=1) + "\n"
    (common.fighter_dir(args.slug) / "palette-alt.json").write_text(text)
    pub = common.PUBLIC_FIGHTERS / args.slug
    pub.mkdir(parents=True, exist_ok=True)
    (pub / "palette-alt.json").write_text(text)
    if args.preview:
        frame = Image.open(common.fighter_dir(args.slug) / "idle" / "00.png").convert("RGBA")
        a = np.array(frame)
        alt = a.copy()
        for i, j in zip(*np.nonzero(a[..., 3])):
            key = "#%02x%02x%02x" % tuple(a[i, j, :3])
            to = mapping.get(key, key)
            alt[i, j, :3] = [int(to[k:k + 2], 16) for k in (1, 3, 5)]
        both = Image.new("RGBA", (frame.width * 2 + 10, frame.height), (34, 32, 86, 255))
        both.alpha_composite(frame, (0, 0))
        both.alpha_composite(Image.fromarray(alt).transpose(Image.FLIP_LEFT_RIGHT), (frame.width + 10, 0))
        both.resize((both.width * 3, both.height * 3), Image.NEAREST).save(args.preview)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
