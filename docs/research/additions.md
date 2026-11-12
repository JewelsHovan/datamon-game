# Proposed additions

Updated: 2026-11-12.

- Ranked by score: 2 x Impact + Fit + Ease, max 20.
- Statuses: proposed, covered (the design or a spec now has it), parked. Adopted and rejected are set by the user.
- Evidence: primary (a source read in full), secondary (summary or snippet), unsourced (design inference).

Seeded from `foundations.md` checked against `docs/game-design.md` on 2026-11-12. Roadmap steps follow the round 2 renumbering (2 Animation pipeline, 3 Combat core, 4 Effects and feel, 5 Match flow and UI, 6 Launch roster, 7 Battlemon supers, 8 CPU, 9 Stages, 10 Audio, 11 Roster batches).

## Top 10

| Rank | ID | Addition | Roadmap step | Score | Evidence | Status |
|---|---|---|---|---|---|---|
| 1 | A-002 | Explicit input buffer and direction+button leniency windows | 1 Engine core, 3 Combat core | 18 | primary (principle); numbers secondary, unverified | proposed |
| 2 | A-003 | Hitstop table by hit strength, with a cap | 3 Combat core | 18 | primary (principle); numbers secondary, unverified | proposed |
| 3 | A-004 | Throw escape: any attack button, short window | 3 Combat core | 17 | primary | proposed |
| 4 | A-017 | Hitstop shake on the hit fighter | 4 Effects and feel | 17 | primary | proposed |
| 5 | A-012 | Latch presses between input samples | 1 Engine core | 16 | primary | proposed |
| 6 | A-005 | Engine-level combo and unblockable guards, battlemons included | 3 Combat core, 7 Battlemon supers | 16 | primary | proposed |
| 7 | A-006 | Basic hit and block sounds in the effects step, not the audio step | 4 Effects and feel | 16 | primary | proposed |
| 8 | A-007 | Training mode: frame meter, input display, dummy record and playback | new step after 5 | 16 | primary | proposed |
| 9 | A-013 | Vsync-aware accumulator: snap to the display interval, carry the remainder | 1 Engine core | 15 | primary | proposed |
| 10 | A-015 | Battlemon screen-time budget for legibility | 7 Battlemon supers | 15 | primary | proposed |

Below the Top 10: A-008 (15), A-009 (15), A-010 (14), A-014 (13), A-016 (13), A-011 (13). Covered: A-001.

## All additions

### A-001: Readable poses: anticipation, active flash, recovery
- Status: covered. First proposed 2026-11-12. Last updated 2026-11-12.
- What: every move shows a distinct anticipation pose on startup frames, a one or two frame flash or smear on the first active frame, and a held recovery pose, so a player can read startup, active and recovery at game scale. Includes a silhouette check of every archetype's moves at game scale.
- Why: animation has to communicate frame data, and Guilty Gear Xrd chose limited, held-pose animation for clarity [secondary] (https://www.gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The, abstract read; the clarity rationale is from summaries).
- Fits: the round 2 design now covers it. Generated clips carry wind-up, impact and recover poses per frame ("Core animation set" in `docs/game-design.md`), and code adds "holds, hit-stop, shake, flashes, smears" (Round 2 decisions; step 4 Effects and feel). What's left is a silhouette check at 140px during clip review (spec 002 R6), small enough to raise when step 4 is specced.
- Score: Impact 5, Fit 5, Ease 3 = 18 (frozen at covering).
- History: 2026-11-12: seeded. 2026-11-12: verification failed. Kotaku (https://kotaku.com/breaking-down-the-animation-of-guilty-gear-and-dragonba-1836849279, read in full) confirms ArcSys "emulates the 'limited animation' of anime" but not the clarity rationale; the Motomura handout refused the connection. 2026-11-12 (Run 2): covered by the round 2 design (image-generated clips with anticipation and recovery poses, plus step 4 smears and flashes).

### A-002: Explicit input buffer and direction+button leniency windows
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: name the windows in one data table, one row per action. A button pressed up to 4 frames before a move becomes possible still comes out (5-frame window). Dashes and wakeup reversals get 7 frames. A special comes out if its direction was held at any point in the last N frames before the button, so simple inputs stay forgiving. Once a direction+button move is recognized, the direction is locked: changing it during the move's first frames does not swap the move.
- Why: SF6 buffers any move 4 frames early, with 7 frames for dashes and wakeup reversals [secondary] (https://srk.shib.live/w/Street_Fighter_6/Game_Data; the page is bot-blocked, so these figures come from search snippets). Arc System Works' Nov 2 2026 Marvel Tokon patch "Extended the input buffer window for dash when using directional inputs", added a buffer to Aerial Dash for "responsiveness of the controls", and stopped a late direction from changing which assist appears [primary] (https://finalweapon.net/2026/11/02/marvel-tokon-fighting-souls-shares-november-2-update-patch-notes/). So per-action buffer windows are a tuning knob, worth keeping as data. The design keeps a 30-frame input history "for press detection and input buffering" but sets no windows.
- Fits: steps 1 and 3. Lives in the sim's input history; deterministic. Spec 001 R4 builds the history but sets no windows.
- Score: Impact 4, Fit 5, Ease 5 = 18.
- History: 2026-11-12: seeded. 2026-11-12: added Tokon patch evidence [primary] and the direction lock; SF6 numbers still unverified (wiki bot-blocked); ranked #1 on the primary-evidence tie-break. 2026-11-12 (Run 2): roadmap step renumbered (Combat core is now 3); stays #1 (tie with A-003, serves the next build target).

### A-003: Hitstop table by hit strength, with a cap
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: hitstop frames per hit class in one table (light, heavy, special, super, K.O.), plus per-move modifiers and a global maximum no move can exceed. Both fighters freeze for the same number of frames. Starting values of 8/12/16 for light/medium/heavy are only an example to tune from by feel. Multi-hit moves use shorter hitstop per hit.
- Why: Sakurai sets hitstop from damage plus per-attack modifiers (more for electric hits, less for projectiles), caps "the maximum amount of time characters can be in freeze frames", and freezes both fighters "for the exact same amount of time" [primary, fan translation] (https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/). Capcom's SF Seminar column gives 8/12/16 as a hypothetical example for one game, not SFV's values, and a later column says longer hitstop makes heavies easier to cancel [secondary: search summaries; both pages return 503] (https://game.capcom.com/cfn/sfv/column/131545?lang=en, https://game.capcom.com/cfn/sfv/column/132455?lang=en).
- Fits: step 3 (sim freezes fighters) and step 4 (effects keep running on render time), as the design already specifies.
- Score: Impact 4, Fit 5, Ease 5 = 18.
- History: 2026-11-12: seeded. 2026-11-12: verification failed: the Capcom column returned 503 and Dustloop's GGACR attack-attributes table returned 403. 2026-11-12 (Run 2): principle verified against Sakurai's column [primary]; added the cap and equal freeze; 8/12/16 relabeled as Capcom's hypothetical example; numbers still unverified.

### A-004: Throw escape: any attack button, short window
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: being grabbed opens a short escape window (start near 9 frames, as data). Pressing any attack button in it breaks the throw with no damage and pushes the fighters apart, so the strike, throw and block triangle stays fair. A strike and a throw that connect on the same frame: the strike wins. Command grabs (Rusher) cannot be escaped, as the counterweight to their risk.
- Why: Granblue Fantasy Versus: Rising, a game built for simple inputs, lets throw breaks use any attack button, and tuned its break window down after beta feedback ("We had a lot of feedback regarding throws") [primary] (https://gematsu.com/2023/10/granblue-fantasy-versus-rising-details-major-adjustments-to-mechanics-in-response-to-first-open-beta-test). SF6's window lasts until the 9th frame of being thrown, strike beats throw on the same frame, and command grabs can't be teched [secondary] (https://srk.shib.live/w/Street_Fighter_6/Defense, snippet). Infil: SF6's tech "sends you almost full screen, so your pressure is over" [primary] (https://words.infil.net/w03-sf6beta-p4.html). Layered rock-paper-scissors needs every option to have a counter (Sirlin, https://sirlin.net/articles/designing-yomi [primary]).
- Fits: step 3 (the design has a throw clip, no escape). The control table has no throw button, so the throw input itself is a spec decision; "any attack button" breaks keep the escape simple whatever the throw input is.
- Score: Impact 4, Fit 5, Ease 4 = 17.
- History: 2026-11-12: seeded. 2026-11-12 (Run 2): GBVS Rising evidence [primary] and SF6 window [secondary] added; any-button break, strike-beats-throw and command-grab exception added; verified against Gematsu.

### A-005: Engine-level combo and unblockable guards, battlemons included
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: system rules instead of per-move fixes. Hitstun and damage scale down as a combo grows, the engine detects a looping combo and lets the defender escape, and a fighter can never be hit high and low on the same frame by a fighter plus their battlemon.
- Why: Skullgirls detects infinites by combo content and removed high/low unblockables engine-wide, which made custom assists safe. "I don't know which unblockables you can find, but I know they're not going to work." (Mike Zaimont) [primary] (https://gamedeveloper.com/design/interview-an-upstart-fighting-game-developer-s-radical-re-think). Battlemon summons are assists, so they inherit this risk.
- Fits: step 3 for scaling and loop detection, step 7 for the summon rule.
- Score: Impact 4, Fit 5, Ease 3 = 16.
- History: 2026-11-12: seeded. 2026-11-12 (Run 2): roadmap steps renumbered.

### A-006: Basic hit and block sounds in the effects step, not the audio step
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: move a minimal set of hit, block and K.O. sounds into step 4 so impact is tuned with sound from the start. Music and the full sound pass stay in step 10.
- Why: a study of Steam player comments found hitstop, sound coherence and camera control together drive impact feel, and a lack of design on one "may ruin" it [primary, abstract] (https://arxiv.org/abs/2208.06155).
- Fits: design change (roadmap order only). Small: WebAudio one-shots triggered by sim events.
- Score: Impact 4, Fit 4, Ease 4 = 16.
- History: 2026-11-12: seeded. 2026-11-12 (Run 2): roadmap steps renumbered (Effects and feel 4, Audio 10).

### A-007: Training mode: frame meter, input display, dummy record and playback
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: a training stage with a frame meter (startup, active and recovery colored per frame, frame advantage shown), the hitbox view the design already plans, an input display, and a dummy that can block, jump or replay a recorded sequence. Doubles as the tuning tool for 37 fighters.
- Why: hidden information is a main newcomer wall, and Fantasy Strike shows frame advantage on every move [primary] (https://blog.playstation.com/?p=213018, https://critpoints.net/2021/05/07/how-fighting-games-can-retain-players/). SF6 ships a frame meter in training [secondary].
- Fits: a new step after 5. Deterministic inputs make record and playback cheap.
- Score: Impact 4, Fit 5, Ease 3 = 16.
- History: 2026-11-12: seeded. 2026-11-12: Marvel Tokon's Nov 2 2026 patch added an "Assist Cooldown" item to its training gauge settings [primary] (https://finalweapon.net/2026/11/02/marvel-tokon-fighting-souls-shares-november-2-update-patch-notes/), a hint to expose meter and battlemon state in training. No rescore. 2026-11-12 (Run 2): roadmap steps renumbered.

### A-008: Callouts that show hidden state: combo count, damage, PUNISH, COUNTER
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: the HUD shows the combo hit count and damage, and flashes PUNISH or COUNTER when a hit lands on recovery or startup. Flavor text can riff on the work ("ROLLBACK!").
- Why: frame advantage, invincibility and scaling are hidden information that stops newcomers (Celia Wagar) [primary] (https://critpoints.net/2021/05/07/how-fighting-games-can-retain-players/).
- Fits: step 5. The sim already emits hit events; the callout needs a "hit during startup or recovery" flag on them.
- Score: Impact 3, Fit 5, Ease 4 = 15.
- History: 2026-11-12: seeded. 2026-11-12 (Run 2): roadmap steps renumbered.

### A-009: Instant replay of the round-winning K.O.
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: after a K.O., an optional replay of the last few seconds from the recorded inputs, skippable with a button.
- Why: the design already notes determinism gives replays [unsourced, design inference]. No external evidence yet on what replays do for couch play.
- Fits: step 5. Replays from a state snapshot plus inputs.
- Score: Impact 3, Fit 5, Ease 4 = 15.
- History: 2026-11-12: seeded. 2026-11-12 (Run 2): roadmap steps renumbered.

### A-010: Headless archetype matchup chart from CPU-vs-CPU sims
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: a test script that runs thousands of seeded CPU-vs-CPU matches per archetype pair and prints a 5x5 win-rate chart. The target is no matchup worse than 7-3. People playing the game have the final say.
- Why: Fantasy Strike's 89% of matchups between 6-4 and 4-6, with none at 7-3, is a benchmark [primary] (https://sirlin.net/posts/game-balance-and-fantasy-strike). Sirlin trusts expert opinion over data, so the chart is a smoke alarm, not the verdict.
- Fits: steps 6 and 8 (needs the CPU). Determinism makes it reproducible.
- Score: Impact 3, Fit 5, Ease 3 = 14.
- History: 2026-11-12: seeded. 2026-11-12 (Run 2): roadmap steps renumbered.

### A-011: One meter, two uses: half bar for an enhanced special, full bar for the battlemon super
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: the super meter also pays for a stronger version of a special at half a bar, so the meter matters before it's full.
- Why: SF6's single Drive gauge creates "hunter vs. prey" tension (Infil) [primary] (https://words.infil.net/w03-sf6beta.html). Caution: Drive Rush and Drive Impact were criticized as low-risk neutral tools [secondary].
- Fits: step 7. Adds one input rule; keep it simple.
- Score: Impact 3, Fit 4, Ease 3 = 13.
- History: 2026-11-12: seeded. 2026-11-12 (Run 2): roadmap steps renumbered.

### A-012: Latch presses between input samples
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: a button tap is never lost, even when it starts and ends between two samples or lands during a hitch. Keyboard `keydown` sets a "pressed since last sample" bit per button. The sampler ORs that bit into the bitmask for the next sim step, then clears it. When one animation frame runs several catch-up steps, the latched press goes to the first step only. Gamepads are still polled once per animation frame. Where a browser exposes `gamepadrawinputchanged`, it latches gamepad presses the same way (feature-detected, optional). A unit test feeds a press and release inside one frame and checks that the press reaches the sim.
- Why: the Edge gamepad explainer says "input changes can be missed between polling intervals", and rAF polling adds "approximately half the polling interval", about 8.33 ms at 60 Hz [primary] (https://microsoftedge.github.io/MSEdgeExplainers/GamepadEventDrivenInputAPI/explainer.html). SDL, LÖVE and MonoGame developers agree that state polling misses short taps and that event handling or a latch fixes it [secondary] (https://discourse.libsdl.org/t/polling-events-vs-get-keyboardstate/39050).
- Fits: step 1 (spec 001 R4 samples "once per step into a per-player bitmask" but says nothing on taps between samples). The sim still sees one bitmask per step, so determinism is untouched.
- Score: Impact 3, Fit 5, Ease 5 = 16.
- History: 2026-11-12: proposed from G-01.

### A-013: Vsync-aware accumulator: snap to the display interval, carry the remainder
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: the loop measures the display's frame interval (median rAF delta over the first second, re-checked when the window moves). Each frame it adds a small carry buffer to the rAF delta, and if the result is within a tolerance of a whole number of display intervals, uses exactly that and keeps the difference in the buffer. On a 60 Hz display every animation frame runs exactly one sim step; on 120 Hz the steps alternate 1, 0, 1, 0 with no doubled or skipped frame. Long-run time stays exact, so spec 001 R2's "60 steps per second of real time" still holds. The F1 overlay counts zero-step and multi-step frames over the last 10 seconds, so pacing is measurable.
- Why: a measured vsync delta "is never exactly equal to the vsync interval", which causes "a heartbeat like stutter"; the fix is to round to the refresh interval and save "that extra bit of time so it can be subtracted off the next delta" [primary] (https://frankforce.com/frame-rate-delta-buffering/, 2012, DirectX, no tolerance given). Glaiel snaps within about 0.0002 s and calls the threshold untuned [secondary] (https://medium.com/@tglaiel/how-to-make-your-game-run-at-60fps-24c61210fe75, 403 on fetch). Without it, an accumulator drifts until one frame runs two steps, about every 1000 frames by one forum account [secondary] (https://gamedev.net/forums/topic/695499-am-i-understanding-fixed-timestep-games-loop-wrong/5372763/). RetroArch also paces 60 Hz content on 120 Hz as an even multiple ("120Hz/2 = 60Hz") [primary] (https://docs.libretro.com/guides/optimal-vsync).
- Fits: step 1 (spec 001 R2 and the R7 overlay, which already shows steps per animation frame). Lives in `src/engine`, outside the sim. The injectable clock makes it unit-testable.
- Score: Impact 3, Fit 5, Ease 4 = 15.
- History: 2026-11-12: proposed from G-01. 2026-11-12 (Run 2): from G-19, snap to the measured display interval instead of only 1/60 s, so 120 Hz paces evenly; RetroArch evidence added. No rescore.

### A-014: Input-latency budget and an opt-in low-latency canvas
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: the loop samples devices at the top of the rAF callback, steps, and draws to the visible canvas in the same callback, never a frame later. `?lowlatency=1` creates the visible canvas with `desynchronized: true` and draws the 640x360 offscreen buffer onto it in one copy. The F1 overlay shows whether the browser honored the hint (`getContextAttributes().desynchronized`). A short doc section lists the chain (gamepad poll about half a frame, sim step, browser presentation one to two frames) against the foundations target of single-digit total frames.
- Why: Chrome on Windows showed one to two frames from a rAF draw to photons at 60 Hz, measured with a phototransistor [primary] (https://aforren1.github.io/chrome-lag-test/index.md.html). The `desynchronized` hint bypasses the compositor queue; clearing the visible canvas can flicker, so draw offscreen and copy [secondary] (https://developer.chrome.com/blog/desynchronized). No measured gain from the hint was found.
- Fits: step 1, or a follow-up to it. Presentation only; the sim is untouched. The hint may tear and is Chromium-only, so it stays opt-in.
- Score: Impact 2, Fit 5, Ease 4 = 13.
- History: 2026-11-12: proposed from G-01. 2026-11-12 (Run 2): offscreen buffer size updated to 640x360 after the round 2 design.

### A-015: Battlemon screen-time budget for legibility
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: a summoned battlemon stays on screen for a fixed time (start near 180 frames), then leaves. The user's super meter does not fill while their battlemon is out, so supers can't chain back to back. If both players summon at once, both stay readable: neither battlemon may cover the other fighter's sprite for more than a few frames. Values live in the battlemon data table.
- Why: Arc System Works lengthened Marvel Tokon's assist cooldowns (180F for all Assemble Assist versions, 300F when the assist is attacked) because "the screen is overly busy or the match loses momentum", aiming at "reducing the amount of information on the screen at one time and improving legibility" [primary] (https://finalweapon.net/2026/11/02/marvel-tokon-fighting-souls-shares-november-2-update-patch-notes/). At 640x360 with two fighters about 140px tall, a battlemon takes up a large share of the screen (design inference). The specific 180-frame value is borrowed, not tested here [unsourced].
- Fits: step 7. Complements A-005 (that one covers unblockables; this one covers clutter). Data-driven, deterministic.
- Score: Impact 3, Fit 5, Ease 4 = 15.
- History: 2026-11-12: proposed from G-17. 2026-11-12 (Run 2): sizes updated to the round 2 design; roadmap step renumbered.

### A-016: Display-rate report, and redraw only on a new sim frame
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: the F1 overlay shows the measured display rate and a pacing verdict: "60/120/240 Hz: even" or "144/165 Hz: uneven, 60 Hz content will judder; set the display to 120 or 60 Hz". When an animation frame runs zero sim steps, the renderer skips the redraw (render-time effects aside), so a 120 Hz display shows each sim frame for exactly two refreshes. A one-line note in the sandbox's console says the same on startup.
- Why: RetroArch says uneven rates "like 75/90/144/165 Hz are only able to maintain smooth frame pacing" with VRR, and outside its timing skew "the display repeats or skips frames ... which shows as judder" [primary] (https://docs.libretro.com/guides/optimal-vsync). Browsers run rAF at the display's fixed rate with no 60 fps cap and no VRR scheduling [secondary] (https://groups.google.com/a/chromium.org/g/chromium-html5/c/qLxS7RmTM8w, https://forums.blurbusters.com/viewtopic.php?p=25739), and a proposal to let pages request a frame rate never got an API [primary] (https://discourse.wicg.io/t/proposal-allow-developers-to-indicate-their-ideal-frame-rate/4422). So the no-interpolation rule costs judder on 144 Hz panels; this makes the cost visible instead of a mystery.
- Fits: step 1 (R7 overlay) or a follow-up. Presentation only; no constraint bent. Office monitors and TVs are mostly 60 Hz, which keeps the impact low.
- Score: Impact 2, Fit 5, Ease 4 = 13.
- History: 2026-11-12: proposed from G-19.

### A-017: Hitstop shake on the hit fighter
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-12.
- What: during hitstop the hit fighter's sprite vibrates: side to side when grounded, up and down when airborne, strongest on the first frame and decaying to zero by the end of the freeze. The attacker shakes slightly or not at all (a tuning flag). The shake is a render-time offset only; hurtboxes and sim positions don't move. Shake strength comes from the same hit-class table as A-003.
- Why: Sakurai makes the hit fighter vibrate during hitstop, sideways on the ground and vertically in the air, and keeps hurtboxes still so follow-ups don't whiff [primary, fan translation] (https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/). His "Eight Hit Stop Techniques" video also lists gradually reducing the shake and keeping the attacker moving slightly [secondary] (https://nintendowire.com/news/2022/12/12/this-week-in-sakurai-12-5-12-11-fine-tuning-hit-stop-and-cheating-the-system/). The design plans screen shake in step 4 but no per-fighter shake.
- Fits: step 4. Follows the design's rule that effects and shake animate on render time while the sim freezes fighters; generated clips stay untouched.
- Score: Impact 4, Fit 5, Ease 4 = 17.
- History: 2026-11-12: proposed from G-02.
