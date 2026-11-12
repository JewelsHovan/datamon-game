"""Record a clip review (spec 002, R5).

Usage:
  uv run --no-project python -I art/pipeline/review.py SLUG                     # show status table
  uv run --no-project python -I art/pipeline/review.py SLUG CLIP approve [NOTE]
  uv run --no-project python -I art/pipeline/review.py SLUG CLIP reject NOTE
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    slug = argv[0]
    common.person(slug)
    status = common.load_status(slug)
    clips = list(common.load_clips()["clips"])
    if len(argv) == 1:
        for c in clips:
            s = status.get(c, {})
            print(f"{c:14} {s.get('state', 'planned'):10} {s.get('note', '')}")
        done = sum(1 for c in clips if status.get(c, {}).get("state") == "approved")
        print(f"\n{done}/{len(clips)} approved")
        return 0
    clip, verdict = argv[1], argv[2] if len(argv) > 2 else ""
    note = " ".join(argv[3:])
    if clip not in clips or verdict not in ("approve", "reject"):
        print(__doc__)
        return 2
    if clip not in status:
        print(f"{slug}/{clip} has not been processed yet", file=sys.stderr)
        return 2
    if verdict == "reject" and not note:
        print("a rejection needs a note saying what is wrong", file=sys.stderr)
        return 2
    status[clip]["state"] = "approved" if verdict == "approve" else "rejected"
    status[clip]["note"] = note
    common.save_status(slug, status)
    print(f"{slug}/{clip}: {status[clip]['state']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
