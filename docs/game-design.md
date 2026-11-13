# Game design: Compass: Cardinal Clash

A 2D pixel-art 1v1 fighting game where Compass people fight, and summon battlemon creatures for their supers. Quality bar: the animation is the star.

This is the durable reference for decisions. Specs link here instead of repeating them; when a decision changes, change it here first. Decisions the user can still change are mirrored on the project HQ page (see `CLAUDE.md`).

## Decisions

### Round 1 interview (2026-11-12)

| Topic | Choice | What it means |
|---|---|---|
| Players | Local 2P + vs CPU | Two players on one keyboard or two gamepads, a CPU opponent, and a short arcade ladder. No networking. |
| Combat | Classic 1v1, simple inputs | Health bars, best of 3 rounds, round timer. Light, heavy and special buttons plus block. Chain combos. Specials are direction+button, no quarter-circle motions. Super meter. |
| Battlemons | Assist summons | Each fighter has a signature battlemon. The super summons it using its real battle frames; its domain decides what the summon does. |
| Flavor | Compass in-jokes | Move names, announcer lines and win quotes riff on data and AI work. Friendly, and never about the person themselves. |
| Animation | Superseded by round 2 | Was: procedural poses from walk frames. |
| Look | Superseded by round 2 | Was: 384x216 with 84px fighters. |
| Roster | Partly superseded by round 2 | All 37 people stay playable eventually, each with one of 5 archetypes; the order of work changed. |
| Stages | Superseded by round 2 | Was: stages drawn in code. |

### Round 2 interview (2026-11-12, after the image-gen spike)

The spike generated a pose grid and a 6-frame punch for Julien with `gpt-image-2.5-sunburst`, using his walk sheet as the reference. Identity, clothes and proportions held across every frame, and the punch reads as real animation at game timing (`art/spike/punch-preview.gif`). That changed the plan:

| Topic | Choice | What it means |
|---|---|---|
| Animation | Image-generated frames | Every fighter animation is a strip of key frames made with image generation and cleaned up by our pipeline. Code adds the feel on top: holds, hit-stop, shake, flashes, smears, particles. |
| Fighter size | 640x360, fighters about 140px | Internal resolution 640x360, fighting stance about 140px tall. Faces stay readable, and the art snaps to a clean pixel grid. |
| Roster | 4 launch fighters, full sets | Julien H., Felicia G., Pentcho T. and Alex A. get complete animation sets first (picked for visual variety; swap on the HQ page). The other 33 follow in batches once the pipeline is proven. |
| Animation set | Core set, 17 clips | Listed under "Core animation set" below. |
| Stages and effects | Generated | Painted pixel stages split into parallax layers, and effect animations (hit and block sparks, dust, slash trails, super flash). |

### Round 3 interview (2026-11-12, after playing the MVP)

| Topic | Choice | What it means |
|---|---|---|
| Buttons | Punch / Kick / Special | Punch = jab, forward+Punch = heavy punch; Kick = snap kick, forward+Kick = roundhouse (knockdown); down+either = low sweep; in the air either = air kick; Punch+Kick = throw; Special = the fighter's signature special. Replaces Light / Heavy / Special. |
| Keyboard layout | Home row split | P1 W A S D + F (punch) G (kick) H (special). P2 arrows + L (punch) ; (kick) ' (special). An in-game controls screen rebinds keys and shows which keys register at once, so two players can check their keyboard. |
| Roster | 4 fighters with their own specials | Felicia, Pentcho and Alex get full animation sets. Each launch fighter gets an archetype and a signature special with its own animation and effect. The other 33 appear on the select screen as "coming soon". |
| Polish | Smoother moves, more moves and reactions, sound and music, living stage and menus | Clip set v2 (more frames per attack, new reaction clips), chiptune audio, a painted stage with parallax and walkers, an animated select screen and a versus splash. |

### Launch fighters (proposed; change on the HQ page)

| Fighter | Archetype | Signature special | Effect |
|---|---|---|---|
| Julien H. | All-rounder | Data Orb: a straight projectile | orb, orb_burst |
| Felicia G. | Trickster | Context Switch: dissolves into data pixels and reappears behind the opponent with a kick | teleport_out, teleport_in |
| Pentcho T. | Bruiser | Hotfix Charge: armored shoulder charge that absorbs one hit and knocks down | charge_streaks |
| Alex A. | Rusher | Rapid Deploy: dashing three-punch flurry ending in an uppercut | rush_streaks |

Stats per archetype (health, walk speed, damage scale) live in one data table; the all-rounder is the baseline.

### Game title (2026-11-12, HQ page)

| Topic | Choice | What it means |
|---|---|---|
| Title | Compass: Cardinal Clash | Replaces the working title "Datamon: Merge Conflict". The title screen shows COMPASS large with CARDINAL CLASH as the subtitle; the browser tab and the HQ page use the full name. The in-fight "MERGE CONFLICT!" callout on a trade stays (an in-joke, not the title). The repo and the site URL keep the datamon-game name for now. |

### Defaults (set while writing specs)

- **Stack:** Vite + TypeScript + Canvas 2D, no game engine. Vitest for game tests, pytest (through uv) for the Python art pipeline. npm.
- **Controls (one data table, easy to change):**

  | | Move | Punch | Kick | Special |
  |---|---|---|---|---|
  | P1 | W A S D | F | G | H |
  | P2 | Arrow keys | L | ; | ' |

  (Round 3; was Light/Heavy with P2 on , . /.) Gamepads through the Gamepad API (d-pad or left stick; A punch, B kick, X or Y special), assigned to a player on their first button press. Enter confirms or starts, Esc pauses. All keys are rebindable on the controls screen.
- **Super:** heavy + special together with a full meter (open on the HQ page).
- **Match rules:** best of 3 rounds, 99-second rounds (open on the HQ page), 1000 health. On time-out, more health wins the round.
- **Image model:** OpenAI `gpt-image-2.5-sunburst` with reference images and transparent backgrounds, called through the image-compass plugin's `generate_openai.py`. Gemini is out for now (its prepaid credits ran out during the spike).

## Game loop architecture

"Strong logic on the game loop" is a core requirement. These rules apply to every spec.

1. **Fixed 60 Hz simulation, decoupled from rendering.** An accumulator runs as many fixed steps as real time requires, capped at 5 per animation frame so a stall never turns into a fast-forward burst. The renderer draws the latest sim state with no interpolation, so what you see is exactly frame N, as in arcade fighters.
2. **Deterministic sim.** The sim state is plain, serializable data. Positions and velocities are integers in subpixel units (100 per pixel). The sim never reads the clock, the DOM, `Math.random`, or transcendental `Math` functions; randomness comes from a seeded PRNG stored in the state. The same starting state and inputs always produce the same state hash. Determinism gives us replays, headless tests and, later, rollback.
3. **Inputs are the only outside influence.** Devices are sampled once per sim step into a per-player bitmask. The sim keeps a short input history (at least 30 frames) for press detection and buffering. Directions become forward and back relative to facing inside the sim. Simultaneous opposite directions (SOCD) resolve to neutral.
4. **Explicit fighter state machine.** Each fighter is in one named state at a time (idle, walk, crouch, jumpsquat, airborne, landing, attack, hitstun, blockstun, knockdown, getup, ko), and every transition lives in one place.
5. **Frame data is data.** Moves are tables: startup, active and recovery frames, hitboxes and hurtboxes per frame, damage, stun, pushback, cancel windows, plus which animation clip frame shows on each tick and the effect cues. Tuning a move never means editing control flow.
6. **Fixed order of operations each step:** read inputs, then advance state machines, then apply movement and gravity, then resolve pushboxes and walls, then detect hits for both fighters at once (so trades happen), then apply hits (damage, hit-stop, stun), then advance round timers and round state, then emit events.
7. **One-way flow to presentation.** The sim emits events (hit, block, whiff, ko, round-start). The renderer, effects and audio consume state and events and never write back. Hit-stop freezes the fighters in the sim; effects and screen shake keep animating on render time.
8. **Layers:** `src/sim` (pure, no DOM), `src/engine` (real-time loop and clock), `src/input` (devices to bitmasks), `src/render`, `src/audio`, `src/scenes`, `src/data`. `src/sim` imports only from `src/sim` and pure data in `src/data`. The art pipeline lives in `art/` and never imports game code.
9. **Rendering is a function of sim state.** Which clip and frame a fighter shows comes from counters in the sim state. Only cosmetic extras (particles, shake, flashes) keep their own render-time clocks.

## Rendering

- 640x360 offscreen canvas, scaled by the largest integer that fits the window (letterboxed; fractional scaling only when the window is smaller than 640x360), `imageSmoothingEnabled = false`.
- **Fighters are drawn from animation clips** (format below). Until a fighter has generated clips, a placeholder clip set is built from their walk sheet.
- **Walk sheets** (`public/datamon/walk/<slug>.webp`): 4 rows (down, up, left, right) of 4 frames. Cell width varies per person (99 to 130px) and cell height is 240; always read `cellW` and `cellH` from the catalog. Per-frame metrics are `[frameWidth, bodyX, footY]`, anchored at feet-center. Side views use rows 2 (facing left) and 3 (facing right), with column 2 as the standing frame (`STANDING_WALK_FRAME`). A standing person is drawn about 150px tall at 640x360 (source footY 228 maps to 150).
- **Battlemon sheets:** 6 cells of 128x128 in a row (idle frames, wind-up, attack, hurt, faint; confirm which cell is which when building supers). Anchor metrics: `bodyX`, `footY`, `visH`.

### Animation clip format (binding for specs 001 and 002)

Each fighter ships `public/fighters/<slug>/manifest.json` and the atlas it names, `public/fighters/<slug>/atlas.webp` (lossless WebP since spec 013; the PNG master stays at `art/fighters/<slug>/atlas.png` for review). `public/fighters/index.json` lists every fighter with a manifest; the game reads it once to know who is playable instead of probing a manifest per person.

```json
{
  "fighter": "julien-hovan",
  "atlas": "atlas.webp",
  "version": 1,
  "scale": 0.27,
  "facing": "right",
  "originX": 38,
  "clips": {
    "heavy_punch": {
      "loop": false,
      "frames": [
        { "x": 0, "y": 0, "w": 96, "h": 142, "ax": 30, "ay": 141, "hold": 4 }
      ]
    }
  }
}
```

- `atlas`: the atlas file next to the manifest. The game requests it as `atlas.webp?v=<version>`, so a new manifest never pairs with an older cached atlas (art is cached for up to an hour, `public/_headers`). The effects atlas (`public/effects/`) and the stage (`public/stages/<id>/manifest.json`: layer files and the background walkers' strip, cast and frames) follow the same rule.
- `x, y, w, h`: the frame's rectangle in the atlas. `ax, ay`: the anchor inside that rectangle, the point that sits on the fighter's position: the body center on the floor, matching the pushbox. The pipeline anchors frames on the back foot (stable across poses) and the packer shifts every anchor by the idle stance's body-center offset (`originX`). `hold`: default ticks at 60 Hz; move frame data may override holds.
- Art faces right. Facing left is drawn mirrored around the anchor.
- `scale` records the factor applied to the generated art, for provenance only; the game draws atlas pixels 1:1 at 640x360.

## Animation pipeline

Lives in `art/`, Python through uv. Generation is the only step that costs money; everything after it is deterministic and re-runnable.

1. **Generate.** One clip per image: a horizontal strip of N frames, facing right, transparent background. Prompt = a shared style block (same character as the references, side view facing right, identical scale, feet on one baseline, no text, no floor) + the clip's per-frame pose lines. References: the fighter's walk-sheet front and side frames (2x nearest), plus the fighter's approved idle frame once it exists, so every clip shares one fighting stance. Size by frame count: 3072x1024 for 5 to 8 frames, 2048x1024 for up to 4. Raw output goes to `art/raw/` (gitignored); every call is logged to `art/generation-log.jsonl`.
2. **Cut.** Alpha below 128 is dropped (the model adds a faint glow halo; body pixels sit at alpha 250 to 254). Connected components become frames; small detached pieces join the nearest figure. Frames order left to right. The frame count must match the clip definition, or processing stops with a report.
3. **Normalize.** One scale per fighter, chosen so the approved idle stance is 140px tall. Area-average downsample, hard alpha. Colors are locked to the fighter's palette (at most 48 colors, built from the walk sheet plus the approved idle) to remove the model's color drift between frames.
4. **Anchor.** Auto anchor: floor = lowest opaque row; x = the back foot's rear edge (leftmost opaque pixel in the bottom rows, since art faces right). Per-frame overrides live in `art/fighters/<slug>/anchors.json`.
5. **Review.** A preview page plays each clip at 60 Hz with its holds, steps frame by frame, shows onion skin, the floor line and the anchor, mirrors for facing left, and saves anchor nudges. Clip previews also go to the HQ "Animation lab" for the user to approve or reject.
6. **Pack.** Approved clips are packed into the fighter's atlas and manifest (format above).

Spike evidence: raw images in `.claude-images/2026-11-12/`, the cut-and-anchor prototype in `art/spike/preview_anim.py`.

### Core animation set (17 clips per fighter)

| Clip | Frames | Loop | Poses |
|---|---|---|---|
| idle | 4 | yes | Fighting stance breathing cycle, fists up. Generated first; becomes a reference for all others. |
| walk | 6 | yes | Fighting-stance shuffle step forward. Walking back plays it in reverse. |
| crouch | 2 | no | Dropping into a crouch, then the crouched guard. |
| jump | 4 | no | Takeoff, rising tuck, apex, falling with legs extended. |
| light_punch | 4 | no | Guard, quick jab extended, retract, guard. |
| heavy_punch | 6 | no | Stance, wind-up, travel, impact, follow-through, recover (the spike clip). |
| light_kick | 4 | no | Lift knee, snap kick extended, retract, stance. |
| heavy_kick | 6 | no | Turn, chamber, roundhouse travel, impact, follow-through, recover. |
| crouch_attack | 4 | no | Crouched, low sweep or low punch extending, impact, recover. |
| air_attack | 3 | no | Airborne tuck, kick extended downward-forward, retract. |
| block | 2 | no | Standing guard with forearms up; crouching guard. |
| hurt | 3 | no | Head snapped back (high hit), doubled over (body hit), recovering. |
| knockdown | 6 | no | Launched backward, airborne, hitting the floor, lying, getting up, back to stance. The K.O. uses frames 1 to 4. |
| throw | 5 | no | Reach and grab, pull in, turn, toss forward, recover. |
| special | 6 | no | Archetype special (all-rounder: energy projectile wind-up and release). |
| summon | 4 | no | Calling the battlemon: hand raised, glowing, gesture forward, hold. |
| victory | 4 | yes | Celebration loop. |

## Archetypes

| Archetype | Plays like | Specials (direction + special) |
|---|---|---|
| All-rounder | Balanced speed and damage | Projectile, rising anti-air, advancing strike |
| Rusher | Fast walk and dash, short range, weaker hits | Dash punch, overhead hop, command grab |
| Bruiser | Slow and heavy, more health, armored moves | Armored charge, ground slam, counter |
| Zoner | Keeps distance, weak up close | Fast projectile, slow projectile, trap |
| Trickster | Mobility and mix-ups | Teleport, feint, crossup dive |

How the 37 people get archetypes is open on the HQ page.

## Battlemon domains (super behavior)

| Domain | Summon behavior |
|---|---|
| AGENT | Autonomous chaser: runs the opponent down, multi-hit. |
| CONFIG | Trap field: drops a zone that slows the opponent. |
| CONTEXT | Wide beam across the screen. |
| MCP | Barrage of tool-call projectiles. |
| PROMPT | Buff or debuff: power up the user, scramble the opponent's next inputs briefly. |

## Flavor guidelines

- Riff on the work, not the people: "Schema Slam", "Context Overflow", "Hotfix Uppercut", "Rogue Subagent", "MERGE CONFLICT!" on a trade, "PROD IS DOWN" on a K.O.
- No jokes about anyone's looks, background or job performance. Keep win quotes interchangeable between people.

## Cost

Generation is billed per image. Estimate: 17 clips plus retries is about 20 to 25 images per fighter, roughly $5 to $15 (the exact rate for this model is not confirmed). The generator takes `--max-images` and logs every call, so real spend can be counted from `art/generation-log.jsonl`.

## Roadmap

Each line is one spec, roughly one session. Done or in review: 001 engine, 002 animation pipeline, 003 combat, 004 effects.

5. **Controls and match flow** (`specs/005-controls-and-match-flow.md`): Punch / Kick / Special, the home-row layout, a controls screen with rebinding and a key test, gamepad join, title, character select (4 playable, 33 coming soon), versus splash, results, rematch, pause.
6. **Launch roster and signature specials** (`specs/006-launch-roster.md`): Felicia, Pentcho and Alex animated with clip set v2; archetype stats; the four signature specials with their effects.
7. **Battlemon supers:** super meter rules and the five domain summons.
8. **CPU opponent and arcade ladder.**
9. **Living stage and menus** (`specs/009-living-stage.md`): a generated Compass stage split into parallax layers, coworkers walking in the background, an animated select screen and versus splash.
10. **Audio** (`specs/010-audio.md`): WebAudio chiptune sound effects, stingers and a music loop.
11. **Roster batches:** the other 33 people, in batches through the proven pipeline.
12. **Animation v2** (`specs/012-animation-v2.md`): smoother attacks (more frames) and new moves and reactions (dashes, crouching and air hurt, wall bounce, intro, taunt, get-up roll, block push) for all four launch fighters.
