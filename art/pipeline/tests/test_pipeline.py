"""Spec 002 pipeline tests.

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
import pack  # noqa: E402
import process  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "spike-punch-strip-50.png"
JULIEN = common.FIGHTERS / "julien-hovan"
MANIFEST = common.PUBLIC_FIGHTERS / "julien-hovan" / "manifest.json"

# The "Core animation set" table in docs/game-design.md
CORE = {"idle": 4, "walk": 6, "walk_back": 6, "dash_forward": 5, "dash_back": 5, "crouch": 3, "jump": 6,
        "light_punch": 6, "heavy_punch": 8, "light_kick": 6, "heavy_kick": 9, "crouch_attack": 6, "air_attack": 5,
        "throw": 7, "block": 2, "block_push": 3, "hurt": 4, "crouch_hurt": 3, "air_hurt": 4, "knockdown": 8,
        "getup_roll": 6, "intro": 6, "taunt": 6, "victory": 6, "summon": 4, "special": 8}  # clip set v2 (spec 012)


# A1 -------------------------------------------------------------------------------------------
def test_clip_definitions_match_design_doc():
    clips = common.load_clips()["clips"]
    assert {k: len(v["poses"]) for k, v in clips.items()} == CORE
    for cid, c in clips.items():
        assert len(c["holds"]) == len(c["poses"]), cid
        assert c["anchor"] in ("backfoot", "torso"), cid
        assert all(isinstance(h, int) and h > 0 for h in c["holds"]), cid
        assert len(c["poses"]) + 1 <= 11, f"{cid}: more than 11 figures per strip"


# A3 -------------------------------------------------------------------------------------------
SPIKE_CLIP = {"poses": ["p"] * 5, "holds": [3] * 5, "anchor": "backfoot", "loop": False}


def test_cut_finds_six_figures_left_to_right():
    figs = process.cut_figures(Image.open(FIXTURE))
    assert len(figs) == 6
    xs = [f.x0 for f in figs]
    assert xs == sorted(xs)


def test_frames_anchor_on_bottom_row_and_stance_scale():
    frames, calib, k = process.process_strip(Image.open(FIXTURE), SPIKE_CLIP, None)
    assert len(frames) == 5
    for f in frames:
        alpha = np.array(f["image"])[..., 3]
        assert alpha[f["ay"]].any(), "anchor row must contain opaque pixels"
        assert f["ay"] == f["image"].height - 1
        assert 0 <= f["ax"] < f["image"].width
    assert abs(round(calib.h * k) - common.STANCE_PX) <= 1


def test_frame_count_mismatch_names_both_counts():
    clip = dict(SPIKE_CLIP, poses=["p"] * 3, holds=[3] * 3)
    with pytest.raises(process.FrameCountError) as e:
        process.process_strip(Image.open(FIXTURE), clip, None)
    assert "expected 4" in str(e.value) and "found 6" in str(e.value)


def test_palette_lock_limits_colors():
    frames, _, _ = process.process_strip(Image.open(FIXTURE), SPIKE_CLIP, None)
    pal = process.build_palette([f["image"] for f in frames], colors=16)
    out = process.apply_palette(frames[0]["image"], pal)
    a = np.array(out)
    used = {"#%02x%02x%02x" % tuple(p[:3]) for p in a[a[..., 3] > 0]}
    assert used <= set(pal) and len(pal) <= 16


def test_shelf_pack_no_overlap():
    sizes = [(90, 140), (120, 100), (60, 150), (200, 80), (90, 140)] * 6
    pos, height = pack.shelf_pack(sizes)
    rects = [(x, y, x + w, y + h) for (x, y), (w, h) in zip(pos, sizes)]
    for i, a in enumerate(rects):
        assert a[2] <= pack.ATLAS_W and a[3] <= height
        for b in rects[i + 1:]:
            assert a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1]


# A4 (runs once Julien's clips exist) ----------------------------------------------------------
@pytest.mark.skipif(not (JULIEN / "palette.json").exists(), reason="Julien's clips not processed yet")
def test_julien_frames_use_palette_and_idle_height():
    pal = set(json.loads((JULIEN / "palette.json").read_text()))
    assert len(pal) <= common.PALETTE_SIZE
    for fj in JULIEN.glob("*/frames.json"):
        meta = json.loads(fj.read_text())
        for fm in meta["frames"]:
            a = np.array(Image.open(fj.parent / fm["file"]).convert("RGBA"))
            used = {"#%02x%02x%02x" % tuple(p[:3]) for p in a[a[..., 3] > 0]}
            assert used <= pal, f"{fj.parent.name}/{fm['file']} uses colors outside the palette"
    idle = json.loads((JULIEN / "idle" / "frames.json").read_text())
    for fm in idle["frames"]:
        assert abs(fm["h"] - common.STANCE_PX) <= 3, f"idle frame {fm['file']} is {fm['h']}px"


# A5 (runs once the atlas is packed) -----------------------------------------------------------
def validate_manifest(m: dict, atlas: Image.Image, anchor_inside: bool = True) -> None:
    assert set(m) >= {"fighter", "version", "scale", "facing", "clips"}
    assert m["facing"] == "right" and isinstance(m["version"], int)
    assert atlas.width <= 2048 and atlas.height <= 2048
    for cid, c in m["clips"].items():
        assert isinstance(c["loop"], bool) and c["frames"], cid
        for f in c["frames"]:
            assert set(f) == {"x", "y", "w", "h", "ax", "ay", "hold"}, cid
            assert f["x"] >= 0 and f["y"] >= 0 and f["x"] + f["w"] <= atlas.width and f["y"] + f["h"] <= atlas.height, cid
            assert f["hold"] > 0, cid
            if anchor_inside:
                assert 0 <= f["ay"] < f["h"], cid


@pytest.mark.skipif(not MANIFEST.exists(), reason="Julien's atlas not packed yet")
def test_julien_manifest_valid():
    m = json.loads(MANIFEST.read_text())
    validate_manifest(m, Image.open(MANIFEST.parent / "atlas.png"))
    status = common.load_status("julien-hovan")
    if all(status.get(c, {}).get("state") == "approved" for c in CORE):
        assert set(m["clips"]) == set(CORE)


# Spec 003 A2: boxes derived from the art --------------------------------------------------------
BOXES = common.ROOT / "src" / "data" / "boxes" / "julien-hovan.json"


@pytest.mark.skipif(not BOXES.exists(), reason="boxes.json not generated yet")
def test_julien_boxes():
    b = json.loads(BOXES.read_text())
    m = json.loads(MANIFEST.read_text())
    assert set(b["clips"]) == set(m["clips"])
    for cid, rows in b["clips"].items():
        assert len(rows) == len(m["clips"][cid]["frames"]), cid
        for i, r in enumerate(rows):
            assert r["hurt"], f"{cid}[{i}] has no hurtbox"
    for cid, i in [("light_punch", 3), ("heavy_punch", 5), ("light_kick", 2), ("heavy_kick", 5), ("crouch_attack", 3), ("air_attack", 2)]:  # v2 impact frames
        reach = b["clips"][cid][i]["reach"]
        assert reach and reach[0] + reach[2] > 30, f"{cid}[{i}] needs a hitbox reaching well in front of the anchor"
        assert reach[3] < 60, f"{cid}[{i}] hitbox is {reach[3]}px tall: it should cover the limb, not the body"
    assert all(r["reach"] is None for r in b["clips"]["idle"])


# Spec 004 A1: effect atlas --------------------------------------------------------------------
FX_MANIFEST = common.ROOT / "public" / "effects" / "manifest.json"


@pytest.mark.skipif(not FX_MANIFEST.exists(), reason="effects not packed yet")
def test_effects_manifest():
    m = json.loads(FX_MANIFEST.read_text())
    validate_manifest(m, Image.open(FX_MANIFEST.parent / "atlas.png"), anchor_inside=False)  # centered effects may anchor outside a small frame
    defs = json.loads((common.ART / "effects.json").read_text())["effects"]
    assert set(m["clips"]) == set(defs)
    for eid, c in m["clips"].items():
        tallest = max(f["h"] for f in c["frames"])
        assert abs(tallest - defs[eid]["target"]) <= 2, f"{eid}: tallest frame {tallest}px, target {defs[eid]['target']}"
        assert len(c["frames"]) == len(defs[eid]["frames"]), eid


# Spec 012 A1: wide strips and per-fighter specials ---------------------------------------------
def test_generator_sizes_and_specials():
    import generate
    clips = common.load_clips()
    assert generate.size_for(len(common.clip_def("julien-hovan", "heavy_kick", clips)["poses"]) + 1) == "3840x1280"
    assert generate.size_for(5) == "3072x1024" and generate.size_for(4) == "2048x1024"
    prompt = generate.build_prompt("heavy_kick", clips, has_idle_ref=True, slug="julien-hovan")
    assert "10 full-body figures" in prompt and "(10)" in prompt
    for slug in ("felicia-gorgacheva", "pentcho-tchomakov", "alex-andrianavalontsalama"):
        own = common.clip_def(slug, "special", clips)
        assert own != clips["clips"]["special"], slug
        assert own["poses"][0] in generate.build_prompt("special", clips, has_idle_ref=False, slug=slug)
