# Research agenda

Updated: 2026-11-17. Open angles rotate by last-run date. An angle can run again after 14 days if new sources are likely. Seeded from the roadmap in `docs/game-design.md` and the open questions in `foundations.md`. Serves follows the round 2 roadmap numbering.

| ID | Angle | Serves | Last run | Status |
|---|---|---|---|---|
| G-01 | Game-loop engineering for browser fighters: fixed timestep under requestAnimationFrame, Gamepad API polling latency, input sampling, measuring input-to-photon lag in a browser | 1 Engine core | 2026-11-12 | parked (engine core built, spec 001 in review; parked 2026-11-15 to stay at 25 open) |
| G-02 | Frame-data conventions for simple-input fighters: buffer windows, direction+button leniency, throws and throw escape, chain-combo rules, pushback, combo damage and hitstun scaling (SF6, Granblue, Fantasy Strike, Smash, KOF) | 3 Combat core | 2026-11-12 | parked (combat core built, spec 003 in progress, G-20 carries the open numbers; parked 2026-11-17 to stay at 25 open) |
| G-03 | Juice values from shipped games: hitstop per strength, screen shake, hit flash, K.O. slow-motion, camera, and how they combine | 4 Effects and feel | 2026-11-17 | open |
| G-04 | Limited animation in 2D fighters: key poses, holds, smears, anticipation and recovery, readability at about 140px (Guilty Gear Xrd, Skullgirls, indie pixel fighters), applied to image-generated clips | 2 Animation pipeline, 4 Effects and feel | | open |
| G-05 | HUD and match flow: health bars with chip and recoverable damage, round pips, announcer, callouts (counter, punish), results screens | 5 Match flow and UI | 2026-11-13 | open |
| G-06 | Simple-input archetype design: how Fantasy Strike, Granblue Fantasy Versus, Smash, Footsies, Divekick and Rivals give characters identity with few buttons | 6 Launch roster | | open |
| G-07 | Balance process for a big roster on shared archetypes: matchup charts, headless CPU-vs-CPU sims, expert review, patch philosophy | 6 Launch roster | | open |
| G-08 | Assist and summon design: MvC assists, Skullgirls custom assists, Persona 4 Arena personas, JoJo stands, BlazBlue Cross Tag; what keeps a summon super fair and readable, and how to stop assist-made unblockables | 7 Battlemon supers | 2026-11-13 | open |
| G-09 | Meter design: one resource with several uses (SF6 Drive gauge, EX moves, supers), gain rates, comeback effects | 7 Battlemon supers | 2026-11-14 | open |
| G-10 | Fighting-game CPU AI: difficulty that feels fair, input reading versus reaction limits, ghost AI (Tekken), arcade ladder pacing, boss design | 8 CPU and arcade ladder | | open |
| G-11 | 2D stage design: readability over busy backgrounds, parallax, corner and wall rules, background characters | 9 Stages | | open |
| G-12 | Fighting-game audio: hit and block sound design, chiptune music, announcer lines, sound as part of impact feel | 10 Audio | | open |
| G-13 | Couch and party play: winner-stays queues, quick rematch and character swap, spectator appeal, office tournaments, play on one keyboard | cross-cutting | | open |
| G-14 | Training mode and teaching tools: frame meter, input display, dummy record and playback, combo trials, tutorials that feel like play | cross-cutting | | open |
| G-15 | Accessibility: remapping, colorblind-safe effects, reduced screen shake and flashes, one-handed play | cross-cutting | | open |
| G-16 | Primary sources the foundations report missed: Core-A Gaming, Sakurai's Creating Games, Patrick Miller's From Masher to Master, Infil's glossary | cross-cutting | | open |
| G-17 | News scan: fighting-game releases, patches, developer diaries and talks from the last 7 days that bear on this game | recurring (every 7 days) | 2026-11-12 | open |
| G-18 | Browser rollback netcode (TypeScript, WebRTC) for a later online mode | cross-cutting | | parked (no networking in scope) |
| G-19 | Frame pacing for a 60 Hz no-interpolation renderer on 120/144/165 Hz displays: how web emulators, FBNeo/Fightcade and browser ports present 60 Hz content, and whether to cap or accept judder | 1 Engine core | 2026-11-12 | parked (engine core built, spec 001 in review; parked 2026-11-16 to stay at 25 open) |
| G-20 | Publisher-side primary sources for system numbers (input buffer, hitstop, throw tech, combo scaling): official frame-data pages, game manuals, patch notes, since fan wikis block automated fetches | 3 Combat core | | open |
| G-21 | Cleaning up image-generated fighter frames: identity and palette drift between frames, anchor jitter, how teams using AI or rotoscoped sprites keep a clip consistent and readable at game scale | 2 Animation pipeline | | open |
| G-22 | Summon counterplay: can assists and summons be hit, blocked or baited, and what losing one costs (MvC, Tokon, Persona 4 Arena Persona Break, Smash Assist Trophies, BBTag; the 4Gamer Mori and Ishikawa interview) | 7 Battlemon supers | 2026-11-15 | open |
| G-23 | Explaining a loss to newcomers: results and post-round screens, match stats, tips and replays (SF6, Smash, Strive, Fantasy Strike) | 5 Match flow and UI | 2026-11-14 | open |
| G-24 | Replay analysis heuristics: how Tekken 8 My Replay & Tips (and any SF6 or Strive equivalent) decides a punish was missed, a throw was escapable or a combo was suboptimal, and how it words the tip | 5 Match flow and UI | 2026-11-15 | open |
| G-25 | Comeback mechanics that spare newcomers a perfect K.O. without rewarding being hit too much: SF4 Ultra, SFV V-Gauge, MK1 meter on hit, GBVS Rising Raging Strike, and players' reactions to each | 7 Battlemon supers | 2026-11-16 | open |
| G-26 | Japanese-language primary sources for system rationale (4Gamer, Famitsu, Dengeki, Den Faminico Gamer interviews): why Persona Break, Tokon's longer cooldown for an attacked assist, SF6's single Drive gauge, Tekken's tip rules; English fan wikis bot-block the fetcher | cross-cutting | | open |
| G-27 | Per-move answer text for a 74-special roster: how games teach the counter to a specific move (Tekken 8 general tips and Arcade Quest, SF6 character guides, Fantasy Strike move tips) and how short the line can be | 5 Match flow and UI | 2026-11-16 | open |
| G-28 | Stalemate breakers for simple-input games: does blocking dominate newcomer couch play, and do guard-breaking tools (GBVS Rising Raging Strike, SF6 Drive Impact, Strive Wild Assault) fix it without becoming low-risk spam; should a battlemon super break guard | 7 Battlemon supers | 2026-11-17 | open |
| G-29 | Super activation presentation: freeze length, who may input during the flash, and the minimum reaction window after it (KOF XIII, SF6, Strive, MvC, BBTag); publisher frame data or manuals, since SRK and Dustloop bot-block | 7 Battlemon supers | | open |
