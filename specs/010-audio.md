# 010: Audio

Status: in-progress
Created: 2026-11-12

## Goal
Hits sound heavy, menus click, rounds have stingers, and a chiptune loop drives the fight: all synthesized in the browser with WebAudio, no audio files.

## Context
Round 3 interview: sound and music are part of the polish pass. The sim emits events every step (`SimEvent` in `src/sim/types.ts`: attack, hit with strength, block, throw, knockdown, projectile, clash, ko, round_start, fight, round_end, match_end, jump, land, tech, trade). Rule 7 of the design doc: presentation consumes events and never writes back. Spec 005 is rewriting the scenes in parallel, so this spec delivers a self-contained module with a small integration surface; the lead wires it into the scenes.

## Requirements
- R1. An audio engine in `src/audio/` on WebAudio: oscillators (square, triangle, saw), a noise source, ADSR envelopes, pitch sweeps, a master gain with a compressor, separate music and effects buses. Created lazily and resumed on the first user input (browsers block audio before that).
- R2. Sound effects mapped from sim events: swings (whoosh by strength) on `attack`, hits (light and heavy differ clearly; special hits add a zap), block (a bright clank), throw grab and toss, knockdown thud, jump and land (soft), projectile launch and burst, clash, trade, K.O. (a big low hit with a falling tone), tech.
- R3. Stingers: round call ("ROUND" jingle), "FIGHT!" hit, K.O. sting, round win and match win jingles, a timer tick in the last 10 seconds. Menu sounds: move, confirm, back.
- R4. Music: a procedural chiptune sequencer with a fight loop (driving, around 150 BPM) and a calmer select-screen loop; patterns as data; music ducks briefly under the K.O. sting; tempo-accurate scheduling against the AudioContext clock (lookahead scheduler), so it does not drift or stutter when frames drop.
- R5. Controls: M mutes or unmutes everything; master, music and effects volumes saved in localStorage (guarded); a muted or failed AudioContext never breaks the game.
- R6. Integration surface: `createAudio(): GameAudio` with `onEvents(events: readonly SimEvent[])`, `ui(kind: "move" | "confirm" | "back")`, `music(track: "select" | "fight" | null)`, `resume()`, `setMuted(b)`, and `dispose()`. Do not edit `src/scenes/` or `src/main.ts`; document the 3 to 5 lines the lead adds to wire it in.

## Acceptance criteria
- [ ] A1. (R1, R2, R6) Unit tests with a fake AudioContext: every SimEvent type that should make a sound schedules at least one voice on the effects bus; light and heavy hits differ (different pitch or envelope); events with no sound (for example `round_end` handled as a stinger) are routed as specified; `onEvents` on a muted engine schedules nothing.
- [ ] A2. (R4) Unit test: the sequencer schedules notes at exact beat times for a pattern at a given BPM over 8 bars with a fake clock, and a late tick (a 300 ms gap) does not schedule notes in the past or skip bars.
- [ ] A3. (R5) Unit tests: mute toggles both buses; volumes persist through a fake storage; a throwing AudioContext constructor leaves a silent engine that never throws.
- [ ] A4. A small dev page `audio-test.html` (Vite dev only) with buttons that trigger each effect, stinger and both music loops; screenshot plus a note in Implementation notes on how each sound reads (subjective check by ear is the user's).
- [ ] A5. `npm run typecheck`, `npm test`, `npm run build` exit 0; no console errors on the audio test page.

## Out of scope
- Voice acting or sampled audio files.
- Per-fighter voice sets.

## Decisions
- Fully synthesized: no assets, tiny download, matches the 8-bit look.
- Effects are fire-and-forget voices; music runs on a lookahead scheduler (about 100 ms ahead, ticking every 25 ms).

## Open questions
- None.

## Tasks
- [ ] T1. Engine: context, buses, compressor, voices, noise, envelopes (`src/audio/engine.ts`).
- [ ] T2. Sound design table: event → recipe (`src/audio/sfx.ts`).
- [ ] T3. Sequencer and the two music loops (`src/audio/music.ts`, `src/audio/patterns.ts`).
- [ ] T4. `createAudio` facade, mute and volumes with persistence (`src/audio/index.ts`).
- [ ] T5. Unit tests with fakes.
- [ ] T6. `audio-test.html` dev page and evidence.

## Implementation notes
(filled by spec-tackle)

## Review
(filled by spec-review)
