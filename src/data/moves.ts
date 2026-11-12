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
  | "throw";

/** How a move must be blocked. mid: either; low: crouching; overhead: standing. */
export type HitHeight = "mid" | "low" | "overhead";

export type HitStrength = "light" | "heavy" | "special";

export interface Segment {
  /** Frame index in the move's clip. */
  frame: number;
  ticks: number;
  active?: boolean;
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
}

export const MOVES: Readonly<Record<MoveId, MoveDef>> = Object.freeze({
  light_punch: {
    id: "light_punch", clip: "light_punch", height: "mid", strength: "light",
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 2, active: true }, { frame: 2, ticks: 2, active: true }, { frame: 3, ticks: 7 }],
    damage: 40, hitstun: 15, blockstun: 11, hitstop: 6, push: 900,
    cancels: ["heavy_punch", "heavy_kick", "special"],
  },
  heavy_punch: {
    id: "heavy_punch", clip: "heavy_punch", height: "mid", strength: "heavy",
    segments: [{ frame: 0, ticks: 4 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 2, active: true }, { frame: 3, ticks: 5, active: true }, { frame: 4, ticks: 5 }, { frame: 5, ticks: 7 }],
    damage: 90, hitstun: 22, blockstun: 16, hitstop: 10, push: 1400,
    cancels: ["special"],
  },
  light_kick: {
    id: "light_kick", clip: "light_kick", height: "mid", strength: "light",
    segments: [{ frame: 0, ticks: 4 }, { frame: 1, ticks: 4, active: true }, { frame: 2, ticks: 5 }, { frame: 3, ticks: 5 }],
    damage: 50, hitstun: 17, blockstun: 12, hitstop: 7, push: 1000,
    cancels: ["heavy_kick", "special"],
  },
  heavy_kick: {
    id: "heavy_kick", clip: "heavy_kick", height: "mid", strength: "heavy", knockdown: true,
    segments: [{ frame: 0, ticks: 5 }, { frame: 1, ticks: 5 }, { frame: 2, ticks: 3, active: true }, { frame: 3, ticks: 5, active: true }, { frame: 4, ticks: 6 }, { frame: 5, ticks: 8 }],
    damage: 110, hitstun: 26, blockstun: 18, hitstop: 11, push: 1600,
  },
  crouch_attack: {
    id: "crouch_attack", clip: "crouch_attack", height: "low", strength: "heavy", knockdown: true,
    segments: [{ frame: 0, ticks: 6 }, { frame: 1, ticks: 3, active: true }, { frame: 2, ticks: 5, active: true }, { frame: 3, ticks: 10 }],
    damage: 70, hitstun: 20, blockstun: 14, hitstop: 8, push: 1000,
  },
  air_attack: {
    id: "air_attack", clip: "air_attack", height: "overhead", strength: "light", air: true,
    segments: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 14, active: true }, { frame: 2, ticks: 200 }],
    damage: 70, hitstun: 18, blockstun: 12, hitstop: 8, push: 800,
  },
  special: {
    id: "special", clip: "special", height: "mid", strength: "special",
    segments: [{ frame: 0, ticks: 4 }, { frame: 1, ticks: 6 }, { frame: 2, ticks: 6 }, { frame: 3, ticks: 3 }, { frame: 4, ticks: 10 }, { frame: 5, ticks: 10 }],
    projectileTick: 16,
    damage: 80, hitstun: 20, blockstun: 14, hitstop: 8, push: 1200, chip: 12,
  },
  throw: {
    id: "throw", clip: "throw", height: "mid", strength: "heavy", knockdown: true,
    segments: [{ frame: 0, ticks: 4 }, { frame: 1, ticks: 6 }, { frame: 2, ticks: 6 }, { frame: 3, ticks: 8 }, { frame: 4, ticks: 10 }],
    grabTick: 3, tossTick: 16, whiffRecovery: 18,
    damage: 120, hitstun: 0, blockstun: 0, hitstop: 10, push: 0,
  },
});

/** The knockdown timeline (knockdown clip frames); its ticks add up to KNOCKDOWN.totalFrames. */
export const KNOCKDOWN_SEGMENTS: readonly Segment[] = [
  { frame: 0, ticks: 8 }, { frame: 1, ticks: 8 }, { frame: 2, ticks: 8 },
  { frame: 3, ticks: 32 }, { frame: 4, ticks: 10 }, { frame: 5, ticks: 8 },
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
