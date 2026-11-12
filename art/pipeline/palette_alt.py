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
    """Recolor the top garment: colors that show up mostly in the torso band and rarely in the
    head band (so hair and face stay), excluding skin tones. Chromatic colors rotate to a target
    hue far from the garment's; near-black and grey garments get tinted instead."""
    fdir = common.fighter_dir(slug)
    palette = json.loads((fdir / "palette.json").read_text())
    torso = {c: 0 for c in palette}
    head = {c: 0 for c in palette}
    for f in sorted((fdir / "idle").glob("*.png")):
        a = np.array(Image.open(f).convert("RGBA"))
        h = a.shape[0]
        for band, store in ((a[int(h * 0.30): int(h * 0.58)], torso), (a[: int(h * 0.24)], head)):
            for p in band[band[..., 3] > 0][:, :3]:
                key = "#%02x%02x%02x" % tuple(p)
                if key in store:
                    store[key] += 1
    total = max(1, sum(torso.values()))

    def skin(c: str) -> bool:
        h, s_, v = hsv(c)
        return 8 <= h <= 45 and 0.18 <= s_ <= 0.7 and v >= 0.5

    garment = [c for c in palette if torso[c] >= 0.005 * total and head[c] <= torso[c] * 0.25 and not skin(c)]
    weights = np.zeros(36)
    chromatic = 0
    for c in garment:
        h, s_, v = hsv(c)
        if s_ >= 0.15:
            weights[int(h // 10) % 36] += torso[c]
            chromatic += torso[c]
    dominant = float(weights.argmax() * 10 + 5) if chromatic else -1.0
    target = max(TARGETS, key=lambda t: hue_dist(dominant, t)) if dominant >= 0 else 215.0
    out = {c: c for c in palette}
    for c in garment:
        h, s_, v = hsv(c)
        if s_ < 0.15:  # black or grey garment: tint it
            r, g, b = colorsys.hsv_to_rgb(target / 360, 0.55, min(1.0, max(v * 1.35, 0.28)))
        else:
            r, g, b = colorsys.hsv_to_rgb(((h + (target - dominant)) % 360) / 360, min(1.0, s_ * 1.6), min(1.0, v * 1.15))
        out[c] = "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))
    changed = sum(1 for k, v in out.items() if k != v)
    print(f"{slug}: garment colors {len(garment)}, dominant hue {dominant:.0f}, target {target:.0f}, {changed} of {len(out)} colors changed")
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
