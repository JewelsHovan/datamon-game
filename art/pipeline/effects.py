"""Effect animations through the image pipeline (spec 004, R1-R3).

Usage:
  uv run --with pillow --with numpy --with scipy python -I art/pipeline/effects.py generate ID [--dry-run]
  uv run --with pillow --with numpy --with scipy python -I art/pipeline/effects.py process ID [RAW.png]
  uv run --with pillow --with numpy --with scipy python -I art/pipeline/effects.py approve ID
  uv run --with pillow --with numpy --with scipy python -I art/pipeline/effects.py pack

Effects have no calibration figure and are not palette-locked. Frames are cut by column gaps
(sparks break into many small pieces, so connected components would mis-assign them), falling
back to equal slots. The tallest frame is scaled to the effect's target height; anchors sit on
the slot center (or the shared bottom row), so the effect does not jitter between frames.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import generate as gen  # noqa: E402
import pack as packer  # noqa: E402
import process  # noqa: E402

DEFS = common.ART / "effects.json"
OUT = common.ART / "effects"
RAW = common.RAW / "effects"
PUBLIC = common.ROOT / "public" / "effects"


def load() -> dict:
    return json.loads(DEFS.read_text())


def status() -> dict:
    return common.load_json(OUT / "status.json", {})


def save_status(s: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "status.json").write_text(json.dumps(s, indent=2, sort_keys=True) + "\n")


def slots(alpha: np.ndarray, n: int) -> list[tuple[int, int]]:
    """Column ranges for n frames: runs of non-empty columns merged across small gaps; equal slots as fallback."""
    cols = alpha.any(axis=0)
    runs, start = [], None
    for x, c in enumerate(cols):
        if c and start is None:
            start = x
        if not c and start is not None:
            runs.append([start, x])
            start = None
    if start is not None:
        runs.append([start, len(cols)])
    while len(runs) > n:  # merge the pair separated by the smallest gap
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        i = int(np.argmin(gaps))
        runs[i] = [runs[i][0], runs[i + 1][1]]
        del runs[i + 1]
    if len(runs) == n:
        return [(a, b) for a, b in runs]
    w = alpha.shape[1]
    return [(round(i * w / n), round((i + 1) * w / n)) for i in range(n)]


def cut(img: Image.Image, eff: dict) -> list[dict]:
    rgba = np.array(img.convert("RGBA"))
    solid = rgba[..., 3] >= common.ALPHA_CUT
    n = len(eff["frames"])
    sl = slots(solid, n)
    ys_all = np.nonzero(solid.any(axis=1))[0]
    cy = (ys_all.min() + ys_all.max()) / 2
    bottom = ys_all.max()
    pieces = []
    for a, b in sl:
        m = solid[:, a:b]
        ys, xs = np.nonzero(m)
        if len(ys) == 0:
            raise process.FrameCountError(f"slot {a}-{b} is empty")
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min() + a, xs.max() + 1 + a
        sub = rgba[y0:y1, x0:x1].copy()
        sub[..., 3] = np.where(solid[y0:y1, x0:x1], 255, 0)
        anchor_x = (a + b) / 2 - x0
        anchor_y = (cy if eff["anchor"] == "center" else bottom) - y0
        pieces.append({"img": Image.fromarray(sub), "ax": anchor_x, "ay": anchor_y})
    k = eff["target"] / max(p["img"].height for p in pieces)
    frames = []
    for p, hold in zip(pieces, eff["holds"]):
        small = process.downscale(p["img"], k)
        ay = int(round(p["ay"] * k))
        if eff["anchor"] == "bottom":
            ay = min(ay, small.height - 1)  # rounding must not push the floor anchor below the frame
        frames.append({"image": small, "ax": int(round(p["ax"] * k)), "ay": ay, "hold": int(hold)})
    return frames


def cmd_generate(eid: str, dry: bool) -> int:
    d = load()
    eff = d["effects"][eid]
    lines = " ".join(f"({i + 1}) {f};" for i, f in enumerate(eff["frames"]))
    prompt = d["style"].format(n=len(eff["frames"])) + f" Frames from left to right: {lines}"
    size = "2048x1024" if len(eff["frames"]) <= 4 else "3072x1024"
    scripts = Path(os.environ.get("IMAGE_COMPASS_SCRIPTS", gen.DEFAULT_SCRIPTS))
    cmd = ["uv", "run", str(scripts / "generate_openai.py"), "--prompt", prompt, "--model", gen.MODEL, "--size", size,
           "--quality", "high", "--background", "transparent", "--output-format", "png", "--variant", f"fx-{eid}", "--json"]
    if dry:
        print(prompt)
        return 0
    res = subprocess.run(cmd, cwd=common.ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stdout[-1500:] + res.stderr[-1500:], file=sys.stderr)
        return res.returncode
    path = json.loads([l for l in res.stdout.splitlines() if l.startswith("{")][-1])["paths"][0]
    dest = RAW / eid
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / f"{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.png"
    shutil.move(path, target)
    with common.LOG_FILE.open("a") as log:
        log.write(json.dumps({"at": dt.datetime.now().isoformat(timespec="seconds"), "slug": "effects", "clip": eid,
                              "model": gen.MODEL, "size": size, "quality": "high", "refs": [],
                              "raw": str(target.relative_to(common.ROOT))}) + "\n")
    print(target)
    return 0


def cmd_process(eid: str, raw: Path | None) -> int:
    eff = load()["effects"][eid]
    if raw is None:
        files = sorted((RAW / eid).glob("*.png"))
        if not files:
            print(f"no raw image for {eid}", file=sys.stderr)
            return 2
        raw = files[-1]
    try:
        frames = cut(Image.open(raw), eff)
    except process.FrameCountError as e:
        print(f"{eid}: {e}", file=sys.stderr)
        return 3
    out = OUT / eid
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.png"):
        old.unlink()
    meta = []
    for i, f in enumerate(frames):
        name = f"{i:02d}.png"
        f["image"].save(out / name)
        meta.append({"file": name, "w": f["image"].width, "h": f["image"].height, "ax": f["ax"], "ay": f["ay"], "hold": f["hold"]})
    loop = eid == "orb"
    (out / "frames.json").write_text(json.dumps({"clip": eid, "loop": loop, "raw": str(raw.relative_to(common.ROOT)), "frames": meta}, indent=1) + "\n")
    process.review_images(frames, out)
    s = status()
    s[eid] = {"state": "generated", "raw": str(raw.relative_to(common.ROOT))}
    save_status(s)
    print(f"{eid}: {len(meta)} frames, heights {[m['h'] for m in meta]}")
    return 0


def cmd_pack() -> int:
    s = status()
    ids = [e for e in load()["effects"] if s.get(e, {}).get("state") == "approved"]
    if not ids:
        print("no approved effects", file=sys.stderr)
        return 2
    entries, metas = [], {}
    for e in ids:
        fj = json.loads((OUT / e / "frames.json").read_text())
        metas[e] = fj
        for fm in fj["frames"]:
            entries.append((e, fm, Image.open(OUT / e / fm["file"]).convert("RGBA")))
    pos, height = packer.shelf_pack([(im.width, im.height) for _, _, im in entries])
    atlas = Image.new("RGBA", (packer.ATLAS_W, height), (0, 0, 0, 0))
    clips: dict = {}
    for (e, fm, im), (x, y) in zip(entries, pos):
        atlas.paste(im, (x, y))
        clips.setdefault(e, {"loop": metas[e]["loop"], "frames": []})["frames"].append(
            {"x": x, "y": y, "w": im.width, "h": im.height, "ax": fm["ax"], "ay": fm["ay"], "hold": fm["hold"]})
    PUBLIC.mkdir(parents=True, exist_ok=True)
    mp = PUBLIC / "manifest.json"
    prev = json.loads(mp.read_text()) if mp.exists() else {}
    atlas.save(PUBLIC / "atlas.png", optimize=True)
    mp.write_text(json.dumps({"fighter": "effects", "version": int(prev.get("version", 0)) + 1, "scale": None,
                              "facing": "right", "clips": clips}, indent=1) + "\n")
    print(f"effects: {len(clips)} clips, {len(entries)} frames, atlas {packer.ATLAS_W}x{height}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["generate", "process", "approve", "pack"])
    ap.add_argument("id", nargs="?")
    ap.add_argument("raw", nargs="?", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if a.action != "pack" and (not a.id or a.id not in load()["effects"]):
        print(f"{a.action} needs an effect id from art/effects.json", file=sys.stderr)
        return 2
    if a.action == "generate":
        return cmd_generate(a.id, a.dry_run)
    if a.action == "process":
        return cmd_process(a.id, a.raw)
    if a.action == "approve":
        s = status()
        s.setdefault(a.id, {})["state"] = "approved"
        save_status(s)
        return 0
    return cmd_pack()


if __name__ == "__main__":
    raise SystemExit(main())
