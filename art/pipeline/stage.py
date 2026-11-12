"""Stage layers through image generation (spec 009, R1).

Usage:
  uv run --with pillow --with numpy python -I art/pipeline/stage.py generate STAGE LAYER [--dry-run]
  uv run --with pillow --with numpy python -I art/pipeline/stage.py process STAGE [LAYER RAW.png]
  uv run --with pillow --with numpy python -I art/pipeline/stage.py manifest STAGE

Layer definitions live in art/stages.json. Each layer is generated once, downscaled to its game
size (width set by its parallax factor across the 1280 px stage), reduced to a limited palette
with hard alpha, and written to public/stages/STAGE/<layer>.png with a manifest.
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

DEFS = common.ART / "stages.json"
RAW = common.RAW / "stages"
PUBLIC = common.ROOT / "public" / "stages"
VIEW_W, VIEW_H, STAGE_W = 640, 360, 1280


def load() -> dict:
    return json.loads(DEFS.read_text())


def layer_size(layer: dict) -> tuple[int, int]:
    w = round(VIEW_W + (STAGE_W - VIEW_W) * layer["factor"])
    return w, layer["height"]


def cmd_generate(stage: str, lid: str, dry: bool) -> int:
    d = load()
    st = d["stages"][stage]
    layer = st["layers"][lid]
    prompt = d["style"] + " " + st["setting"] + " " + layer["prompt"]
    bg = "transparent" if layer.get("transparent") else "opaque"
    scripts = Path(os.environ.get("IMAGE_COMPASS_SCRIPTS", gen.DEFAULT_SCRIPTS))
    cmd = ["uv", "run", str(scripts / "generate_openai.py"), "--prompt", prompt, "--model", gen.MODEL,
           "--size", layer["gen_size"], "--quality", "high", "--background", bg, "--output-format", "png",
           "--variant", f"stage-{stage}-{lid}", "--json"]
    if dry:
        print(prompt, "\n", " ".join(cmd[-12:]))
        return 0
    res = subprocess.run(cmd, cwd=common.ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stdout[-1500:] + res.stderr[-1500:], file=sys.stderr)
        return res.returncode
    path = json.loads([l for l in res.stdout.splitlines() if l.startswith("{")][-1])["paths"][0]
    dest = RAW / stage / lid
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / f"{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.png"
    shutil.move(path, target)
    with common.LOG_FILE.open("a") as log:
        log.write(json.dumps({"at": dt.datetime.now().isoformat(timespec="seconds"), "slug": f"stage-{stage}", "clip": lid,
                              "model": gen.MODEL, "size": layer["gen_size"], "quality": "high", "refs": [],
                              "raw": str(target.relative_to(common.ROOT))}) + "\n")
    print(target)
    return 0


def reduce(img: Image.Image, size: tuple[int, int], colors: int, transparent: bool) -> Image.Image:
    small = img.convert("RGBA").resize(size, Image.BOX)
    a = np.array(small)
    alpha = np.where(a[..., 3] >= common.ALPHA_CUT, 255, 0).astype(np.uint8) if transparent else np.full(a.shape[:2], 255, np.uint8)
    rgb = Image.fromarray(a[..., :3], "RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    out = np.dstack([np.array(rgb), alpha])
    return Image.fromarray(out, "RGBA")


def cmd_process(stage: str, lid: str | None, raw: Path | None) -> int:
    st = load()["stages"][stage]
    out = PUBLIC / stage
    out.mkdir(parents=True, exist_ok=True)
    ids = [lid] if lid else list(st["layers"])
    for i in ids:
        layer = st["layers"][i]
        src = raw if (raw and lid) else sorted((RAW / stage / i).glob("*.png"))[-1]
        img = reduce(Image.open(src), layer_size(layer), layer.get("colors", 64), bool(layer.get("transparent")))
        img.save(out / f"{i}.png", optimize=True)
        print(f"{stage}/{i}: {img.size} from {Path(src).name}")
    return cmd_manifest(stage)


def cmd_manifest(stage: str) -> int:
    st = load()["stages"][stage]
    layers = []
    for i, layer in st["layers"].items():
        w, h = layer_size(layer)
        if not (PUBLIC / stage / f"{i}.png").exists():
            continue
        layers.append({"id": i, "file": f"{i}.png", "w": w, "h": h, "factor": layer["factor"], "y": layer["y"]})
    (PUBLIC / stage / "manifest.json").write_text(json.dumps({"stage": stage, "name": st["name"], "floorColor": st["floorColor"],
                                                              "layers": layers}, indent=1) + "\n")
    print(f"{stage}: manifest with {len(layers)} layers")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["generate", "process", "manifest"])
    ap.add_argument("stage")
    ap.add_argument("layer", nargs="?")
    ap.add_argument("raw", nargs="?", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if a.action == "generate":
        return cmd_generate(a.stage, a.layer, a.dry_run)
    if a.action == "process":
        return cmd_process(a.stage, a.layer, a.raw)
    return cmd_manifest(a.stage)


if __name__ == "__main__":
    raise SystemExit(main())
