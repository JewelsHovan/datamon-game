# What makes a great fighting game

Research date: 2026-11-12. Method: four parallel web-research passes (combat systems, game feel and tech, accessibility and onboarding, case studies and business), then a verification pass on the claims the conclusions lean on hardest.

Evidence tags: **[primary]** means the page was read in full. **[secondary]** means a search summary or secondary reporting. A lot of the design-side evidence is secondary; see "Evidence quality" at the end.

## TL;DR

A great fighting game is a readable, deterministic duel. A small set of rules generates deep mind games, and the netcode and controls never get in the way. Around that sits a package that gives newcomers a reason to stay and the community a reason to own the game.

History says depth and feel are what make a fighting game loved. The 2025-2026 market says the package and the business model decide whether it survives:

- **Street Fighter 6:** a paid, complete package with layered onboarding. Past 7M units.
- **2XKO:** free-to-play, accessible, 2v2. Active development ends December 2026, eleven months after launch.

## The model: five layers

The layers run from what kills a game if it's missing (layer 1) to what keeps it alive for decades (layer 5).

### 1. Foundation: controls, determinism, netcode (table stakes)

If these fail, nothing above them matters.

- **Rollback netcode is mandatory.** The game predicts the remote player's input and keeps going. If the prediction was wrong, it rewinds and resimulates within a single frame.
  - The prediction is right "95% of the time" because players change inputs only about 5 times per second.
  - Killer Instinct sets are played "over connections that approach 200ms ping, which would be unbearable with any delay-based netcode." [primary: Infil]
- **A small fixed input delay keeps rollbacks short.** Games that let players choose usually offer 0-8 frames. Killer Instinct and Injustice 2 use 3, and 2XKO uses a fixed 3 frames both online and offline. [primary: Infil, Riot]
- **How rollback is implemented matters as much as having it.** SFV's rollback was widely panned, and Tekken 8's is contested. [secondary]
- **Determinism is what makes rollback possible.** Both clients process identical inputs identically: "THE RESULT IS IDENTICAL ON BOTH SIDES" (Mike Zaimont). [primary]
- **Server-authoritative rollback is the 2025-26 frontier.** In 2XKO the server "acts as the authority for input, state, and time" and runs a validation copy of every competitive match. In 4-player matches, each player's traffic is about a third of what peer-to-peer would need. Its experimental "Fair Play" mode repeats late inputs, which can produce surprise combos on a player with a bad connection. [primary: Riot]
- **Input buffering and leniency.** [secondary: SuperCombo wiki, patch notes]
  - SF6 buffers any move 4 frames early, which gives a 5-frame window.
  - Dashes and wakeup reversals get 7 frames.
  - The attack button is accepted up to 9 frames after the last direction of a motion.
- **Total input lag stays in single-digit frames.** Guilty Gear Strive measured about 4 frames on PC. On PS5 it was about 4.5 until a patch fixed it. [secondary, 2021-22]
- **Controller rules are now part of the design.** Evo requires leverless controllers to cancel out opposing directions (SOCD cleaning) before the game sees them. [secondary, 2020 ruling; check evo.gg/rules]

### 2. Feel and readability

- **Hitstop does two jobs.** Hitstop is the brief freeze when a hit lands. It sells the weight of the hit and gives the attacker time to confirm the hit and cancel into a follow-up.
  - Capcom's SFV seminar gives 8/12/16 frames for light/medium/heavy hits.
  - King of Fighters XIII uses 7/11, and SF2 used about 14 for everything. [secondary]
  - Values vary by series. Consistency within one game matters more than the exact number.
- **Impact comes from three things working together:** hitstop, matching sound and camera control. A 2022 study of Steam player comments found that neglecting any one of them "may ruin" the sense of impact. [primary abstract: Lin et al.]
- **Animation has to communicate frame data.** Startup, active and recovery frames should each look distinct, and characters need strong silhouettes. Guilty Gear Xrd used anime-style limited animation inside a 3D engine to keep its key poses crisp. [primary abstract: GDC]
- **Show the hidden state.**
  - Fantasy Strike prints frame advantage on every move and uses discrete hit points, so you can see when the next hit is lethal.
  - SF6 has a frame meter in training mode.
  - Hidden information (frame advantage, invincibility, damage scaling) is one of the main walls newcomers hit. [primary: Sirlin/PS Blog, Wagar]

### 3. The depth engine

- **Neutral is the heart of the game.** Neutral is the mid-range standoff where neither player has the advantage. Most exchanges start there, and spacing, punishing whiffed attacks and baiting decide who gets to attack. The levers are normals with distinct ranges and roles, walk speed, how committal dashes and jumps are, and whiff recovery. [secondary: guides]
- **Layered rock-paper-scissors ("yomi").** Attack beats throw, throw beats block, block beats attack, so "everything has a counter."
  - Depth comes from payoffs that are unequal and depend on context: life, meter, position, matchup.
  - Players have to keep weighing their options; they can't solve the game. [primary: Sirlin]
- **Fix degenerate play with system rules, not one patch per exploit.** Skullgirls worked this way. [primary: Zaimont]
  - Its engine detects infinite combos by their content, and the defender can escape with any button.
  - It ruled out unblockable high/low setups at the engine level, which made custom assist characters safe to allow.
  - Zaimont: "I don't know which unblockables you can find, but I know they're not going to work."
- **One readable, universal resource.** SF6's Drive gauge works as a single shared meter.
  - It starts full each round and pays for parry, enhanced (EX) special moves, Drive Rush and Drive Impact.
  - When it runs out, the player enters Burnout. This creates a "hunter vs. prey" tension that Infil called "a winner." [primary: Infil, beta-era]
  - The criticism is that Drive Impact and Drive Rush became low-risk tools in neutral. [secondary: reviews]
- **Leave room for emergent techniques.** SF2's combos were a timing bug the team chose to keep. Evaluate techniques players discover before patching them out. [secondary: GGRecon]

### 4. Characters and balance

- **Each character needs its own game plan.** Archetypes give that identity: shoto, grappler, zoner, rushdown, puppet, stance.
- **Balance means every matchup is playable, not that every character is the same.**
  - Sirlin ranks flavor, dynamics and elegance above balance.
  - His fix order is: nerf the top tier, buff the bottom tier, then compress the tiers. He trusts expert opinion over win-rate data.
  - [primary: Sirlin]
- **Matchup-spread benchmarks.** These are character-vs-character win splits. 7-3 means one side wins 70% of games between strong players.
  - Fantasy Strike: 89% of matchups fall between 6-4 and 4-6, with none at 7-3 or worse.
  - Super Turbo: the spread runs from +27 to -22.5.
  - 3rd Strike: +32 to -36.
- **Diversity beats flattening** (Critpoints). Strive's reported policy is to keep strong characters strong and buff the weak ones. [primary: Critpoints 2015; secondary: Strive]

### 5. On-ramp, package and longevity

- **Optional simplified controls get real use without disrupting top-level play.** [secondary: Capcom stats via press]
  - SF6 year one: 75.6% Classic, 24.1% Modern, 0.3% Dynamic.
  - Capcom says the core player base shifted from men aged 35-45 to players in their 20s within 7 months of launch.
- **Simpler inputs alone don't keep players.** [secondary]
  - DBFZ's player count fell despite easy inputs (Wagar).
  - 2XKO launched with no motion inputs and duo play, and Riot still reported flat engagement.
- **Teach and reveal; don't cut depth.**
  - Sirlin: "It feels like trying to make a motorcycle by sawing a car in half. I'd like to try actually making a motorcycle." [primary]
  - Sakurai designs Smash so that random button presses still produce interesting results. [secondary]
- **Ship the whole package, on every platform.** [secondary]
  - SFV launched without an arcade mode, and Arcade Edition was called "how it should have launched".
  - Marvel Tokon scored 94% recommend on OpenCritic but only 46% positive on Steam after a broken PC launch. First-week sales were about 485K (an analyst estimate).
  - SF6 launched with World Tour (32.3 hours on average to finish), Battle Hub and three control schemes.
- **Live service runs on trust.** Tekken 8 sold 3M by February 2025. [secondary]
  - The battle pass and shop, then the Season 2 and 3 balance swings, drew "Overwhelmingly Negative" reviews and apologies.
  - Tekken 8 entries at EVO Las Vegas fell from 2,521 in 2025 to 1,354 in 2026.
- **Size the business to the audience.** The core fighting-game audience is finite. [secondary, consistent across outlets]
  - MultiVersus shut down in May 2025.
  - 2XKO launched on January 20, 2026 and cut about 80 staff three weeks later.
  - On August 20, 2026, Riot announced that active development ends in December 2026. It said the game costs far more to run than it brings in and engagement had stayed flat.
- **Community ownership is the long tail.** [secondary]
  - 3rd Strike drew 1,101 entrants at a 2024 event, more than 20 years after its last patch.
  - Melee survived years of Nintendo hostility on the back of grassroots organizers.
  - Cheap access (emulation, rollback mods), depth worth exploring in training mode, and community tools keep old games played.

## Where the evidence disagrees

1. **Balance.** Sirlin sets a tight bar (no 7-3 matchups). On the other side, 3rd Strike, MvC2 and Melee endure with wide spreads and "everyone is broken." My read: playable variety matters more than parity.
2. **Execution.** 3rd Strike's strict execution is credited for its longevity, yet execution walls are the most-cited newcomer barrier. Both are true for different audiences. Dual control schemes are the current compromise.
3. **Accessibility vs. depth.** Nakayama says Modern is "not easy mode", while Classic dominates the top Master ranks. The emerging consensus: Modern is offered as an option with its own skill ceiling, and it hasn't caused a balance crisis.
4. **Why newcomers leave.** One camp blames the game itself: execution and hidden information. The other blames the format: 1v1 losses, free-to-play monetization, matchmaking. 2XKO suggests the format and the business model weigh as much as the inputs.
5. **The EVO 2026 decline.** EVO Las Vegas had 5,774 unique players in 2026, down from 8,541, and SF6 fell from 4,228 entries to 2,414. Possible causes:
   - genre fatigue;
   - event-specific factors: the date move, travel costs, a boycott over the Saudi-backed ownership, and Evo Japan drawing 10,000+.

   Unresolved.
6. **Rollback.** Some sources treat rollback as the answer by definition. The SFV and Tekken complaints show that implementation quality matters as much as having it.

## Design checklist

Use this to evaluate a game or to build one, in priority order:

1. A deterministic fixed-step simulation and rollback from day one. Retrofitting either one later is painful (this is inference, not sourced). Keep total input lag in single-digit frames and document the buffer.
2. A readable game state: telegraphed animation, consistent hitstop, sound and camera that land with the hit, and visible frame data in training mode.
3. A neutral built on distinct normals, layered rock-paper-scissors with payoffs that depend on context, and one readable resource.
4. Engine-level guards against infinites and unblockables, while leaving room for emergent techniques.
5. Characters with distinct game plans. Aim for no 7-3 matchups, but prefer variety over parity.
6. Optional simple controls, teaching tools, and single-player content that teaches.
7. A complete launch on every platform. Fair monetization: cosmetics and characters, never balance. A predictable, published balance philosophy.
8. A business sized for the core audience, with support for grassroots events and community tools.

## Open questions and gaps

- **Ranked and matchmaking design** (hidden MMR, placement, rematch culture): no developer-level sources found for SF6 or Tekken 8.
- **Retention data:** no public retention telemetry exists for any major fighting game (day-N retention, quit points).
- **Primary designer material not read:**
  - Core-A Gaming videos
  - Sakurai's "Creating Games"
  - Arc System Works' Strive design goals
  - Nakayama and Matsumoto interviews
  - Patrick Miller's "From Masher to Master"
- **Classics without sources:** longevity for MvC2, Tekken 3, KOF and GGXX specifically.
- **Single-source or conflicting figures:**
  - SF6 at 7.5M (September 30, 2026): KitGuru only.
  - Marvel Tokon at about 485K: an analyst estimate.
  - Mortal Kombat 1 sales: 4M vs. 8M+.
  - Guilty Gear Strive at 4M: date unclear.
  - Invincible VS at 1M+: counts "players", not copies sold.

## Evidence quality

Read in full:
- Sirlin: three articles plus the PS Blog piece on Fantasy Strike
- Zaimont: Game Developer interview and rollback blog
- Infil: netcode parts 1 and 4, SF6 beta
- Riot: 2XKO online-play post
- Critpoints: 2015 and 2021 articles
- evo.gg 2026 numbers
- GoSuGamers 2XKO interview
- esports.net SF6 year-one stats

Everything else came from search summaries or secondary reporting, and numbers from those sources are tagged in the sections above.

Several primary sources failed to load: Ars Technica, the Capcom IR page (403), Infil's glossary, Sakurai's videos and the Motomura slides. Several sources predate 2018 and may be dated: the Skullgirls interview (about 2012), Critpoints 2015, and Sirlin's undated balance articles.

## Sources

Combat systems and balance
- https://sirlin.net/articles/designing-yomi
- https://sirlin.net/articles/game-balance-and-yomi
- https://sirlin.net/posts/game-balance-and-fantasy-strike
- https://gamedeveloper.com/design/interview-an-upstart-fighting-game-developer-s-radical-re-think
- https://critpoints.net/2015/06/22/how-should-developers-handle-balancing-in-fighting-games/
- https://words.infil.net/w03-sf6beta.html
- https://www.ggrecon.com/articles/how-street-fighter-2-accidentally-invented-combos/
- https://dashfight.com/news/new-interview-explains-why-strive-had-to-change-guilty-gear-5447
- https://www.avclub.com/street-fighter-6-beta-impressions

Game feel and tech
- https://words.infil.net/w02-netcode.html
- https://words.infil.net/w02-netcode-p4.html
- https://mikezsez.blogspot.com/2019/12/lets-talk-about-rollbacks-part-2.html
- https://2xko.riotgames.com/en-us/news/dev/how-2xko-handles-online-play/
- https://www.gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The
- https://arxiv.org/abs/2208.06155
- https://game.capcom.com/cfn/sfv/column/131545?lang=en
- https://nintendowire.com/news/2022/12/12/this-week-in-sakurai-12-5-12-11-fine-tuning-hit-stop-and-cheating-the-system/
- https://srk.shib.live/w/Street_Fighter_6/Game_Data
- https://shacknews.com/article/139959/street-fighter-6-version-202405-patch-notes
- https://displaylag.com/video-game-input-lag-database/
- https://www.dualshockers.com/evo-publishes-controller-ruleset-hit-box-deemed-legal/

Accessibility and onboarding
- https://critpoints.net/2021/05/07/how-fighting-games-can-retain-players/
- https://www.denofgeek.com/games/grappling-with-the-skill-curve-are-fighting-games-too-difficult/
- https://www.esports.net/news/fighting-games/street-fighter-6-first-year-stats/
- https://automaton-media.com/en/news/street-fighter-6-devs-reveal-that-series-core-player-base-has-gotten-much-younger/
- https://blog.playstation.com/?p=213018
- https://www.gosugamers.net/news/77416-interview-2xko-game-director-talks-post-launch-plans-no-motion-inputs-and-katarina-s-absence
- https://www.thegamer.com/street-fighter-6-hands-on-modern-control-scheme-interview/
- https://nintendowire.com/news/2018/08/09/masahiro-sakurai-talks-all-things-smash-in-guardian-interview/

Case studies, business and community
- https://evo.gg/news/evo-2026-by-the-numbers
- https://www.gematsu.com/2026/06/street-fighter-6-sales-top-seven-million
- https://www.kitguru.net/?p=751318
- https://www.pcgamer.com/games/fighting/riot-is-ending-development-of-its-2xko-fighting-game
- https://www.gamedeveloper.com/business/riot-games-is-winding-down-fighter-2xko-in-december-2026
- https://gameinformer.com/2026/02/09/riot-games-is-laying-off-around-80-2xko-employees-three-weeks-after-the-games-launch
- https://www.gamereactor.eu/marvel-tokon-fighting-souls-has-sold-nearly-500000-copies-but-had-its-word-of-mouth-cut-short-according-to-analyst-1760103/
- https://videogameschronicle.com/news/marvel-tokon-fighting-souls-sold-fewer-than-3000-units-in-japan-in-its-first-week/
- https://pushsquare.com/news/2025/04/tekken-8-reveals-emergency-patches-as-player-backlash-spirals-out-of-control
- https://www.pushsquare.com/news/2026/03/tekken-8-season-3-backlash-somehow-even-worse-than-season-2-game-gets-review-bombed
- https://www.gamingonlinux.com/2025/01/warner-bros-platform-fighter-multiversus-goes-offline-for-good-in-may
- https://dashfight.com/news/evo-2024-proves-good-games-never-die-6149
- https://gamesbeat.com/street-fighter-v-arcade-edition-review-how-the-fighter-should-have-launched/
- https://www.gamedeveloper.com/game-platforms/killer-instinct-fighting-games-and-the-f2p-challenge
- https://www.videogameschronicle.com/news/snk-ceo-steps-down-after-heavily-marketed-fatal-fury-city-of-the-wolves-seemingly-muted-launch
