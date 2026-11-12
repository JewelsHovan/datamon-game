# Research agenda

Updated: 2026-11-12. Open angles rotate by last-run date. An angle can run again after 14 days if new sources are likely. Seeded from the roadmap in `docs/game-design.md` and the open questions in `foundations.md`. Serves follows the round 2 roadmap numbering.

| ID | Angle | Serves | Last run | Status |
|---|---|---|---|---|
| G-01 | Game-loop engineering for browser fighters: fixed timestep under requestAnimationFrame, Gamepad API polling latency, input sampling, measuring input-to-photon lag in a browser | 1 Engine core | 2026-11-12 | open |
| G-02 | Frame-data conventions for simple-input fighters: buffer windows, direction+button leniency, throws and throw escape, chain-combo rules, pushback, combo damage and hitstun scaling (SF6, Granblue, Fantasy Strike, Smash, KOF) | 3 Combat core | 2026-11-12 | open |
| G-03 | Juice values from shipped games: hitstop per strength, screen shake, hit flash, K.O. slow-motion, camera, and how they combine | 4 Effects and feel | | open |
| G-04 | Limited animation in 2D fighters: key poses, holds, smears, anticipation and recovery, readability at about 140px (Guilty Gear Xrd, Skullgirls, indie pixel fighters), applied to image-generated clips | 2 Animation pipeline, 4 Effects and feel | | open |
| G-05 | HUD and match flow: health bars with chip and recoverable damage, round pips, announcer, callouts (counter, punish), results screens | 5 Match flow and UI | | open |
| G-06 | Simple-input archetype design: how Fantasy Strike, Granblue Fantasy Versus, Smash, Footsies, Divekick and Rivals give characters identity with few buttons | 6 Launch roster | | open |
| G-07 | Balance process for a big roster on shared archetypes: matchup charts, headless CPU-vs-CPU sims, expert review, patch philosophy | 6 Launch roster | | open |
| G-08 | Assist and summon design: MvC assists, Skullgirls custom assists, Persona 4 Arena personas, JoJo stands, BlazBlue Cross Tag; what keeps a summon super fair and readable, and how to stop assist-made unblockables | 7 Battlemon supers | | open |
| G-09 | Meter design: one resource with several uses (SF6 Drive gauge, EX moves, supers), gain rates, comeback effects | 7 Battlemon supers | | open |
| G-10 | Fighting-game CPU AI: difficulty that feels fair, input reading versus reaction limits, ghost AI (Tekken), arcade ladder pacing, boss design | 8 CPU and arcade ladder | | open |
| G-11 | 2D stage design: readability over busy backgrounds, parallax, corner and wall rules, background characters | 9 Stages | | open |
| G-12 | Fighting-game audio: hit and block sound design, chiptune music, announcer lines, sound as part of impact feel | 10 Audio | | open |
| G-13 | Couch and party play: winner-stays queues, quick rematch and character swap, spectator appeal, office tournaments, play on one keyboard | cross-cutting | | open |
| G-14 | Training mode and teaching tools: frame meter, input display, dummy record and playback, combo trials, tutorials that feel like play | cross-cutting | | open |
| G-15 | Accessibility: remapping, colorblind-safe effects, reduced screen shake and flashes, one-handed play | cross-cutting | | open |
| G-16 | Primary sources the foundations report missed: Core-A Gaming, Sakurai's Creating Games, Patrick Miller's From Masher to Master, Infil's glossary | cross-cutting | | open |
| G-17 | News scan: fighting-game releases, patches, developer diaries and talks from the last 7 days that bear on this game | recurring (every 7 days) | 2026-11-12 | open |
| G-18 | Browser rollback netcode (TypeScript, WebRTC) for a later online mode | cross-cutting | | parked (no networking in scope) |
| G-19 | Frame pacing for a 60 Hz no-interpolation renderer on 120/144/165 Hz displays: how web emulators, FBNeo/Fightcade and browser ports present 60 Hz content, and whether to cap or accept judder | 1 Engine core | 2026-11-12 | open |
| G-20 | Publisher-side primary sources for system numbers (input buffer, hitstop, throw tech, combo scaling): official frame-data pages, game manuals, patch notes, since fan wikis block automated fetches | 3 Combat core | | open |
| G-21 | Cleaning up image-generated fighter frames: identity and palette drift between frames, anchor jitter, how teams using AI or rotoscoped sprites keep a clip consistent and readable at game scale | 2 Animation pipeline | | open |
