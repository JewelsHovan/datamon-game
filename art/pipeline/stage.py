"""Stage layers through image generation (spec 009, R1), and the background walkers' strip (spec 013, R2).

Usage:
  uv run --with pillow --with numpy python -I art/pipeline/stage.py generate STAGE LAYER [--dry-run]
  uv run --with pillow --with numpy python -I art/pipeline/stage.py process STAGE [LAYER RAW.png]
  uv run --with pillow --with numpy python -I art/pipeline/stage.py manifest STAGE

Layer definitions live in art/stages.json. Each layer is generated once, downscaled to its game
size (width set by its parallax factor across the 1280 px stage), reduced to a limited palette
with hard alpha, and written as a PNG master art/stages/STAGE/<layer>.png (spec 013, R1).

`manifest` (also run by `process`) exports every layer from its master as the lossless WebP the
game loads (public/stages/STAGE/<layer>.webp), cuts the walker strip (public/stages/STAGE/walkers.webp:
the four right-facing walk frames of each cast member at walker scale, the cast chosen by the
stage's "walkers" rule), and writes public/stages/STAGE/manifest.json, which names every file and
lists the cast with its frames. The game reads all of it from the manifest.
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
MASTERS = common.STAGES
PUBLIC = common.PUBLIC_STAGES
VIEW_W, VIEW_H, STAGE_W = 640, 360, 1280
# A standing person is 150 px tall at 640x360: walk-sheet footY 228 maps to 150 (PLACEHOLDER_* in src/render/clips.ts).
PERSON_PX, SHEET_FOOT_Y = 150, 228
WALKERS = "walkers"
PAD = 2


def master_path(stage: str, name: str) -> Path:
    return MASTERS / stage / f"{name}.png"


def shipped_name(name: str) -> str:
    return f"{name}.webp"


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
    (MASTERS / stage).mkdir(parents=True, exist_ok=True)
    ids = [lid] if lid else list(st["layers"])
    for i in ids:
        layer = st["layers"][i]
        src = raw if (raw and lid) else sorted((RAW / stage / i).glob("*.png"))[-1]
        img = reduce(Image.open(src), layer_size(layer), layer.get("colors", 64), bool(layer.get("transparent")))
        img.save(master_path(stage, i), optimize=True)
        print(f"{stage}/{i}: {img.size} from {Path(src).name}")
    return cmd_manifest(stage)


def walker_cast(rule: dict, people: dict[str, dict]) -> list[str]:
    """Every `every`-th person who is not excluded (the launch fighters), at most `count`, in catalog order."""
    exclude = set(rule["exclude"])
    pool = [slug for slug in people if slug not in exclude]
    return [slug for i, slug in enumerate(pool) if i % rule["every"] == 0][: rule["count"]]


def walker_frames(person: dict, k: float) -> list[tuple[Image.Image, int, int]]:
    """A person's four right-facing walk frames scaled by k (area average, hard alpha) and trimmed
    to their opaque pixels, each with its anchor (feet center on the floor line) in frame pixels."""
    sheet = Image.open(common.WALK / f"{person['slug']}.webp").convert("RGBA")
    cw, ch = person["cellW"], person["cellH"]
    w, h = round(cw * k), round(ch * k)
    row = common.SIDE_RIGHT_ROW
    out = []
    for col, (_, body_x, foot_y) in enumerate(person["frames"]["right"]):
        cell = sheet.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
        a = np.array(cell.resize((w, h), Image.BOX))
        solid = a[..., 3] >= common.ALPHA_CUT
        a[..., 3] = np.where(solid, 255, 0)
        a[~solid] = 0
        ys, xs = np.nonzero(solid)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
        ax = int(round(body_x * w / cw)) - x0
        ay = int(round(foot_y * h / ch)) - y0
        out.append((Image.fromarray(a[y0:y1, x0:x1]), ax, ay))
    return out


def build_walkers(stage: str, st: dict) -> dict | None:
    """Cuts the walker strip (PNG master + WebP) and returns its manifest entry."""
    rule = st.get("walkers")
    if not rule:
        return None
    k = rule["scale"] * PERSON_PX / SHEET_FOOT_Y
    people = common.people()
    cut = [(slug, walker_frames(people[slug], k)) for slug in walker_cast(rule, people)]
    width = sum(im.width + PAD for _, frames in cut for im, _, _ in frames) - PAD
    height = max(im.height for _, frames in cut for im, _, _ in frames)
    strip = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    cast, x = [], 0
    for slug, frames in cut:
        rects = []
        for im, ax, ay in frames:
            strip.paste(im, (x, 0))
            rects.append({"x": x, "y": 0, "w": im.width, "h": im.height, "ax": ax, "ay": ay})
            x += im.width + PAD
        cast.append({"slug": slug, "frames": rects})
    common.save_master_and_webp(strip, master_path(stage, WALKERS), PUBLIC / stage / shipped_name(WALKERS))
    print(f"{stage}/walkers: {len(cast)} people, strip {width}x{height}")
    return {"file": shipped_name(WALKERS), "w": width, "h": height, "scale": round(k, 4),
            "stand": common.STAND_COL, "cast": cast}


def cmd_manifest(stage: str) -> int:
    st = load()["stages"][stage]
    out = PUBLIC / stage
    out.mkdir(parents=True, exist_ok=True)
    layers = []
    for i, layer in st["layers"].items():
        w, h = layer_size(layer)
        src = master_path(stage, i)
        if not src.exists():
            continue
        common.save_webp(Image.open(src), out / shipped_name(i))
        (out / f"{i}.png").unlink(missing_ok=True)  # only the WebP ships
        layers.append({"id": i, "file": shipped_name(i), "w": w, "h": h, "factor": layer["factor"], "y": layer["y"]})
    mp = out / "manifest.json"
    prev = json.loads(mp.read_text()) if mp.exists() else {}
    manifest = {"stage": stage, "name": st["name"], "version": 0, "floorColor": st["floorColor"], "layers": layers}
    walkers = build_walkers(stage, st)
    if walkers:
        manifest["walkers"] = walkers
    # The version names the art in the game's URLs (cache busting), so it moves only when something changed.
    unchanged = {**prev, "version": 0} == manifest
    manifest["version"] = int(prev.get("version", 0)) + (0 if unchanged else 1)
    mp.write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{stage}: manifest with {len(layers)} layers{' and walkers' if walkers else ''}")
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
