# CLAUDE.md

A 2D pixel-art 1v1 fighting game (working title "Datamon: Merge Conflict") built from the Datamon assets: Compass people fight and summon "battlemon" creatures for supers.

## Status

Designed, not built yet. `docs/game-design.md` holds every design decision, the binding game loop architecture rules, and the spec roadmap. Read it before writing or tackling a spec.

Stack: Vite + TypeScript + Canvas 2D (no engine), Vitest, npm. `src/sim` is a pure, deterministic 60 Hz simulation and must stay free of DOM, clock and `Math.random`.

## Assets

- `public/datamon/portraits/<slug>.webp`: 37 people portraits.
- `public/datamon/walk/<slug>.webp`: 4-direction walk sheets for the same 37 people (down, up, left, right; 4 frames each).
- `public/datamon/battlemons/<slug>.webp` and `battlemons/icons/<slug>.webp`: 35 creatures, 7 in each of 5 domains (AGENT, CONFIG, CONTEXT, MCP, PROMPT).
- `src/data/datamonCatalog.js`: registry with names, colors, sprite cell sizes and per-frame metrics. Asset URLs are relative (`./datamon/...`), so they resolve when `public/` is served at the root. Ids 0..5 are leftover voxel skins from the project the assets came from (`../minecraft-clone`) and can be ignored.

People are real colleagues: keep their portrayal friendly.

## Project HQ

A private artifact shows progress and holds decisions the user can change: https://claude.ai/artifact/TFmTP3paD4poGDEpNrJkq6

- Its data lives in the artifact's database (ArtifactData tool, that URL): `hub/project` (`phase`, `nextAction`, `nextHint`), `hub/log` (`entries`, newest first, keep at most 30), `specs/<NNN>` (`status`, `criteria` and `tasks` as `{done, total}`, `file`; `planned` means not written yet), `decisions/<id>` (`options`, `choice`, `appliedChoice`, `state`, `note`).
- **Keep it current.** Whenever a spec is created or changes status, update its `specs/<NNN>` doc, the `hub/project` phase and next action, and prepend a `hub/log` entry. Pin writes with `if_version`.
- **Apply the user's picks.** At the start of a session, or when the user says "apply my HQ decisions", list `decisions` whose `state` is `decided` or `changed`. Fold each choice (and its `note`) into `docs/game-design.md` and any affected spec, then set `appliedChoice` to the choice and `state` to `applied`. Tell the user what changed.
- The page itself is `hq/template.html`. Rebuild with `uv run --with pillow python -I hq/build_hq.py` (writes the gitignored `hq/index.html`), then republish with the Artifact tool passing the URL above. Layout changes only; data never goes in the page source.

## Workflow

Spec-driven. Specs live in `specs/` (see `specs/README.md`).

- `/spec-create <idea>`: write a spec with testable acceptance criteria.
- `/spec-tackle [N]`: implement a ready spec and prove its criteria.
- `/spec-review [N]`: verify independently, then mark done or send back.
