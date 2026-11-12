"""Spec 009 A1: the office stage layers, their sizes and the palette limit.

Run:  uv run --with pytest --with pillow --with numpy --with scipy pytest art/pipeline/tests -q
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import stage  # noqa: E402

OFFICE = stage.PUBLIC / "office"
MANIFEST = OFFICE / "manifest.json"
DEFS = stage.load()["stages"]["office"]["layers"]


def manifest() -> dict:
    return json.loads(MANIFEST.read_text())


def test_manifest_lists_the_far_and_mid_layers():
    m = manifest()
    assert m["stage"] == "office"
    assert [layer["id"] for layer in m["layers"]] == ["far", "mid"]
    assert m["floorColor"].startswith("#") and len(m["floorColor"]) == 7


@pytest.mark.parametrize("lid", ["far", "mid"])
def test_layer_size_matches_its_parallax_factor(lid):
    layer = next(x for x in manifest()["layers"] if x["id"] == lid)
    expected_w = round(stage.VIEW_W + (stage.STAGE_W - stage.VIEW_W) * DEFS[lid]["factor"])
    assert layer["factor"] == DEFS[lid]["factor"]
    assert (layer["w"], layer["h"]) == (expected_w, 360)
    img = Image.open(OFFICE / layer["file"])
    assert img.size == (expected_w, 360)


@pytest.mark.parametrize("lid", ["far", "mid"])
def test_layer_palette_limit(lid):
    img = np.array(Image.open(OFFICE / f"{lid}.png").convert("RGBA"))
    opaque = img[img[..., 3] > 0][:, :3]
    colors = {tuple(c) for c in opaque.reshape(-1, 3)}
    assert len(colors) <= DEFS[lid]["colors"]


def test_far_is_opaque_and_mid_is_cut_out():
    far = np.array(Image.open(OFFICE / "far.png").convert("RGBA"))
    mid = np.array(Image.open(OFFICE / "mid.png").convert("RGBA"))
    assert (far[..., 3] == 255).all()
    transparent = (mid[..., 3] == 0).mean()
    assert 0.2 < transparent < 0.95  # furniture over a see-through background
