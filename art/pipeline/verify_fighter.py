"""Verify a single fighter's complete 26-clip processed, packed, recolored and boxed assets.

Usage:  uv run --with pillow --with numpy python -I art/pipeline/verify_fighter.py SLUG
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

ATTACK_IMPACT_FRAMES = [
    ("light_punch", 3),
    ("heavy_punch", 5),
    ("light_kick", 2),
    ("heavy_kick", 5),
    ("crouch_attack", 3),
    ("air_attack", 2),
]


def verify(slug: str) -> list[str]:
    errors: list[str] = []
    common.person(slug)
    clips_def = common.load_clips()
    core_clips = list(clips_def["clips"])
    fdir = common.fighter_dir(slug)
    pub = common.PUBLIC_FIGHTERS / slug
    boxes_path = common.ROOT / "src" / "data" / "boxes" / f"{slug}.json"

    pal_path = fdir / "palette.json"
    if not pal_path.exists():
        errors.append("missing palette.json")
        return errors
    pal = set(json.loads(pal_path.read_text()))
    if len(pal) > common.PALETTE_SIZE:
        errors.append(f"palette has {len(pal)} colors (> {common.PALETTE_SIZE})")

    status = common.load_status(slug)
    for cid in core_clips:
        expected_n = len(common.clip_def(slug, cid, clips_def)["poses"])
        if status.get(cid, {}).get("state") != "approved":
            errors.append(f"clip {cid} status is {status.get(cid, {}).get('state')!r} (expected 'approved')")
        fj = fdir / cid / "frames.json"
        if not fj.exists():
            errors.append(f"missing {cid}/frames.json")
            continue
        meta = json.loads(fj.read_text())
        if len(meta["frames"]) != expected_n:
            errors.append(f"{cid}: expected {expected_n} frames, found {len(meta['frames'])}")
        for fm in meta["frames"]:
            im_path = fdir / cid / fm["file"]
            if not im_path.exists():
                errors.append(f"missing {cid}/{fm['file']}")
                continue
            a = np.array(Image.open(im_path).convert("RGBA"))
            vis = a[a[..., 3] > 0]
            if len(vis) == 0:
                errors.append(f"{cid}/{fm['file']} has 0 opaque pixels")
                continue
            used = {"#%02x%02x%02x" % tuple(p[:3]) for p in vis}
            if not (used <= pal):
                errors.append(f"{cid}/{fm['file']} uses colors outside palette.json")
            if fm["w"] < 16 or fm["w"] > 280 or fm["h"] < 18 or fm["h"] > 230:
                errors.append(f"{cid}/{fm['file']} unusual bounds {fm['w']}x{fm['h']}")
        if cid == "idle":
            for fm in meta["frames"]:
                if abs(fm["h"] - common.STANCE_PX) > 5:
                    errors.append(f"idle/{fm['file']} height is {fm['h']}px (expected {common.STANCE_PX}+/-5)")

    manifest_path = pub / "manifest.json"
    master_atlas = fdir / common.MASTER_ATLAS
    shipped_atlas = pub / common.ATLAS_FILE
    alt_pub = pub / "palette-alt.json"
    if not manifest_path.exists():
        errors.append("missing public manifest.json")
        return errors
    if not master_atlas.exists() or not shipped_atlas.exists():
        errors.append("missing master or shipped atlas")
        return errors
    if not alt_pub.exists():
        errors.append("missing public palette-alt.json")

    m = json.loads(manifest_path.read_text())
    if set(m["clips"]) != set(core_clips):
        missing = sorted(set(core_clips) - set(m["clips"]))
        errors.append(f"manifest missing clips: {missing}")
    for cid, cmeta in m["clips"].items():
        for i, fm in enumerate(cmeta["frames"]):
            if fm["ax"] > 80:
                errors.append(f"manifest {cid}[{i}] ax={fm['ax']}px exceeds 80px screen margin")
    mismatch = common.visible_mismatch(Image.open(shipped_atlas), Image.open(master_atlas))
    if mismatch != 0:
        errors.append(f"WebP visible_mismatch={mismatch} (expected 0)")

    if not boxes_path.exists():
        errors.append(f"missing {boxes_path.relative_to(common.ROOT)}")
        return errors
    b = json.loads(boxes_path.read_text())
    if set(b["clips"]) != set(m["clips"]):
        errors.append("boxes clips do not match manifest clips")
    for cid, rows in b["clips"].items():
        for i, r in enumerate(rows):
            if not r.get("hurt"):
                errors.append(f"boxes {cid}[{i}] has empty hurtbox")
    for cid, idx in ATTACK_IMPACT_FRAMES:
        rows = b["clips"].get(cid, [])
        if idx < len(rows):
            reach = rows[idx].get("reach")
            if not reach or reach[0] + reach[2] <= 24:
                errors.append(f"boxes {cid}[{idx}] missing forward reach box (got {reach})")

    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("slug")
    args = ap.parse_args()
    errs = verify(args.slug)
    if errs:
        print(f"FAIL {args.slug}: {len(errs)} issue(s):", file=sys.stderr)
        for e in errs:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print(f"PASS {args.slug}: all 26 clips, palette, manifest, WebP, alt-palette and boxes verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
