"""Spec 014 A1: the app icons, favicons and share image exist at the right sizes,
have hard pixel edges, and are exactly what art/pipeline/app_icons.py makes.

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
import app_icons  # noqa: E402

PUBLIC = app_icons.PUBLIC
SIZES = {
    "icons/favicon-16.png": (16, 16),
    "icons/favicon-32.png": (32, 32),
    "icons/apple-touch-icon.png": (180, 180),
    "icons/icon-192.png": (192, 192),
    "icons/icon-512.png": (512, 512),
    "icons/icon-maskable-512.png": (512, 512),
    "share.png": (1200, 630),
}
# Shown on platforms that fill or mask the shape themselves: no transparent pixel at all.
OPAQUE = ["icons/apple-touch-icon.png", "icons/icon-maskable-512.png", "share.png"]


def rgba(rel: str) -> np.ndarray:
    return np.array(Image.open(PUBLIC / rel).convert("RGBA"))


def test_every_output_is_listed():
    assert set(SIZES) == set(app_icons.OUTPUTS)


@pytest.mark.parametrize("rel", sorted(SIZES))
def test_size(rel):
    with Image.open(PUBLIC / rel) as im:
        assert im.format == "PNG"
        assert im.size == SIZES[rel]


@pytest.mark.parametrize("rel", sorted(SIZES))
def test_alpha_is_hard(rel):
    alpha = rgba(rel)[..., 3]
    assert set(np.unique(alpha).tolist()) <= {0, 255}


@pytest.mark.parametrize("rel", OPAQUE)
def test_full_bleed_images_are_opaque(rel):
    assert (rgba(rel)[..., 3] == 255).all()


@pytest.mark.parametrize("rel", sorted(SIZES))
def test_crisp_whole_number_enlargement(rel):
    """Each image is its logical design enlarged k times: every k x k block is one color."""
    k = app_icons.OUTPUTS[rel][1]
    px = rgba(rel)
    h, w = px.shape[:2]
    blocks = px.reshape(h // k, k, w // k, k, 4)
    assert (blocks == blocks[:, :1, :, :1, :]).all()


def test_maskable_figure_head_inside_the_safe_zone():
    """The fighter's head and fists (everything above the icon's middle) sit inside the 80% circle."""
    px = rgba("icons/icon-maskable-512.png")[..., :3].astype(int)
    logical = px[::4, ::4]
    size = logical.shape[0]
    # The figure = every pixel that differs from the icon's bare background.
    bare = app_icons.icon_background(size)
    yy, xx = np.mgrid[0:size, 0:size]
    figure = (logical != bare[..., :3].astype(int)).any(axis=2)
    assert figure.sum() > 1000
    top = figure & (yy < size // 2)
    r = size / 2 * app_icons.SAFE_ZONE
    d2 = (xx + 0.5 - size / 2) ** 2 + (yy + 0.5 - size / 2) ** 2
    assert top.any() and (d2[top] <= r * r).all()


def test_favicon_ico_holds_the_crisp_16_and_32():
    with Image.open(PUBLIC / "favicon.ico") as ico:
        assert set(ico.info["sizes"]) >= {(16, 16), (32, 32)}
        for n in (16, 32):
            ico.size = (n, n)
            ico.load()
            got = np.array(ico.convert("RGBA"))
            assert (got == rgba(f"icons/favicon-{n}.png")).all(), n


def test_outputs_match_the_script(tmp_path):
    """No hand edits: regenerating from the fighters' art gives the same pixels."""
    images = app_icons.build(tmp_path)
    for rel in SIZES:
        assert (np.array(images[rel].convert("RGBA")) == rgba(rel)).all(), rel


def test_atlas_name_comes_from_the_manifest(tmp_path, monkeypatch):
    folder = tmp_path / "someone"
    folder.mkdir()
    (folder / "atlas.webp").write_bytes(b"")
    monkeypatch.setattr(app_icons, "FIGHTERS", tmp_path)
    assert app_icons.atlas_path("someone", {"atlas": "atlas.webp"}) == folder / "atlas.webp"
    assert app_icons.atlas_path("someone", {}) == folder / "atlas.webp"  # only the WebP exists
    (folder / "atlas.png").write_bytes(b"")
    assert app_icons.atlas_path("someone", {}) == folder / "atlas.png"


def test_share_image_shows_the_four_launch_fighters():
    assert len(app_icons.LAUNCH) == 4
    for slug in app_icons.LAUNCH:
        manifest = json.loads((app_icons.FIGHTERS / slug / "manifest.json").read_text())
        assert "idle" in manifest["clips"]
