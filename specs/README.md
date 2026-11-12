# Specs

Spec-driven workflow: `/spec-create` writes a spec, `/spec-tackle` builds it, `/spec-review` verifies it.

Lifecycle: `draft` → `ready` → `in-progress` → `review` → `done` (review can send it back to `in-progress`).

Files are `NNN-short-slug.md`. The skills keep this index in sync.

| # | Spec | Status |
|---|---|---|
| 001 | [Engine core: game loop, input and two fighters moving](001-engine-core.md) | review |
| 002 | [Animation pipeline and Julien's full set](002-animation-pipeline.md) | ready |
