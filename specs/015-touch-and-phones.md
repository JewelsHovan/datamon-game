# 015: Touch controls and phone layout

Status: review
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
- [x] A1. (R1, R2) Vitest: the d-pad maps touch positions to directions (8-way, dead zone, sliding), buttons map to bits, a short tap is latched into the next sample, and touch bits merge with keyboard bits for P1 only.
- [x] A2. (R1, R2, R3) A browser check emulating a phone (844x390, device scale 3, touch, mobile) plays from the title screen to the results by touch only: VS CPU, picks a fighter and a level, walks, jumps, lands a punch, a special and a throw, pauses and resumes, finishes the match. Screenshots in `specs/evidence/015/` of the controls, a pressed button, and the results.
- [x] A3. (R1) The same check confirms the controls are hidden on a desktop page used with the keyboard, and appear after the first touch.
- [x] A4. (R3) In portrait (390x844) the rotate screen shows; rotating to landscape removes it and the match continues (screenshots).
- [x] A5. (R4) The browser check confirms `touch-action: none` on the game area and controls, `overscroll-behavior: none`, `user-select: none` on the controls, and the viewport meta disables zoom.
- [x] A6. (R5) Screenshots at every R5 size show the whole canvas with crisp edges, nothing cut off, controls only on touch sizes.
- [x] A7. No regression: `./dm check` exits 0 and the 001, 003, 005, 008, 009 and 012 browser checks pass.

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
- [x] T1. `src/input/touch.ts`: the control layer (DOM, pointer events, d-pad geometry, buttons, latching), shown on first touch; vitest for A1.
- [x] T2. Merge touch into P1's bits in `src/input/sampler.ts` and wire it in `src/scenes/game.ts`.
- [x] T3. `index.html` and `src/render/screen.ts`: viewport meta, touch CSS, safe areas, fractional fill on touch, rotate screen, landscape lock on fullscreen.
- [x] T4. Browser checks for A2 to A6 in `specs/evidence/015/`; evidence and notes.

## Implementation notes

### What was built
- **`src/input/touch.ts` (T1).** Pure parts: `dpadBits(dx, dy, radius)` (8 equal 45 degree sectors from slope tests against tan 22.5, dead zone a quarter of the radius, a finger slid past the pad keeps its direction), `TOUCH_BUTTON_BITS` (Throw = Punch|Kick, Pause = Start), `TouchState` (bits per finger by pointer id, OR'd, plus a latch of everything set since the last sample, cleared by `endSample()`, as the keyboard does), and `layoutTouch()` (d-pad bottom-left, a 2x2 button cluster bottom-right with the right column raised, Pause in the right letterbox when it fits, else the top letterbox, else just under the health bars at canvas y 50; sizes from the short side of the screen, clamped: d-pad 120..200 px, buttons 52..84 px). DOM layer `createTouchControls(root, win)`: builds the d-pad (cross, lit arms, a knob that follows the thumb) and the five buttons, pointer events with pointer capture per finger (the d-pad tracks its finger anywhere, so sliding between directions never lifts), `pressed`/`lit` classes while held. Shown on a coarse pointer at start-up or on the first `pointerType: "touch"` anywhere; hidden (and every finger lifted) when P1 plays with the keyboard or a pad. No long-press menu (`contextmenu` prevented), no iOS pinch (`gesturestart` prevented, Safari ignores `user-scalable=no`).
- **Sampler (T2).** `createInputSampler(keyboard, pads, touch?)` ORs touch into P1's mask only and calls `touch.endSample()` after each sample. Before merging it hands P1's keyboard and pad bits to `touch.otherInput()`, which hides the controls when they are non-zero; P2's devices never reach it, so on a tablet P2 can play on a keyboard or pad (the spec's Decisions) without hiding P1's controls. `src/scenes/game.ts` builds the controls from `GameOptions.touchControls` (`#touch-controls`, passed by `main.ts`), and `info().screen` exposes the fit, the rotate state and the touch state for checks.
- **Screen (T3).** `fitScreen(w, h, { fractional, insets })`: unchanged without options (desktop integer scaling, fractional only below 640x360); on a touch device the scale is fractional and fills the safe area, so a landscape phone uses its whole height. Insets come from `env(safe-area-inset-*)` read through a hidden probe element; the canvas and the controls stay inside them. `needsRotate(w, h, touch)`: touch device and taller than wide shows `#rotate-screen`, and the game loop freezes behind it (`loop.setHidden(document.hidden || rotating)`), so turning back to landscape continues the same frame. `lockLandscapeOnFullscreen(document)` listens for `fullscreenchange` and calls `screen.orientation.lock("landscape")` (rejections ignored), whichever code requests fullscreen. `index.html`: viewport `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`; `touch-action: none` and `overscroll-behavior: none` on html and body; `touch-action: none`, `user-select: none` and `-webkit-touch-callout: none` on the canvas, the controls and the rotate screen; the control styles; `#touch-controls` and `#rotate-screen` elements.

### Choices made while building
- Safe areas: all four insets are respected, so on an iPhone in landscape the canvas fills the height minus the home indicator (369 of 390 px with 21 px bottom inset). "Uses the whole height" holds for the safe height.
- The rotate screen shows on every touch device in portrait, tablets included (a portrait tablet would fit the canvas at under half the screen height).
- Pause is Start, and shows only in the fight and pause scenes (`setPauseShown`, driven by the scene hook in `game.ts`). On menus Start only confirms, as Punch does, and where the screen has no letterbox (667x375, a 1280x720 touch laptop) the button's fallback spot under the timer sat over the title logo.
- Audio: on touch, `pointerdown` is not a user activation for audio, only the end of a tap is, so `main.ts` also resumes audio on `pointerup` and `touchend`.

### Files outside the task list
- `src/main.ts`: passes `#touch-controls` and `#rotate-screen` to `startGame`, and resumes audio on `pointerup` and `touchend`.
- `src/input/touch.test.ts` (A1) and new cases in `src/render/screen.test.ts` (fractional fill, insets, rotate rule, desktop unchanged).
- `specs/evidence/015/cdp.mjs`: Chrome and CDP plumbing shared by `touch-check.mjs` and `sizes-check.mjs` (copied from spec 003's check, plus device emulation and fingers).

### Evidence
Browser checks run against `./dm dev` (port 5341) in a private headless Chrome 157 over CDP (`specs/evidence/015/cdp.mjs`): phones as `Emulation.setDeviceMetricsOverride` with `mobile: true`, device scale 3 (tablets 2) and a landscape or portrait `screenOrientation`, plus `Emulation.setTouchEmulationEnabled` with `maxTouchPoints: 5`; fingers through `Input.dispatchTouchEvent` (touchStart and touchMove carry every finger down; touchEnd lists only the finger that lifts, measured: leaving a finger out of a touchMove does not lift it in Chrome 157). Element positions from `getBoundingClientRect`.
- **A1.** `npx vitest run src/input/touch.test.ts src/render/screen.test.ts` exit 0, 36 tests. `src/input/touch.test.ts`: "maps the 8 directions", "gives each direction a 45 degree sector", "is neutral inside the dead zone and reads past the pad's edge", "slides between directions without lifting", "map to bits; Throw is Punch+Kick and Pause is Start", "hold together with a direction (multi-touch)", "latches a tap shorter than one step into the next sample, once", "latches a d-pad flick released between steps", "merges touch with P1's keyboard and pad bits, never P2's", "reports P1's keyboard and pad input to the touch source, never P2's", plus layout tests at every touch size of R5 and two notch cases (no control over the health bars, all inside the safe area, none overlapping, d-pad at least 120 px and buttons 52 px).
- **A2.** `node specs/evidence/015/touch-check.mjs http://127.0.0.1:5341/ specs/evidence/015` exit 0, 27 checks, `touch-results.json`. At 844x390 (device scale 3, mobile, touch), by touch only: Punch on the title opens VS CPU select; d-pad taps walk the cursor to Julien, Punch picks him, Punch takes the random tile for the CPU, d-pad left sets EASY, Punch confirms; the fight starts (`cpu: [null, "easy"]`); holding the d-pad walks (`walk_forward`, 58 px); a d-pad flick up jumps (`jump` event, player 0); Punch lands `light_punch`; finger 1 holding the d-pad toward the CPU while finger 2 taps Kick starts `heavy_kick`; Special lands (`hit`, move `special`); Throw lands (`throw` event, player 0); Pause opens the pause menu (sim frame frozen 677 to 677 over 300 ms) and Punch resumes (694); forward+Kick until the results (`PLAYER 1 WINS`, about a minute); d-pad down and Punch on the results pick CHARACTER SELECT. No console errors. Screenshots looked at: `a2-01-title-controls.png` (controls, Pause hidden on menus), `a2-02-select-level.png`, `a2-03-walk.png`, `a2-04-pressed-button.png` (right arm of the d-pad and Kick lit together), `a2-05-pause.png`, `a2-06-results.png`.
- **A3.** Same check: a 1280x720 desktop page (no touch, `mobile: false`) moved the title cursor with S, controls `display: none`, integer scale 2 (`a3-01-desktop-keyboard.png`); with touch emulation turned on, a tap on the title art shows them (`a3-02-after-first-touch.png`); P2's ArrowLeft leaves them showing, P1's W hides them again.
- **A4.** Same check: opened at 390x844 the rotate screen shows (`display: flex`) and the game does not step (manager frame 0), `a4-01-portrait-rotate.png`; a `?cpu=easy` match at 844x390 turned to 390x844 shows the rotate screen with the sim frame frozen (121, 121 over 500 ms), `a4-02-portrait-mid-match.png`; back at 844x390 the rotate screen is gone and the same round continues from the frozen frame (125 after 100 ms, then advancing), `a4-03-landscape-continues.png`.
- **A5.** Same check, computed styles at 844x390: `touch-action: none` on html, body, `#game`, `#touch-controls`, the d-pad and all five buttons; `overscroll-behavior: none` on html and body; `user-select: none` on the controls; viewport `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`. Behavior: `Input.synthesizePinchGesture` (x2.5) and a double `Input.synthesizeTapGesture` leave `visualViewport.scale` at 1 and `scrollY` at 0; a press reads as held right after touchStart (no click wait).
- **R3, landscape lock.** Same check: with `screen.orientation.lock` replaced by a recorder, `requestFullscreen()` (user gesture) led to one `lock("landscape")` call.
- **A6.** `node specs/evidence/015/sizes-check.mjs http://127.0.0.1:5341/ specs/evidence/015` exit 0, 14 checks, `sizes-results.json`. At all ten R5 sizes the canvas is 640x360, `image-rendering: pixelated`, 16:9, inside the viewport; touch sizes fill one side (667x375 to 666.7x375, 844x390 to 693.3x390, 932x430 to 764.4x430, 1024x768 to 1024x576, 1180x820 to 1180x663.75), desktops keep integer scales (1366x768 x2, 1920x1080 x3, 2560x1440 x4) with no controls; touch sizes show 5 controls on the title and 6 in a fight, none over the health bars or outside the viewport; portrait sizes show the rotate screen. Screenshots looked at: `a6-<size>-title.png` and `a6-<size>-fight.png` for each landscape size, `a6-375x667-title.png`, `a6-390x844-title.png` (rotate screen) and `-under-rotate.png` (the letterboxed canvas under it), zoomed crops `a6-crisp-844x390.png` and `a6-crisp-1024x768.png` (hard pixel edges at x1.083 and x1.6). Safe area: with `Emulation.setSafeAreaInsetsOverride` (47 left and right, 21 bottom) the probe reads those insets, the canvas sits at x 94 at 656x369, and every control stays inside (`a6-844x390-notch.png`).
- **A7.** `./dm check` exit 0 (typecheck, 329 tests in 24 files, build). Regression browser checks on the final code, output to a scratch directory so their recorded evidence stays as is: `node specs/evidence/001/browser-check.mjs` exit 0 (13 checks; A9 still integer: 1440x900 at x2, 800x600 at x1), `003/fight-check.mjs` exit 0 (11), `005/flow-check.mjs` exit 0 (22), `008/cpu-check.mjs` exit 0 (5), `009/stage-check.mjs` exit 0 (9), `012/moves-check.mjs` exit 0 (19, run with its 006 screenshot directory as the fourth argument). An earlier 009 run failed only its render-fps sample (min 57.9 against 59, average 60) while the machine's load average was about 18; the rerun on the final code passed (min 59.8). Nothing in this spec runs per frame on a desktop page.

### Follow-ups
- On touch, the title, select and pause screens and the round 1 intro still show keyboard legends ("MOVE: WASD OR ARROWS", "F PUNCH  G KICK"). A touch legend (or none) when the controls are showing would read better.
- The rotate screen freezes the game but the music keeps playing behind it; suspending audio there like a hidden tab would match.
- Not tried on real phones: iOS Safari (pinch through `gesturestart`, safe areas, the home indicator) and Android Chrome (pull-to-refresh, the landscape lock on fullscreen) are covered only through Chrome's device emulation.
- Spec 014 adds FULLSCREEN to the title and pause menus; the landscape lock here listens for `fullscreenchange`, so it needs no wiring there, but a check that enters fullscreen through that menu item on a phone would confirm the two together.

### Lead session, after merging 013, 014 and 015 (2026-11-12)
- Spec 014's double-click-for-fullscreen fired on a synthesized double tap, so the R3 landscape-lock check saw the page already fullscreen and no lock request. Double-click now toggles fullscreen only for a mouse (two quick taps on a phone must not flip it mid-fight); `touch-check.mjs` passes again (EXIT=0), with the lock requested once.
- On a fatal load failure the touch controls stop listening (`dispose`); the failure screen (z-index 100) sits above them and the rotate screen.

## Review
(filled by spec-review)
