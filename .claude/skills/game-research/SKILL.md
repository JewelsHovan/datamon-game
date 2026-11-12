---
name: game-research
description: Daily research loop for Compass: Cardinal Clash. Picks the next angles from docs/research/agenda.md, researches what great fighting games do there, checks the findings against docs/game-design.md, and ranks proposed additions in docs/research/additions.md. Use for "game research", "run the daily research", "what should we add to the game", "research additions for the game", or one focused angle ("/game-research assists"). For one-off research on another topic, use research; to turn an addition into a spec, use spec-create.
argument-hint: "[angle] [--daily]"
---

# game-research

Goal: each run takes the game's research one step deeper and leaves the ranked list of additions more trustworthy than it found it. A run that finds nothing new says so. It never pads the list.

## Files

Everything lives in `docs/research/`. This skill writes nowhere else.

| File | Role |
|---|---|
| `foundations.md` | The base report: five-layer model, design checklist, sources. Reference; don't rewrite it. |
| `agenda.md` | The research queue: angles, the roadmap step each serves, last-run date, status. |
| `additions.md` | Ranked backlog of proposed additions with scores, evidence and status. Its Top 10 table is what the user reads. |
| `daily/YYYY-MM-DD.md` | One note per run: angles, findings with sources, additions proposed or updated. |

Layouts for all three are in [formats.md](formats.md). Follow them so runs stay comparable.

## Modes

- `--daily` (launchd): unattended. Never ask a question. On a real blocker, write it in the daily note and finish with a `STATUS: blocked` line.
- No arguments: the same run in an interactive session; report in chat.
- `<angle>`: research that angle instead of picking from the agenda. Still log it in the agenda and the daily note.

If today's daily note already exists, append a `## Run 2` section; never overwrite it.

## Steps

1. **Ground.** Read `CLAUDE.md`, `docs/game-design.md`, `specs/README.md`, `additions.md`, `agenda.md` and the last 3 daily notes. Work out the **next build target**: the first roadmap step in `game-design.md` that has no spec with status done. Also note anything the design or a spec now covers that `additions.md` still lists as proposed; mark it `covered`, citing where.
2. **Pick two angles.**
   - **A:** the open angle that serves the next build target. If there is none, take the open angle with the oldest last-run date; never-run angles go first.
   - **B:** the news-scan angle if it last ran 7+ days ago, otherwise the next angle by the same rule.
   - Skip angles that ran in the last 14 days, unless the user named one.
3. **Research each angle** with about 6 to 12 searches and fetches, reading the best 2 to 4 pages in full.
   - Prefer primary sources: developer talks and postmortems, designer writing, frame-data wikis, patch notes, measured data.
   - Check `foundations.md` and the earlier daily notes first, so the run covers new ground instead of re-reading known sources.
   - Tag every claim `[primary]` (page read) or `[secondary]` (summary or snippet).
   - Never invent a number, quote or URL. Write "not found" instead.
4. **Turn findings into candidate additions for this game.**
   - A candidate is concrete enough to spec: what the player sees or feels, which roadmap step it belongs to, and a rough cost.
   - Check it against the constraints in `game-design.md`: local 2P plus CPU with no networking; direction+button specials with no motions; procedural animation built from walk sheets; a 384x216 Canvas 2D view; a deterministic 60 Hz sim; 37 real colleagues, portrayed kindly.
   - Drop what conflicts with those constraints. If an idea is strong enough to justify bending them, label it `design change`.
5. **Dedupe and score.**
   - Match candidates against `additions.md` by meaning, not by title.
   - A match gets the new evidence and a fresh score, never a duplicate entry.
   - Never re-propose a `rejected` addition unless the new evidence is clearly stronger, and say why.
   - Score with the rubric below.
6. **Verify the top 3.**
   - Any addition in the top 3 whose load-bearing claim is `[secondary]` or unsourced gets one primary read to check it. Seed items count too.
   - If the check fails, mark it `unverified` in the Top 10 table and say so in the note.
7. **Write, in this order**, so a run cut short by its budget still leaves its findings:
   1. The daily note.
   2. `additions.md`: rescore, re-rank, refresh the Top 10 and the `Updated:` date.
   3. `agenda.md`: set today's date on the angles run. Add up to 3 new angles the research surfaced, each tied to a roadmap step or marked cross-cutting. Keep at most 25 open angles by parking the stalest.
8. **Report** in under 10 lines: the angles, new and updated additions, today's #1 and why.
   - In `--daily` mode, the last line must be exactly one of:
     `STATUS: ok | angles: <angle A>; <angle B> | new: <n> | updated: <n> | top: <A-id> <title>`
     `STATUS: blocked | <reason>`

## Scoring rubric

- **Impact (1-5):** how much it improves a match, or the reason to play, for this game's players: Compass colleagues on a couch, mostly newcomers to fighting games.
- **Fit (1-5):** how well it fits the design and its constraints. 1 means it needs a design change.
- **Ease (1-5):** 5 is a table or data change, 3 is about one spec, 1 is several specs or a new system.
- **Score** = 2 x Impact + Fit + Ease (max 20).
- **Ties:** `[primary]` evidence first, then the one that serves the next build target.

## Rules

- Write only under `docs/research/`.
- Never edit `game-design.md`, `specs/`, `src/` or `CLAUDE.md`, and never commit. Adopting an addition is the user's call: they write a spec with `/spec-create` or edit the design doc.
- Statuses this skill sets: `proposed`, `covered` (the design or a spec now has it), `parked`. Only the user sets `adopted` and `rejected`.
- Flavor ideas follow the design doc: riff on the work, never on the people.
- Keep a daily note under about 150 lines. Findings without sources don't go in.

## Schedule

- Runs daily at 07:37 through launchd: `~/Library/LaunchAgents/com.compass.datamon-research.plist` starts `~/bin/datamon-research`.
- That wrapper runs `claude -p` with a prompt that points at this file in `--daily` mode. `--restricted` does not load project skills, so the slash command would not resolve. It runs with these limits:
  - a budget cap;
  - `--restricted`: no user settings, no shell;
  - no MCP servers;
  - tools limited to reading, web search and fetch, and edits under `docs/research/`.
  - In that mode, use Read, Glob and Grep; Bash is not available.
- Logs, and the last status line, are in `~/Library/Logs/datamon-research/`.
- Pause: `launchctl bootout gui/$(id -u)/com.compass.datamon-research`.
- Run once now: `launchctl kickstart gui/$(id -u)/com.compass.datamon-research`.
