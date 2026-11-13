// Frame data (spec 003, spec 006, spec 012, spec 016). Pure data plus small pure helpers; src/sim reads it.
//
// A move is a timeline of segments. Each segment shows one frame of the move's
// clip for `ticks` sim frames; `active` segments have a hitbox. Startup, active
// and recovery all come from this one list, so the art and the frame data cannot
// drift apart.

export type MoveId =
  | "light_punch"
  | "heavy_punch"
  | "light_kick"
  | "heavy_kick"
  | "crouch_attack"
  | "air_attack"
  | "special"
  | "throw"
  // launch signature specials (spec 006)
  | "teleport"
  | "charge"
  | "rush"
  // launch secondary specials (spec 016)
  | "rising_commit"
  | "phantom_ping"
  | "seismic_slam"
  | "canary_hop"
  // batch 1 primary + secondary specials (spec 016)
  | "packet_sniper"
  | "rate_mine"
  | "rollback_parry"
  | "velvet_cross"
  | "skyline_upper"
  | "twin_thread"
  | "force_push"
  | "breaker_lariat"
  | "golden_rush"
  | "crown_dive"
  | "ground_fault"
  | "arc_beacon"
  | "cache_blink"
  | "mirage_trap"
  | "anvil_drop"
  | "steel_counter"
  // full 37-fighter expansion specials (spec 017: 25 fighters x 2 = 50 specials)
  | "vector_slash"
  | "skyward_hook"
  | "prism_volley"
  | "static_tether"
  | "mirror_step"
  | "crescent_feint"
  | "turbo_blitz"
  | "flash_knee"
  | "signal_beam"
  | "pulse_beacon"
  | "titan_press"
  | "tectonic_stomp"
  | "comet_upper"
  | "spark_bolt"
  | "granite_tackle"
  | "vault_throw"
  | "rail_shot"
  | "anchor_mine"
  | "tempest_kick"
  | "spiral_dive"
  | "dragon_merge"
  | "node_pulse"
  | "shadow_pivot"
  | "null_counter"
  | "cobalt_crush"
  | "blue_shift_grab"
  | "vortex_combo"
  | "jet_sweep"
  | "lotus_strike"
  | "horizon_orb"
  | "starlight_hop"
  | "silk_parry"
  | "forge_breaker"
  | "iron_guard"
  | "cedar_upper"
  | "solar_dart"
  | "oasis_wave"
  | "mirage_arc"
  | "cascade_flurry"
  | "fountain_dive"
  | "blink_edge"
  | "trap_socket"
  | "gale_kick"
  | "lightning_slide"
  | "cryo_ping"
  | "frost_fault"
  | "wild_fang"
  | "apex_pounce"
  | "jade_palm"
  | "cloud_rising";

export type ProjectileKind = "orb" | "fast_packet" | "slow_mine" | "shockwave" | "arc_burst";

/** How a move must be blocked. mid: either; low: crouching; overhead: standing. */
export type HitHeight = "mid" | "low" | "overhead";

export type HitStrength = "light" | "heavy" | "special";

export interface ProjectileSpec {
  kind: ProjectileKind;
  /** Horizontal speed in subpixels per frame (0 for stationary mines). */
  speed: number;
  /** Vertical speed in subpixels per frame (negative rises; default 0). */
  vy?: number;
  /** Spawn offset forward from fighter x (subpixels). */
  spawnX: number;
  /** Spawn offset from fighter y (subpixels; negative is above floor). */
  spawnY: number;
  /** Hitbox half-width and half-height (subpixels). */
  halfW: number;
  halfH: number;
  /** Max lifetime in sim frames before expiring. */
  ttl: number;
}

export interface Segment {
  /** Frame index in the move's clip. */
  frame: number;
  ticks: number;
  active?: boolean;
  /** Forward speed during this segment (subpixels per frame; negative steps back). */
  vx?: number;
  /** Hitbox [x, y, w, h] in px (anchor space) when the art has no reach box for this frame. */
  reach?: readonly [number, number, number, number];
  /** Not drawn and cannot be hit (a teleport or blink vanish). */
  hidden?: boolean;
  /** Cannot be hit. */
  invuln?: boolean;
  /** Absorbs one hit: damage is taken, no stun (once per move). */
  armor?: boolean;
  /** Parry/counter window: absorbs an incoming strike with 0 damage and jumps to counterJumpTick. */
  counter?: boolean;
  /** Per-hit overrides for multi-hit moves. */
  damage?: number;
  hitstop?: number;
  knockdown?: boolean;
  launch?: number;
}

export interface MoveDef {
  id: MoveId;
  clip: string;
  segments: readonly Segment[];
  damage: number;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  /** Pushback on the defender, in subpixels, spread over COMBAT.pushFrames. */
  push: number;
  height: HitHeight;
  strength: HitStrength;
  knockdown?: boolean;
  /** Chip damage on block (specials only). */
  chip?: number;
  /** Moves this one can cancel into once it has hit or been blocked. */
  cancels?: readonly MoveId[];
  /** Air moves continue until landing; the last segment holds. */
  air?: boolean;
  /** The special spawns a projectile on this tick. */
  projectileTick?: number;
  /** Custom projectile parameters when projectileTick fires (defaults to standard Data Orb). */
  projectileSpec?: ProjectileSpec;
  /** Throws check for a grab on this tick; on a whiff they jump to whiffRecovery. */
  grabTick?: number;
  whiffRecovery?: number;
  /** Throws and command grabs launch the opponent on this tick (after a successful grab). */
  tossTick?: number;
  /** Unblockable grounded command grab checked on this tick (cannot be teched; whiffs airborne). */
  commandGrabTick?: number;
  /** Center-to-center grab reach in subpixels for command grabs (defaults to COMBAT.throwRange). */
  grabRange?: number;
  /** Move tick to jump to immediately when a `counter` segment absorbs a strike. */
  counterJumpTick?: number;
  /** Knockdowns launch the victim upward at this speed (subpixels per frame). */
  launch?: number;
  /** Each active segment can hit once (a flurry), instead of one hit per move. */
  multiHit?: boolean;
  /** Teleport: vanish on the first tick, reappear on the second. */
  vanishTick?: number;
  reappearTick?: number;
}

// Clip set v2 (spec 012) + expanded 24-special roster (spec 016).
export const MOVES: Readonly<Record<MoveId, MoveDef>> = Object.freeze({
  light_punch: {
    id: "light_punch", clip: "light_punch", height: "mid", strength: "light",
    segments: [{ frame: 0, ticks: 1 }, { frame: 1, ticks: 2 }, { frame: 2, ticks: 1, active: true }, { frame: 3, ticks: 3, active: true }, { frame: 4, ticks: 3 }, { frame: 5, ticks: 4 }],
    damage: 40, hitstun: 15, blockstun: 11, hitstop: 6, push: 900,
    cancels: ["heavy_punch", "heavy_kick", "special"],
  },
  heavy_punch: {
    id: "heavy_punch", clip: "heavy_punch", height: "mid", strength: "heavy",
    segments: [{ frame: 0, ticks: 2 }, { frame: 1, ticks: 2 }, { frame: 2, ticks: 3 }, { frame: 3, ticks: 1 }, { frame: 4, ticks: 2, active: true }, { frame: 5, ticks: 5, active: true }, { frame: 6, ticks: 5 }, { frame: 7, ticks: 7 }],
    damage: 90, hitstun: 22, blockstun: 16, hitstop: 10, push: 1400,
    cancels: ["special"],
  },
  light_kick: {
    id: "light_kick", clip: "light_kick", height: "mid", strength: "light",
    segments: [{ frame: 0, ticks: 2 }, { frame: 1, ticks: 2 }, { frame: 2, ticks: 4, active: true }, { frame: 3, ticks: 3 }, { frame: 4, ticks: 3 }, { frame: 5, ticks: 4 }],
    damage: 50, hitstun: 17, blockstun: 12, hitstop: 7, push: 1000,
    cancels: ["heavy_kick", "special"],
  },
  heavy_kick: {
    id: "heavy_kick", clip: "heavy_kick", height: "mid", strength: "heavy", knockdown: true,
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 3 }, { frame: 2, ticks: 3 }, { frame: 3, ticks: 1 }, { frame: 4, ticks: 3, active: true }, { frame: 5, ticks: 5, active: true }, { frame: 6, ticks: 5 }, { frame: 7, ticks: 4 }, { frame: 8, ticks: 5 }],
    damage: 110, hitstun: 26, blockstun: 18, hitstop: 11, push: 1600, launch: 650,
  },
  crouch_attack: {
    id: "crouch_attack", clip: "crouch_attack", height: "low", strength: "heavy", knockdown: true,
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 3 }, { frame: 2, ticks: 3, active: true }, { frame: 3, ticks: 5, active: true }, { frame: 4, ticks: 4 }, { frame: 5, ticks: 6 }],
    damage: 70, hitstun: 20, blockstun: 14, hitstop: 8, push: 1000,
  },
  air_attack: {
    id: "air_attack", clip: "air_attack", height: "overhead", strength: "light", air: true,
    segments: [{ frame: 0, ticks: 2 }, { frame: 1, ticks: 1 }, { frame: 2, ticks: 7, active: true }, { frame: 3, ticks: 7, active: true }, { frame: 4, ticks: 200 }],
    damage: 70, hitstun: 18, blockstun: 12, hitstop: 8, push: 800,
  },
  special: {
    id: "special", clip: "special", height: "mid", strength: "special",
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 5 }, { frame: 3, ticks: 4 }, { frame: 4, ticks: 3 }, { frame: 5, ticks: 3 }, { frame: 6, ticks: 9 }, { frame: 7, ticks: 8 }],
    projectileTick: 16,
    projectileSpec: { kind: "orb", speed: 600, spawnX: 6400, spawnY: -9200, halfW: 1400, halfH: 1300, ttl: 180 },
    damage: 80, hitstun: 20, blockstun: 14, hitstop: 8, push: 1200, chip: 12,
  },
  throw: {
    id: "throw", clip: "throw", height: "mid", strength: "heavy", knockdown: true,
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 4 }, { frame: 3, ticks: 3 }, { frame: 4, ticks: 2 }, { frame: 5, ticks: 8 }, { frame: 6, ticks: 10 }],
    grabTick: 3, tossTick: 16, whiffRecovery: 18,
    damage: 120, hitstun: 0, blockstun: 0, hitstop: 10, push: 0, launch: 500,
  },

  // ---------------- Original 4 Launch Fighters (Primary + Secondary) ----------------

  teleport: {
    id: "teleport", clip: "special", height: "overhead", strength: "special",
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 5 }, { frame: 2, ticks: 4, hidden: true }, { frame: 3, ticks: 4, hidden: true },
      { frame: 4, ticks: 4, invuln: true }, { frame: 5, ticks: 3 }, { frame: 6, ticks: 8, active: true }, { frame: 7, ticks: 10 }],
    vanishTick: 8, reappearTick: 16,
    damage: 85, hitstun: 20, blockstun: 14, hitstop: 9, push: 1200, chip: 10,
  },
  charge: {
    id: "charge", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 500,
    segments: [{ frame: 0, ticks: 4 }, { frame: 1, ticks: 6, armor: true }, { frame: 2, ticks: 4, active: true, armor: true, vx: 700 },
      { frame: 3, ticks: 5, active: true, armor: true, vx: 700 }, { frame: 4, ticks: 5, active: true, armor: true, vx: 700, reach: [30, -124, 40, 64] },
      { frame: 5, ticks: 4, active: true, vx: 300 }, { frame: 6, ticks: 9 }, { frame: 7, ticks: 9 }],
    damage: 110, hitstun: 0, blockstun: 18, hitstop: 12, push: 1400, chip: 14,
  },
  rush: {
    id: "rush", clip: "special", height: "mid", strength: "special", multiHit: true,
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 5, vx: 800 }, { frame: 2, ticks: 3, active: true, vx: 300 },
      { frame: 3, ticks: 3, active: true, vx: 300 }, { frame: 4, ticks: 3, active: true, vx: 300, reach: [24, -122, 48, 26] }, { frame: 5, ticks: 4, vx: 300 },
      { frame: 6, ticks: 3, active: true, vx: 200, damage: 60, hitstop: 10, knockdown: true, launch: 900, reach: [6, -158, 48, 80] },
      { frame: 7, ticks: 6 }, { frame: 8, ticks: 6 }],
    damage: 28, hitstun: 16, blockstun: 10, hitstop: 5, push: 250, chip: 6,
  },
  rising_commit: {
    // Julien F+S: invulnerable rising anti-air uppercut
    id: "rising_commit", clip: "heavy_punch", height: "mid", strength: "special", knockdown: true, launch: 820,
    segments: [
      { frame: 0, ticks: 2, invuln: true },
      { frame: 2, ticks: 3, invuln: true, vx: 220 },
      { frame: 4, ticks: 3, active: true, invuln: true, vx: 240, reach: [14, -162, 46, 88] },
      { frame: 5, ticks: 6, active: true, vx: 120, reach: [18, -168, 48, 92] },
      { frame: 6, ticks: 8 },
      { frame: 7, ticks: 10 },
    ],
    damage: 95, hitstun: 22, blockstun: 14, hitstop: 11, push: 1100, chip: 12,
  },
  phantom_ping: {
    // Felicia F+S: evasive backstep feint that fires an angled spark pulse
    id: "phantom_ping", clip: "summon", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 3, vx: -500, invuln: true },
      { frame: 1, ticks: 5, vx: -420 },
      { frame: 2, ticks: 6 },
      { frame: 3, ticks: 12 },
    ],
    projectileTick: 11,
    projectileSpec: { kind: "fast_packet", speed: 820, spawnX: 5600, spawnY: -9400, halfW: 1600, halfH: 1100, ttl: 120 },
    damage: 65, hitstun: 18, blockstun: 12, hitstop: 7, push: 1000, chip: 10,
  },
  seismic_slam: {
    // Pentcho F+S: armored stomp sending a low floor shockwave
    id: "seismic_slam", clip: "summon", height: "low", strength: "special", knockdown: true, launch: 380,
    segments: [
      { frame: 0, ticks: 4 },
      { frame: 1, ticks: 7, armor: true },
      { frame: 2, ticks: 6, active: true, armor: true, reach: [18, -44, 54, 42] },
      { frame: 3, ticks: 14 },
    ],
    projectileTick: 13,
    projectileSpec: { kind: "shockwave", speed: 540, spawnX: 5800, spawnY: -2200, halfW: 1800, halfH: 1600, ttl: 110 },
    damage: 78, hitstun: 20, blockstun: 15, hitstop: 9, push: 1200, chip: 12,
  },
  canary_hop: {
    // Alex F+S: advancing overhead hop-kick to crack crouching turtles
    id: "canary_hop", clip: "heavy_kick", height: "overhead", strength: "special",
    segments: [
      { frame: 0, ticks: 3 },
      { frame: 2, ticks: 5, vx: 480 },
      { frame: 4, ticks: 5, vx: 440 },
      { frame: 5, ticks: 6, active: true, vx: 220, reach: [20, -128, 56, 54] },
      { frame: 7, ticks: 5 },
      { frame: 8, ticks: 7 },
    ],
    damage: 82, hitstun: 21, blockstun: 13, hitstop: 9, push: 900, chip: 10,
  },

  // ---------------- 8 New Fighters (Primary + Secondary) ----------------

  packet_sniper: {
    // Ethan S: long-range piercing high-velocity data bolt
    id: "packet_sniper", clip: "special", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 4 }, { frame: 3, ticks: 3 },
      { frame: 4, ticks: 3 }, { frame: 5, ticks: 8 }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 6 },
    ],
    projectileTick: 15,
    projectileSpec: { kind: "fast_packet", speed: 940, spawnX: 6800, spawnY: -9600, halfW: 1800, halfH: 1100, ttl: 150 },
    damage: 76, hitstun: 19, blockstun: 14, hitstop: 8, push: 1500, chip: 14,
  },
  rate_mine: {
    // Ethan F+S: deploys a stationary lingering trap orb ahead
    id: "rate_mine", clip: "summon", height: "mid", strength: "special", knockdown: true, launch: 520,
    segments: [
      { frame: 0, ticks: 4 },
      { frame: 1, ticks: 6 },
      { frame: 2, ticks: 6 },
      { frame: 3, ticks: 12 },
    ],
    projectileTick: 12,
    projectileSpec: { kind: "slow_mine", speed: 0, spawnX: 11500, spawnY: -7800, halfW: 1900, halfH: 1900, ttl: 135 },
    damage: 88, hitstun: 24, blockstun: 16, hitstop: 10, push: 1300, chip: 12,
  },

  rollback_parry: {
    // Megane S: poised parry stance -> instant lunging palm-slash reversal on counter!
    id: "rollback_parry", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 720,
    segments: [
      { frame: 0, ticks: 3 },
      { frame: 1, ticks: 6, counter: true },
      { frame: 2, ticks: 8, counter: true },
      { frame: 3, ticks: 8 }, // whiff recovery hold if nothing hit the parry
      { frame: 4, ticks: 3, invuln: true, vx: 520 }, // tick 25 (counterJumpTick!)
      { frame: 5, ticks: 3, active: true, invuln: true, vx: 380, reach: [24, -124, 58, 42] },
      { frame: 6, ticks: 6, active: true, reach: [24, -120, 62, 40] },
      { frame: 7, ticks: 8 },
    ],
    counterJumpTick: 25,
    damage: 120, hitstun: 24, blockstun: 14, hitstop: 12, push: 1400, chip: 10,
  },
  velvet_cross: {
    // Megane F+S: swift forward spin-glide overhead kick
    id: "velvet_cross", clip: "heavy_kick", height: "overhead", strength: "special",
    segments: [
      { frame: 0, ticks: 3 },
      { frame: 1, ticks: 4, vx: 580 },
      { frame: 3, ticks: 5, vx: 520 },
      { frame: 5, ticks: 6, active: true, vx: 200, reach: [20, -132, 58, 52] },
      { frame: 7, ticks: 5 },
      { frame: 8, ticks: 7 },
    ],
    damage: 84, hitstun: 20, blockstun: 13, hitstop: 9, push: 1000, chip: 10,
  },

  skyline_upper: {
    // Jerry S: invincible rising dragon uppercut anti-air
    id: "skyline_upper", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 860,
    segments: [
      { frame: 0, ticks: 2, invuln: true },
      { frame: 1, ticks: 3, invuln: true },
      { frame: 2, ticks: 2, invuln: true, vx: 260 },
      { frame: 3, ticks: 4, active: true, invuln: true, vx: 240, reach: [14, -172, 48, 96] },
      { frame: 4, ticks: 6, active: true, vx: 120, reach: [16, -178, 48, 96] },
      { frame: 5, ticks: 6 },
      { frame: 6, ticks: 6 },
      { frame: 7, ticks: 8 },
    ],
    damage: 102, hitstun: 24, blockstun: 14, hitstop: 12, push: 1200, chip: 12,
  },
  twin_thread: {
    // Jerry F+S: crisp balanced mid projectile wave
    id: "twin_thread", clip: "summon", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 4 },
      { frame: 1, ticks: 5 },
      { frame: 2, ticks: 5 },
      { frame: 3, ticks: 14 },
    ],
    projectileTick: 11,
    projectileSpec: { kind: "orb", speed: 700, spawnX: 6200, spawnY: -9200, halfW: 1500, halfH: 1400, ttl: 160 },
    damage: 78, hitstun: 20, blockstun: 14, hitstop: 8, push: 1200, chip: 12,
  },

  force_push: {
    // Scott S: armored step-in unblockable command grab power-slam!
    id: "force_push", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 640,
    segments: [
      { frame: 0, ticks: 4 },
      { frame: 1, ticks: 4, armor: true, vx: 420 },
      { frame: 2, ticks: 4, armor: true, vx: 320 }, // commandGrabTick at 10
      { frame: 3, ticks: 5 },
      { frame: 4, ticks: 5 },
      { frame: 5, ticks: 7 }, // tossTick at 22
      { frame: 6, ticks: 6 },
      { frame: 7, ticks: 7 },
    ],
    commandGrabTick: 10, grabRange: 9600, tossTick: 22, whiffRecovery: 18,
    damage: 145, hitstun: 0, blockstun: 0, hitstop: 13, push: 0,
  },
  breaker_lariat: {
    // Scott F+S: heavy 1-hit armored advancing clothesline
    id: "breaker_lariat", clip: "heavy_punch", height: "mid", strength: "special", knockdown: true, launch: 460,
    segments: [
      { frame: 0, ticks: 3 },
      { frame: 2, ticks: 5, armor: true, vx: 460 },
      { frame: 4, ticks: 3, active: true, armor: true, vx: 540, reach: [22, -132, 62, 48] },
      { frame: 5, ticks: 6, active: true, vx: 340, reach: [26, -132, 64, 48] },
      { frame: 6, ticks: 7 },
      { frame: 7, ticks: 9 },
    ],
    damage: 118, hitstun: 24, blockstun: 18, hitstop: 12, push: 1800, chip: 16,
  },

  golden_rush: {
    // Antonia S: fast low-profile baseball slide kick (hits low, knocks down)
    id: "golden_rush", clip: "special", height: "low", strength: "special", knockdown: true, launch: 420,
    segments: [
      { frame: 0, ticks: 3 },
      { frame: 1, ticks: 3, vx: 620 },
      { frame: 2, ticks: 3, vx: 720 },
      { frame: 3, ticks: 5, active: true, vx: 640, reach: [22, -36, 56, 34] },
      { frame: 4, ticks: 5, active: true, vx: 420, reach: [24, -34, 62, 32] },
      { frame: 5, ticks: 5 },
      { frame: 6, ticks: 5 },
      { frame: 7, ticks: 6 },
    ],
    damage: 86, hitstun: 20, blockstun: 13, hitstop: 9, push: 900, chip: 10,
  },
  crown_dive: {
    // Antonia F+S: leaping forward axe-kick (hits overhead, pairs with Golden Rush low!)
    id: "crown_dive", clip: "heavy_kick", height: "overhead", strength: "special",
    segments: [
      { frame: 0, ticks: 3 },
      { frame: 2, ticks: 5, vx: 520 },
      { frame: 4, ticks: 5, vx: 480 },
      { frame: 5, ticks: 6, active: true, vx: 240, reach: [22, -130, 58, 56] },
      { frame: 7, ticks: 5 },
      { frame: 8, ticks: 6 },
    ],
    damage: 84, hitstun: 22, blockstun: 14, hitstop: 9, push: 850, chip: 10,
  },

  ground_fault: {
    // Vincent S: ground-fist slam with close hitbox + low-skimming floor shockwave
    id: "ground_fault", clip: "special", height: "low", strength: "special",
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 4 }, { frame: 3, ticks: 3 },
      { frame: 4, ticks: 5, active: true, reach: [18, -48, 52, 46] },
      { frame: 5, ticks: 7 }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 6 },
    ],
    projectileTick: 15,
    projectileSpec: { kind: "shockwave", speed: 660, spawnX: 6000, spawnY: -2200, halfW: 1900, halfH: 1600, ttl: 140 },
    damage: 76, hitstun: 20, blockstun: 15, hitstop: 8, push: 1350, chip: 12,
  },
  arc_beacon: {
    // Vincent F+S: upward-angled anti-air energy pulse that snipes jumpers
    id: "arc_beacon", clip: "summon", height: "mid", strength: "special", knockdown: true, launch: 580,
    segments: [
      { frame: 0, ticks: 3 },
      { frame: 1, ticks: 5 },
      { frame: 2, ticks: 5 },
      { frame: 3, ticks: 13 },
    ],
    projectileTick: 10,
    projectileSpec: { kind: "arc_burst", speed: 520, vy: -280, spawnX: 5400, spawnY: -10200, halfW: 1800, halfH: 1800, ttl: 55 },
    damage: 86, hitstun: 22, blockstun: 14, hitstop: 9, push: 1200, chip: 12,
  },

  cache_blink: {
    // Saransh S: vanished forward phase-dash emerging into a 2-hit spin-backfist + side-kick!
    id: "cache_blink", clip: "special", height: "mid", strength: "special", multiHit: true,
    segments: [
      { frame: 0, ticks: 3 },
      { frame: 1, ticks: 4, hidden: true, vx: 760 },
      { frame: 2, ticks: 5, hidden: true, vx: 760 },
      { frame: 3, ticks: 3, invuln: true, vx: 260 },
      { frame: 4, ticks: 4, active: true, vx: 220, damage: 38, hitstop: 6, reach: [24, -118, 48, 32] },
      { frame: 5, ticks: 3, vx: 180 },
      { frame: 6, ticks: 6, active: true, damage: 58, hitstop: 10, knockdown: true, launch: 560, reach: [16, -98, 72, 38] },
      { frame: 7, ticks: 8 },
    ],
    vanishTick: 3,
    damage: 45, hitstun: 18, blockstun: 12, hitstop: 7, push: 600, chip: 8,
  },
  mirage_trap: {
    // Saransh F+S: evasive back-hop leaving a hovering static mine at his old position!
    id: "mirage_trap", clip: "summon", height: "mid", strength: "special", knockdown: true, launch: 480,
    segments: [
      { frame: 0, ticks: 3, invuln: true, vx: -560 },
      { frame: 1, ticks: 6, vx: -460 },
      { frame: 2, ticks: 6 },
      { frame: 3, ticks: 11 },
    ],
    projectileTick: 4,
    projectileSpec: { kind: "slow_mine", speed: 0, spawnX: 3800, spawnY: -8400, halfW: 1800, halfH: 1800, ttl: 125 },
    damage: 82, hitstun: 22, blockstun: 15, hitstop: 9, push: 1100, chip: 10,
  },

  anvil_drop: {
    // Tyler S: armored hop into crushing double-axe overhead slam
    id: "anvil_drop", clip: "special", height: "overhead", strength: "special", knockdown: true, launch: 480,
    segments: [
      { frame: 0, ticks: 4 },
      { frame: 1, ticks: 4, armor: true },
      { frame: 2, ticks: 4, armor: true, vx: 460 },
      { frame: 3, ticks: 5, armor: true, vx: 440 },
      { frame: 4, ticks: 3, active: true, vx: 260, reach: [20, -142, 54, 72] },
      { frame: 5, ticks: 6, active: true, reach: [22, -110, 60, 78] },
      { frame: 6, ticks: 7 },
      { frame: 7, ticks: 8 },
    ],
    damage: 112, hitstun: 24, blockstun: 16, hitstop: 12, push: 1400, chip: 14,
  },
  steel_counter: {
    // Tyler F+S: braced guard absorb -> devastating gut-breaker launch!
    id: "steel_counter", clip: "heavy_punch", height: "mid", strength: "special", knockdown: true, launch: 780,
    segments: [
      { frame: 0, ticks: 3 },
      { frame: 1, ticks: 7, counter: true },
      { frame: 2, ticks: 8, counter: true },
      { frame: 3, ticks: 8 }, // whiff recovery if unhit
      { frame: 4, ticks: 3, invuln: true, vx: 440 }, // tick 26 (counterJumpTick!)
      { frame: 5, ticks: 6, active: true, invuln: true, vx: 240, reach: [22, -128, 60, 48] },
      { frame: 6, ticks: 6 },
      { frame: 7, ticks: 8 },
    ],
    counterJumpTick: 26,
    damage: 125, hitstun: 26, blockstun: 16, hitstop: 13, push: 1500, chip: 12,
  },

  // ---------------- Remaining 25 Colleagues (Spec 017: 50 Unique Specials) ----------------

  vector_slash: {
    // Andrea S: crisp advancing horizontal knife-hand slash
    id: "vector_slash", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 520,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 3, vx: 380 }, { frame: 2, ticks: 3, vx: 360 },
      { frame: 3, ticks: 3, vx: 300 }, { frame: 4, ticks: 3, active: true, vx: 220, reach: [22, -124, 54, 38] },
      { frame: 5, ticks: 6, active: true, reach: [26, -124, 62, 40] }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 7 },
    ],
    damage: 94, hitstun: 22, blockstun: 14, hitstop: 10, push: 1350, chip: 12,
  },
  skyward_hook: {
    // Andrea F+S: invulnerable rising anti-air uppercut
    id: "skyward_hook", clip: "heavy_punch", height: "mid", strength: "special", knockdown: true, launch: 840,
    segments: [
      { frame: 0, ticks: 2, invuln: true }, { frame: 2, ticks: 3, invuln: true, vx: 240 },
      { frame: 4, ticks: 3, active: true, invuln: true, vx: 240, reach: [16, -166, 48, 90] },
      { frame: 5, ticks: 6, active: true, vx: 120, reach: [18, -170, 48, 92] },
      { frame: 6, ticks: 7 }, { frame: 7, ticks: 9 },
    ],
    damage: 98, hitstun: 23, blockstun: 14, hitstop: 11, push: 1150, chip: 12,
  },

  prism_volley: {
    // Aurelien S: high-velocity twin-palm prism packet
    id: "prism_volley", clip: "special", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 4 }, { frame: 3, ticks: 3 },
      { frame: 4, ticks: 3 }, { frame: 5, ticks: 8 }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 7 },
    ],
    projectileTick: 16,
    projectileSpec: { kind: "fast_packet", speed: 880, spawnX: 6600, spawnY: -9400, halfW: 1700, halfH: 1200, ttl: 155 },
    damage: 78, hitstun: 20, blockstun: 14, hitstop: 8, push: 1450, chip: 13,
  },
  static_tether: {
    // Aurelien F+S: mid-screen hovering tether mine
    id: "static_tether", clip: "summon", height: "mid", strength: "special", knockdown: true, launch: 500,
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 6 }, { frame: 2, ticks: 6 }, { frame: 3, ticks: 12 },
    ],
    projectileTick: 12,
    projectileSpec: { kind: "slow_mine", speed: 0, spawnX: 9800, spawnY: -8200, halfW: 1850, halfH: 1850, ttl: 145 },
    damage: 86, hitstun: 23, blockstun: 15, hitstop: 10, push: 1250, chip: 12,
  },

  mirror_step: {
    // Dana S: poised evasion parry -> spinning hook-kick reversal
    id: "mirror_step", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 740,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 6, counter: true }, { frame: 2, ticks: 8, counter: true },
      { frame: 3, ticks: 7 },
      { frame: 4, ticks: 3, invuln: true, vx: 480 }, // tick 24
      { frame: 5, ticks: 3, active: true, invuln: true, vx: 340, reach: [22, -124, 58, 42] },
      { frame: 6, ticks: 6, active: true, reach: [24, -122, 62, 42] }, { frame: 7, ticks: 8 },
    ],
    counterJumpTick: 24,
    damage: 118, hitstun: 24, blockstun: 14, hitstop: 12, push: 1400, chip: 10,
  },
  crescent_feint: {
    // Dana F+S: micro-backstep feint into lunging overhead kick
    id: "crescent_feint", clip: "heavy_kick", height: "overhead", strength: "special",
    segments: [
      { frame: 0, ticks: 4, vx: -380 }, { frame: 2, ticks: 4, vx: 580 }, { frame: 4, ticks: 4, vx: 560 },
      { frame: 5, ticks: 6, active: true, vx: 220, reach: [22, -132, 58, 54] },
      { frame: 7, ticks: 5 }, { frame: 8, ticks: 7 },
    ],
    damage: 86, hitstun: 21, blockstun: 13, hitstop: 9, push: 950, chip: 10,
  },

  turbo_blitz: {
    // Duc S: explosive 3-hit jab-cross-flying-knee rush
    id: "turbo_blitz", clip: "special", height: "mid", strength: "special", multiHit: true,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4, vx: 760 },
      { frame: 2, ticks: 3, active: true, vx: 320, reach: [24, -122, 50, 32] },
      { frame: 3, ticks: 3, active: true, vx: 320, reach: [24, -122, 52, 32] },
      { frame: 4, ticks: 3, vx: 340 }, { frame: 5, ticks: 3, vx: 300 },
      { frame: 6, ticks: 5, active: true, vx: 220, damage: 56, hitstop: 10, knockdown: true, launch: 760, reach: [18, -142, 52, 68] },
      { frame: 7, ticks: 8 },
    ],
    damage: 28, hitstun: 16, blockstun: 10, hitstop: 5, push: 260, chip: 6,
  },
  flash_knee: {
    // Duc F+S: quick-startup advancing pressure knee
    id: "flash_knee", clip: "light_kick", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 2, vx: 520 }, { frame: 1, ticks: 3, vx: 580 },
      { frame: 2, ticks: 5, active: true, vx: 320, reach: [20, -112, 54, 46] },
      { frame: 3, ticks: 4 }, { frame: 4, ticks: 4 }, { frame: 5, ticks: 5 },
    ],
    damage: 78, hitstun: 20, blockstun: 15, hitstop: 8, push: 850, chip: 10,
  },

  signal_beam: {
    // Elina S: high-pushback long-screen beam packet
    id: "signal_beam", clip: "special", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 4 }, { frame: 3, ticks: 3 },
      { frame: 4, ticks: 3 }, { frame: 5, ticks: 8 }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 6 },
    ],
    projectileTick: 15,
    projectileSpec: { kind: "fast_packet", speed: 960, spawnX: 6800, spawnY: -9500, halfW: 1800, halfH: 1100, ttl: 150 },
    damage: 75, hitstun: 19, blockstun: 14, hitstop: 8, push: 1550, chip: 14,
  },
  pulse_beacon: {
    // Elina F+S: angled anti-air pulse burst
    id: "pulse_beacon", clip: "summon", height: "mid", strength: "special", knockdown: true, launch: 600,
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 5 }, { frame: 2, ticks: 5 }, { frame: 3, ticks: 13 },
    ],
    projectileTick: 10,
    projectileSpec: { kind: "arc_burst", speed: 580, vy: -380, spawnX: 5400, spawnY: -9800, halfW: 1650, halfH: 1650, ttl: 95 },
    damage: 84, hitstun: 22, blockstun: 14, hitstop: 9, push: 1200, chip: 12,
  },

  titan_press: {
    // Emile S: armored step-in unblockable bear-hug command grab
    id: "titan_press", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 620,
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 4, armor: true, vx: 380 },
      { frame: 2, ticks: 5, armor: true, vx: 340 }, // commandGrabTick at 11
      { frame: 3, ticks: 5 }, { frame: 4, ticks: 5 },
      { frame: 5, ticks: 7 }, // tossTick at 24
      { frame: 6, ticks: 6 }, { frame: 7, ticks: 7 },
    ],
    commandGrabTick: 11, grabRange: 9800, tossTick: 24, whiffRecovery: 18,
    damage: 148, hitstun: 0, blockstun: 0, hitstop: 13, push: 0,
  },
  tectonic_stomp: {
    // Emile F+S: armored stomp sending a low floor shockwave
    id: "tectonic_stomp", clip: "summon", height: "low", strength: "special", knockdown: true, launch: 400,
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 7, armor: true },
      { frame: 2, ticks: 6, active: true, armor: true, reach: [18, -46, 56, 44] }, { frame: 3, ticks: 14 },
    ],
    projectileTick: 13,
    projectileSpec: { kind: "shockwave", speed: 560, spawnX: 5800, spawnY: -2200, halfW: 1850, halfH: 1600, ttl: 115 },
    damage: 82, hitstun: 21, blockstun: 15, hitstop: 9, push: 1300, chip: 13,
  },

  comet_upper: {
    // Francesco S: invulnerable rising dragon uppercut
    id: "comet_upper", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 880,
    segments: [
      { frame: 0, ticks: 2, invuln: true }, { frame: 1, ticks: 3, invuln: true },
      { frame: 2, ticks: 2, invuln: true, vx: 260 },
      { frame: 3, ticks: 4, active: true, invuln: true, vx: 250, reach: [14, -172, 48, 96] },
      { frame: 4, ticks: 6, active: true, vx: 120, reach: [16, -178, 48, 96] },
      { frame: 5, ticks: 6 }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 8 },
    ],
    damage: 100, hitstun: 24, blockstun: 14, hitstop: 12, push: 1200, chip: 12,
  },
  spark_bolt: {
    // Francesco F+S: crisp mid-range spark orb
    id: "spark_bolt", clip: "summon", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 5 }, { frame: 2, ticks: 5 }, { frame: 3, ticks: 14 },
    ],
    projectileTick: 11,
    projectileSpec: { kind: "orb", speed: 660, spawnX: 6200, spawnY: -9200, halfW: 1450, halfH: 1400, ttl: 170 },
    damage: 78, hitstun: 20, blockstun: 14, hitstop: 8, push: 1200, chip: 12,
  },

  granite_tackle: {
    // Guillaume F. S: super-armored shoulder-and-forearm barge
    id: "granite_tackle", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 480,
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 5, armor: true },
      { frame: 2, ticks: 4, active: true, armor: true, vx: 660, reach: [24, -124, 52, 58] },
      { frame: 3, ticks: 4, active: true, armor: true, vx: 660, reach: [26, -124, 54, 58] },
      { frame: 4, ticks: 4, active: true, armor: true, vx: 620, reach: [26, -124, 56, 58] },
      { frame: 5, ticks: 5, active: true, vx: 280, reach: [28, -124, 58, 58] },
      { frame: 6, ticks: 8 }, { frame: 7, ticks: 8 },
    ],
    damage: 115, hitstun: 24, blockstun: 18, hitstop: 12, push: 1700, chip: 15,
  },
  vault_throw: {
    // Guillaume F. F+S: close armored command throw
    id: "vault_throw", clip: "throw", height: "mid", strength: "special", knockdown: true, launch: 680,
    segments: [
      { frame: 0, ticks: 4, vx: 360 }, { frame: 1, ticks: 5, armor: true, vx: 300 }, // commandGrabTick at 8
      { frame: 2, ticks: 4 }, { frame: 3, ticks: 4 }, { frame: 4, ticks: 3 }, // tossTick at 18
      { frame: 5, ticks: 7 }, { frame: 6, ticks: 9 },
    ],
    commandGrabTick: 8, grabRange: 9200, tossTick: 18, whiffRecovery: 16,
    damage: 138, hitstun: 0, blockstun: 0, hitstop: 12, push: 0,
  },

  rail_shot: {
    // Guillaume P. S: fastest sniper rail packet in the game
    id: "rail_shot", clip: "special", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 4 }, { frame: 3, ticks: 3 },
      { frame: 4, ticks: 3 }, { frame: 5, ticks: 9 }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 6 },
    ],
    projectileTick: 16,
    projectileSpec: { kind: "fast_packet", speed: 1000, spawnX: 6800, spawnY: -9200, halfW: 1900, halfH: 1050, ttl: 140 },
    damage: 80, hitstun: 20, blockstun: 15, hitstop: 9, push: 1600, chip: 15,
  },
  anchor_mine: {
    // Guillaume P. F+S: close anti-rushdown proximity mine
    id: "anchor_mine", clip: "summon", height: "mid", strength: "special", knockdown: true, launch: 540,
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 5 }, { frame: 2, ticks: 6 }, { frame: 3, ticks: 12 },
    ],
    projectileTick: 11,
    projectileSpec: { kind: "slow_mine", speed: 0, spawnX: 7400, spawnY: -7600, halfW: 1900, halfH: 1900, ttl: 150 },
    damage: 90, hitstun: 24, blockstun: 16, hitstop: 10, push: 1350, chip: 12,
  },

  tempest_kick: {
    // Jewoo S: 2-hit spinning tornado jump kick
    id: "tempest_kick", clip: "special", height: "mid", strength: "special", multiHit: true,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 3, vx: 520 }, { frame: 2, ticks: 3, vx: 540 },
      { frame: 3, ticks: 4, active: true, vx: 480, reach: [18, -128, 52, 44] },
      { frame: 4, ticks: 3, vx: 440 },
      { frame: 5, ticks: 6, active: true, vx: 320, damage: 58, hitstop: 10, knockdown: true, launch: 640, reach: [22, -126, 64, 48] },
      { frame: 6, ticks: 6 }, { frame: 7, ticks: 7 },
    ],
    damage: 38, hitstun: 18, blockstun: 12, hitstop: 6, push: 450, chip: 8,
  },
  spiral_dive: {
    // Jewoo F+S: advancing overhead roundhouse drop
    id: "spiral_dive", clip: "heavy_kick", height: "overhead", strength: "special",
    segments: [
      { frame: 0, ticks: 3 }, { frame: 2, ticks: 5, vx: 540 }, { frame: 4, ticks: 4, vx: 500 },
      { frame: 5, ticks: 6, active: true, vx: 240, reach: [22, -130, 58, 54] },
      { frame: 7, ticks: 5 }, { frame: 8, ticks: 7 },
    ],
    damage: 84, hitstun: 21, blockstun: 13, hitstop: 9, push: 950, chip: 10,
  },

  dragon_merge: {
    // Jonah S: armored coil into explosive twin-fist strike
    id: "dragon_merge", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 600,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4, armor: true }, { frame: 2, ticks: 4, armor: true, vx: 360 },
      { frame: 3, ticks: 3, vx: 440 }, { frame: 4, ticks: 3, active: true, vx: 300, reach: [22, -124, 54, 42] },
      { frame: 5, ticks: 7, active: true, reach: [26, -126, 64, 44] }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 7 },
    ],
    damage: 106, hitstun: 24, blockstun: 16, hitstop: 11, push: 1650, chip: 14,
  },
  node_pulse: {
    // Jonah F+S: steady mid-screen data orb
    id: "node_pulse", clip: "summon", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 5 }, { frame: 2, ticks: 5 }, { frame: 3, ticks: 14 },
    ],
    projectileTick: 11,
    projectileSpec: { kind: "orb", speed: 640, spawnX: 6200, spawnY: -9200, halfW: 1450, halfH: 1350, ttl: 175 },
    damage: 78, hitstun: 20, blockstun: 14, hitstop: 8, push: 1200, chip: 12,
  },

  shadow_pivot: {
    // Jonathan S: vanish cross-up teleport into overhead ridge-hand chop
    id: "shadow_pivot", clip: "special", height: "overhead", strength: "special",
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4 },
      { frame: 2, ticks: 4, hidden: true }, { frame: 3, ticks: 4, hidden: true },
      { frame: 4, ticks: 3, invuln: true }, { frame: 5, ticks: 3, vx: 260 },
      { frame: 6, ticks: 7, active: true, reach: [22, -130, 56, 46] }, { frame: 7, ticks: 9 },
    ],
    vanishTick: 7, reappearTick: 15,
    damage: 86, hitstun: 20, blockstun: 14, hitstop: 9, push: 1150, chip: 10,
  },
  null_counter: {
    // Jonathan F+S: tight parry window -> explosive shock-palm reversal
    id: "null_counter", clip: "block_push", height: "mid", strength: "special", knockdown: true, launch: 660,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 0, ticks: 8, counter: true }, { frame: 0, ticks: 6 },
      { frame: 1, ticks: 6, active: true, invuln: true, vx: 360, reach: [20, -124, 62, 48] }, // tick 17
      { frame: 2, ticks: 8 },
    ],
    counterJumpTick: 17,
    damage: 116, hitstun: 24, blockstun: 15, hitstop: 12, push: 1900, chip: 10,
  },

  cobalt_crush: {
    // Logan S: armored bounding hop into crushing overhand haymaker
    id: "cobalt_crush", clip: "special", height: "overhead", strength: "special", knockdown: true, launch: 500,
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 4, armor: true },
      { frame: 2, ticks: 4, armor: true, vx: 480 }, { frame: 3, ticks: 4, armor: true, vx: 460 },
      { frame: 4, ticks: 3, active: true, vx: 280, reach: [22, -138, 56, 66] },
      { frame: 5, ticks: 6, active: true, reach: [24, -118, 62, 68] },
      { frame: 6, ticks: 7 }, { frame: 7, ticks: 8 },
    ],
    damage: 116, hitstun: 24, blockstun: 16, hitstop: 12, push: 1450, chip: 14,
  },
  blue_shift_grab: {
    // Logan F+S: armored step-in unblockable command grab
    id: "blue_shift_grab", clip: "throw", height: "mid", strength: "special", knockdown: true, launch: 640,
    segments: [
      { frame: 0, ticks: 4, vx: 400 }, { frame: 1, ticks: 6, armor: true, vx: 320 }, // commandGrabTick at 9
      { frame: 2, ticks: 4 }, { frame: 3, ticks: 4 }, { frame: 4, ticks: 3 }, // tossTick at 19
      { frame: 5, ticks: 7 }, { frame: 6, ticks: 8 },
    ],
    commandGrabTick: 9, grabRange: 9500, tossTick: 19, whiffRecovery: 17,
    damage: 142, hitstun: 0, blockstun: 0, hitstop: 13, push: 0,
  },

  vortex_combo: {
    // Milen S: 3-hit hook + body-blow + spinning back-kick launcher
    id: "vortex_combo", clip: "special", height: "mid", strength: "special", multiHit: true,
    segments: [
      { frame: 0, ticks: 3 },
      { frame: 1, ticks: 3, active: true, vx: 460, reach: [22, -122, 50, 32] },
      { frame: 2, ticks: 3, active: true, vx: 380, reach: [22, -108, 50, 32] },
      { frame: 3, ticks: 3, vx: 300 }, { frame: 4, ticks: 3, vx: 280 }, { frame: 5, ticks: 3, vx: 260 },
      { frame: 6, ticks: 5, active: true, vx: 200, damage: 58, hitstop: 10, knockdown: true, launch: 720, reach: [24, -118, 62, 44] },
      { frame: 7, ticks: 8 },
    ],
    damage: 28, hitstun: 16, blockstun: 10, hitstop: 5, push: 260, chip: 6,
  },
  jet_sweep: {
    // Milen F+S: fast advancing low slide-sweep
    id: "jet_sweep", clip: "crouch_attack", height: "low", strength: "special", knockdown: true, launch: 420,
    segments: [
      { frame: 0, ticks: 3, vx: 520 }, { frame: 1, ticks: 3, vx: 600 },
      { frame: 2, ticks: 3, active: true, vx: 520, reach: [20, -44, 58, 42] },
      { frame: 3, ticks: 5, active: true, vx: 280, reach: [24, -42, 64, 40] },
      { frame: 4, ticks: 5 }, { frame: 5, ticks: 7 },
    ],
    damage: 86, hitstun: 22, blockstun: 15, hitstop: 9, push: 1050, chip: 10,
  },

  lotus_strike: {
    // Minh S: armored circular palm guard into lunging double-palm thrust
    id: "lotus_strike", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 580,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4, armor: true },
      { frame: 2, ticks: 3, vx: 440 }, { frame: 3, ticks: 3, vx: 420 },
      { frame: 4, ticks: 3, active: true, vx: 320, reach: [22, -120, 54, 40] },
      { frame: 5, ticks: 7, active: true, reach: [26, -122, 62, 42] }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 7 },
    ],
    damage: 102, hitstun: 23, blockstun: 15, hitstop: 11, push: 1500, chip: 13,
  },
  horizon_orb: {
    // Minh F+S: poised long-duration mid orb
    id: "horizon_orb", clip: "summon", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 5 }, { frame: 2, ticks: 5 }, { frame: 3, ticks: 14 },
    ],
    projectileTick: 11,
    projectileSpec: { kind: "orb", speed: 620, spawnX: 6200, spawnY: -9200, halfW: 1450, halfH: 1400, ttl: 185 },
    damage: 80, hitstun: 20, blockstun: 14, hitstop: 8, push: 1250, chip: 12,
  },

  starlight_hop: {
    // Oyku S: nimble low-crush hop into overhead axe-kick
    id: "starlight_hop", clip: "special", height: "overhead", strength: "special", knockdown: true, launch: 460,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 3, vx: 440 },
      { frame: 2, ticks: 4, vx: 480 }, { frame: 3, ticks: 4, vx: 440 },
      { frame: 4, ticks: 3, active: true, vx: 260, reach: [20, -134, 54, 58] },
      { frame: 5, ticks: 6, active: true, vx: 160, reach: [22, -118, 58, 62] },
      { frame: 6, ticks: 6 }, { frame: 7, ticks: 7 },
    ],
    damage: 90, hitstun: 22, blockstun: 14, hitstop: 10, push: 1050, chip: 11,
  },
  silk_parry: {
    // Oyku F+S: graceful parry counter -> swift rising counter punch
    id: "silk_parry", clip: "heavy_punch", height: "mid", strength: "special", knockdown: true, launch: 760,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 6, counter: true }, { frame: 2, ticks: 8, counter: true },
      { frame: 3, ticks: 7 },
      { frame: 4, ticks: 3, invuln: true, vx: 420 }, // tick 24
      { frame: 5, ticks: 5, active: true, invuln: true, vx: 240, reach: [22, -134, 58, 52] },
      { frame: 6, ticks: 6 }, { frame: 7, ticks: 7 },
    ],
    counterJumpTick: 24,
    damage: 118, hitstun: 24, blockstun: 14, hitstop: 12, push: 1350, chip: 10,
  },

  forge_breaker: {
    // Philippe S: heavy armored step-through clothesline lariat
    id: "forge_breaker", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 480,
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 4, armor: true }, { frame: 2, ticks: 4, armor: true, vx: 420 },
      { frame: 3, ticks: 4, armor: true, vx: 520 },
      { frame: 4, ticks: 3, active: true, vx: 440, reach: [24, -128, 60, 48] },
      { frame: 5, ticks: 7, active: true, vx: 240, reach: [28, -128, 66, 50] },
      { frame: 6, ticks: 7 }, { frame: 7, ticks: 8 },
    ],
    damage: 120, hitstun: 25, blockstun: 18, hitstop: 12, push: 1750, chip: 16,
  },
  iron_guard: {
    // Philippe F+S: braced iron guard counter -> heavy counter hook
    id: "iron_guard", clip: "heavy_punch", height: "mid", strength: "special", knockdown: true, launch: 740,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 7, counter: true }, { frame: 2, ticks: 8, counter: true },
      { frame: 3, ticks: 7 },
      { frame: 4, ticks: 3, invuln: true, vx: 440 }, // tick 25
      { frame: 5, ticks: 6, active: true, invuln: true, vx: 260, reach: [24, -130, 62, 50] },
      { frame: 6, ticks: 6 }, { frame: 7, ticks: 8 },
    ],
    counterJumpTick: 25,
    damage: 128, hitstun: 26, blockstun: 16, hitstop: 13, push: 1550, chip: 12,
  },

  cedar_upper: {
    // Richard S: invulnerable skyward anti-air uppercut
    id: "cedar_upper", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 870,
    segments: [
      { frame: 0, ticks: 2, invuln: true }, { frame: 1, ticks: 3, invuln: true },
      { frame: 2, ticks: 2, invuln: true, vx: 260 },
      { frame: 3, ticks: 4, active: true, invuln: true, vx: 240, reach: [14, -172, 48, 96] },
      { frame: 4, ticks: 6, active: true, vx: 120, reach: [16, -178, 48, 96] },
      { frame: 5, ticks: 6 }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 8 },
    ],
    damage: 102, hitstun: 24, blockstun: 14, hitstop: 12, push: 1200, chip: 12,
  },
  solar_dart: {
    // Richard F+S: fast mid-screen solar packet
    id: "solar_dart", clip: "summon", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 5 }, { frame: 2, ticks: 5 }, { frame: 3, ticks: 13 },
    ],
    projectileTick: 11,
    projectileSpec: { kind: "fast_packet", speed: 840, spawnX: 6200, spawnY: -9400, halfW: 1650, halfH: 1150, ttl: 145 },
    damage: 76, hitstun: 19, blockstun: 14, hitstop: 8, push: 1300, chip: 12,
  },

  oasis_wave: {
    // Sarah S: low ground-palm shockwave
    id: "oasis_wave", clip: "special", height: "low", strength: "special", knockdown: true, launch: 390,
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 4 }, { frame: 3, ticks: 3 },
      { frame: 4, ticks: 4, active: true, reach: [20, -48, 56, 46] },
      { frame: 5, ticks: 7 }, { frame: 6, ticks: 7 }, { frame: 7, ticks: 7 },
    ],
    projectileTick: 16,
    projectileSpec: { kind: "shockwave", speed: 580, spawnX: 6000, spawnY: -2200, halfW: 1850, halfH: 1600, ttl: 120 },
    damage: 80, hitstun: 21, blockstun: 15, hitstop: 9, push: 1300, chip: 13,
  },
  mirage_arc: {
    // Sarah F+S: steep anti-air arc burst
    id: "mirage_arc", clip: "summon", height: "mid", strength: "special", knockdown: true, launch: 620,
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 5 }, { frame: 2, ticks: 5 }, { frame: 3, ticks: 13 },
    ],
    projectileTick: 10,
    projectileSpec: { kind: "arc_burst", speed: 500, vy: -440, spawnX: 5200, spawnY: -9800, halfW: 1700, halfH: 1700, ttl: 95 },
    damage: 86, hitstun: 22, blockstun: 14, hitstop: 9, push: 1200, chip: 12,
  },

  cascade_flurry: {
    // Stephanie S: triple low-mid-high kick cascade
    id: "cascade_flurry", clip: "special", height: "mid", strength: "special", multiHit: true,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 3, vx: 540 },
      { frame: 2, ticks: 3, active: true, vx: 380, reach: [22, -62, 54, 42] },
      { frame: 3, ticks: 3, vx: 300 },
      { frame: 4, ticks: 3, active: true, vx: 320, reach: [24, -108, 56, 36] },
      { frame: 5, ticks: 3, vx: 260 },
      { frame: 6, ticks: 5, active: true, vx: 200, damage: 56, hitstop: 10, knockdown: true, launch: 680, reach: [24, -138, 62, 50] },
      { frame: 7, ticks: 8 },
    ],
    damage: 28, hitstun: 16, blockstun: 10, hitstop: 5, push: 260, chip: 6,
  },
  fountain_dive: {
    // Stephanie F+S: swift advancing overhead hop-kick
    id: "fountain_dive", clip: "heavy_kick", height: "overhead", strength: "special",
    segments: [
      { frame: 0, ticks: 3 }, { frame: 2, ticks: 4, vx: 560 }, { frame: 4, ticks: 4, vx: 520 },
      { frame: 5, ticks: 6, active: true, vx: 220, reach: [22, -130, 58, 54] },
      { frame: 7, ticks: 5 }, { frame: 8, ticks: 7 },
    ],
    damage: 84, hitstun: 21, blockstun: 13, hitstop: 9, push: 920, chip: 10,
  },

  blink_edge: {
    // Tabarek S: sleek vanish teleport into lunging spear-hand strike
    id: "blink_edge", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 520,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4 },
      { frame: 2, ticks: 3, hidden: true }, { frame: 3, ticks: 4, hidden: true },
      { frame: 4, ticks: 3, invuln: true, vx: 340 }, { frame: 5, ticks: 3, vx: 300 },
      { frame: 6, ticks: 7, active: true, reach: [24, -122, 58, 42] }, { frame: 7, ticks: 9 },
    ],
    vanishTick: 7, reappearTick: 14,
    damage: 90, hitstun: 22, blockstun: 14, hitstop: 10, push: 1200, chip: 11,
  },
  trap_socket: {
    // Tabarek F+S: evasive backstep dropping a proximity trap mine
    id: "trap_socket", clip: "summon", height: "mid", strength: "special", knockdown: true, launch: 500,
    segments: [
      { frame: 0, ticks: 4, vx: -420, invuln: true }, { frame: 1, ticks: 5, vx: -360 },
      { frame: 2, ticks: 5 }, { frame: 3, ticks: 12 },
    ],
    projectileTick: 10,
    projectileSpec: { kind: "slow_mine", speed: 0, spawnX: 6800, spawnY: -8000, halfW: 1850, halfH: 1850, ttl: 140 },
    damage: 84, hitstun: 22, blockstun: 15, hitstop: 9, push: 1200, chip: 11,
  },

  gale_kick: {
    // Veronica S: horizontal flying knee-into-side-kick rush
    id: "gale_kick", clip: "special", height: "mid", strength: "special", multiHit: true,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 3, vx: 620 }, { frame: 2, ticks: 3, vx: 600 },
      { frame: 3, ticks: 4, active: true, vx: 520, reach: [18, -120, 50, 42] },
      { frame: 4, ticks: 3, vx: 420 },
      { frame: 5, ticks: 6, active: true, vx: 280, damage: 58, hitstop: 10, knockdown: true, launch: 600, reach: [24, -120, 64, 44] },
      { frame: 6, ticks: 6 }, { frame: 7, ticks: 7 },
    ],
    damage: 36, hitstun: 18, blockstun: 12, hitstop: 6, push: 420, chip: 8,
  },
  lightning_slide: {
    // Veronica F+S: blazing low slide kick
    id: "lightning_slide", clip: "crouch_attack", height: "low", strength: "special", knockdown: true, launch: 400,
    segments: [
      { frame: 0, ticks: 3, vx: 560 }, { frame: 1, ticks: 3, vx: 660 },
      { frame: 2, ticks: 3, active: true, vx: 580, reach: [22, -42, 60, 40] },
      { frame: 3, ticks: 5, active: true, vx: 300, reach: [26, -40, 64, 38] },
      { frame: 4, ticks: 5 }, { frame: 5, ticks: 7 },
    ],
    damage: 84, hitstun: 22, blockstun: 15, hitstop: 9, push: 1050, chip: 10,
  },

  cryo_ping: {
    // Victor S: high-stun chilling data orb
    id: "cryo_ping", clip: "special", height: "mid", strength: "special",
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 4 }, { frame: 3, ticks: 3 },
      { frame: 4, ticks: 3 }, { frame: 5, ticks: 9 }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 6 },
    ],
    projectileTick: 16,
    projectileSpec: { kind: "orb", speed: 680, spawnX: 6400, spawnY: -9200, halfW: 1550, halfH: 1500, ttl: 175 },
    damage: 80, hitstun: 23, blockstun: 16, hitstop: 9, push: 1400, chip: 13,
  },
  frost_fault: {
    // Victor F+S: creeping low floor shockwave
    id: "frost_fault", clip: "summon", height: "low", strength: "special", knockdown: true, launch: 380,
    segments: [
      { frame: 0, ticks: 4 }, { frame: 1, ticks: 6 }, { frame: 2, ticks: 5 }, { frame: 3, ticks: 13 },
    ],
    projectileTick: 12,
    projectileSpec: { kind: "shockwave", speed: 500, spawnX: 5800, spawnY: -2200, halfW: 1850, halfH: 1600, ttl: 125 },
    damage: 78, hitstun: 21, blockstun: 15, hitstop: 9, push: 1250, chip: 12,
  },

  wild_fang: {
    // Wild S: feral pouncing 2-hit double-hook slash
    id: "wild_fang", clip: "special", height: "mid", strength: "special", multiHit: true,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 3, vx: 660 }, { frame: 2, ticks: 3, vx: 680 },
      { frame: 3, ticks: 3, vx: 580 },
      { frame: 4, ticks: 3, active: true, vx: 420, reach: [22, -124, 54, 44] },
      { frame: 5, ticks: 6, active: true, vx: 260, damage: 60, hitstop: 10, knockdown: true, launch: 660, reach: [26, -124, 62, 46] },
      { frame: 6, ticks: 6 }, { frame: 7, ticks: 7 },
    ],
    damage: 38, hitstun: 18, blockstun: 12, hitstop: 6, push: 420, chip: 8,
  },
  apex_pounce: {
    // Wild F+S: fast rushdown command grab
    id: "apex_pounce", clip: "throw", height: "mid", strength: "special", knockdown: true, launch: 640,
    segments: [
      { frame: 0, ticks: 4, vx: 560 }, { frame: 1, ticks: 5, vx: 460 }, // commandGrabTick at 8
      { frame: 2, ticks: 4 }, { frame: 3, ticks: 4 }, { frame: 4, ticks: 3 }, // tossTick at 18
      { frame: 5, ticks: 7 }, { frame: 6, ticks: 8 },
    ],
    commandGrabTick: 8, grabRange: 9400, tossTick: 18, whiffRecovery: 17,
    damage: 130, hitstun: 0, blockstun: 0, hitstop: 12, push: 0,
  },

  jade_palm: {
    // William S: rooted kung-fu iron-palm burst with armored coil
    id: "jade_palm", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 560,
    segments: [
      { frame: 0, ticks: 3 }, { frame: 1, ticks: 4, armor: true }, { frame: 2, ticks: 3, armor: true },
      { frame: 3, ticks: 3, vx: 480 }, { frame: 4, ticks: 3, active: true, vx: 360, reach: [22, -122, 54, 42] },
      { frame: 5, ticks: 7, active: true, reach: [26, -122, 62, 44] }, { frame: 6, ticks: 6 }, { frame: 7, ticks: 7 },
    ],
    damage: 108, hitstun: 24, blockstun: 16, hitstop: 11, push: 1600, chip: 14,
  },
  cloud_rising: {
    // William F+S: invulnerable rising flash-kick anti-air
    id: "cloud_rising", clip: "heavy_kick", height: "mid", strength: "special", knockdown: true, launch: 830,
    segments: [
      { frame: 0, ticks: 2, invuln: true }, { frame: 2, ticks: 3, invuln: true, vx: 220 },
      { frame: 4, ticks: 3, active: true, invuln: true, vx: 220, reach: [18, -162, 52, 90] },
      { frame: 5, ticks: 6, active: true, vx: 120, reach: [20, -168, 54, 92] },
      { frame: 7, ticks: 6 }, { frame: 8, ticks: 8 },
    ],
    damage: 98, hitstun: 23, blockstun: 14, hitstop: 11, push: 1150, chip: 12,
  },
});

/** The knockdown timeline (knockdown clip frames); its ticks add up to KNOCKDOWN.totalFrames. */
export const KNOCKDOWN_SEGMENTS: readonly Segment[] = [
  { frame: 0, ticks: 8 }, { frame: 1, ticks: 8 }, { frame: 2, ticks: 4 }, { frame: 3, ticks: 4 },
  { frame: 4, ticks: 24 }, { frame: 5, ticks: 10 }, { frame: 6, ticks: 8 }, { frame: 7, ticks: 8 },
];

export function moveDuration(move: MoveDef): number {
  let total = 0;
  for (const s of move.segments) total += s.ticks;
  return total;
}

/** Ticks before the first active segment (the move's startup). */
export function firstActiveTick(move: MoveDef): number {
  let t = 0;
  for (const s of move.segments) {
    if (s.active) return t;
    t += s.ticks;
  }
  return -1;
}

export interface SegmentAt {
  index: number;
  segment: Segment;
}

/** The segment showing at `tick` (0-based ticks into the move); the last one holds past the end. */
export function segmentAt(segments: readonly Segment[], tick: number): SegmentAt {
  let t = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    t += s.ticks;
    if (tick < t) return { index: i, segment: s };
  }
  const last = segments.length - 1;
  return { index: last, segment: segments[last]! };
}

/** Tick at which segment `index` starts. */
export function segmentStart(segments: readonly Segment[], index: number): number {
  let t = 0;
  for (let i = 0; i < index; i++) t += segments[i]!.ticks;
  return t;
}
