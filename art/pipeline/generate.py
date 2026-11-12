"""Generate one animation strip with image gen (spec 002, R2).

Usage:  uv run --with pillow python -I art/pipeline/generate.py SLUG CLIP [--n K] [--dry-run] [--max-images M] [--force]

Builds the prompt from art/clips.json (a calibration stance frame, then the clip's poses),
attaches the fighter's references, calls image-compass generate_openai.py, moves the result to
art/raw/SLUG/CLIP/ and logs every image to art/generation-log.jsonl.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

MODEL = "gpt-image-2.5-sunburst"
DEFAULT_SCRIPTS = "/Users/julien.hovan/Desktop/Internals/claude-compass-superpowers/image-compass/scripts"

STYLE = (
    "Pixel-art fighting game animation strip of the exact same character shown in the reference images: "
    "same face, hair, clothes, colors, proportions, dark pixel outlines and 16-bit pixel-art shading. "
    "Side view, the character faces RIGHT in every frame. {n} full-body figures in one horizontal row, "
    "evenly spaced with clear empty space between them so no two figures touch or overlap, "
    "identical character scale in every frame, feet on the same baseline. "
    "No text, no labels, no numbers, no frame borders, no shadows, no floor, no effects or motion lines. "
    "Transparent background."
)


def build_refs(slug: str) -> list[Path]:
    refs = common.fighter_dir(slug) / "refs"
    refs.mkdir(exist_ok=True)
    pair = refs / "walk-pair.png"
    if not pair.exists():
        from PIL import Image  # only needed once per fighter

        front = common.walk_cell(slug, common.FRONT_ROW, 0)
        side = common.walk_cell(slug, common.SIDE_RIGHT_ROW, common.STAND_COL)
        up = lambda im: im.resize((im.width * 2, im.height * 2), Image.NEAREST)  # noqa: E731
        f2, s2 = up(front), up(side)
        canvas = Image.new("RGBA", (f2.width + s2.width + 20, max(f2.height, s2.height)), (0, 0, 0, 0))
        canvas.paste(f2, (0, 0))
        canvas.paste(s2, (f2.width + 20, 0))
        canvas.save(pair)
    out = [pair]
    idle = refs / "idle-stance.png"
    if idle.exists():
        out.append(idle)
    return out


def build_prompt(clip_id: str, clips: dict, has_idle_ref: bool, slug: str = "") -> str:
    clip = common.clip_def(slug, clip_id, clips)
    poses = [clips["calibration_pose"]] + clip["poses"]
    lines = " ".join(f"({i + 1}) {p};" for i, p in enumerate(poses))
    prompt = STYLE.format(n=len(poses)) + f" Frames from left to right: {lines}"
    if has_idle_ref:
        prompt += " The last reference image shows this character's fighting stance: keep that exact stance, guard, scale and proportions."
    return prompt


def size_for(n_figures: int) -> str:
    if n_figures <= 4:
        return "2048x1024"
    if n_figures <= 8:
        return "3072x1024"
    return "3840x1280"  # up to 11 figures: the widest 3:1 canvas the model accepts


def log_count(slug: str) -> int:
    if not common.LOG_FILE.exists():
        return 0
    return sum(1 for line in common.LOG_FILE.read_text().splitlines() if line and json.loads(line).get("slug") == slug)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug")
    ap.add_argument("clip")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-images", type=int, default=None, help="refuse if this fighter's logged images would exceed M")
    ap.add_argument("--force", action="store_true", help="regenerate even if the clip is approved")
    ap.add_argument("--quality", default="high")
    args = ap.parse_args()

    clips = common.load_clips()
    if args.clip not in clips["clips"]:
        print(f"unknown clip {args.clip}", file=sys.stderr)
        return 2
    common.person(args.slug)
    state = common.load_status(args.slug).get(args.clip, {}).get("state")
    if state == "approved" and not args.force:
        print(f"{args.slug}/{args.clip} is approved; pass --force to regenerate", file=sys.stderr)
        return 2
    if args.max_images is not None and log_count(args.slug) + args.n > args.max_images:
        print(f"budget: {log_count(args.slug)} images logged for {args.slug}, +{args.n} exceeds --max-images {args.max_images}", file=sys.stderr)
        return 2

    refs = build_refs(args.slug)
    prompt = build_prompt(args.clip, clips, has_idle_ref=len(refs) > 1, slug=args.slug)
    cdef = common.clip_def(args.slug, args.clip, clips)
    n_fig = len(cdef["poses"]) + 1
    scripts = Path(os.environ.get("IMAGE_COMPASS_SCRIPTS", DEFAULT_SCRIPTS))
    cmd = ["uv", "run", str(scripts / "generate_openai.py"), "--prompt", prompt, "--model", MODEL,
           "--size", cdef.get("size") or size_for(n_fig), "--quality", args.quality, "--background", "transparent",
           "--output-format", "png", "--variant", f"{args.slug}-{args.clip}", "--n", str(args.n), "--json"]
    for r in refs:
        cmd += ["--ref", str(r)]

    if args.dry_run:
        print("PROMPT:\n" + prompt + "\n\nREFS:\n" + "\n".join(str(r.relative_to(common.ROOT)) for r in refs))
        print("\nCOMMAND:\n" + " ".join(shlex.quote(c) for c in cmd))
        return 0

    res = subprocess.run(cmd, cwd=common.ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stdout[-2000:] + res.stderr[-2000:], file=sys.stderr)
        return res.returncode
    paths = json.loads([l for l in res.stdout.splitlines() if l.startswith("{")][-1])["paths"]
    dest = common.RAW / args.slug / args.clip
    dest.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    with common.LOG_FILE.open("a") as log:
        for i, p in enumerate(paths):
            target = dest / f"{stamp}-{i}.png"
            shutil.move(p, target)
            log.write(json.dumps({"at": dt.datetime.now().isoformat(timespec="seconds"), "slug": args.slug, "clip": args.clip,
                                  "model": MODEL, "size": cdef.get("size") or size_for(n_fig), "quality": args.quality,
                                  "refs": [str(r.relative_to(common.ROOT)) for r in refs],
                                  "raw": str(target.relative_to(common.ROOT))}) + "\n")
            print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
