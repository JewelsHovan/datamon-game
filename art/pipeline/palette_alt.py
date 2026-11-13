"""Build P2's alternate atlas for mirror matches (spec 003 R8, spec 006; QA 2026-11-12 F1).

Usage:  uv run --with pillow --with numpy --with scipy python -I art/pipeline/palette_alt.py SLUG [SLUG ...]
        ... palette_alt.py --sheet OUT.png SLUG [SLUG ...]   (review sheet: normal | alt, 2x)
        ... palette_alt.py --suggest SLUG                    (a starting garment map, printed)

The alternate look recolors one or two garments and never touches a face, hair, beard or skin.
A plain color map cannot promise that: a fighter's hair may share exact colors with their clothes
(Pentcho's hair and beard use the browns of his jacket), and a garment may share colors with the
shoes or the other garment. So the recolor is done here, offline, per pixel:

1. Head mask (heads.py): every frame's head is found by shape, then grown HAIR_GROW pixels through
   the colors of the hand-drawn reference head (hair at the back of the head that reaches past the
   placed shape). alt.json can replace a frame's head ("polygons") or cut a sleeve that passes
   right under the chin out of it ("exclude"). Nothing inside the head changes, with one
   exception: a garment marked "headFree" has colors no head has (checked against the reference
   head; its "inHead" colors, such as an eye that shares a sweater green, are excluded), so its
   pixels inside a generous head mask (a sleeve next to the face) are recolored.
2. Garments (alt.json "garments"): each has a color map {"#from": "#to"} and a list of "shared"
   colors, the map's colors that also appear outside that garment (the shoes, the belt, a collar).
   A pixel of an unshared color (an anchor) is recolored with its garment's map. A pixel of a
   shared color takes the side most of its decided neighbors (within RADIUS) are on, a garment or
   anything else, pass after pass; ties stay as they are. Colors in "skin" can never be in a map.
3. Writes art/fighters/SLUG/atlas-alt.png (review master) and head-mask.png (the protected heads,
   what the tests check), public/fighters/SLUG/atlas-alt.webp (lossless, what the game draws for P2
   in a mirror match), and names it in the manifest as "atlasAlt" (new pixels bump the manifest
   version, the art's cache key). Re-run after pack.py (a repack drops "atlasAlt").

Review every frame after a change (--sheet, plus the head masks in head-mask.png).
"""

from __future__ import annotations

import argparse
import colorsys
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import heads  # noqa: E402

ALT_ATLAS = "atlas-alt.webp"
ALT_MASTER = "atlas-alt.png"
HEAD_MASK = "head-mask.png"
CONFIG = "alt.json"
RADIUS = 4  # neighborhood that decides a shared color's side
HAIR_GROW = 2  # the head grows this far through its own colors (hair past the placed head)
NEUTRAL_V = 0.13  # unmapped colors darker than this (outlines) take no side

# --suggest only: the old automatic map (hue rotation of the dominant top-garment hue)
TARGETS = (0.0, 215.0, 45.0)  # red, blue, gold


def key_of(hexcolor: str) -> int:
    return int(hexcolor[1:], 16)


def hex_of(key: int) -> str:
    return "#%06x" % key


def keys(rgba: np.ndarray) -> np.ndarray:
    return (rgba[..., 0].astype(np.int32) << 16) | (rgba[..., 1].astype(np.int32) << 8) | rgba[..., 2].astype(np.int32)


def value(hexcolor: str) -> float:
    return max(int(hexcolor[i:i + 2], 16) for i in (1, 3, 5)) / 255


def load(slug: str) -> tuple[np.ndarray, dict, dict]:
    atlas = np.array(Image.open(common.fighter_dir(slug) / common.MASTER_ATLAS).convert("RGBA"))
    manifest = json.loads((common.PUBLIC_FIGHTERS / slug / "manifest.json").read_text())
    cfg = json.loads((common.fighter_dir(slug) / CONFIG).read_text())
    return atlas, manifest, cfg


def garment_sets(cfg: dict) -> list[dict]:
    """Per garment: its map as int keys (identity entries dropped), and its anchor colors."""
    skin = {key_of(c) for c in cfg.get("skin", [])}
    out = []
    for g in cfg["garments"]:
        m = {key_of(a): key_of(b) for a, b in g["map"].items() if a.lower() != b.lower()}
        bad = skin & set(m)
        if bad:
            raise SystemExit(f"garment {g['name']!r} maps skin colors {sorted(hex_of(k) for k in bad)}")
        out.append({"name": g["name"], "map": m, "shared": {key_of(c) for c in g.get("shared", [])},
                    "headFree": bool(g.get("headFree", False)), "inHead": {key_of(c) for c in g.get("inHead", [])}})
    for i, g in enumerate(out):
        elsewhere = set().union(*(o["map"].keys() for j, o in enumerate(out) if j != i)) if len(out) > 1 else set()
        # inHead colors (an eye that shares a sweater green) follow their neighbors outside the heads too
        g["anchors"] = set(g["map"]) - g["shared"] - g["inHead"] - elsewhere
    return out


def head_free_colors(garments: list[dict]) -> set[int]:
    """Anchors of garments marked headFree, minus their "inHead" colors: colors no head has (checked
    against the reference head), so a pixel of one inside a generous head mask is a sleeve or a
    collar, and is recolored. Every other color inside a head mask stays as it is."""
    out: set[int] = set()
    for g in garments:
        if g["headFree"]:
            out |= g["anchors"] - g["inHead"]
    return out


def reference_head_colors(atlas: np.ndarray, manifest: dict, cfg: dict) -> set[int]:
    """Every color inside the hand-drawn reference head."""
    ref = {fr.key: fr for fr in heads.frames_of(manifest)}[cfg["head"]["frame"]]
    img = atlas[ref.y:ref.y + ref.h, ref.x:ref.x + ref.w]
    inside = heads.polygon_mask(img.shape[:2], cfg["head"]["polygon"]) & (img[..., 3] > 0)
    return set(np.unique(keys(img)[inside]).tolist())


def check_head_free(atlas: np.ndarray, manifest: dict, cfg: dict, garments: list[dict]) -> None:
    """A headFree garment's colors must not occur in the hand-drawn reference head unless listed in inHead."""
    found = reference_head_colors(atlas, manifest, cfg) & head_free_colors(garments)
    if found:
        raise SystemExit(f"colors of a headFree garment in the reference head: {sorted(hex_of(c) for c in found)}; list them in inHead")


def _disc(r: int) -> np.ndarray:
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y <= r * r).astype(np.float64)


def recolor_frame(img: np.ndarray, head: np.ndarray, garments: list[dict], neutral: set[int]) -> tuple[np.ndarray, np.ndarray]:
    """The frame recolored, and a label per pixel: -1 untouched, k recolored with garment k."""
    k = keys(img)
    opaque = img[..., 3] > 0
    protected = head & ~np.isin(k, list(head_free_colors(garments)))
    free = opaque & ~protected
    family = np.zeros(k.shape, bool)
    for g in garments:
        family |= np.isin(k, list(g["map"]))
    cand = [free & np.isin(k, list(g["map"])) for g in garments]
    UNDECIDED, OTHER, NONE = -1, -2, -3
    labels = np.full(k.shape, NONE, np.int16)
    labels[free & ~family & ~np.isin(k, list(neutral))] = OTHER
    labels[free & family] = UNDECIDED
    for gi, g in enumerate(garments):
        labels[free & np.isin(k, list(g["anchors"]))] = gi
    # Shared colors: the side with more decided pixels within RADIUS wins (ties: untouched), pass after
    # pass, so a garment's decision spreads through its own shared shades and stops where the hair,
    # shoes or skin around it outnumber it.
    disc = _disc(RADIUS)
    while True:
        und = labels == UNDECIDED
        if not und.any():
            break
        score = [ndimage.convolve((labels == gi).astype(np.float64), disc, mode="constant") for gi in range(len(garments))]
        other = ndimage.convolve((labels == OTHER).astype(np.float64), disc, mode="constant")
        best = np.zeros(k.shape)
        best_g = np.full(k.shape, UNDECIDED, np.int16)
        for gi in range(len(garments)):
            s = np.where(cand[gi], score[gi], 0.0)
            other += np.where(cand[gi], 0.0, score[gi])  # a garment this color is not in counts as other
            win = s > best
            best[win], best_g[win] = s[win], gi
        decide = und & ((best > 0) | (other > 0))
        if not decide.any():
            break
        to_g = decide & (best > other)
        labels[to_g] = best_g[to_g]
        labels[decide & ~to_g] = OTHER
    labels[labels < 0] = -1
    out = img.copy()
    for gi, g in enumerate(garments):
        sel = labels == gi
        if sel.any():
            src = k[sel]
            dst = np.array([g["map"][int(c)] for c in src], np.int64)
            out[sel, 0] = (dst >> 16) & 255
            out[sel, 1] = (dst >> 8) & 255
            out[sel, 2] = dst & 255
    return out, labels


def build(slug: str) -> tuple[np.ndarray, np.ndarray, dict]:
    """(alt atlas, head mask, per-garment pixel counts) from the master atlas and alt.json."""
    atlas, manifest, cfg = load(slug)
    head, placements = heads.head_masks(atlas, manifest, cfg["head"])
    garments = garment_sets(cfg)
    check_head_free(atlas, manifest, cfg, garments)
    palette = json.loads((common.fighter_dir(slug) / "palette.json").read_text())
    neutral = {key_of(c) for c in palette if value(c) < NEUTRAL_V}
    head_colors = list(reference_head_colors(atlas, manifest, cfg) | neutral)
    alt = atlas.copy()
    counts = {g["name"]: 0 for g in garments}
    for fr in heads.frames_of(manifest):
        sl = (slice(fr.y, fr.y + fr.h), slice(fr.x, fr.x + fr.w))
        img = atlas[sl]
        # Hair that reaches past the placed head (the back of the head over a collar) is caught by
        # growing the head through the head's own colors: pixels next to a head in a head color are head.
        hair_ok = (img[..., 3] > 0) & np.isin(keys(img), head_colors)
        for _ in range(HAIR_GROW):
            head[sl] |= ndimage.binary_dilation(head[sl]) & hair_ok
        # A sleeve right under the chin can end up inside the head: alt.json cuts it out per frame.
        for poly in cfg["head"].get("overrides", {}).get(fr.key, {}).get("exclude", []):
            head[sl] &= ~heads.polygon_mask(img.shape[:2], poly)
        out, labels = recolor_frame(img, head[sl], garments, neutral)
        alt[sl] = out
        for gi, g in enumerate(garments):
            counts[g["name"]] += int((labels == gi).sum())
    return alt, head, {"counts": counts, "placements": placements}


def write(slug: str) -> None:
    alt, head, info = build(slug)
    fdir = common.fighter_dir(slug)
    pub = common.PUBLIC_FIGHTERS / slug
    img = Image.fromarray(alt, "RGBA")
    # The manifest version is the art's cache key (?v=): new alternate pixels need a new version, or
    # a browser could pair the manifest with an alternate atlas cached up to an hour earlier.
    prev = pub / ALT_ATLAS
    changed = not prev.exists() or common.visible_mismatch(Image.open(prev), img) > 0
    common.save_master_and_webp(img, fdir / ALT_MASTER, pub / ALT_ATLAS)
    Image.fromarray(head).save(fdir / HEAD_MASK, optimize=True)  # 1-bit
    mp = pub / "manifest.json"
    m = json.loads(mp.read_text())
    named = m.get("atlasAlt") == ALT_ATLAS
    ordered: dict = {}
    for k_, v in m.items():
        if k_ == "atlasAlt":
            continue
        ordered[k_] = v
        if k_ == "atlas":
            ordered["atlasAlt"] = ALT_ATLAS
    if named and changed:
        ordered["version"] = int(ordered["version"]) + 1
    mp.write_text(json.dumps(ordered, indent=1) + "\n")
    common.write_fighter_index()
    (pub / "palette-alt.json").unlink(missing_ok=True)  # the game no longer recolors at load
    kb = round((pub / ALT_ATLAS).stat().st_size / 1024)
    print(f"{slug}: recolored {info['counts']}, head masks {int(head.sum())} px -> {(pub / ALT_ATLAS).relative_to(common.ROOT)} ({kb} KB)")


# Review sheet --------------------------------------------------------------------------------------
SHEET_CLIPS = ("idle", "walk", "hurt", "knockdown", "air_hurt", "special", "victory")
BG = (52, 44, 92, 255)


def sheet(slugs: list[str], out: Path, clips=SHEET_CLIPS, zoom: int = 2, frames_per_clip: int = 4) -> None:
    """Per fighter and clip: up to frames_per_clip frames, each normal next to alt, on a stage-like
    background, drawn at `zoom`x with nearest-neighbor scaling."""
    rows = []
    for slug in slugs:
        atlas = np.array(Image.open(common.fighter_dir(slug) / common.MASTER_ATLAS).convert("RGBA"))
        alt = np.array(Image.open(common.fighter_dir(slug) / ALT_MASTER).convert("RGBA"))
        m = json.loads((common.PUBLIC_FIGHTERS / slug / "manifest.json").read_text())
        for cid in clips:
            frames = m["clips"][cid]["frames"]
            pick = np.linspace(0, len(frames) - 1, min(frames_per_clip, len(frames))).round().astype(int)
            cells = []
            for i in sorted(set(pick.tolist())):
                f = frames[i]
                sl = (slice(f["y"], f["y"] + f["h"]), slice(f["x"], f["x"] + f["w"]))
                cells.append((f, Image.fromarray(atlas[sl]), Image.fromarray(alt[sl])))
            rows.append((f"{slug.split('-')[0]} {cid}", cells))
    cell_w = max(max(f["w"] for f, _, _ in cells) for _, cells in rows) + 6
    cell_h = max(max(f["h"] for f, _, _ in cells) for _, cells in rows) + 6
    label_w = 120
    ncols = max(len(cells) for _, cells in rows)
    W = label_w + ncols * (2 * cell_w + 10)
    img = Image.new("RGBA", (W, len(rows) * cell_h), BG)
    d = ImageDraw.Draw(img)
    for r, (label, cells) in enumerate(rows):
        d.text((4, r * cell_h + 4), label, fill=(255, 255, 255, 255))
        d.line((0, r * cell_h, W, r * cell_h), fill=(30, 26, 60, 255))
        for c, (f, a, b) in enumerate(cells):
            x0 = label_w + c * (2 * cell_w + 10)
            base = r * cell_h + cell_h - 3  # feet on a shared floor line
            img.alpha_composite(a, (x0 + 3, base - f["h"]))
            img.alpha_composite(b, (x0 + cell_w + 3, base - f["h"]))
    img = img.resize((img.width * zoom, img.height * zoom), Image.NEAREST)
    d = ImageDraw.Draw(img)
    for c in range(ncols):  # column captions at full size
        x0 = (label_w + c * (2 * cell_w + 10)) * zoom
        d.text((x0 + 6, 4), "normal", fill=(255, 255, 255, 255))
        d.text((x0 + cell_w * zoom + 6, 4), "alt (P2)", fill=(255, 220, 120, 255))
    out.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out, optimize=True)
    print(f"sheet {img.width}x{img.height} -> {out}")


# Suggest ---------------------------------------------------------------------------------------------
def suggest(slug: str) -> dict[str, str]:
    """A starting map for a new fighter: colors mostly in the torso band of the idle frames and rarely
    in the head band (skin tones excluded), rotated to whichever of red, blue or gold is farthest
    from their dominant hue; near-black and grey garments are tinted. Review it, split it into
    garments and list the shared colors in alt.json."""
    fdir = common.fighter_dir(slug)
    palette = json.loads((fdir / "palette.json").read_text())

    def hsv(c: str) -> tuple[float, float, float]:
        h, s, v = colorsys.rgb_to_hsv(*(int(c[i:i + 2], 16) / 255 for i in (1, 3, 5)))
        return h * 360, s, v

    def hue_dist(a: float, b: float) -> float:
        d = abs(a - b) % 360
        return min(d, 360 - d)

    torso = {c: 0 for c in palette}
    head = {c: 0 for c in palette}
    for f in sorted((fdir / "idle").glob("*.png")):
        a = np.array(Image.open(f).convert("RGBA"))
        h = a.shape[0]
        for band, store in ((a[int(h * 0.30): int(h * 0.58)], torso), (a[: int(h * 0.24)], head)):
            for p in band[band[..., 3] > 0][:, :3]:
                c = "#%02x%02x%02x" % tuple(p)
                if c in store:
                    store[c] += 1
    total = max(1, sum(torso.values()))

    def skin(c: str) -> bool:
        h, s_, v = hsv(c)
        return 8 <= h <= 45 and 0.18 <= s_ <= 0.7 and v >= 0.5

    garment = [c for c in palette if torso[c] >= 0.005 * total and head[c] <= torso[c] * 0.25 and not skin(c)]
    weights = np.zeros(36)
    for c in garment:
        h, s_, _v = hsv(c)
        if s_ >= 0.15:
            weights[int(h // 10) % 36] += torso[c]
    dominant = float(weights.argmax() * 10 + 5) if weights.any() else -1.0
    target = max(TARGETS, key=lambda t: hue_dist(dominant, t)) if dominant >= 0 else 215.0
    out = {}
    for c in garment:
        h, s_, v = hsv(c)
        if s_ < 0.15:
            r, g, b = colorsys.hsv_to_rgb(target / 360, 0.55, min(1.0, max(v * 1.35, 0.28)))
        else:
            r, g, b = colorsys.hsv_to_rgb(((h + (target - dominant)) % 360) / 360, min(1.0, s_ * 1.6), min(1.0, v * 1.15))
        out[c] = "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slugs", nargs="+")
    ap.add_argument("--sheet", type=Path, help="write a normal | alt review sheet of these fighters instead")
    ap.add_argument("--suggest", action="store_true", help="print a starting garment map for one fighter")
    args = ap.parse_args()
    if args.suggest:
        print(json.dumps(suggest(args.slugs[0]), indent=1))
        return 0
    if args.sheet:
        sheet(args.slugs, args.sheet)
        return 0
    for slug in args.slugs:
        write(slug)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
