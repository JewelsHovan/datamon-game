// CPU difficulty levels (spec 008, R4). One table; behaviors in cpu.ts read only these numbers.
// Chances are 0..1. Frames are 60 Hz sim frames.

export type CpuLevel = "easy" | "normal" | "hard";

export interface LevelParams {
  /** How many frames late the CPU sees the opponent (human reaction time). */
  reaction: number;
  /** Blocks an attack in range. */
  block: number;
  /** Picks the right block height (crouch for lows, stand for overheads). */
  correctHeight: number;
  /** Hits a jump-in before it lands. */
  antiAir: number;
  /** Turns a landed light hit into a combo. */
  combo: number;
  /** Throws a blocking or idle opponent up close. */
  throw: number;
  /** Answers a throw with a throw (tech). */
  tech: number;
  /** Uses the special at range. */
  special: number;
  /** Walks in rather than waiting or backing off. */
  aggression: number;
  /** Jumps in from mid range. */
  jumpIn: number;
  /** Presses something random instead of the planned action. */
  mistake: number;
  /** Frames between neutral decisions (min, max). */
  gap: readonly [number, number];
}

export const LEVELS: Readonly<Record<CpuLevel, LevelParams>> = Object.freeze({
  easy: {
    reaction: 22, block: 0.1, correctHeight: 0.4, antiAir: 0.03, combo: 0, throw: 0.1, tech: 0,
    special: 0.15, aggression: 0.45, jumpIn: 0.04, mistake: 0.15, gap: [20, 45],
  },
  normal: {
    reaction: 12, block: 0.33, correctHeight: 0.75, antiAir: 0.4, combo: 0.45, throw: 0.3, tech: 0.2,
    special: 0.3, aggression: 0.6, jumpIn: 0.06, mistake: 0.04, gap: [10, 28],
  },
  hard: {
    reaction: 6, block: 0.88, correctHeight: 0.95, antiAir: 0.8, combo: 0.9, throw: 0.45, tech: 0.6,
    special: 0.4, aggression: 0.7, jumpIn: 0.05, mistake: 0, gap: [4, 14],
  },
});

export const CPU_LEVELS: readonly CpuLevel[] = ["easy", "normal", "hard"];
