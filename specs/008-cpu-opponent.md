# 008: CPU opponent with three difficulty levels

Status: review
Created: 2026-11-12

## Goal
One player can practice against a CPU that plays like a person at three skill levels: Easy is a sparring partner that forgets to block, Normal fights back and punishes mistakes, Hard blocks on reaction, anti-airs jumps and turns light hits into combos.

## Context
The user asked for a CPU to practice against, with 3 difficulty levels (2026-11-12, during the round 3 work). The sim takes one input bitmask per player per step (`src/sim/step.ts`) and stays deterministic (`docs/game-design.md`, "Game loop architecture"). Spec 005 adds the "VS CPU" mode, a difficulty choice and a `?cpu=easy|normal|hard` URL shortcut, and calls `createCpu(level, player, seed).decide(state)` from `src/ai/cpu.ts` for the CPU's input each step. Buttons follow the round 3 scheme (Punch / Kick / Special).

## Requirements
- R1. The CPU only presses buttons: `decide(state)` returns an input bitmask built from the same buttons a player has (no direct state changes), so every rule of the sim applies to it.
- R2. It reacts like a person: it sees the opponent through a delay (reaction time) and decides from that delayed view; its own state is current. Its randomness comes from its own seeded generator, so a CPU match is reproducible from the match seed.
- R3. Behaviors: spacing and walking (approach, keep distance, back off after a knockdown), blocking at the right height against attacks in range, anti-airs against jump-ins, hit-confirm combos (light hit into heavy or special), throws against a blocking opponent up close, the special at range (zoning), jumping over or blocking projectiles, getting up and pressing buttons again. Easy also makes deliberate mistakes.
- R4. Three levels from one parameter table (`src/ai/levels.ts`): reaction time, block chance and correct-height chance, anti-air chance, combo chance, throw chance, special use, aggression, and a mistake rate. Easy: about 22 frames reaction, rarely blocks; Normal: about 12 frames, blocks half the time; Hard: about 6 frames, blocks most attacks at the right height.
- R5. Works for any fighter (uses the generic Special input; fighter-specific tactics later).

## Acceptance criteria
- [x] A1. (R1, R2) Vitest: two CPUs with the same seed fed the same states return the same inputs; `decide` never mutates the state it is given.
- [x] A2. (R3, R4) Vitest against a scripted attacker that throws light punches up close: Hard blocks at least 70% of them, Normal 30 to 70%, Easy at most 30%.
- [x] A3. (R3, R4) Vitest against a scripted jumper: Hard anti-airs (hits the jumper before landing) at least 50% of the jumps, Easy at most 20%.
- [x] A4. (R3, R4) Vitest: each level fights a passive dummy and wins the match; Hard wins faster than Easy (fewer frames).
- [x] A5. (R3) Vitest: Hard vs Hard and Easy vs Hard CPU matches run to a match end without errors or stuck states (no fighter non-actionable for more than 300 frames), and Hard beats Easy in most of 5 seeded matches.
- [x] A6. In the browser, `?cpu=hard` starts a fight where the CPU visibly walks, blocks and attacks (screenshots in `specs/evidence/008/`).

## Out of scope
- Fighter-specific CPU tactics for each signature special; arcade ladder (later); a learning AI.

## Decisions
- The CPU reads the opponent's move id once it shows on screen (after its reaction delay), as a player reads an animation.
- Plans are short input scripts (press, hold, release) so button presses produce real press edges.

## Open questions
- None.

## Tasks
- [x] T1. `src/ai/levels.ts` (parameter table) and `src/ai/cpu.ts` (controller: delayed view, seeded RNG, plans, behaviors), matching the interface spec 005 uses.
- [x] T2. Vitest suite for A1 to A5 (after spec 005 merges, since the button mapping changes).
- [x] T3. Browser evidence.

## Implementation notes
2026-11-12, lead session.

- `src/ai/levels.ts` holds the parameter table (reaction delay, block, anti-air, tech, throw, combo, special, jump-in, aggression, mistakes, gaps between actions); `src/ai/cpu.ts` is the controller: it sees the opponent through a delayed view, draws from its own mulberry32 RNG (seeded, so a match replays exactly), runs short input plans, guards by anticipation in jab range (no one reacts to a 3-frame jab) and answers threats it can see in time. Pure: `decide` reads the state and never writes it.
- Spec 006 specials: the CPU knows each move's reach (`REACH`), uses the projectile and the teleport from long range and the charge and rush from mid range, does not guard a teleport before it reappears, and blocks the charge and rush like other attacks.
- A1-A5: `src/ai/cpu.test.ts`, 7 tests (determinism and no mutation; close jabs blocked: Hard at least 70%, Normal 30-70%, Easy at most 30%; anti-air: Hard at least half the jump-ins, Easy at most 20%; each level beats a passive dummy, Hard faster than Easy; Hard vs Hard ends with no fighter stuck over 300 frames; Hard beats Easy in at least 3 of 5; Hard vs Hard with every launch fighter's special ends cleanly).
- A6: `specs/evidence/008/cpu-check.mjs` opens `?cpu=hard&p1=julien-hovan&p2=pentcho-tchomakov` and screenshots the CPU walking in, blocking a jab and attacking (a Hotfix Charge in this run). ALL PASS, no console errors. The VS CPU path from the title (select, CPU level) is covered by spec 005's flow check.

## Review
(filled by spec-review)
