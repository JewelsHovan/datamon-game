"""Cut a generated strip into game-ready frames (spec 002, R3).

Usage:  uv run --with pillow --with numpy --with scipy python -I art/pipeline/process.py SLUG CLIP RAW.png

Every strip starts with one calibration frame (the standard fighting stance). It sets the
clip's scale (stance -> STANCE_PX tall) and the anchor offset for torso-anchored clips, then
is dropped. Output: art/fighters/SLUG/CLIP/NN.png, frames.json, contact.png, preview.gif.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402


class FrameCountError(Exception):
    pass


@dataclass
class Figure:
    img: Image.Image  # RGBA crop, hard alpha, raw scale
    x0: int
    y0: int
    backfoot_x: float  # raw, relative to crop
    mass_x: float  # raw, relative to crop

    @property
    def h(self) -> int:
        return self.img.height


def cut_figures(img: Image.Image, min_share: float = 0.12) -> list[Figure]:
    """Split a strip into figures via connected components, ordered left to right."""
    rgba = np.array(img.convert("RGBA"))
    solid = rgba[..., 3] >= common.ALPHA_CUT
    lab, n = ndimage.label(solid, structure=np.ones((3, 3)))
    if n == 0:
        return []
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    big = [i + 1 for i, s in enumerate(sizes) if s >= min_share * sizes.max()]
    cents = ndimage.center_of_mass(solid, lab, range(1, n + 1))
    owner = {}
    for i in range(1, n + 1):
        if i in big:
            owner[i] = i
        else:
            cy, cx = cents[i - 1]
            owner[i] = min(big, key=lambda b: (cents[b - 1][1] - cx) ** 2 + (cents[b - 1][0] - cy) ** 2)
    big.sort(key=lambda b: cents[b - 1][1])
    figures = []
    for b in big:
        mask = np.isin(lab, [i for i, o in owner.items() if o == b])
        ys, xs = np.nonzero(mask)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sub = rgba[y0:y1, x0:x1].copy()
        m = mask[y0:y1, x0:x1]
        sub[..., 3] = np.where(m, 255, 0)
        h = m.shape[0]
        band = max(3, int(h * 0.05))
        feet = m[h - band:]
        backfoot = float(np.nonzero(feet.any(axis=0))[0].min())
        mass = float(np.nonzero(m)[1].mean())
        figures.append(Figure(Image.fromarray(sub), int(x0), int(y0), backfoot, mass))
    return figures


def downscale(img: Image.Image, k: float) -> Image.Image:
    w, h = max(1, round(img.width * k)), max(1, round(img.height * k))
    small = np.array(img.resize((w, h), Image.BOX))
    small[..., 3] = np.where(small[..., 3] >= common.ALPHA_CUT, 255, 0)
    return Image.fromarray(small)


def build_palette(images: list[Image.Image], colors: int = common.PALETTE_SIZE) -> list[str]:
    """Median-cut palette over the opaque pixels of the given images."""
    px = []
    for im in images:
        a = np.array(im.convert("RGBA"))
        px.append(a[a[..., 3] >= common.ALPHA_CUT][:, :3])
    allpx = np.concatenate(px)
    side = int(np.ceil(np.sqrt(len(allpx))))
    pad = np.zeros((side * side - len(allpx), 3), dtype=np.uint8) + allpx[0]
    grid = np.concatenate([allpx, pad]).reshape(side, side, 3)
    q = Image.fromarray(grid, "RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = q.getpalette()[: colors * 3]
    used = sorted(set(q.getdata()))
    return ["#%02x%02x%02x" % tuple(pal[i * 3: i * 3 + 3]) for i in used]


def apply_palette(img: Image.Image, palette: list[str]) -> Image.Image:
    rgb = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in palette], dtype=np.int32)
    a = np.array(img.convert("RGBA"))
    opaque = a[..., 3] > 0
    px = a[opaque][:, :3].astype(np.int32)
    d = ((px[:, None, :] - rgb[None, :, :]) ** 2).sum(-1)
    a[opaque, :3] = rgb[d.argmin(1)].astype(np.uint8)
    return Image.fromarray(a)


def process_strip(img: Image.Image, clip: dict, palette: list[str] | None, overrides: dict | None = None):
    """Return (frames, calibration_figure). frames: list of dicts with image + anchor + hold."""
    figures = cut_figures(img)
    expected = len(clip["poses"]) + 1
    if len(figures) != expected:
        raise FrameCountError(f"expected {expected} figures (1 calibration + {expected - 1} frames), found {len(figures)}")
    calib, rest = figures[0], figures[1:]
    k = common.STANCE_PX / calib.h
    offset = calib.mass_x - calib.backfoot_x  # torso anchors land in back-foot space
    overrides = overrides or {}
    frames = []
    for i, fig in enumerate(rest):
        small = downscale(fig.img, k)
        if palette:
            small = apply_palette(small, palette)
        ax_raw = fig.backfoot_x if clip.get("anchor", "backfoot") == "backfoot" else fig.mass_x - offset
        dx, dy = overrides.get(str(i), [0, 0])
        frames.append({
            "image": small,
            "ax": int(round(ax_raw * k)) + int(dx),
            "ay": small.height - 1 + int(dy),
            "hold": int(clip["holds"][i]),
        })
    return frames, calib, k


STAGE_BG, FLOOR = (34, 32, 86, 255), (138, 106, 114, 255)


def review_images(frames: list[dict], out_dir: Path, zoom: int = 3) -> None:
    """Contact sheet (frames aligned on the anchor, floor line, anchor mark) and a timed GIF."""
    left = max(f["ax"] for f in frames) + 12
    right = max(f["image"].width - f["ax"] for f in frames) + 12
    top = max(f["ay"] for f in frames) + 12
    below = max(f["image"].height - f["ay"] for f in frames) + 12
    W, H = left + right, top + below

    def canvas(f) -> Image.Image:
        c = Image.new("RGBA", (W, H), STAGE_BG)
        ImageDraw.Draw(c).line((0, top + 1, W, top + 1), fill=FLOOR)
        c.alpha_composite(f["image"], (left - f["ax"], top - f["ay"]))
        return c

    tiles = []
    for i, f in enumerate(frames):
        c = canvas(f)
        d = ImageDraw.Draw(c)
        d.line((left - 3, top + 1, left + 3, top + 1), fill=(255, 201, 74, 255))
        d.line((left, top - 2, left, top + 4), fill=(255, 201, 74, 255))
        d.text((3, 2), str(i), fill=(240, 236, 255, 255))
        tiles.append(c.resize((W * zoom, H * zoom), Image.NEAREST))
    sheet = Image.new("RGB", (len(tiles) * W * zoom, H * zoom))
    for i, t in enumerate(tiles):
        sheet.paste(t.convert("RGB"), (i * W * zoom, 0))
    sheet.save(out_dir / "contact.png")
    gif = [canvas(f).resize((W * zoom, H * zoom), Image.NEAREST).convert("RGB") for f in frames]
    gif[0].save(out_dir / "preview.gif", save_all=True, append_images=gif[1:],
                duration=[max(20, round(f["hold"] * 1000 / 60)) for f in frames], loop=0)


def palette_for(slug: str, clip_id: str, figures_for_idle: list[Image.Image] | None) -> list[str]:
    path = common.fighter_dir(slug) / "palette.json"
    if path.exists():
        return json.loads(path.read_text())
    if clip_id != "idle":
        raise SystemExit("palette.json is missing: process the idle clip first")
    walk = [common.walk_cell(slug, common.SIDE_RIGHT_ROW, c) for c in range(4)] + [common.walk_cell(slug, common.FRONT_ROW, 0)]
    pal = build_palette(walk + (figures_for_idle or []))
    path.write_text(json.dumps(pal, indent=1) + "\n")
    return pal


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug")
    ap.add_argument("clip")
    ap.add_argument("raw", type=Path)
    args = ap.parse_args()

    clips = common.load_clips()["clips"]
    if args.clip not in clips:
        print(f"unknown clip {args.clip}", file=sys.stderr)
        return 2
    clip = clips[args.clip]
    img = Image.open(args.raw).convert("RGBA")
    fdir = common.fighter_dir(args.slug)
    overrides = common.load_json(fdir / "anchors.json", {}).get(args.clip, {})

    try:
        unpaletted, calib, k = process_strip(img, clip, None, overrides)
    except FrameCountError as e:
        print(f"{args.slug}/{args.clip}: {e} in {args.raw}", file=sys.stderr)
        return 3
    pal = palette_for(args.slug, args.clip, [f["image"] for f in unpaletted] if args.clip == "idle" else None)
    frames = [dict(f, image=apply_palette(f["image"], pal)) for f in unpaletted]

    out = fdir / args.clip
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.png"):
        old.unlink()
    meta = []
    for i, f in enumerate(frames):
        name = f"{i:02d}.png"
        f["image"].save(out / name)
        meta.append({"file": name, "w": f["image"].width, "h": f["image"].height, "ax": f["ax"], "ay": f["ay"], "hold": f["hold"]})
    (out / "frames.json").write_text(json.dumps({"clip": args.clip, "loop": clip["loop"], "scale": round(k, 5),
                                                  "raw": str(args.raw.relative_to(common.ROOT)) if args.raw.is_absolute() else str(args.raw),
                                                  "frames": meta}, indent=1) + "\n")
    review_images(frames, out)
    if args.clip == "idle":
        refs = fdir / "refs"
        refs.mkdir(exist_ok=True)
        calib.img.save(refs / "idle-stance.png")
    status = common.load_status(args.slug)
    prev = status.get(args.clip, {})
    status[args.clip] = {"state": "generated", "raw": str(args.raw), "note": prev.get("note", "")}
    common.save_status(args.slug, status)
    heights = [m["h"] for m in meta]
    print(f"{args.slug}/{args.clip}: {len(meta)} frames, scale {k:.4f}, heights {heights}, -> {out.relative_to(common.ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
