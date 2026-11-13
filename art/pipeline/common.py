"""Shared paths and helpers for the animation pipeline (spec 002)."""

from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "art"
RAW = ART / "raw"
FIGHTERS = ART / "fighters"
CLIPS_FILE = ART / "clips.json"
LOG_FILE = ART / "generation-log.jsonl"
CATALOG = ROOT / "src" / "data" / "datamonCatalog.js"
WALK = ROOT / "public" / "datamon" / "walk"
PUBLIC_FIGHTERS = ROOT / "public" / "fighters"

STAGES = ART / "stages"
PUBLIC_STAGES = ROOT / "public" / "stages"
EFFECTS = ART / "effects"
PUBLIC_EFFECTS = ROOT / "public" / "effects"

# Shipped art (spec 013, R1): PNG masters stay under art/ for review; the game loads lossless WebP.
# exact=False lets the encoder change the color of fully transparent pixels only, so every visible
# pixel (alpha > 0) and the whole alpha channel stay identical to the master.
ATLAS_FILE = "atlas.webp"
MASTER_ATLAS = "atlas.png"
WEBP = {"lossless": True, "quality": 100, "method": 6, "exact": False}

STANCE_PX = 140  # fighting-stance height in game pixels at 640x360
ALPHA_CUT = 128
PALETTE_SIZE = 48
SIDE_RIGHT_ROW, FRONT_ROW, STAND_COL = 3, 0, 2


def load_clips() -> dict:
    return json.loads(CLIPS_FILE.read_text())


def clip_def(slug: str, clip_id: str, clips: dict | None = None) -> dict:
    """A clip's definition for one fighter: the fighter's own signature special, or the shared clip."""
    clips = clips or load_clips()
    if clip_id == "special" and slug in clips.get("specials", {}):
        return clips["specials"][slug]["clip"]
    return clips["clips"][clip_id]


def people() -> dict[str, dict]:
    src = CATALOG.read_text()
    m = re.search(r"CHARACTER_MODELS = Object\.freeze\((\[.*?\])\);", src, re.S)
    if not m:
        raise SystemExit(f"CHARACTER_MODELS not found in {CATALOG}")
    return {p["slug"]: p for p in json.loads(m.group(1)) if p["kind"] == "datamon_person"}


def person(slug: str) -> dict:
    ppl = people()
    if slug not in ppl:
        raise SystemExit(f"unknown fighter slug: {slug}")
    return ppl[slug]


def walk_cell(slug: str, row: int, col: int) -> Image.Image:
    p = person(slug)
    sheet = Image.open(WALK / f"{slug}.webp").convert("RGBA")
    cw, ch = p["cellW"], p["cellH"]
    return sheet.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))


def fighter_dir(slug: str) -> Path:
    d = FIGHTERS / slug
    d.mkdir(parents=True, exist_ok=True)
    return d


def status_path(slug: str) -> Path:
    return fighter_dir(slug) / "status.json"


def load_status(slug: str) -> dict:
    p = status_path(slug)
    return json.loads(p.read_text()) if p.exists() else {}


def save_status(slug: str, status: dict) -> None:
    status_path(slug).write_text(json.dumps(status, indent=2, sort_keys=True) + "\n")


def load_json(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


def write_fighter_index() -> Path:
    """public/fighters/index.json: every fighter with a packed manifest, with its atlas and version.
    The game reads it once instead of probing a manifest per person (a 404 for everyone without art)."""
    fighters = {}
    for mp in sorted(PUBLIC_FIGHTERS.glob("*/manifest.json")):
        m = json.loads(mp.read_text())
        fighters[mp.parent.name] = {"manifest": mp.name, "atlas": m.get("atlas", ATLAS_FILE), "version": m["version"]}
    out = PUBLIC_FIGHTERS / "index.json"
    out.write_text(json.dumps({"fighters": fighters}, indent=1) + "\n")
    return out


def save_master_and_webp(img: Image.Image, master: Path, shipped: Path) -> None:
    """Writes the PNG master (review copy under art/) and the lossless WebP the game loads."""
    master.parent.mkdir(parents=True, exist_ok=True)
    shipped.parent.mkdir(parents=True, exist_ok=True)
    img.save(master, optimize=True)
    save_webp(img, shipped)


def save_webp(img: Image.Image, path: Path) -> None:
    img.convert("RGBA").save(path, "WEBP", **WEBP)


def visible_mismatch(shipped: Image.Image, master: Image.Image) -> int:
    """Pixels where the shipped image differs from the master: any alpha difference, or a color
    difference where the master is visible (alpha > 0). 0 means pixel-identical to the eye."""
    import numpy as np

    a = np.array(shipped.convert("RGBA"))
    b = np.array(master.convert("RGBA"))
    if a.shape != b.shape:
        return max(a.size, b.size)
    alpha_diff = a[..., 3] != b[..., 3]
    color_diff = (a[..., :3] != b[..., :3]).any(axis=2) & (b[..., 3] > 0)
    return int((alpha_diff | color_diff).sum())
