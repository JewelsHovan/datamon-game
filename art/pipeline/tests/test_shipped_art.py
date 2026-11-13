"""Spec 013 A1: shipped art is lossless WebP named by the manifests, and every visible pixel equals
the PNG master under art/. Also the walker strip (R2): the cast comes from the stage's rule.

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
import common  # noqa: E402
import stage  # noqa: E402

PUBLIC = common.ROOT / "public"
FIGHTERS = sorted(p.parent.name for p in common.PUBLIC_FIGHTERS.glob("*/manifest.json"))
STAGE = common.PUBLIC_STAGES / "office"


def manifest(path: Path) -> dict:
    return json.loads(path.read_text())


def assert_shipped(shipped: Path, master: Path) -> None:
    assert shipped.suffix == ".webp" and shipped.exists(), shipped
    assert master.suffix == ".png" and master.exists(), master
    im = Image.open(shipped)
    assert im.format == "WEBP", shipped
    assert common.visible_mismatch(im, Image.open(master)) == 0, f"{shipped.name} differs from {master}"


def test_save_webp_keeps_visible_pixels_and_alpha(tmp_path):
    rng = np.random.default_rng(13)
    a = rng.integers(0, 256, (40, 60, 4), dtype=np.uint8)
    a[..., 3] = np.where(rng.random((40, 60)) < 0.4, 0, 255)  # hard alpha with junk color under alpha 0
    a[:5, :5, 3] = 128
    master = Image.fromarray(a, "RGBA")
    common.save_webp(master, tmp_path / "x.webp")
    shipped = Image.open(tmp_path / "x.webp")
    assert shipped.format == "WEBP"
    assert common.visible_mismatch(shipped, master) == 0


def test_visible_mismatch_sees_a_changed_pixel():
    a = np.zeros((4, 4, 4), np.uint8)
    a[1, 1] = (10, 20, 30, 255)
    b = a.copy()
    b[1, 1, 0] = 11
    assert common.visible_mismatch(Image.fromarray(b), Image.fromarray(a)) == 1
    b = a.copy()
    b[2, 2] = (99, 99, 99, 0)  # color under alpha 0 does not count
    assert common.visible_mismatch(Image.fromarray(b), Image.fromarray(a)) == 0


@pytest.mark.parametrize("slug", FIGHTERS)
def test_fighter_atlas_is_webp_and_matches_its_master(slug):
    m = manifest(common.PUBLIC_FIGHTERS / slug / "manifest.json")
    assert m["atlas"] == common.ATLAS_FILE
    assert_shipped(common.PUBLIC_FIGHTERS / slug / m["atlas"], common.FIGHTERS / slug / common.MASTER_ATLAS)


def test_effects_atlas_is_webp_and_matches_its_master():
    m = manifest(common.PUBLIC_EFFECTS / "manifest.json")
    assert m["atlas"] == common.ATLAS_FILE
    assert_shipped(common.PUBLIC_EFFECTS / m["atlas"], common.EFFECTS / common.MASTER_ATLAS)


def test_stage_layers_and_walkers_are_webp_and_match_their_masters():
    m = manifest(STAGE / "manifest.json")
    assert isinstance(m["version"], int) and m["version"] >= 1
    assert [layer["file"] for layer in m["layers"]] == ["far.webp", "mid.webp"]
    for layer in m["layers"]:
        assert_shipped(STAGE / layer["file"], stage.master_path("office", layer["id"]))
    assert m["walkers"]["file"] == "walkers.webp"
    assert_shipped(STAGE / m["walkers"]["file"], stage.master_path("office", "walkers"))


def test_no_png_art_ships():
    shipped = [p for d in ("fighters", "effects", "stages") for p in (PUBLIC / d).rglob("*.png")]
    assert shipped == []


# R2: the walker strip ------------------------------------------------------------------------------
def test_walker_cast_follows_the_stage_rule():
    rule = stage.load()["stages"]["office"]["walkers"]
    people = list(common.people())
    pool = [s for s in people if s not in set(rule["exclude"])]
    expected = pool[:: rule["every"]][: rule["count"]]
    cast = [c["slug"] for c in manifest(STAGE / "manifest.json")["walkers"]["cast"]]
    assert cast == expected and len(cast) == 7
    assert not set(cast) & set(FIGHTERS), "launch fighters never walk in the background"


def test_walker_frames_are_four_right_facing_frames_at_walker_scale():
    w = manifest(STAGE / "manifest.json")["walkers"]
    strip = np.array(Image.open(STAGE / w["file"]).convert("RGBA"))
    assert strip.shape[:2] == (w["h"], w["w"])
    assert w["stand"] == common.STAND_COL
    k = w["scale"]
    assert abs(k - 0.6 * 150 / 228) < 1e-3  # 60% of a 150 px standing person
    people = common.people()
    for c in w["cast"]:
        assert len(c["frames"]) == 4, c["slug"]
        for f in c["frames"]:
            assert f["x"] + f["w"] <= w["w"] and f["y"] + f["h"] <= w["h"], c["slug"]
            cell = strip[f["y"]:f["y"] + f["h"], f["x"]:f["x"] + f["w"]]
            assert cell[..., 3].any(), c["slug"]
            assert set(np.unique(cell[..., 3])) <= {0, 255}, "hard alpha"
            # The figure stands on its anchor row and is a walker's height (about 90 px for a 228 px sheet foot).
            assert abs(f["ay"] - (f["h"] - 1)) <= 2, c["slug"]
            assert abs(f["h"] - people[c["slug"]]["frames"]["right"][0][2] * k) <= 6, c["slug"]
            assert 0 <= f["ax"] < f["w"], c["slug"]
