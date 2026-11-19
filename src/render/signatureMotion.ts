// Authored pose timing and defensive reaction choreography (spec 020).
// Pure render-time pose derivation from sim state; never alters sim timing or balance.
import type { MoveId } from "../data/moves";
import type { FighterState } from "../sim/types";

export type SignatureBeat = "anticipation" | "travel" | "impact" | "follow_through";

export type DefensiveReaction = "perfect_shield" | "guard_break" | "throw_tech";

export interface PoseOptions {
  reduced?: boolean;
  reaction?: DefensiveReaction | null;
}

export interface FighterPose {
  /** Pixel-snapped horizontal offset along facing (+ = forward, - = back). */
  offsetX: number;
  /** Pixel-snapped vertical offset (+ = down, - = up). */
  offsetY: number;
  /** Horizontal scale around the anchor (1 = neutral; destination width is pixel-snapped). */
  scaleX: number;
  /** Vertical scale around the anchor (1 = neutral; destination height is pixel-snapped). */
  scaleY: number;
  /** Authored beat label for signature specials. */
  beat?: SignatureBeat;
  /** Optional clip frame override for multi-phase reactions (e.g. Guard Break). */
  frameOverride?: number;
}

export const NEUTRAL_POSE: FighterPose = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
});

interface BeatSlice {
  untilTick: number;
  beat: SignatureBeat;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

function fromSlices(slices: readonly BeatSlice[], tick: number): FighterPose {
  for (const s of slices) {
    if (tick <= s.untilTick) {
      return {
        offsetX: s.offsetX,
        offsetY: s.offsetY,
        scaleX: s.scaleX,
        scaleY: s.scaleY,
        beat: s.beat,
      };
    }
  }
  const last = slices[slices.length - 1];
  if (!last) return NEUTRAL_POSE;
  return {
    offsetX: last.offsetX,
    offsetY: last.offsetY,
    scaleX: last.scaleX,
    scaleY: last.scaleY,
    beat: last.beat,
  };
}

// Pentcho: Hotfix Charge ("charge", 46 ticks: 0..9 windup/armor, 10..23 rush, 24..27 brake, 28..45 settle).
const CHARGE_SLICES: readonly BeatSlice[] = [
  { untilTick: 1, beat: "anticipation", offsetX: -2, offsetY: 0, scaleX: 1.03, scaleY: 0.97 },
  { untilTick: 3, beat: "anticipation", offsetX: -3, offsetY: 0, scaleX: 1.04, scaleY: 0.96 },
  { untilTick: 9, beat: "anticipation", offsetX: -5, offsetY: 2, scaleX: 1.08, scaleY: 0.92 },
  { untilTick: 13, beat: "travel", offsetX: 4, offsetY: 1, scaleX: 1.12, scaleY: 0.92 },
  { untilTick: 18, beat: "travel", offsetX: 5, offsetY: 1, scaleX: 1.1, scaleY: 0.94 },
  { untilTick: 23, beat: "travel", offsetX: 6, offsetY: 2, scaleX: 1.12, scaleY: 0.92 },
  { untilTick: 27, beat: "impact", offsetX: 3, offsetY: 1, scaleX: 1.06, scaleY: 0.95 },
  { untilTick: 32, beat: "follow_through", offsetX: 1, offsetY: -2, scaleX: 0.97, scaleY: 1.03 },
  { untilTick: 36, beat: "follow_through", offsetX: 0, offsetY: -1, scaleX: 0.99, scaleY: 1.01 },
  { untilTick: 45, beat: "follow_through", offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
];

// Felicia: Context Switch ("teleport", 41 ticks: 0..7 phase slip, 8..15 hidden, 16..19 coil, 20..30 overhead, 31..40 land).
const TELEPORT_SLICES: readonly BeatSlice[] = [
  { untilTick: 2, beat: "anticipation", offsetX: -2, offsetY: 0, scaleX: 0.96, scaleY: 1.04 },
  { untilTick: 3, beat: "anticipation", offsetX: 0, offsetY: -1, scaleX: 0.92, scaleY: 1.04 },
  { untilTick: 4, beat: "anticipation", offsetX: 0, offsetY: -1, scaleX: 0.86, scaleY: 1.08 },
  { untilTick: 5, beat: "anticipation", offsetX: 0, offsetY: -2, scaleX: 0.8, scaleY: 1.11 },
  { untilTick: 6, beat: "anticipation", offsetX: 0, offsetY: -2, scaleX: 0.74, scaleY: 1.14 },
  { untilTick: 7, beat: "anticipation", offsetX: 0, offsetY: -3, scaleX: 0.68, scaleY: 1.17 },
  { untilTick: 15, beat: "travel", offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
  { untilTick: 17, beat: "travel", offsetX: 0, offsetY: -4, scaleX: 0.76, scaleY: 1.16 },
  { untilTick: 19, beat: "travel", offsetX: 0, offsetY: 2, scaleX: 1.08, scaleY: 0.92 },
  { untilTick: 22, beat: "travel", offsetX: 1, offsetY: -5, scaleX: 0.92, scaleY: 1.1 },
  { untilTick: 25, beat: "impact", offsetX: 4, offsetY: -2, scaleX: 1.09, scaleY: 0.94 },
  { untilTick: 30, beat: "impact", offsetX: 2, offsetY: 0, scaleX: 1.03, scaleY: 0.98 },
  { untilTick: 34, beat: "follow_through", offsetX: 0, offsetY: 1, scaleX: 1.04, scaleY: 0.96 },
  { untilTick: 40, beat: "follow_through", offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
];

// Alex: Rapid Deploy ("rush", 36 ticks: 0..2 coil, 3..7 blitz, 8..16 flurry, 17..20 uppercut coil, 21..23 launch, 24..35 settle).
const RUSH_SLICES: readonly BeatSlice[] = [
  { untilTick: 2, beat: "anticipation", offsetX: -3, offsetY: 1, scaleX: 0.94, scaleY: 1.04 },
  { untilTick: 7, beat: "travel", offsetX: 4, offsetY: 1, scaleX: 1.15, scaleY: 0.89 },
  { untilTick: 10, beat: "travel", offsetX: 3, offsetY: 0, scaleX: 1.07, scaleY: 0.96 },
  { untilTick: 13, beat: "travel", offsetX: 4, offsetY: -1, scaleX: 1.09, scaleY: 0.95 },
  { untilTick: 16, beat: "travel", offsetX: 5, offsetY: 0, scaleX: 1.11, scaleY: 0.94 },
  { untilTick: 20, beat: "anticipation", offsetX: -2, offsetY: 3, scaleX: 1.1, scaleY: 0.88 },
  { untilTick: 23, beat: "impact", offsetX: 3, offsetY: -6, scaleX: 0.9, scaleY: 1.14 },
  { untilTick: 26, beat: "follow_through", offsetX: 1, offsetY: -7, scaleX: 0.94, scaleY: 1.06 },
  { untilTick: 29, beat: "follow_through", offsetX: 0, offsetY: -3, scaleX: 0.97, scaleY: 1.03 },
  { untilTick: 31, beat: "follow_through", offsetX: 0, offsetY: 1, scaleX: 1.05, scaleY: 0.95 },
  { untilTick: 35, beat: "follow_through", offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
];

const SIGNATURE_MOVES: Partial<Record<MoveId, readonly BeatSlice[]>> = {
  charge: CHARGE_SLICES,
  teleport: TELEPORT_SLICES,
  rush: RUSH_SLICES,
};

/** Returns the authored beat for a signature special at `tick` (accounting for hitstop crush). */
export function signatureBeatForMove(moveId: MoveId, tick: number, hitstop = 0): SignatureBeat | undefined {
  const slices = SIGNATURE_MOVES[moveId];
  if (!slices) return undefined;
  if (moveId === "charge" && hitstop > 0 && tick >= 10 && tick <= 27) return "impact";
  if (moveId === "teleport" && hitstop > 0 && tick >= 23 && tick <= 30) return "impact";
  if (moveId === "rush" && hitstop > 0 && tick >= 21 && tick <= 23) return "impact";
  return fromSlices(slices, tick).beat;
}

const GUARD_BREAK_SWAY_X = [-3, -1, 2, 0] as const;

/** Authored 3-phase Guard Break stagger pose: shatter jolt, dizzy slump sway, recovery gasp. */
export function guardBreakPose(stateFrame: number): FighterPose {
  if (stateFrame <= 6) {
    return { offsetX: -5, offsetY: 0, scaleX: 0.93, scaleY: 1.06, frameOverride: 0 };
  }
  if (stateFrame <= 35) {
    const step = Math.floor((stateFrame - 7) / 7);
    return {
      offsetX: GUARD_BREAK_SWAY_X[step % GUARD_BREAK_SWAY_X.length] ?? 0,
      offsetY: 2,
      scaleX: 1.04,
      scaleY: 0.96,
      frameOverride: step % 2 === 0 ? 1 : 2,
    };
  }
  return { offsetX: -1, offsetY: 1, scaleX: 1.01, scaleY: 0.99, frameOverride: 3 };
}

/**
 * Derives the pixel-snapped pose transform for `f` from sim state and real sim-event reactions.
 * Covers Hotfix Charge, Context Switch, Rapid Deploy, Perfect Shield brace,
 * Guard Break stagger, and Throw Escape pushback recoil.
 */
export function poseForFighter(f: FighterState, options?: PoseOptions): FighterPose {
  if (f.state === "attack" && f.move) {
    const slices = SIGNATURE_MOVES[f.move.id];
    if (!slices) return NEUTRAL_POSE;
    const base = fromSlices(slices, f.move.tick);
    if (f.hitstop > 0) {
      if (f.move.id === "charge" && f.move.tick >= 10 && f.move.tick <= 27) {
        return { offsetX: 6, offsetY: 1, scaleX: 1.14, scaleY: 0.9, beat: "impact" };
      }
      if (f.move.id === "teleport" && f.move.tick >= 23 && f.move.tick <= 30) {
        return { offsetX: 5, offsetY: -2, scaleX: 1.12, scaleY: 0.92, beat: "impact" };
      }
      if (f.move.id === "rush" && f.move.tick >= 21 && f.move.tick <= 23) {
        return { offsetX: 4, offsetY: -7, scaleX: 0.88, scaleY: 1.16, beat: "impact" };
      }
    }
    return base;
  }

  const reaction = options?.reaction ?? (f.state === "guard_break" ? "guard_break" : null);

  if (reaction === "perfect_shield" && (f.state === "blockstun" || f.state === "airborne")) {
    return f.stateFrame <= 2 || f.hitstop > 0
      ? { offsetX: 2, offsetY: 0, scaleX: 0.96, scaleY: 1.04 }
      : { offsetX: 1, offsetY: 0, scaleX: 0.98, scaleY: 1.02 };
  }

  if (reaction === "guard_break" && f.state === "guard_break") {
    return guardBreakPose(f.stateFrame);
  }

  if (reaction === "throw_tech" && f.state === "idle") {
    return { offsetX: -2, offsetY: 1, scaleX: 0.96, scaleY: 1.03 };
  }

  return NEUTRAL_POSE;
}
