"""App icons, favicons and the link-preview image (spec 014, R1 and R3).

Everything is composed from the game's own art: the launch fighters' idle
frames (atlas + manifest under public/fighters/<slug>/) and the title
lettering (Press Start 2P, gold over a navy backdrop with a grid, as the
title screen draws it). Each image is designed at a small "logical" size in
game pixels and enlarged by a whole number with nearest-neighbour, so every
pixel edge stays hard at every size. Alpha is only ever 0 or 255.

Run:  uv run --with pillow --with numpy python -I art/pipeline/app_icons.py [--out DIR] [--sheet PNG]

Writes public/icons/*.png, public/favicon.ico and public/share.png (or under
--out). --sheet also writes a contact sheet of the results for review.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
FIGHTERS = PUBLIC / "fighters"

# Colors from src/scenes/ui.ts (backdrop, GOLD, panel) and title.ts (subtitle red).
NAVY_TOP = (0x0B, 0x0A, 0x1F)
NAVY_MID = (0x17, 0x15, 0x4A)
NAVY_BOTTOM = (0x2A, 0x1F, 0x5C)
GRID = (120, 110, 220)
GRID_ALPHA = 0.12
GOLD = (0xFF, 0xC9, 0x4A)
RED = (0xFF, 0x61, 0x70)
OUTLINE = (0x0D, 0x0C, 0x22)
P1_BLUE = (0x4A, 0xA8, 0xFF)
P2_RED = (0xFF, 0x5A, 0x5A)

# The title font, Press Start 2P (SIL Open Font License 1.1, by codeman38),
# rasterized at its native 8 px: the 7x7 glyph of each letter the images use.
GLYPHS = {
    "A": "..###../.##.##./##...##/##...##/#######/##...##/##...##",
    "C": "..####./.##..##/##...../##...../##...../.##..##/..####.",
    "D": "#####../##..##./##...##/##...##/##...##/##..##./#####..",
    "H": "##...##/##...##/##...##/#######/##...##/##...##/##...##",
    "I": ".######/...##../...##../...##../...##../...##../.######",
    "L": ".##..../.##..../.##..../.##..../.##..../.##..../.######",
    "M": "##...##/###.###/#######/##.#.##/##.#.##/##...##/##...##",
    "N": "##...##/###..##/####.##/##.####/##..###/##...##/##...##",
    "O": ".#####./##...##/##...##/##...##/##...##/##...##/.#####.",
    "P": "######./##...##/##...##/##...##/######./##...../##.....",
    "R": "######./##...##/##...##/##..###/#####../##.###./##..###",
    "S": ".#####./##...##/##...../.#####./.....##/##...##/.#####.",
    "V": "##...##/##...##/##...##/###.###/.#####./..###../...#...",
}
GLYPH_ADVANCE = 8  # font units per character (7 drawn + 1 space)

LAUNCH = ["julien-hovan", "felicia-gorgacheva", "pentcho-tchomakov", "alex-andrianavalontsalama"]
ICON_FIGHTER = "julien-hovan"  # the default P1, the all-rounder

# file -> (design, logical size, scale). Maskable icons keep the figure inside the
# safe zone (a centred circle of 80% of the width) and fill every pixel.
SAFE_ZONE = 0.8


def atlas_path(slug: str, manifest: dict) -> Path:
    """The fighter's atlas: the file the manifest names (spec 013 moves to WebP), else atlas.png."""
    folder = FIGHTERS / slug
    for key in ("atlas", "atlasFile", "image", "file"):
        name = manifest.get(key)
        if isinstance(name, str) and name:
            return folder / Path(name).name
        if isinstance(name, dict):  # e.g. {"file": "atlas.webp", ...}
            inner = name.get("file") or name.get("src")
            if isinstance(inner, str) and inner:
                return folder / Path(inner).name
    for candidate in ("atlas.png", "atlas.webp"):
        if (folder / candidate).exists():
            return folder / candidate
    raise SystemExit(f"{slug}: no atlas next to {folder / 'manifest.json'}")


def idle_frame(slug: str) -> tuple[np.ndarray, int, int]:
    """First idle frame as RGBA pixels with hard alpha, and its anchor (ax, ay)."""
    manifest = json.loads((FIGHTERS / slug / "manifest.json").read_text())
    f = manifest["clips"]["idle"]["frames"][0]
    atlas = Image.open(atlas_path(slug, manifest)).convert("RGBA")
    px = np.array(atlas.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"])))
    px[..., 3] = np.where(px[..., 3] >= 128, 255, 0)
    return px, f["ax"], f["ay"]


def blend(base: tuple[int, ...] | np.ndarray, color: tuple[int, int, int], alpha: float) -> np.ndarray:
    return np.rint(np.asarray(base, dtype=np.float64) * (1 - alpha) + np.asarray(color, dtype=np.float64) * alpha)


def backdrop(w: int, h: int, grid: int = 24, offset: int = 0) -> np.ndarray:
    """The menu backdrop (src/scenes/ui.ts drawBackdrop): navy gradient and a faint grid, opaque."""
    t = np.arange(h, dtype=np.float64) / max(h - 1, 1)
    stops = [(0.0, NAVY_TOP), (0.55, NAVY_MID), (1.0, NAVY_BOTTOM)]
    rows = np.zeros((h, 3))
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        mask = (t >= t0) & (t <= t1)
        k = ((t[mask] - t0) / (t1 - t0))[:, None]
        rows[mask] = np.asarray(c0) * (1 - k) + np.asarray(c1) * k
    img = np.zeros((h, w, 4), dtype=np.float64)
    img[..., :3] = np.rint(rows)[:, None, :]
    img[..., 3] = 255
    for x in range(offset % grid, w, grid):
        img[:, x, :3] = blend(img[:, x, :3], GRID, GRID_ALPHA)
    for y in range(offset % grid, h, grid):
        img[y, :, :3] = blend(img[y, :, :3], GRID, GRID_ALPHA)
    return img.astype(np.uint8)


def fill(img: np.ndarray, x0: int, y0: int, x1: int, y1: int, color: tuple[int, int, int]) -> None:
    h, w = img.shape[:2]
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
    if x0 < x1 and y0 < y1:
        img[y0:y1, x0:x1, :3] = color
        img[y0:y1, x0:x1, 3] = 255


def glyph_cells(s: str, scale: int) -> list[tuple[int, int]]:
    """Top-left corners of the font pixels of `s`, in image pixels relative to the text origin."""
    cells = []
    for i, ch in enumerate(s):
        if ch == " ":
            continue
        for gy, row in enumerate(GLYPHS[ch].split("/")):
            for gx, bit in enumerate(row):
                if bit == "#":
                    cells.append((i * GLYPH_ADVANCE * scale + gx * scale, gy * scale))
    return cells


def text(img: np.ndarray, s: str, cx: int, y: int, scale: int, color: tuple[int, int, int]) -> None:
    """Centred text as src/render/hud.ts text() draws it: a 1 px dark outline plus a (2, 2) shadow."""
    x = cx - (len(s) * GLYPH_ADVANCE * scale) // 2
    cells = glyph_cells(s, scale)
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (1, 1), (2, 2)):
        for gx, gy in cells:
            fill(img, x + gx + dx, y + gy + dy, x + gx + dx + scale, y + gy + dy + scale, OUTLINE)
    for gx, gy in cells:
        fill(img, x + gx, y + gy, x + gx + scale, y + gy + scale, color)


def paste(img: np.ndarray, sprite: np.ndarray, x: int, y: int, mirror: bool = False) -> None:
    """Hard-alpha paste of `sprite` with its top-left at (x, y), clipped to the image."""
    if mirror:
        sprite = sprite[:, ::-1]
    h, w = img.shape[:2]
    sh, sw = sprite.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + sw, w), min(y + sh, h)
    if x0 >= x1 or y0 >= y1:
        return
    part = sprite[y0 - y : y1 - y, x0 - x : x1 - x]
    on = part[..., 3] == 255
    region = img[y0:y1, x0:x1]
    region[on] = part[on]


def ellipse(img: np.ndarray, cx: float, cy: float, rx: float, ry: float, color: tuple[int, int, int], alpha: float) -> None:
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    inside = ((xx + 0.5 - cx) / rx) ** 2 + ((yy + 0.5 - cy) / ry) ** 2 <= 1
    img[inside, :3] = blend(img[inside, :3], color, alpha)


def round_corners(img: np.ndarray, r: int) -> None:
    """Transparent corners (alpha 0), a stepped quarter circle of radius r."""
    h, w = img.shape[:2]
    for y in range(r):
        for x in range(r):
            if (r - x - 0.5) ** 2 + (r - y - 0.5) ** 2 > r * r:
                for yy, xx in ((y, x), (y, w - 1 - x), (h - 1 - y, x), (h - 1 - y, w - 1 - x)):
                    img[yy, xx] = 0


def opaque_bbox(sprite: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(sprite[..., 3])
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


# ------------------------------------------------------------------ designs --


def favicon() -> np.ndarray:
    """16x16: the gold C of COMPASS on the navy panel, corners cut."""
    img = np.zeros((16, 16, 4), dtype=np.uint8)
    fill(img, 0, 0, 16, 16, NAVY_MID)
    for gx, gy in glyph_cells("C", 2):
        fill(img, 1 + gx, 1 + gy, 3 + gx, 3 + gy, GOLD)
    round_corners(img, 2)
    return img


def icon_background(size: int) -> np.ndarray:
    """The backdrop split diagonally like the versus splash (src/scenes/versus.ts): P1 blue, P2 red."""
    img = backdrop(size, size, grid=12)
    yy, xx = np.mgrid[0:size, 0:size]
    split = (xx + 0.5) - size / 2 - (size * 0.25) * (1 - 2 * (yy + 0.5) / size)
    img[split < 0, :3] = blend(img[split < 0, :3], P1_BLUE, 0.3)
    img[split >= 0, :3] = blend(img[split >= 0, :3], P2_RED, 0.3)
    return img


def app_icon(size: int, maskable: bool = False, rounded: bool = False) -> np.ndarray:
    """A launch fighter's bust over the versus colors: head and raised fists, body running off the bottom."""
    img = icon_background(size)
    sprite, _, _ = idle_frame(ICON_FIGHTER)
    bx0, by0, bx1, _ = opaque_bbox(sprite)
    head_top = round(size * (0.2 if maskable else 0.12))
    cx = size // 2
    paste(img, sprite, cx - (bx0 + bx1) // 2, head_top - by0)
    if rounded:
        round_corners(img, max(2, size // 8))
    return img


def share() -> np.ndarray:
    """600x315 (x2 = 1200x630): the title lettering over the four launch fighters, two a side."""
    w, h = 600, 315
    img = backdrop(w, h)
    text(img, "COMPASS", w // 2, 26, 5, GOLD)
    text(img, "CARDINAL CLASH", w // 2, 78, 2, RED)
    floor = 300
    fill(img, 0, floor, w, h, OUTLINE)
    fill(img, 0, floor, w, floor + 1, (0x3E, 0x3A, 0x80))
    spots = [(90, False), (205, False), (395, True), (510, True)]
    for slug, (x, mirror) in zip(LAUNCH, spots):
        sprite, ax, ay = idle_frame(slug)
        ellipse(img, x, floor - 1, 34, 5, OUTLINE, 0.6)
        left = x - (sprite.shape[1] - 1 - ax if mirror else ax)
        paste(img, sprite, left, floor - ay - 1, mirror=mirror)
    text(img, "VS", w // 2, 196, 4, GOLD)
    return img


def upscale(img: np.ndarray, k: int) -> Image.Image:
    return Image.fromarray(img, "RGBA").resize((img.shape[1] * k, img.shape[0] * k), Image.NEAREST)


# file -> (design, scale): every output is its logical design enlarged by a whole number.
OUTPUTS = {
    "icons/favicon-16.png": (favicon, 1),
    "icons/favicon-32.png": (favicon, 2),
    "icons/apple-touch-icon.png": (lambda: app_icon(90), 2),
    "icons/icon-192.png": (lambda: app_icon(96, rounded=True), 2),
    "icons/icon-512.png": (lambda: app_icon(128, rounded=True), 4),
    "icons/icon-maskable-512.png": (lambda: app_icon(128, maskable=True), 4),
    "share.png": (share, 2),
}


def build(out: Path = PUBLIC) -> dict[str, Image.Image]:
    images: dict[str, Image.Image] = {}
    for rel, (design, k) in OUTPUTS.items():
        im = upscale(design(), k)
        path = out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if rel == "share.png" or rel.startswith("icons/apple") or "maskable" in rel:
            im = im.convert("RGB")  # opaque by design: no alpha channel at all
        im.save(path, optimize=True)
        images[rel] = im
    # Browsers and crawlers still ask for /favicon.ico.
    images["icons/favicon-32.png"].save(out / "favicon.ico", sizes=[(16, 16), (32, 32)], append_images=[images["icons/favicon-16.png"]])
    return images


def contact_sheet(images: dict[str, Image.Image], path: Path) -> None:
    """Every icon at its real size on light and dark tiles, the maskable one with its safe zone."""
    pad = 16
    icons = [k for k in images if k.startswith("icons/")]
    width = pad + sum(images[k].width + pad for k in icons)
    height = pad + 512 + pad + 512 + pad
    sheet = Image.new("RGB", (max(width, 1200 + 2 * pad), height + 630 + pad), (40, 40, 48))
    x = pad
    for k in icons:
        im = images[k].convert("RGBA")
        for row, bg in enumerate([(236, 236, 240), (24, 24, 28)]):
            tile = Image.new("RGBA", im.size, bg + (255,))
            tile.alpha_composite(im)
            sheet.paste(tile.convert("RGB"), (x, pad + row * (512 + pad)))
        x += im.width + pad
    mask = images["icons/icon-maskable-512.png"].convert("RGBA")
    ring = np.array(mask)
    yy, xx = np.mgrid[0:512, 0:512]
    d = np.sqrt((xx + 0.5 - 256) ** 2 + (yy + 0.5 - 256) ** 2)
    ring[(d > 256 * SAFE_ZONE) & (d < 256 * SAFE_ZONE + 2)] = (0, 255, 160, 255)
    sheet.paste(Image.fromarray(ring).convert("RGB"), (x - mask.width - pad, pad + 512 + pad))
    sheet.paste(images["share.png"], (pad, height))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, optimize=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=PUBLIC, help="folder to write into (default: public/)")
    ap.add_argument("--sheet", type=Path, help="also write a contact sheet PNG here")
    args = ap.parse_args()
    images = build(args.out)
    for rel, im in images.items():
        print(f"{args.out / rel}  {im.width}x{im.height}")
    print(f"{args.out / 'favicon.ico'}  16x16 + 32x32")
    if args.sheet:
        contact_sheet(images, args.sheet)
        print(f"{args.sheet}  contact sheet")


if __name__ == "__main__":
    main()
