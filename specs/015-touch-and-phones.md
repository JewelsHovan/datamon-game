# 015: Touch controls and phone layout

Status: ready
Created: 2026-11-12

## Goal
Anyone with a phone or tablet can open the link and play a full match against the CPU with on-screen controls, from the title screen to the results, and the game fits every screen it is opened on.

## Context
Release readiness, part 3 of 3 (parts 1 and 2: specs 013 and 014). Today the game needs a keyboard or a gamepad: on a phone the title screen shows and nothing can be pressed. Input is sampled once per step into a per-player bitmask from the keyboard and gamepads (`src/input/sampler.ts`), and menus run on the same bits (Punch confirms, Kick goes back, Start pauses), so a touch source that produces P1's bits makes the menus work too. The canvas is 640x360, scaled by the largest integer factor that fits (fractional below 640x360) and letterboxed (`src/render/screen.ts`).

## Requirements
- R1. Touch controls for P1, shown once the player touches the screen (or on a coarse pointer) and hidden for keyboard and gamepad play: a d-pad on the left (8 directions with a dead zone, slide between directions without lifting), Punch, Kick and Special buttons on the right, a Throw button (Punch+Kick), and a Pause button. Multi-touch: a direction and buttons can be held together. Controls sit over the letterbox and the bottom corners, semi-transparent, never over the health bars, and light up while pressed.
- R2. Touch feeds P1's input bitmask through the sampler, merged with the keyboard and gamepad; a tap shorter than one sim step still registers (as keyboard taps do). Menus, character select, pause and results all work by touch.
- R3. Phone layout: in landscape the canvas uses the whole height (it may scale fractionally on touch devices so it fills the screen; desktop keeps integer scaling); in portrait a "rotate your device" screen shows over the game; safe-area insets (notches) are respected; on Android, going fullscreen also locks landscape where the browser allows it.
- R4. The page behaves like an app on touch: no pinch or double-tap zoom, no pull-to-refresh or overscroll bounce, no text selection or long-press menu on the controls, no 300 ms tap delay.
- R5. Responsive everywhere: at 375x667 and 390x844 (portrait), 667x375, 844x390 and 932x430 (landscape phones), 1024x768 and 1180x820 (tablets), 1366x768, 1920x1080 and 2560x1440 (desktops) the game is fully visible, crisp and letterboxed, with nothing cut off.

## Acceptance criteria
- [ ] A1. (R1, R2) Vitest: the d-pad maps touch positions to directions (8-way, dead zone, sliding), buttons map to bits, a short tap is latched into the next sample, and touch bits merge with keyboard bits for P1 only.
- [ ] A2. (R1, R2, R3) A browser check emulating a phone (844x390, device scale 3, touch, mobile) plays from the title screen to the results by touch only: VS CPU, picks a fighter and a level, walks, jumps, lands a punch, a special and a throw, pauses and resumes, finishes the match. Screenshots in `specs/evidence/015/` of the controls, a pressed button, and the results.
- [ ] A3. (R1) The same check confirms the controls are hidden on a desktop page used with the keyboard, and appear after the first touch.
- [ ] A4. (R3) In portrait (390x844) the rotate screen shows; rotating to landscape removes it and the match continues (screenshots).
- [ ] A5. (R4) The browser check confirms `touch-action: none` on the game area and controls, `overscroll-behavior: none`, `user-select: none` on the controls, and the viewport meta disables zoom.
- [ ] A6. (R5) Screenshots at every R5 size show the whole canvas with crisp edges, nothing cut off, controls only on touch sizes.
- [ ] A7. No regression: `./dm check` exits 0 and the 001, 003, 005, 008, 009 and 012 browser checks pass.

## Out of scope
- Two players on one touch screen (P2 keeps the keyboard or a gamepad).
- Swipe gestures and motion inputs; haptics.
- Rebinding touch controls or moving them around.

## Decisions
- P1 only on touch: VS CPU is the mobile mode; VS PLAYER on a tablet works with a keyboard or gamepad for P2.
- Controls are HTML elements over the canvas, not drawn in it: pointer events give reliable multi-touch hit testing, and the canvas stays a pure function of game state.
- Fractional scaling on touch devices: filling a phone's height matters more than integer-perfect pixels at those sizes; desktop keeps integer scaling.

## Open questions
- None.

## Tasks
- [ ] T1. `src/input/touch.ts`: the control layer (DOM, pointer events, d-pad geometry, buttons, latching), shown on first touch; vitest for A1.
- [ ] T2. Merge touch into P1's bits in `src/input/sampler.ts` and wire it in `src/scenes/game.ts`.
- [ ] T3. `index.html` and `src/render/screen.ts`: viewport meta, touch CSS, safe areas, fractional fill on touch, rotate screen, landscape lock on fullscreen.
- [ ] T4. Browser checks for A2 to A6 in `specs/evidence/015/`; evidence and notes.

## Implementation notes
(filled by spec-tackle)

## Review
(filled by spec-review)
