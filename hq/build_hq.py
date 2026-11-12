"""Build hq/index.html (the Merge Conflict HQ artifact page) from hq/template.html.

Embeds the 37 roster portraits and the two spec-001 sandbox fighters as data URIs.
Run from the repo root:  uv run --with pillow python -I hq/build_hq.py
"""

import base64
import io
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "datamon"
CATALOG = ROOT / "src" / "data" / "datamonCatalog.js"
SANDBOX = ("julien-hovan", "felicia-gorgacheva")  # spec 001 default P1, P2
FIGHTER_H = 150  # standing height at 640x360 (docs/game-design.md)


def people():
    src = CATALOG.read_text()
    match = re.search(r"CHARACTER_MODELS = Object\.freeze\((\[.*?\])\);", src, re.S)
    if not match:
        raise SystemExit(f"CHARACTER_MODELS not found in {CATALOG}")
    return [m for m in json.loads(match.group(1)) if m["kind"] == "datamon_person"]


def data_uri(raw: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def fighter_frame(slug: str, row: int, cw: int) -> str:
    """Standing side frame (column 2), downscaled to game size with hard alpha edges."""
    sheet = Image.open(ASSETS / "walk" / f"{slug}.webp").convert("RGBA")
    cell = sheet.crop((2 * cw, row * 240, 3 * cw, row * 240 + 240))  # cellW varies per person
    scale = FIGHTER_H / 228
    cell = cell.resize((round(cw * scale), round(240 * scale)), Image.BOX)
    cell.putalpha(cell.getchannel("A").point(lambda v: 255 if v > 110 else 0))
    cell = cell.crop(cell.getbbox())
    buf = io.BytesIO()
    cell.save(buf, "PNG", optimize=True)
    return data_uri(buf.getvalue(), "image/png")


def main():
    ppl = people()
    by_slug = {p["slug"]: p for p in ppl}
    roster = [
        {
            "slug": p["slug"],
            "name": p["name"],
            "short": p["shortName"],
            "img": data_uri((ASSETS / "portraits" / f"{p['slug']}.webp").read_bytes(), "image/webp"),
        }
        for p in sorted(ppl, key=lambda p: p["name"])
    ]
    p1, p2 = (by_slug[s] for s in SANDBOX)
    fighters = {
        "p1": {"name": p1["name"], "short": p1["shortName"], "img": fighter_frame(p1["slug"], 3, p1["cellW"])},  # faces right
        "p2": {"name": p2["name"], "short": p2["shortName"], "img": fighter_frame(p2["slug"], 2, p2["cellW"])},  # faces left
    }
    html = (ROOT / "hq" / "template.html").read_text()
    html = html.replace("/*__ROSTER__*/[]", json.dumps(roster))
    html = html.replace("/*__FIGHTERS__*/{}", json.dumps(fighters))
    out = ROOT / "hq" / "index.html"
    out.write_text(html)
    print(f"{out} {len(html) / 1024:.0f} KB, {len(roster)} people")


if __name__ == "__main__":
    main()
