// Sim state: plain, JSON-serializable data. Every number is an integer.
// Positions and velocities are in subpixels (100 per pixel); y grows downward
// and the floor is MOVEMENT.floorY.
import type { HitStrength, MoveId } from "../data/moves";

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
  // combat (spec 003)
  "attack",
  "hitstun",
  "blockstun",
  "held",
  "knockdown",
  "ko",
  "victory",
] as const;

export type FighterStateName = (typeof FIGHTER_STATES)[number];

/** Ring buffer of input bitmasks (SOCD already resolved). */
export interface InputHistory {
  /** Fixed-length buffer; `frames[head]` is the newest entry. */
  frames: number[];
  head: number;
}

/** A move in progress. Ground moves use the "attack" state; air moves keep "airborne". */
export interface MoveInstance {
  id: MoveId;
  /** Ticks into the move; 0 on the frame it starts. */
  tick: number;
  /** The move has hit or been blocked (no second hit; cancels open). */
  connected: boolean;
  /** Throws: the grab succeeded. */
  grabbed: boolean;
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
  // combat (spec 003)
  health: number;
  move: MoveInstance | null;
  /** Frames left frozen by hit-stop. */
  hitstop: number;
  /** Frames left in hitstun or blockstun. */
  stun: number;
  /** The hit or block was taken crouching (picks the crouching pose). */
  stunLow: boolean;
  /** Pushback still to apply (subpixels, signed along x) and the frames left to apply it. */
  pushLeft: number;
  pushFrames: number;
  /** Hits taken in the current combo (for damage scaling); reset when actionable. */
  comboHits: number;
  /** Sim frame of the last press consumed by a move (presses at or before it are spent). */
  consumedFrame: number;
}

export interface Projectile {
  owner: PlayerIndex;
  x: number;
  y: number;
  vx: number;
}

export type RoundPhase = "intro" | "fight" | "ko" | "matchover";

export interface RoundState {
  phase: RoundPhase;
  phaseFrame: number;
  /** 1-based round number. */
  number: number;
  wins: [number, number];
  /** Frames left on the round timer. */
  timer: number;
  /** Winner of the current round (-1 none yet, 2 draw). */
  winner: -1 | 0 | 1 | 2;
  /** "ko" or "time" once the round is decided, "" before. */
  reason: "" | "ko" | "time";
  /** Training (the sandbox): no timer, no round end, health refills after a K.O. */
  training: boolean;
}

export type SimEvent =
  | { type: "jump"; player: PlayerIndex; dir: JumpDir }
  | { type: "land"; player: PlayerIndex }
  | { type: "attack"; player: PlayerIndex; move: MoveId }
  | { type: "hit"; player: PlayerIndex; target: PlayerIndex; move: MoveId; strength: HitStrength; x: number; y: number; damage: number; combo: number }
  | { type: "block"; player: PlayerIndex; target: PlayerIndex; move: MoveId; strength: HitStrength; x: number; y: number }
  | { type: "trade"; x: number; y: number }
  | { type: "throw"; player: PlayerIndex; target: PlayerIndex }
  | { type: "tech"; x: number; y: number }
  | { type: "knockdown"; player: PlayerIndex; x: number; y: number }
  | { type: "projectile"; player: PlayerIndex; x: number; y: number }
  | { type: "clash"; x: number; y: number }
  | { type: "ko"; player: PlayerIndex; x: number; y: number }
  | { type: "round_start"; round: number }
  | { type: "fight" }
  | { type: "round_end"; winner: -1 | 0 | 1 | 2; reason: "ko" | "time" }
  | { type: "match_end"; winner: 0 | 1 };

export interface SimState {
  /** Number of steps run since the state was created. */
  frame: number;
  /** Seeded PRNG state (uint32); the only source of randomness. */
  rng: number;
  fighters: [FighterState, FighterState];
  projectiles: Projectile[];
  round: RoundState;
  /** Events emitted by the last step; cleared at the start of every step. */
  events: SimEvent[];
}

/** One input bitmask per player for a single step. */
export type InputPair = readonly [number, number];
