// Frame data (spec 003, R2). Pure data plus small pure helpers; src/sim reads it.
//
// A move is a timeline of segments. Each segment shows one frame of the move's
// clip for `ticks` sim frames; `active` segments have a hitbox. Startup, active
// and recovery all come from this one list, so the art and the frame data cannot
// drift apart. Every fighter uses the all-rounder set until archetypes (spec 006).

export type MoveId =
  | "light_punch"
  | "heavy_punch"
  | "light_kick"
  | "heavy_kick"
  | "crouch_attack"
  | "air_attack"
  | "special"
  | "throw"
  // signature specials (spec 006)
  | "teleport"
  | "charge"
  | "rush";

/** How a move must be blocked. mid: either; low: crouching; overhead: standing. */
export type HitHeight = "mid" | "low" | "overhead";

export type HitStrength = "light" | "heavy" | "special";

export interface Segment {
  /** Frame index in the move's clip. */
  frame: number;
  ticks: number;
  active?: boolean;
  /** Forward speed during this segment (subpixels per frame). */
  vx?: number;
  /** Hitbox [x, y, w, h] in px (anchor space) when the art has no reach box for this frame. */
  reach?: readonly [number, number, number, number];
  /** Not drawn and cannot be hit (a teleport's vanish). */
  hidden?: boolean;
  /** Cannot be hit. */
  invuln?: boolean;
  /** Absorbs one hit: damage is taken, no stun (once per move). */
  armor?: boolean;
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
  /** Throws check for a grab on this tick; on a whiff they jump to whiffRecovery. */
  grabTick?: number;
  whiffRecovery?: number;
  /** Throws launch the opponent on this tick (after a successful grab). */
  tossTick?: number;
  /** Knockdowns launch the victim upward at this speed (subpixels per frame). */
  launch?: number;
  /** Each active segment can hit once (a flurry), instead of one hit per move. */
  multiHit?: boolean;
  /** Teleport: vanish on the first tick, reappear on the second. */
  vanishTick?: number;
  reappearTick?: number;
}

// Clip set v2 (spec 012): more frames per attack, same startup / active / recovery as spec 003.
export const MOVES: Readonly<Record<MoveId, MoveDef>> = Object.freeze({
  light_punch: {
    id: "light_punch", clip: "light_punch", height: "mid", strength: "light",
    // stance, snap, [half, full], retract, guard: startup 3, active 4, recovery 7
    segments: [{ frame: 0, ticks: 1 }, { frame: 1, ticks: 2 }, { frame: 2, ticks: 1, active: true }, { frame: 3, ticks: 3, active: true }, { frame: 4, ticks: 3 }, { frame: 5, ticks: 4 }],
    damage: 40, hitstun: 15, blockstun: 11, hitstop: 6, push: 900,
    cancels: ["heavy_punch", "heavy_kick", "special"],
  },
  heavy_punch: {
    id: "heavy_punch", clip: "heavy_punch", height: "mid", strength: "heavy",
    // stance, wind-up, full wind-up, rotate, [halfway, impact], follow-through, recover: 8 / 7 / 12
    segments: [{ frame: 0, ticks: 2 }, { frame: 1, ticks: 2 }, { frame: 2, ticks: 3 }, { frame: 3, ticks: 1 }, { frame: 4, ticks: 2, active: true }, { frame: 5, ticks: 5, active: true }, { frame: 6, ticks: 5 }, { frame: 7, ticks: 7 }],
    damage: 90, hitstun: 22, blockstun: 16, hitstop: 10, push: 1400,
    cancels: ["special"],
  },
  light_kick: {
    id: "light_kick", clip: "light_kick", height: "mid", strength: "light",
    // lift, chamber, [extended], retract, lower, stance: 4 / 4 / 10
    segments: [{ frame: 0, ticks: 2 }, { frame: 1, ticks: 2 }, { frame: 2, ticks: 4, active: true }, { frame: 3, ticks: 3 }, { frame: 4, ticks: 3 }, { frame: 5, ticks: 4 }],
    damage: 50, hitstun: 17, blockstun: 12, hitstop: 7, push: 1000,
    cancels: ["heavy_kick", "special"],
  },
  heavy_kick: {
    id: "heavy_kick", clip: "heavy_kick", height: "mid", strength: "heavy", knockdown: true,
    // stance, pivot, chamber, travel, [sweep up, impact], follow, down, land: 10 / 8 / 14
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 3 }, { frame: 2, ticks: 3 }, { frame: 3, ticks: 1 }, { frame: 4, ticks: 3, active: true }, { frame: 5, ticks: 5, active: true }, { frame: 6, ticks: 5 }, { frame: 7, ticks: 4 }, { frame: 8, ticks: 5 }],
    damage: 110, hitstun: 26, blockstun: 18, hitstop: 11, push: 1600, launch: 650,
  },
  crouch_attack: {
    id: "crouch_attack", clip: "crouch_attack", height: "low", strength: "heavy", knockdown: true,
    // crouch, reach, [sweep start, full], follow, pull back: 6 / 8 / 10
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 3 }, { frame: 2, ticks: 3, active: true }, { frame: 3, ticks: 5, active: true }, { frame: 4, ticks: 4 }, { frame: 5, ticks: 6 }],
    damage: 70, hitstun: 20, blockstun: 14, hitstop: 8, push: 1000,
  },
  air_attack: {
    id: "air_attack", clip: "air_attack", height: "overhead", strength: "light", air: true,
    // tuck, chamber, [kick, kick held], retract (holds until landing): 3 / 14
    segments: [{ frame: 0, ticks: 2 }, { frame: 1, ticks: 1 }, { frame: 2, ticks: 7, active: true }, { frame: 3, ticks: 7, active: true }, { frame: 4, ticks: 200 }],
    damage: 70, hitstun: 18, blockstun: 12, hitstop: 8, push: 800,
  },
  special: {
    id: "special", clip: "special", height: "mid", strength: "special",
    // stance, draw back, cupped, coiled, (projectile at 16) thrust, thrusting, full, recover: 39 total
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 5 }, { frame: 3, ticks: 4 }, { frame: 4, ticks: 3 }, { frame: 5, ticks: 3 }, { frame: 6, ticks: 9 }, { frame: 7, ticks: 8 }],
    projectileTick: 16,
    damage: 80, hitstun: 20, blockstun: 14, hitstop: 8, push: 1200, chip: 12,
  },
  throw: {
    id: "throw", clip: "throw", height: "mid", strength: "heavy", knockdown: true,
    // reach (grab at 3), grip, pull in, twist, swing, toss (at 16), recover: 34 total
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 4 }, { frame: 3, ticks: 3 }, { frame: 4, ticks: 2 }, { frame: 5, ticks: 8 }, { frame: 6, ticks: 10 }],
    grabTick: 3, tossTick: 16, whiffRecovery: 18,
    damage: 120, hitstun: 0, blockstun: 0, hitstop: 10, push: 0, launch: 500,
  },
  // Signature specials (spec 006). Each uses its fighter's own "special" clip.
  teleport: {
    id: "teleport", clip: "special", height: "overhead", strength: "special",
    // stance, crouch, [spin, spin] vanished, reappear crouch, kick chamber, [kick], land
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 5 }, { frame: 2, ticks: 4, hidden: true }, { frame: 3, ticks: 4, hidden: true },
      { frame: 4, ticks: 4, invuln: true }, { frame: 5, ticks: 3 }, { frame: 6, ticks: 8, active: true }, { frame: 7, ticks: 10 }],
    vanishTick: 8, reappearTick: 16,
    damage: 85, hitstun: 20, blockstun: 14, hitstop: 9, push: 1200, chip: 10,
  },
  charge: {
    id: "charge", clip: "special", height: "mid", strength: "special", knockdown: true, launch: 500,
    // stance, brace (armor), [burst, run, run, slam] moving with armor, stumble, stance
    segments: [{ frame: 0, ticks: 4 }, { frame: 1, ticks: 6, armor: true }, { frame: 2, ticks: 4, active: true, armor: true, vx: 700 },
      { frame: 3, ticks: 5, active: true, armor: true, vx: 700 }, { frame: 4, ticks: 5, active: true, armor: true, vx: 700, reach: [30, -124, 40, 64] },
      { frame: 5, ticks: 4, active: true, vx: 300 }, { frame: 6, ticks: 9 }, { frame: 7, ticks: 9 }],
    damage: 110, hitstun: 0, blockstun: 18, hitstop: 12, push: 1400, chip: 14,
  },
  rush: {
    id: "rush", clip: "special", height: "mid", strength: "special", multiHit: true,
    // stance, dash, [jab], [straight], [hook], crouch, [uppercut launches], rising, land
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 5, vx: 800 }, { frame: 2, ticks: 3, active: true, vx: 300 },
      { frame: 3, ticks: 3, active: true, vx: 300 }, { frame: 4, ticks: 3, active: true, vx: 300, reach: [24, -122, 48, 26] }, { frame: 5, ticks: 4, vx: 300 },
      { frame: 6, ticks: 3, active: true, vx: 200, damage: 60, hitstop: 10, knockdown: true, launch: 900, reach: [6, -158, 48, 80] },
      { frame: 7, ticks: 6 }, { frame: 8, ticks: 6 }],
    damage: 28, hitstun: 16, blockstun: 10, hitstop: 5, push: 250, chip: 6,
  },
});

/** The knockdown timeline (knockdown clip frames); its ticks add up to KNOCKDOWN.totalFrames. */
export const KNOCKDOWN_SEGMENTS: readonly Segment[] = [
  // launched, flying, crash (dust at 16), bounce, lying (K.O. holds from 24), roll to side, one knee, stand
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
