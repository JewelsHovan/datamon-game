"""Pack a fighter's approved clips into an atlas and manifest (spec 002, R4).

Usage:  uv run --with pillow python -I art/pipeline/pack.py SLUG [--all]

Only clips whose status is "approved" are packed, unless --all (for previewing work in progress).
The manifest follows the "Animation clip format" in docs/game-design.md. The PNG master goes to
art/fighters/SLUG/atlas.png for review; the game loads the lossless WebP copy
public/fighters/SLUG/atlas.webp, named by the manifest's "atlas" field (spec 013, R1).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

ATLAS_W = 1024
PAD = 2


def shelf_pack(sizes: list[tuple[int, int]], width: int = ATLAS_W) -> tuple[list[tuple[int, int]], int]:
    """Place rectangles on shelves, tallest first. Returns positions (input order) and atlas height."""
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i][1])
    pos: list[tuple[int, int]] = [(0, 0)] * len(sizes)
    x = y = shelf_h = 0
    for i in order:
        w, h = sizes[i]
        if w + PAD > width:
            raise ValueError(f"frame {w}px wide does not fit a {width}px atlas")
        if x + w + PAD > width:
            x, y, shelf_h = 0, y + shelf_h + PAD, 0
        pos[i] = (x, y)
        x += w + PAD
        shelf_h = max(shelf_h, h)
    return pos, y + shelf_h


def body_center_offset(idle: list[tuple[dict, Image.Image]]) -> int:
    """Mean horizontal distance from the back-foot anchor to the opaque pixels' center, over idle frames."""
    import numpy as np

    offs = []
    for fm, im in idle:
        xs = np.nonzero(np.array(im)[..., 3] > 0)[1]
        offs.append(xs.mean() - fm["ax"])
    return int(round(sum(offs) / len(offs)))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug")
    ap.add_argument("--all", action="store_true", help="pack generated clips too, not only approved ones")
    ap.add_argument("--skip-index", action="store_true", help="do not rewrite public/fighters/index.json (for parallel builds)")
    args = ap.parse_args()

    fdir = common.fighter_dir(args.slug)
    status = common.load_status(args.slug)
    order = list(common.load_clips()["clips"])
    wanted = [c for c in order if status.get(c, {}).get("state") == "approved" or (args.all and (fdir / c / "frames.json").exists())]
    if not wanted:
        print(f"no {'processed' if args.all else 'approved'} clips for {args.slug}", file=sys.stderr)
        return 2

    entries = []  # (clip, frame meta, image)
    clip_meta = {}
    for c in wanted:
        fj = json.loads((fdir / c / "frames.json").read_text())
        clip_meta[c] = fj
        for fm in fj["frames"]:
            entries.append((c, fm, Image.open(fdir / c / fm["file"]).convert("RGBA")))
    # The game puts a fighter's position (and pushbox) at the body center. Frames are anchored on
    # the back foot, so shift every anchor forward by the idle stance's body-center offset.
    origin_x = body_center_offset([(fm, im) for c, fm, im in entries if c == "idle"]) if "idle" in clip_meta else 0
    pos, height = shelf_pack([(im.width, im.height) for _, _, im in entries])
    atlas = Image.new("RGBA", (ATLAS_W, height), (0, 0, 0, 0))
    clips: dict = {}
    for (c, fm, im), (x, y) in zip(entries, pos):
        atlas.paste(im, (x, y))
        clips.setdefault(c, {"loop": clip_meta[c]["loop"], "frames": []})["frames"].append(
            {"x": x, "y": y, "w": im.width, "h": im.height, "ax": fm["ax"] + origin_x, "ay": fm["ay"], "hold": fm["hold"]})

    out = common.PUBLIC_FIGHTERS / args.slug
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    prev = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    idle_scale = clip_meta.get("idle", {}).get("scale")
    manifest = {"fighter": args.slug, "atlas": common.ATLAS_FILE, "version": int(prev.get("version", 0)) + 1,
                "scale": idle_scale, "facing": "right", "originX": origin_x, "clips": clips}
    common.save_master_and_webp(atlas, fdir / common.MASTER_ATLAS, out / common.ATLAS_FILE)
    (out / "atlas.png").unlink(missing_ok=True)  # only the WebP ships
    manifest_path.write_text(json.dumps(manifest, indent=1) + "\n")
    if not args.skip_index:
        common.write_fighter_index()
    print(f"{args.slug}: {len(clips)} clips, {len(entries)} frames, atlas {ATLAS_W}x{height} -> {out.relative_to(common.ROOT)}")
    if (fdir / "alt.json").exists():  # the new manifest names no alternate atlas until it is rebuilt
        print(f"now re-run palette_alt.py {args.slug} (mirror-match colors), then review its sheet")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
