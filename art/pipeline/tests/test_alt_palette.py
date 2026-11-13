"""QA 2026-11-12 F1: P2's alternate atlas for mirror matches (art/pipeline/palette_alt.py).

The rule: the alternate colors never change a pixel of a face, hair, beard or skin, and the garment
they recolor changes completely (no mottled jacket, no specks on the trousers).

Run:  uv run --with pytest --with pillow --with numpy --with scipy pytest art/pipeline/tests -q
"""

from __future__ import annotations

import json
import sys
from functools import cache
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common  # noqa: E402
import heads  # noqa: E402
import palette_alt  # noqa: E402

FIGHTERS = sorted(p.parent.name for p in common.PUBLIC_FIGHTERS.glob("*/manifest.json"))
BOXES = common.ROOT / "src" / "data" / "boxes"
UPRIGHT = ("idle", "walk", "walk_back")  # clips whose second hurt box is the torso
MIN_HEAD_PX = 150  # a head at 140 px stance height is about 30x35 px


@cache
def art(slug: str) -> dict:
    fdir = common.fighter_dir(slug)
    atlas, manifest, cfg = palette_alt.load(slug)
    alt = np.array(Image.open(fdir / palette_alt.ALT_MASTER).convert("RGBA"))
    mask = np.array(Image.open(fdir / palette_alt.HEAD_MASK)) > 0
    garments = palette_alt.garment_sets(cfg)
    keys = palette_alt.keys(atlas)
    visible = atlas[..., 3] > 0
    changed = visible & (alt[..., :3] != atlas[..., :3]).any(axis=2)
    protected = mask & ~np.isin(keys, list(palette_alt.head_free_colors(garments)))
    family = np.isin(keys, list(set().union(*(g["map"] for g in garments))))
    return {"atlas": atlas, "alt": alt, "mask": mask, "manifest": manifest, "cfg": cfg, "garments": garments,
            "keys": keys, "visible": visible, "changed": changed, "protected": protected, "family": family}


def test_every_fighter_has_an_alternate_atlas():
    assert len(FIGHTERS) == 37
    for slug in FIGHTERS:
        assert (common.fighter_dir(slug) / palette_alt.CONFIG).exists(), slug


@pytest.mark.parametrize("slug", FIGHTERS)
def test_manifest_names_the_alt_atlas_and_the_webp_matches_its_master(slug):
    m = art(slug)["manifest"]
    assert m["atlasAlt"] == palette_alt.ALT_ATLAS
    shipped = common.PUBLIC_FIGHTERS / slug / m["atlasAlt"]
    im = Image.open(shipped)
    assert im.format == "WEBP"
    assert common.visible_mismatch(im, Image.open(common.fighter_dir(slug) / palette_alt.ALT_MASTER)) == 0
    assert not (common.PUBLIC_FIGHTERS / slug / "palette-alt.json").exists(), "the game no longer recolors at load"


@pytest.mark.parametrize("slug", FIGHTERS)
def test_same_size_same_alpha(slug):
    a = art(slug)
    assert a["alt"].shape == a["atlas"].shape == (*a["mask"].shape, 4)
    assert (a["alt"][..., 3] == a["atlas"][..., 3]).all()


@pytest.mark.parametrize("slug", FIGHTERS)
def test_no_pixel_of_a_head_changes(slug):
    """The protected region is every frame's head mask (heads.py, grown through the head's own
    colors, reviewed frame by frame). Only colors no head has (headFree, checked against the
    hand-drawn reference head) may change inside it: a sleeve that crosses a generous mask."""
    a = art(slug)
    bad = a["changed"] & a["protected"]
    assert int(bad.sum()) == 0, f"{slug}: {int(bad.sum())} protected pixels changed"
    palette_alt.check_head_free(a["atlas"], a["manifest"], a["cfg"], a["garments"])
    # and the reference head itself has none of the colors allowed to change inside a head
    assert not palette_alt.reference_head_colors(a["atlas"], a["manifest"], a["cfg"]) & palette_alt.head_free_colors(a["garments"])


@pytest.mark.parametrize("slug", FIGHTERS)
def test_every_frame_has_a_head(slug):
    a = art(slug)
    for fr in heads.frames_of(a["manifest"]):
        m = a["mask"][fr.y:fr.y + fr.h, fr.x:fr.x + fr.w]
        assert int(m.sum()) >= MIN_HEAD_PX, f"{slug} {fr.key}: head mask has {int(m.sum())} px"


@pytest.mark.parametrize("slug", FIGHTERS)
def test_skin_and_unmapped_colors_never_change(slug):
    a = art(slug)
    skin = np.isin(a["keys"], [palette_alt.key_of(c) for c in a["cfg"]["skin"]])
    assert int((a["changed"] & skin).sum()) == 0
    assert int((a["changed"] & ~a["family"]).sum()) == 0, "only colors of a garment map change"


@pytest.mark.parametrize("slug", FIGHTERS)
def test_every_change_is_one_of_its_garment_maps(slug):
    a = art(slug)
    src = a["keys"][a["changed"]]
    dst = palette_alt.keys(a["alt"])[a["changed"]]
    allowed = {(f, t) for g in a["garments"] for f, t in g["map"].items()}
    pairs = set(zip(src.tolist(), dst.tolist()))
    assert pairs <= allowed, sorted((palette_alt.hex_of(f), palette_alt.hex_of(t)) for f, t in pairs - allowed)[:5]


def torso_boxes(slug: str):
    """Per upright frame: its torso hurt box (the second box, rows 24 to 58 percent) in atlas pixels."""
    boxes = json.loads((BOXES / f"{slug}.json").read_text())["clips"]
    m = art(slug)["manifest"]
    for cid in UPRIGHT:
        for i, f in enumerate(m["clips"][cid]["frames"]):
            bx, by, bw, bh = boxes[cid][i]["hurt"][1]
            x0, y0 = f["x"] + f["ax"] + bx, f["y"] + f["ay"] + by
            yield slice(max(f["y"], y0), min(f["y"] + f["h"], y0 + bh)), slice(max(f["x"], x0), min(f["x"] + f["w"], x0 + bw))


def specks(a: dict) -> tuple[int, int]:
    """Garment-colored pixels outside the heads (outlines aside) whose fate, changed or not, differs
    from at least 6 of their 8 neighbors: the mottling and specks QA saw. (count, out of)."""
    palette = json.loads((common.fighter_dir(a["manifest"]["fighter"]) / "palette.json").read_text())
    neutral = np.isin(a["keys"], [palette_alt.key_of(c) for c in palette if palette_alt.value(c) < palette_alt.NEUTRAL_V])
    region = a["visible"] & a["family"] & ~neutral & ~a["mask"]
    fate = a["changed"]
    pad_r, pad_f = np.pad(region, 1), np.pad(fate, 1)
    h, w = region.shape
    differ = np.zeros(region.shape, np.int8)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                r = pad_r[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
                f = pad_f[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
                differ += r & (f != fate)
    return int((region & (differ >= 6)).sum()), int(region.sum())


@pytest.mark.parametrize("slug", FIGHTERS)
def test_the_garment_changes_almost_completely(slug, capsys):
    """Three measures. The garment-only (anchor) colors outside the heads all change. Specks (a pixel
    whose fate differs from at least 6 of its 8 neighbors) are rare: the old exact-color map left
    0.5 to 2 percent of the garment pixels as specks. And on an independent region, the torso hurt
    box of every upright frame, most garment-colored pixels change; the rest are hands, the belt,
    a collar and lapel shadow lines that share the garment's colors and stay as they are."""
    a = art(slug)
    anchors = np.isin(a["keys"], list(set().union(*(g["anchors"] for g in a["garments"])))) & ~a["protected"] & a["visible"]
    whole = float(a["changed"][anchors].mean())
    n_specks, n_garment = specks(a)
    region = np.zeros(a["mask"].shape, bool)
    for sl in torso_boxes(slug):
        region[sl] = True
    garment = region & a["visible"] & a["family"] & ~a["protected"]
    torso = float(a["changed"][garment].mean())
    with capsys.disabled():
        print(f"\n{slug}: anchor-color pixels changed {whole:.4f} of {int(anchors.sum())}; specks {n_specks} of "
              f"{n_garment} ({n_specks / n_garment:.4%}); torso garment pixels changed {torso:.4f} of {int(garment.sum())}")
    assert whole == 1.0
    assert n_specks / n_garment <= 0.002, f"{slug}: {n_specks} specks"
    assert torso >= 0.9, f"{slug}: only {torso:.3f} of the garment changed in the torso"
