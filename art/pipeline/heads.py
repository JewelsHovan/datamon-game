"""Find the head (face, hair, beard) in every packed frame of a fighter (alternate palette, spec 006).

The alternate palette must never touch a head, but a fighter's hair can share exact colors with
their clothes (Pentcho's hair and beard use the browns of his jacket), so a color map alone cannot
protect it. The head is found by shape instead: a reference head (a polygon on one frame, drawn
once per fighter in art/fighters/SLUG/alt.json) is searched in every frame over all rotations and
positions, comparing colors and the silhouette (sum of squared differences, computed with FFTs).
It finds the head upright, bent, lying and upside down. The derived hurt boxes cannot stand in:
their first box is the top band of the frame, which is the feet or the whole body when lying.

The placed reference head, clipped to the frame's opaque pixels, is then grown by GROW pixels near
the silhouette (never toward the placed reference body, so the collar stays out of it) to cover
hair that pokes out further than in the reference; palette_alt.py grows it further through the
head's own colors. Per-frame overrides in alt.json: {"clip:i": {"angle": a, "dy": y, "dx": x}}
pins a placement, {"clip:i": {"polygons": [[[x, y], ...], ...]}} replaces the mask (frames where
the head hides behind a guard or an arm). Every frame's mask is reviewed by eye.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, signal

ANGLES = tuple(range(-180, 180, 10))
PAD = 4  # context around the reference head that takes part in the match (silhouette, collar)
GROW = 2  # pixels the placed head grows outward to cover hair that pokes out further
ALPHA_WEIGHT = 0.6  # weight of "is opaque" next to the RGB channels in the match


@dataclass
class Frame:
    clip: str
    index: int
    x: int
    y: int
    w: int
    h: int

    @property
    def key(self) -> str:
        return f"{self.clip}:{self.index}"


@dataclass
class Placement:
    angle: int
    dy: int  # top-left of the rotated template in frame coordinates
    dx: int
    score: float  # mean squared difference over the template support (0 = identical)


def frames_of(manifest: dict) -> list[Frame]:
    return [Frame(cid, i, f["x"], f["y"], f["w"], f["h"]) for cid, clip in manifest["clips"].items()
            for i, f in enumerate(clip["frames"])]


def features(rgba: np.ndarray) -> np.ndarray:
    a = (rgba[..., 3] > 0).astype(np.float64)
    rgb = rgba[..., :3].astype(np.float64) / 255.0 * a[..., None]
    return np.concatenate([rgb, a[..., None] * ALPHA_WEIGHT], axis=2)


def polygon_mask(shape: tuple[int, int], polygon: list[list[int]]) -> np.ndarray:
    m = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in polygon], fill=255, outline=255)
    return np.array(m) > 0


def _rotate(a: np.ndarray, angle: int) -> np.ndarray:
    return ndimage.rotate(a, angle, reshape=True, order=0, mode="constant", cval=0)


class HeadFinder:
    def __init__(self, ref: np.ndarray, polygon: list[list[int]]):
        opaque = ref[..., 3] > 0
        head = polygon_mask(opaque.shape, polygon) & opaque
        if not head.any():
            raise ValueError("the reference head polygon covers no opaque pixel")
        ys, xs = np.nonzero(head)
        y0, x0 = max(0, ys.min() - PAD), max(0, xs.min() - PAD)
        y1, x1 = min(opaque.shape[0], ys.max() + PAD + 1), min(opaque.shape[1], xs.max() + PAD + 1)
        support = ndimage.binary_dilation(head, iterations=PAD)[y0:y1, x0:x1]
        feats = features(ref)[y0:y1, x0:x1] * support[..., None]
        head_c = head[y0:y1, x0:x1]
        body_c = (opaque & ~head)[y0:y1, x0:x1] & support
        self.rotations = []
        for angle in ANGLES:
            t = np.stack([_rotate(feats[..., k], angle) for k in range(feats.shape[2])], axis=2)
            s = _rotate(support.astype(np.uint8), angle) > 0
            hm = _rotate(head_c.astype(np.uint8), angle) > 0
            bm = _rotate(body_c.astype(np.uint8), angle) > 0
            t = t * s[..., None]
            self.rotations.append((angle, t, s.astype(np.float64), hm, bm, float((t ** 2).sum()), float(s.sum())))

    def _rotation(self, angle: int):
        for r in self.rotations:
            if r[0] == angle:
                return r
        raise ValueError(f"angle {angle} is not one of {ANGLES}")

    def locate(self, frame: np.ndarray) -> Placement:
        f = features(frame)
        best: Placement | None = None
        for angle, t, s, _hm, _bm, t2, n in self.rotations:
            th, tw = s.shape
            p = np.pad(f, ((th, th), (tw, tw), (0, 0)))
            f2 = signal.fftconvolve((p ** 2).sum(axis=2), s[::-1, ::-1], mode="valid")
            cross = sum(signal.fftconvolve(p[..., k], t[::-1, ::-1, k], mode="valid") for k in range(p.shape[2]))
            ssd = (t2 - 2 * cross + f2) / n
            iy, ix = np.unravel_index(int(np.argmin(ssd)), ssd.shape)
            score = float(ssd[iy, ix])
            if best is None or score < best.score:
                best = Placement(angle, int(iy) - th, int(ix) - tw, score)
        assert best is not None
        return best

    def mask(self, frame: np.ndarray, placement: Placement) -> np.ndarray:
        """The placed reference head on this frame's opaque pixels, grown outward by GROW."""
        _angle, _t, _s, hm, bm, _t2, _n = self._rotation(placement.angle)
        opaque = frame[..., 3] > 0
        head = _place(hm, opaque.shape, placement.dy, placement.dx)
        body = _place(bm, opaque.shape, placement.dy, placement.dx)
        head &= opaque
        if GROW and head.any():
            # Hair that pokes out further than in the reference does so at the silhouette, so growth
            # stays near transparent pixels: it never spreads over a sleeve or collar under the chin.
            grown = ndimage.binary_dilation(head, iterations=GROW)
            near_edge = ndimage.binary_dilation(~opaque, iterations=GROW, border_value=1)
            head |= grown & opaque & near_edge & ~ndimage.binary_dilation(body, iterations=1)
        return head


def _place(m: np.ndarray, shape: tuple[int, int], dy: int, dx: int) -> np.ndarray:
    out = np.zeros(shape, bool)
    y0, x0 = max(0, dy), max(0, dx)
    y1, x1 = min(shape[0], dy + m.shape[0]), min(shape[1], dx + m.shape[1])
    if y1 > y0 and x1 > x0:
        out[y0:y1, x0:x1] = m[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    return out


def head_masks(atlas: np.ndarray, manifest: dict, cfg: dict) -> tuple[np.ndarray, dict[str, Placement | str]]:
    """An atlas-sized mask of every frame's head, and how each frame's head was placed."""
    frames = frames_of(manifest)
    by_key = {fr.key: fr for fr in frames}
    ref_frame = by_key[cfg["frame"]]
    crop = lambda fr: atlas[fr.y:fr.y + fr.h, fr.x:fr.x + fr.w]  # noqa: E731
    finder = HeadFinder(crop(ref_frame), cfg["polygon"])
    overrides = cfg.get("overrides", {})
    out = np.zeros(atlas.shape[:2], bool)
    placements: dict[str, Placement | str] = {}
    for fr in frames:
        img = crop(fr)
        ov = overrides.get(fr.key, {})
        if "polygons" in ov:
            m = np.zeros(img.shape[:2], bool)
            for poly in ov["polygons"]:
                m |= polygon_mask(img.shape[:2], poly)
            m &= img[..., 3] > 0
            placements[fr.key] = "polygons"
        else:
            if "angle" in ov:
                finder._rotation(ov["angle"])  # validates the angle
                pl = Placement(ov["angle"], ov["dy"], ov["dx"], float("nan"))
            else:
                pl = finder.locate(img)
            m = finder.mask(img, pl)
            placements[fr.key] = pl
        out[fr.y:fr.y + fr.h, fr.x:fr.x + fr.w] |= m
    return out, placements


def load_config(path) -> dict:
    return json.loads(path.read_text())
