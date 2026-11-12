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
