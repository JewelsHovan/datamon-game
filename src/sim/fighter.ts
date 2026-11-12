// Fighter movement state machine. Every state transition lives in this file:
// input-driven ones in advanceFighter, the floor contact in landFighter
// (called by physics when an airborne fighter reaches the floor).
import { MOVEMENT } from "../data/movement";
import { DIR_BACK, DIR_DOWN, DIR_FORWARD, DIR_UP } from "./inputBits";
import { inputAt, toFacingRelative } from "./inputHistory";
import type { FighterState, FighterStateName, JumpDir, PlayerIndex, SimEvent } from "./types";

export function isAirborne(f: FighterState): boolean {
  return f.state === "airborne";
}

/** States in which directional input moves the fighter (idle, walking, crouching). */
export function isActionable(state: FighterStateName): boolean {
  return (
    state === "idle" || state === "walk_forward" || state === "walk_back" || state === "crouch"
  );
}

function enter(f: FighterState, state: FighterStateName): void {
  if (f.state !== state) {
    f.state = state;
    f.stateFrame = 0;
  }
}

function horizontalIntent(dirs: number): JumpDir {
  if ((dirs & DIR_FORWARD) !== 0) return 1;
  if ((dirs & DIR_BACK) !== 0) return -1;
  return 0;
}

/** Idle, walk, crouch and jump decisions for a fighter that can act. */
function groundedControl(f: FighterState, dirs: number): void {
  if ((dirs & DIR_UP) !== 0) {
    enter(f, "jumpsquat");
    f.jumpDir = horizontalIntent(dirs);
  } else if ((dirs & DIR_DOWN) !== 0) {
    enter(f, "crouch");
  } else if ((dirs & DIR_FORWARD) !== 0) {
    enter(f, "walk_forward");
  } else if ((dirs & DIR_BACK) !== 0) {
    enter(f, "walk_back");
  } else {
    enter(f, "idle");
  }
}

function launch(f: FighterState, player: PlayerIndex, events: SimEvent[]): void {
  enter(f, "airborne");
  f.vy = -MOVEMENT.jumpLaunchSpeed;
  f.vx = f.jumpDir * f.facing * MOVEMENT.jumpHorizontalSpeed;
  events.push({ type: "jump", player, dir: f.jumpDir });
}

/** Grounded horizontal velocity for the current state. */
function groundVelocity(f: FighterState): number {
  switch (f.state) {
    case "walk_forward":
      return f.facing * MOVEMENT.walkForwardSpeed;
    case "walk_back":
      return -f.facing * MOVEMENT.walkBackSpeed;
    default:
      return 0;
  }
}

/**
 * Advances one fighter's state machine by one frame, from its newest input.
 * Sets the velocities that physics applies next.
 */
export function advanceFighter(f: FighterState, player: PlayerIndex, events: SimEvent[]): void {
  const dirs = toFacingRelative(inputAt(f.input, 0), f.facing);
  f.stateFrame += 1;

  switch (f.state) {
    case "jumpsquat": {
      // A direction held during the squat still picks the jump direction.
      const intent = horizontalIntent(dirs);
      if (intent !== 0) f.jumpDir = intent;
      if (f.stateFrame >= MOVEMENT.jumpsquatFrames) launch(f, player, events);
      break;
    }
    case "airborne":
      // No air control; physics lands the fighter.
      break;
    case "landing":
      if (f.stateFrame >= MOVEMENT.landingFrames) {
        enter(f, "idle");
        groundedControl(f, dirs);
      }
      break;
    default:
      groundedControl(f, dirs);
      break;
  }

  if (f.state !== "airborne") {
    f.vx = groundVelocity(f);
    f.vy = 0;
  }
}

/** Floor contact: the only way out of the airborne state. */
export function landFighter(f: FighterState, player: PlayerIndex, events: SimEvent[]): void {
  f.y = MOVEMENT.floorY;
  f.vx = 0;
  f.vy = 0;
  f.jumpDir = 0;
  enter(f, "landing");
  events.push({ type: "land", player });
}
