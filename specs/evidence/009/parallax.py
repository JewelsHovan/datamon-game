"""Spec 009 A2: measure parallax from the camera screenshots.

Usage:  uv run --with pillow --with numpy python -I specs/evidence/009/parallax.py specs/evidence/009

Reads 02-camera-left.png and 01-camera-center.png (camera x 0 and 320, from stage-check.mjs and
its positions.json) and finds, for two bands of the picture, the horizontal shift that best
aligns them:
  - far: rows 110-140, where the mid layer is about 5% opaque (sky and skyline through the windows);
  - mid: rows 150-178, where the mid layer's shelves, monitors and plants dominate.
Both bands sit below the HUD and above the fighters' heads, so nothing has to be masked.
The floor is drawn in code in camera space with boards every 64 px; a 320 px move is a whole
number of boards, so it cannot be told apart from no move in pixels, and the check takes its
offset from the renderer (positions.json) instead.
Exits 1 unless the measured shifts match the renderer's offsets within 2 px and far < mid < floor.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

out = Path(sys.argv[1] if len(sys.argv) > 1 else "specs/evidence/009")
pos = json.loads((out / "positions.json").read_text())


def gray(name: str) -> np.ndarray:
    img = Image.open(out / name).convert("L")
    w, h = img.size
    # Screenshots are the 640x360 canvas scaled 2x; go back to canvas pixels.
    return np.asarray(img.resize((w // 2, h // 2), Image.NEAREST), dtype=np.float32)


def best_shift(a: np.ndarray, b: np.ndarray, max_shift: int = 400) -> tuple[int, float, float]:
    """Shift s such that a[:, x] best matches b[:, x - s]; also the error there and the runner-up's."""
    errs = {s: float(np.abs(a[:, s:] - b[:, : a.shape[1] - s]).mean()) for s in range(0, max_shift + 1)}
    ranked = sorted(errs.items(), key=lambda kv: kv[1])
    best = ranked[0]
    runner = next(e for s, e in ranked if abs(s - best[0]) > 3)
    return best[0], best[1], runner


left, center = gray("02-camera-left.png"), gray("01-camera-center.png")
expected = [c - l for c, l in zip(pos["center"]["layerOffsets"], pos["left"]["layerOffsets"])]
measured = []
for label, (y0, y1), exp in [("far", (110, 140), expected[0]), ("mid", (150, 178), expected[1])]:
    s, err, runner = best_shift(left[y0:y1], center[y0:y1])
    measured.append(s)
    print(f"{label} (rows {y0}-{y1}): measured shift {s} px (mean error {err:.1f}, next best {runner:.1f}); renderer offset change {exp} px")
print(f"floor: renderer offset change {expected[2]} px (camera speed; not measurable from the 64 px boards)")
ok = all(abs(m - e) <= 2 for m, e in zip(measured, expected)) and measured[0] < measured[1] < expected[2]
print("PARALLAX OK" if ok else "PARALLAX MISMATCH")
sys.exit(0 if ok else 1)
