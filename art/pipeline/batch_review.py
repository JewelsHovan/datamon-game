"""Process the newest raw strip of each clip and tile contact sheets into review mosaics.

Usage:  uv run --with pillow --with numpy --with scipy python -I art/pipeline/batch_review.py SLUG OUT_DIR [CLIP ...]

Skips approved clips unless clips are named. Prints one line per clip (frames found or the error) and writes
OUT_DIR/mosaic-N.png with up to 4 clips each (frames aligned on the anchor, floor line).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402


def newest_raw(slug: str, clip: str) -> Path | None:
    files = sorted((common.RAW / slug / clip).glob("*.png"))
    return files[-1] if files else None


def main(argv: list[str]) -> int:
    slug, out = argv[0], Path(argv[1])
    out.mkdir(parents=True, exist_ok=True)
    explicit = argv[2:]
    clips = explicit or list(common.load_clips()["clips"])
    status = common.load_status(slug)
    sheets = []
    for c in clips:
        if status.get(c, {}).get("state") == "approved" and not explicit:
            continue  # named clips are reprocessed even if approved (a regeneration under review)
        raw = newest_raw(slug, c)
        if raw is None:
            print(f"{c:14} no raw image")
            continue
        res = subprocess.run([sys.executable, "-I", str(Path(__file__).parent / "process.py"), slug, c, str(raw)],
                             capture_output=True, text=True)
        line = (res.stdout.strip() or res.stderr.strip()).splitlines()[-1]
        print(f"{c:14} exit {res.returncode}  {line}")
        contact = common.fighter_dir(slug) / c / "contact.png"
        if res.returncode == 0 and contact.exists():
            sheets.append((c, Image.open(contact).convert("RGB")))
    for n in range(0, len(sheets), 4):
        group = sheets[n:n + 4]
        scale = 2 / 3  # contact sheets are 3x; show at 2x
        rows = [(c, im.resize((round(im.width * scale), round(im.height * scale)), Image.NEAREST)) for c, im in group]
        W = max(im.width for _, im in rows)
        H = sum(im.height + 22 for _, im in rows)
        mosaic = Image.new("RGB", (W, H), (14, 13, 32))
        d = ImageDraw.Draw(mosaic)
        y = 0
        for c, im in rows:
            d.text((6, y + 4), c, fill=(255, 201, 74))
            mosaic.paste(im, (0, y + 22))
            y += im.height + 22
        path = out / f"mosaic-{n // 4 + 1}.png"
        mosaic.save(path)
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
