// Sim state: plain, JSON-serializable data. Every number is an integer.
// Positions and velocities are in subpixels (100 per pixel); y grows downward
// and the floor is MOVEMENT.floorY.

export type PlayerIndex = 0 | 1;

/** 1 = facing right (toward +x), -1 = facing left. */
export type Facing = 1 | -1;

/** Jump direction relative to facing at launch: -1 back, 0 neutral, 1 forward. */
export type JumpDir = -1 | 0 | 1;

export const FIGHTER_STATES = [
  "idle",
  "walk_forward",
  "walk_back",
  "crouch",
  "jumpsquat",
  "airborne",
  "landing",
] as const;

export type FighterStateName = (typeof FIGHTER_STATES)[number];

/** Ring buffer of input bitmasks (SOCD already resolved). */
export interface InputHistory {
  /** Fixed-length buffer; `frames[head]` is the newest entry. */
  frames: number[];
  head: number;
}

export interface FighterState {
  slug: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: Facing;
  state: FighterStateName;
  /** Frames spent in the current state; 0 on the frame the state was entered. */
  stateFrame: number;
  jumpDir: JumpDir;
  input: InputHistory;
}

export type SimEvent =
  | { type: "jump"; player: PlayerIndex; dir: JumpDir }
  | { type: "land"; player: PlayerIndex };

export interface SimState {
  /** Number of steps run since the state was created. */
  frame: number;
  /** Seeded PRNG state (uint32); the only source of randomness. */
  rng: number;
  fighters: [FighterState, FighterState];
  /** Events emitted by the last step; cleared at the start of every step. */
  events: SimEvent[];
}

/** One input bitmask per player for a single step. */
export type InputPair = readonly [number, number];
