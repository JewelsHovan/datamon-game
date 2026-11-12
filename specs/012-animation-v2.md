# 012: Animation v2: smoother moves, more moves and reactions

Status: in-progress
Created: 2026-11-12

## Goal
Every attack flows from wind-up through follow-through instead of snapping between poses, and fighters react the way a fighting-game fan expects: they dash, stagger low and high, tumble in the air, bounce off walls, roll away on get-up, push blocks away, enter with an intro and taunt.

## Context
Round 3 interview: the user liked the animations and picked every polish area. The pipeline (spec 002) generates one clip per strip with a calibration stance figure; strips can hold up to 10 frames plus the calibration figure at 3840x1280. Move timelines live in `src/data/moves.ts`, the state machine in `src/sim/fighter.ts` and `src/sim/combat.ts`, clip selection in `src/render/fighterRenderer.ts`. Spec 006 generates the three new launch fighters with this clip set, so its definitions land first. Spec 005 is changing the button mapping in parallel; the sim tasks here wait for it to merge.

## Requirements
- R1. Clip set v2 in `art/clips.json`: 26 clips. Smoother: jump 6, light_punch 6, heavy_punch 8, light_kick 6, heavy_kick 9, crouch_attack 6, air_attack 5, throw 7, hurt 4, knockdown 8, crouch 3, victory 6 frames. New: walk_back 6, dash_forward 5, dash_back 5, block_push 3, crouch_hurt 3, air_hurt 4, getup_roll 6, intro 6, taunt 6. Kept: idle 4, walk 6, block 2, summon 4. special stays per fighter (spec 006).
- R2. The generator handles up to 11 figures per strip (3840x1280 for 9 or more).
- R3. Julien regenerated for every new or longer clip; idle, walk, block and summon kept.
- R4. Frame data re-timed for the longer clips with the same feel (startup, active and recovery within 1 to 2 frames of today unless noted).
- R5. New mechanics, each using its clip: dash forward and back on a double-tap within 10 frames (the back dash is invulnerable for its first 6 frames); walking back uses walk_back; crouching hits use crouch_hurt; airborne hits launch into air_hurt with up to 2 juggle hits before the fall; a knockdown that reaches a wall in its first frames bounces off it (wall_bounce event, one per combo); holding back while lying rolls backward on get-up (getup_roll); Punch+Kick during blockstun pushes the attacker away (block_push, 12 frames); round 1 intro plays both fighters' intro clips; down+Special taunts (vulnerable); the round winner taunts before the victory pose on non-final rounds.
- R6. Effects for the new moments: dust on dashes, a wall-hit burst, a small swoosh on block push (reuse existing effects where they read well).

## Acceptance criteria
- [x] A1. (R1, R2) pytest: `art/clips.json` matches the R1 table; the generator's dry run for heavy_kick uses 3840x1280 and lists 10 figures.
- [x] A2. (R3) All 22 regenerated Julien clips pass the frame-by-frame review (same person, limbs, facing, planted feet, readable motion at game timing), approved, packed; GIFs in the HQ Animation lab.
- [ ] A3. (R4) Vitest: startup and total of every move within 2 frames of the spec 003 values, unless the spec notes a change.
- [ ] A4. (R5) Vitest for each mechanic: double-tap dash and its distance; back dash invulnerability; crouching hit uses crouch_hurt; an air hit allows exactly 2 juggle hits; wall bounce once per combo; get-up roll moves back; block push separates the fighters; taunt is punishable; determinism hash test still matches.
- [ ] A5. (R5, R6) Browser screenshots in `specs/evidence/012/` of a dash, an air juggle, a wall bounce, a get-up roll, a block push, the intro and a taunt.

## Out of scope
- New fighters and their specials (spec 006), battlemon summons (spec 007), audio (spec 010).

## Decisions
- One clip per strip is kept; longer clips use the wider 3840x1280 canvas rather than two strips, so the model keeps one consistent drawing of the motion.
- Juggle limit and wall bounce count live in `src/data/combat.ts`.
- Walk speed is matched to the art so feet do not slide: each walk step moves the feet about 30 px per cycle, so forward walk is 1.8 px/frame over an 18-tick cycle and back walk 1.5 px/frame over 20 ticks (spec 001 had 2.7 and 2.0 with a 30-tick cycle, which slid the feet about 2.7x; the user flagged the walk in the HQ lab).

## Open questions
- None.

## Tasks
- [x] T1. Clip set v2 in `art/clips.json`, 3840x1280 support in `generate.py`, pytest.
- [x] T2. Generate, review and approve Julien's 22 clips; pack; publish GIFs to the HQ.
- [x] T3. Re-time `src/data/moves.ts`; add combat constants.
- [ ] T4. Sim mechanics (dash, walk back, crouch hurt, air hurt and juggles, wall bounce, get-up roll, block push, intro, taunt) after spec 005 merges.
- [ ] T5. Render clip selection for the new states; effects for the new moments.
- [ ] T6. Tests and browser evidence.

## Implementation notes
2026-11-12, lead session (art and re-timing; the sim mechanics T4-T6 follow once spec 005 merges).

- Clip set v2 is in `art/clips.json` (26 clips plus per-fighter specials under `specials`); `common.clip_def` resolves a fighter's own special. Strips with 9 or more figures use 3840x1280; a clip may set its own `size` (throw does: grabbing hands touched the next figure on narrower strips).
- The processor now splits up to two merged figure pairs at their thinnest column before giving up. It rescued Alex's throw and Felicia's special; Julien's and Felicia's throws split badly (a foot landed in the wrong frame) and were regenerated on 3840x1280 instead.
- crouch_hurt was regenerated for all four fighters with stricter pose lines: the first take stood about 130 px tall against an 87 px crouch.
- A1: pytest 11 passed (clip table, generator sizing for 3840x1280, per-fighter specials in prompts).
- A2: all 22 regenerated Julien clips reviewed frame by frame and approved (walk_back, dashes, 3-frame crouch, 6-frame jump, 6/8/6/9-frame attacks, 6-frame sweep, 5-frame air kick, 7-frame throw, block push, 4-frame hurt, crouch_hurt, air_hurt, 8-frame knockdown, get-up roll, intro, taunt, 6-frame victory, 8-frame special). Packed: 26 clips, 142 frames. GIFs in the HQ Animation lab.
- T3: `src/data/moves.ts` re-timed to v2 frames with the spec 003 startup/active/recovery unchanged; knockdown timeline 8 frames, still 74 ticks with impact at 16 and the K.O. hold at 24. Renderer: walk_back clip, crouch_hurt and the 4-frame hurt, jump frame 0 for the jumpsquat.
- Walk speed synced to the stride (see Decisions) after the user flagged the walk in the lab.
- Generation so far for this spec and 006: Julien 43 images in total across both rounds, the three new fighters 28-29 each, effects 11, stage 2 (141 logged).

## Review
(filled by spec-review)
