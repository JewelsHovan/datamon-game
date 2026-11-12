# CLAUDE.md

A small, fun browser game built from the Datamon assets: Compass people and "battlemon" creatures.

## Status

Fresh repo. No game code or stack yet; the first spec decides the game and the stack (Vite by default for the frontend).

## Assets

- `public/datamon/portraits/<slug>.webp`: 37 people portraits.
- `public/datamon/walk/<slug>.webp`: 4-direction walk sheets for the same 37 people (down, up, left, right; 4 frames each).
- `public/datamon/battlemons/<slug>.webp` and `battlemons/icons/<slug>.webp`: 35 creatures, 7 in each of 5 domains (AGENT, CONFIG, CONTEXT, MCP, PROMPT).
- `src/data/datamonCatalog.js`: registry with names, colors, sprite cell sizes and per-frame metrics. Asset URLs are relative (`./datamon/...`), so they resolve when `public/` is served at the root. Ids 0..5 are leftover voxel skins from the project the assets came from (`../minecraft-clone`) and can be ignored.

People are real colleagues: keep their portrayal friendly.

## Workflow

Spec-driven. Specs live in `specs/` (see `specs/README.md`).

- `/spec-create <idea>`: write a spec with testable acceptance criteria.
- `/spec-tackle [N]`: implement a ready spec and prove its criteria.
- `/spec-review [N]`: verify independently, then mark done or send back.
