"""Re-export the shipped art from its PNG masters (spec 013, R1, R2). No generation, no repacking.

Usage:  uv run --with pillow --with numpy python -I art/pipeline/ship.py

- Fighters: art/fighters/SLUG/atlas.png -> public/fighters/SLUG/atlas.webp, and the manifest names it
  (atlas-alt.png -> atlas-alt.webp too, P2's mirror-match colors from palette_alt.py);
  public/fighters/index.json lists every fighter with a manifest (the game's playable roster).
- Effects: art/effects/atlas.png -> public/effects/atlas.webp, and the manifest names it.
- Stages: every layer master and the walker strip (stage.py manifest).
Fighter and effect manifest versions are kept (the pixels the game sees do not change); the stage
manifest's version moves only when its content does. pack.py, effects.py and stage.py write the
same files when art is (re)packed; this is for re-exporting without repacking. Re-running it is a no-op.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import stage  # noqa: E402


def with_atlas(manifest: dict) -> dict:
    """The manifest with "atlas" right after its first key (the fighter), other keys unchanged."""
    out: dict = {}
    for i, (key, value) in enumerate(manifest.items()):
        if key == "atlas":
            continue
        out[key] = value
        if i == 0:
            out["atlas"] = common.ATLAS_FILE
    return out


def ship_atlas(master: Path, public_dir: Path) -> None:
    mp = public_dir / "manifest.json"
    common.save_webp(Image.open(master), public_dir / common.ATLAS_FILE)
    (public_dir / common.MASTER_ATLAS).unlink(missing_ok=True)  # only the WebP ships
    mp.write_text(json.dumps(with_atlas(json.loads(mp.read_text())), indent=1) + "\n")
    kb = lambda p: round(p.stat().st_size / 1024)  # noqa: E731
    print(f"{public_dir.relative_to(common.ROOT)}: {kb(master)} KB PNG -> {kb(public_dir / common.ATLAS_FILE)} KB WebP")


def main() -> int:
    for fdir in sorted(common.FIGHTERS.iterdir()):
        master = fdir / common.MASTER_ATLAS
        public_dir = common.PUBLIC_FIGHTERS / fdir.name
        if master.exists() and (public_dir / "manifest.json").exists():
            ship_atlas(master, public_dir)
            alt = fdir / "atlas-alt.png"  # P2's mirror-match colors (palette_alt.py)
            if alt.exists():
                common.save_webp(Image.open(alt), public_dir / "atlas-alt.webp")
    print(common.write_fighter_index().relative_to(common.ROOT))
    if (common.EFFECTS / common.MASTER_ATLAS).exists():
        ship_atlas(common.EFFECTS / common.MASTER_ATLAS, common.PUBLIC_EFFECTS)
    for sid in stage.load()["stages"]:
        if (stage.MASTERS / sid).exists():
            stage.cmd_manifest(sid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
