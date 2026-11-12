// Movement, gravity, pushboxes, stage walls, the screen-width separation limit
// and facing. Integer subpixels only.
import { MOVEMENT } from "../data/movement";
import { canTurn, isAirborne, landFighter } from "./fighter";
import { clampInt } from "./fixed";
import type { FighterState, PlayerIndex, SimEvent } from "./types";

/** Leftmost and rightmost x a fighter's center may reach (the stage walls). */
export const WALL_LEFT = MOVEMENT.screenMargin;
export const WALL_RIGHT = MOVEMENT.stageWidth - MOVEMENT.screenMargin;

/** Largest allowed distance between the two fighters' centers. */
export const MAX_SEPARATION = MOVEMENT.screenWidth - 2 * MOVEMENT.screenMargin;

const HALF_GRAVITY = MOVEMENT.gravity >> 1;
const HALF_PUSH = MOVEMENT.pushboxWidth >> 1;

/**
 * Applies velocity and gravity. Airborne fighters follow an exact parabola
 * (y += vy + g/2, then vy += g), so a jump lasts a whole number of frames.
 */
export function applyMovement(f: FighterState, player: PlayerIndex, events: SimEvent[]): void {
  f.x += f.vx;
  if (!isAirborne(f)) return;
  f.y += f.vy + HALF_GRAVITY;
  f.vy += MOVEMENT.gravity;
  if (f.y >= MOVEMENT.floorY) landFighter(f, player, events);
}

export interface Pushbox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function pushboxHeight(f: FighterState): number {
  if (isAirborne(f)) return MOVEMENT.pushboxHeightAirborne;
  if (f.state === "crouch") return MOVEMENT.pushboxHeightCrouching;
  return MOVEMENT.pushboxHeightStanding;
}

/** The fighter's pushbox in subpixels, feet at the bottom edge. */
export function pushboxOf(f: FighterState): Pushbox {
  return {
    left: f.x - HALF_PUSH,
    right: f.x + HALF_PUSH,
    top: f.y - pushboxHeight(f),
    bottom: f.y,
  };
}

export function pushboxesOverlap(a: FighterState, b: FighterState): boolean {
  const pa = pushboxOf(a);
  const pb = pushboxOf(b);
  return pa.left < pb.right && pb.left < pa.right && pa.top < pb.bottom && pb.top < pa.bottom;
}

function clampToWalls(f: FighterState): void {
  f.x = clampInt(f.x, WALL_LEFT, WALL_RIGHT);
}

/**
 * Keeps both fighters on screen: each stays within MAX_SEPARATION / 2 of the
 * previous frame's midpoint, which acts like the screen edges. A fighter
 * moving away from a stationary opponent stops at the edge instead of
 * dragging them, and the distance can never exceed MAX_SEPARATION.
 */
function clampToScreen(f: FighterState, previousMid: number): void {
  const half = MAX_SEPARATION >> 1;
  f.x = clampInt(f.x, previousMid - half, previousMid + half);
}

/**
 * Pushes overlapping pushboxes apart horizontally, half each. A fighter
 * against a wall does not move, so the other one takes the whole push.
 */
function separatePushboxes(a: FighterState, b: FighterState): void {
  if (!pushboxesOverlap(a, b)) return;
  const dx = b.x - a.x;
  // Which side b ends up on; on an exact tie, b goes the way a is facing.
  const side = dx > 0 ? 1 : dx < 0 ? -1 : a.facing;
  const overlap = MOVEMENT.pushboxWidth - side * dx;
  const pushA = overlap >> 1;
  const pushB = overlap - pushA;
  a.x -= side * pushA;
  b.x += side * pushB;
  clampToWalls(a);
  clampToWalls(b);

  const remaining = MOVEMENT.pushboxWidth - side * (b.x - a.x);
  if (remaining > 0) {
    const aAtWall = side === 1 ? a.x === WALL_LEFT : a.x === WALL_RIGHT;
    if (aAtWall) b.x += side * remaining;
    else a.x -= side * remaining;
    clampToWalls(a);
    clampToWalls(b);
  }
}

/** Screen limit, walls, then pushboxes, in that order. */
export function resolveSpacing(fighters: [FighterState, FighterState], previousMid: number): void {
  const [a, b] = fighters;
  clampToScreen(a, previousMid);
  clampToScreen(b, previousMid);
  clampToWalls(a);
  clampToWalls(b);
  separatePushboxes(a, b);
}

/** Midpoint between the two fighters (rounded down). */
export function midpoint(fighters: readonly [FighterState, FighterState]): number {
  return Math.floor((fighters[0].x + fighters[1].x) / 2);
}

/**
 * Fighters face each other, but only turn while both are on the ground: a
 * jump over the opponent swaps their facing when the jumper lands. A fighter
 * mid-attack, stunned or downed does not turn.
 */
export function updateFacing(fighters: [FighterState, FighterState]): void {
  const [a, b] = fighters;
  if (isAirborne(a) || isAirborne(b)) return;
  // Attacking, stunned or downed fighters keep their facing until they can act again.
  if (b.x > a.x) {
    if (canTurn(a.state)) a.facing = 1;
    if (canTurn(b.state)) b.facing = -1;
  } else if (b.x < a.x) {
    if (canTurn(a.state)) a.facing = -1;
    if (canTurn(b.state)) b.facing = 1;
  }
}
