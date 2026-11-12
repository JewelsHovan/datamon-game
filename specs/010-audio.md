# 010: Audio

Status: review
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
- [x] A1. (R1, R2, R6) Unit tests with a fake AudioContext: every SimEvent type that should make a sound schedules at least one voice on the effects bus; light and heavy hits differ (different pitch or envelope); events with no sound (for example `round_end` handled as a stinger) are routed as specified; `onEvents` on a muted engine schedules nothing.
- [x] A2. (R4) Unit test: the sequencer schedules notes at exact beat times for a pattern at a given BPM over 8 bars with a fake clock, and a late tick (a 300 ms gap) does not schedule notes in the past or skip bars.
- [x] A3. (R5) Unit tests: mute toggles both buses; volumes persist through a fake storage; a throwing AudioContext constructor leaves a silent engine that never throws.
- [x] A4. A small dev page `audio-test.html` (Vite dev only) with buttons that trigger each effect, stinger and both music loops; screenshot plus a note in Implementation notes on how each sound reads (subjective check by ear is the user's).
- [x] A5. `npm run typecheck`, `npm test`, `npm run build` exit 0; no console errors on the audio test page.

## Out of scope
- Voice acting or sampled audio files.
- Per-fighter voice sets.

## Decisions
- Fully synthesized: no assets, tiny download, matches the 8-bit look.
- Effects are fire-and-forget voices; music runs on a lookahead scheduler (about 100 ms ahead, ticking every 25 ms).

## Open questions
- None.

## Tasks
- [x] T1. Engine: context, buses, compressor, voices, noise, envelopes (`src/audio/engine.ts`).
- [x] T2. Sound design table: event → recipe, plus the stingers and menu sounds (`src/audio/sfx.ts`).
- [x] T3. Sequencer and the two music loops (`src/audio/music.ts`, `src/audio/patterns.ts`).
- [x] T4. `createAudio` facade, mute and volumes with persistence, `bindAudioControls` for the browser side (`src/audio/index.ts`).
- [x] T5. Unit tests with fakes (`src/audio/testing/fakeAudioContext.ts`; `engine.test.ts`, `music.test.ts`, `index.test.ts`).
- [x] T6. `audio-test.html` dev page (`src/audio/testPage.ts`) and evidence (`specs/evidence/010/`).

## Implementation notes

Built in an isolated worktree while spec 005 rewrites the scenes, so nothing outside `src/audio/`, `audio-test.html` and this spec's evidence was touched. The module is not wired into the game yet; the lead adds the lines under "Integration" below.

### Files
- `src/audio/engine.ts`: structural WebAudio interfaces (the browser `AudioContext` satisfies them; checked at compile time in `engine.test.ts`), `AudioEngine` with the bus graph `voices → sfxBus` and `voices → track fade → musicBus → duck` into one `DynamicsCompressor` (threshold -16 dB, ratio 6) then the master gain. Voices are layers (`tone` with sine/square/saw/triangle or NES 25% and 12.5% pulse waves built as `PeriodicWave`, or `noise` from one shared 2 s looping buffer), each with an ADSR envelope, exponential pitch sweep, optional biquad filter sweep and optional waveshaper drive. Voice budget per bus (sfx 128, music 64), counted from scheduling to the end; a recipe that does not fit is dropped whole, never cut to a few layers.
- `src/audio/sfx.ts`: the sound design table as data (`SFX`, `STINGERS`, `UI_SOUNDS`) and `routeEvent(e)`, a pure map from each `SimEvent` to an effect, stinger cues (with delays) and a music duck.
- `src/audio/patterns.ts`: instruments and both loops as data (chord chart per bar, rhythm/arpeggio/drum strings, melody note strings) and a pure `compileSong` that expands them into a 16th-note step grid. Fight: A minor, 150 BPM, 16 bars (8-bar drive of octave bass, 16th pulse arpeggio and noise drums, then 8 bars with a pulse lead hook, fills on bars 8 and 16, crash on 1 and 9). Select: Fmaj7 Em7 Dm7 Cmaj7, 112 BPM, 8 bars, triangle bass, soft pulse keys, a triangle melody from bar 5, rim and offbeat hats, no snare.
- `src/audio/music.ts`: `Sequencer` (lookahead 100 ms, ticked every 25 ms; step time is `origin + n * stepDuration`, so no drift; a late tick re-anchors the grid 10 ms ahead of the clock and keeps the pattern position, so nothing lands in the past and no step or bar is skipped) and `MusicPlayer` (one track at a time, 0.25 s fade between tracks, keeps its place but starts no voices while muted).
- `src/audio/index.ts`: the facade and `bindAudioControls`. `src/audio/testing/fakeAudioContext.ts`: recording fake context, manual timers, memory storage.
- `audio-test.html` + `src/audio/testPage.ts`: the dev page (not in the build; Vite serves it in dev at `/audio-test.html`).

### API (R6) and what was added
`createAudio(options?)` returns `GameAudio` with the R6 methods `onEvents`, `ui`, `music`, `resume`, `setMuted`, `dispose`, plus `toggleMute`, `muted`, `getVolume`/`setVolume` (master, music, sfx; 0..1), `setHidden`, `status`, `stats()` and `internals()` (dev and tests). Additions and why:
- `onEvents(events, round?)` takes an optional second argument, `state.round`: the R3 timer tick needs the round timer, which is state, not an event. Without it there is simply no tick.
- `bindAudioControls(window, audio, options?)` does the browser side of R1 and R5 in one call: capture-phase `pointerdown`/`touchstart`/`keydown` on the window call `resume()` (capture, so it runs before scene handlers and the first menu sound is not lost), `KeyM` toggles mute (ignores repeats and Ctrl/Cmd/Alt; `ignoreKey` lets the controls screen keep M while it captures a binding), and `visibilitychange` suspends the context while the tab is hidden. Returns an unbind function.
- `createAudio()` touches no browser API: the `AudioContext` is created on the first `resume()`, inside the user gesture, so Chrome never warns. `music()` called earlier is remembered and starts on resume. A missing or throwing `AudioContext`, nodes that throw mid-game, a suspended or closed context and blocked or corrupt `localStorage` all leave a silent engine; every public method is wrapped and never throws. Settings persist under `localStorage["datamon.audio"]` as `{master, music, sfx, muted}` (mute persists too).

### Routing (R2, R3)
| Event | Sound |
|---|---|
| `attack` | whoosh by the move's strength: light (light punch, light kick, air attack), heavy (heavy punch, heavy kick, crouch attack), special (whoosh plus a rising pulse charge), throw (short grab whiff) |
| `hit` | `hit_light`, `hit_heavy` or `hit_special` by `strength`; `move: "throw"` is the toss; combo hits climb 2.5% in pitch per hit (capped at +10%); every hit gets a ±3% random pitch so repeats do not machine-gun |
| `block` | `block_light`, `block_heavy`, `block_special` (chip adds a small zap) |
| `throw` / `tech` / `knockdown` | grab, tech "ting", knockdown thud with a small bounce |
| `jump` / `land` | soft rising triangle blip / soft low thump |
| `projectile` / `clash` / `trade` | launch / burst between projectiles / "MERGE CONFLICT" minor-second buzz under a doubled impact. A projectile that connects arrives as a `hit` or `block` with `move: "special"`, which is the burst-and-zap recipe |
| `ko` | K.O. effect, K.O. sting 0.45 s later, music ducked to 15% for 2.2 s. A `hit` in the same batch as a `ko` is skipped (the K.O. carries the impact) |
| `round_start` | "ROUND" jingle plus one blip per round number |
| `fight` | "FIGHT!" stab |
| `round_end` | no effect; stingers only: K.O. win jingle at +1.6 s (lands with the victory pose after the K.O. slow motion), time-out "time up" now and the win jingle at +1.15 s, draw (winner 2) the draw phrase, winner -1 nothing |
| `match_end` | match win fanfare |
| timer | `onEvents(..., state.round)` ticks once per second from 10 to 1 in the fight phase (sharper tick from 3), never in training or other phases |

Overlapping ducks merge (deeper depth and later end win), so the K.O. duck and the round-win duck in the same batch never let the music jump back up between them.

### How each sound is built to read (A4)
Headless Chrome cannot judge sound; these are the design intents. The by-ear check on `/audio-test.html` is the user's.
- Light hit: a 35 ms high-passed noise snap, a square body falling 440 to 150 Hz in 70 ms and a tiny sine click; short and bright, about 0.1 s.
- Heavy hit: a darker noise transient (low-pass sweeping 4.2 kHz to 700 Hz), a driven square falling 190 to 52 Hz through a closing low-pass, and a sine sub drop 110 to 38 Hz; about 0.27 s, clearly lower and longer than the light hit.
- Special hit: a medium driven hit plus a resonant saw zap sweeping down from 1.8 kHz and a quiet pulse sparkle.
- Swings: band-passed noise sweeps; light is quick and high (900 Hz to 3.2 kHz), heavy is slower and lower with a low air rumble.
- Blocks: a high-passed tick plus inharmonic partials (ratios 1, 1.47, 2.09, 2.64) on triangle and filtered square, a bright metallic clank; heavy blocks are lower with a thump.
- K.O.: a long low-passed noise blast, a heavily driven square falling 160 to 38 Hz, a sine sub sliding to 28 Hz, a pulse tone falling 880 to 110 Hz over 1.1 s, and an A/E triangle ring-out with a noise shimmer tail; the sting then plays a falling A minor arpeggio over a held low A.
- Stingers: ROUND is a rising E minor pulse arpeggio over a triangle E; FIGHT! is a noise burst, kick and an A power-chord square stab with a rising saw; the round win is a short C major fanfare; the match win is a longer fanfare with a snare pickup and crash; draw is an unresolved D suspended phrase; time up is two falling square beeps; the timer tick is a short triangle wood-block.
- Menu: move is a 35 ms pulse blip at C6, confirm is C6 then G6, back is triangle G5 then C5.
- Mix safety: every layer peak is at most 0.75 and the summed gain of layers sounding at once is at most 2 (unit test); buses sit at 0.85 (sfx) and 0.5 (music) times the user volume (defaults master 0.8, music 0.7, sfx 0.9), all into the compressor. Square and pulse layers are low-passed (2 to 5 kHz) to stay off the harsh end.

### Evidence
- A1: `src/audio/index.test.ts` "audio facade: events to voices (A1)": "every SimEvent type schedules at least one voice on the effects bus" (all 16 types; every started source traced through the fake graph to the sfx bus and not the music bus, start time not in the past), "light and heavy hits differ in pitch and length" (heavy lowest start frequency under 0.8 times the light one, heavy longest voice over 1.5 times), "special hits add a zap layer", "stinger-only events route as specified and schedule their stingers ahead" (`round_end` has no effect and its stinger starts exactly 1.6 s ahead), "onEvents on a muted engine schedules nothing" (all events, menu and timer ticks: 0 sources). Routing per move and strength in `engine.test.ts` "sound design table (R2, R3)".
- A2: `src/audio/music.test.ts` "sequencer (A2)": "schedules notes at exact beat times for 8 bars at 120 BPM" (32 beats at `0.05 + k * 0.5` to 9 decimals, never in the past, seamless loop), "is exact at 150 BPM over the full fight loop with a ragged tick rate", "a late tick (300 ms gap) schedules nothing in the past and skips no step or bar" (every pattern step in order across the gap and the loop point, one resync, exact spacing after it).
- A3: `src/audio/index.test.ts` "audio facade: controls and failure (A3)": "mute toggles both buses and unmute restores the volumes", "volumes and mute persist through storage", "bad or blocked storage falls back to defaults without throwing", "a throwing AudioContext constructor leaves a silent engine that never throws" (every method before and after dispose; the constructor is tried once), plus nodes throwing mid-game, no WebAudio at all (node), hidden-tab suspend and `bindAudioControls` (M, repeats and modifiers ignored, `ignoreKey`).
- A4: `audio-test.html` has a button for every effect, stinger, menu sound and both loops, plus a combo, a 10..0 timer countdown, 12 stacked heavy hits and a scripted full round with music. Screenshots `specs/evidence/010/01-audio-test-fight-loop.png` and `02-audio-test-select-loop.png`. Browser check: `npx vite --port 5302 --strictPort --host 127.0.0.1`, then `node specs/evidence/010/audio-check.mjs http://127.0.0.1:5302/ specs/evidence/010` → EXIT=0, 12/12 PASS (`specs/evidence/010/results.json`): no context before input; a real CDP mouse click starts it (audio clock rate 1.002 of wall time); all 31 one-shot buttons start voices (0 dropped); combo and countdown; fight loop at 10.5 steps/s with 0 late notes; a 400 ms main-thread stall gives 1 resync and 0 late notes; full round 391 voices, 0 late, 0 dropped; select loop; M key mutes (0 voices while muted); music stops; volume persists across a reload. How it sounds is UNVERIFIED by me: by ear is the user's call.
- A5: `npm run typecheck` EXIT=0; `npm test` EXIT=0 (16 files, 177 tests, 48 of them in `src/audio`); `npm run build` EXIT=0 (`audio-test.html` stays dev only, no `vite.config.ts` change needed); the browser check's "no console errors" passes (errors [], warnings []) after giving the page an inline `data:` favicon (the only error was the browser's `/favicon.ico` 404).

### Integration (for the lead)
```ts
// main.ts (once, at boot)
import { bindAudioControls, createAudio } from "./audio";
const audio = createAudio();          // no AudioContext yet
bindAudioControls(window, audio);     // first click or key resumes audio, M mutes, hidden tab suspends
// pass `audio` to the scenes

// fight scene, inside the loop's step(), right after `state = step(state, sampler.sample());`
audio.onEvents(state.events, state.round); // every step, also when events is empty (timer tick)

// per scene
audio.music("select");                 // title, controls, character select, results: on enter
audio.music("fight");                  // versus splash or fight scene: on enter
audio.ui("move"); audio.ui("confirm"); audio.ui("back"); // menu cursor, accept, cancel
```
- While the controls screen captures a binding, pass `bindAudioControls(window, audio, { ignoreKey: () => capturing })` so M can be bound.
- `music()` with the track already playing is a no-op, so calling it on every scene enter is safe; `music(null)` stops it.
- Without `bindAudioControls`, call `audio.resume()` from the first `pointerdown` or `keydown` handler.

### Follow-ups
- The by-ear pass on `/audio-test.html` (levels, the heavy/light contrast, how loud the K.O. is under the music).
- A volume UI in the options or pause menu (spec 005 or later): `setVolume` and `getVolume` are ready.
- Per-fighter or per-special sounds (out of scope here) can be new `SFX` entries routed by `move` once spec 006 adds signature specials.

## Review
(filled by spec-review)
