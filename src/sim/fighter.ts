// Fighter state machine. Every state transition lives here: input-driven ones
// in advanceFighter, the floor contact in landFighter (called by physics when an
// airborne fighter reaches the floor), and the combat ones through combat.ts
// helpers called from here and from hit application.
import { MOVES_V2 } from "../data/combat";
import { fighterInfo } from "../data/fighters";
import { MOVES, segmentAt } from "../data/moves";
import { MOVEMENT } from "../data/movement";
import { advanceDowned, dashInput, tickGroundMove, tryAirMove, tryBlockPush, tryGroundMove, tryTaunt } from "./combat";
import { DIR_BACK, DIR_DOWN, DIR_FORWARD, DIR_UP } from "./inputBits";
import { inputAt, toFacingRelative } from "./inputHistory";
import type { FighterState, FighterStateName, JumpDir, PlayerIndex, SimEvent, SimState } from "./types";

export function isAirborne(f: FighterState): boolean {
  return f.state === "airborne";
}

/** States in which directional input moves the fighter (idle, walking, crouching). */
export function isActionable(state: FighterStateName): boolean {
  return (
    state === "idle" || state === "walk_forward" || state === "walk_back" || state === "crouch"
  );
}

/** States in which a grounded fighter may turn to face the opponent. */
export function canTurn(state: FighterStateName): boolean {
  return isActionable(state) || state === "landing" || state === "jumpsquat";
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
      return f.facing * Math.floor((MOVEMENT.walkForwardSpeed * fighterInfo(f.slug).walkPct) / 100);
    case "walk_back":
      return -f.facing * Math.floor((MOVEMENT.walkBackSpeed * fighterInfo(f.slug).walkPct) / 100);
    case "dash_forward":
      // Fast for the first two thirds, then a short slowdown.
      return f.facing * (f.stateFrame <= 10 ? MOVES_V2.dashForwardSpeed : MOVES_V2.dashForwardTail);
    case "dash_back":
      return -f.facing * (f.stateFrame <= 11 ? MOVES_V2.dashBackSpeed : MOVES_V2.dashBackTail);
    case "attack": {
      // Specials that travel (Hotfix Charge, Rapid Deploy) move with their segments.
      if (!f.move) return 0;
      const vx = segmentAt(MOVES[f.move.id].segments, f.move.tick).segment.vx ?? 0;
      return f.facing * vx;
    }
    default:
      return 0;
  }
}

/** Ends a timed state: back to neutral once `frames` have passed. */
function timedState(f: FighterState, player: PlayerIndex, state: SimState, control: boolean, dirs: number, frames: number): void {
  if (f.stateFrame < frames) return;
  f.state = "idle";
  f.stateFrame = 0;
  neutral(f, player, state, control, dirs);
}

/** Fighters may move and attack only while the round is being fought (or in training). */
export function controlEnabled(state: SimState): boolean {
  return state.round.training || (state.round.phase === "fight" && state.round.winner === -1);
}

/** Acting from neutral: start a buffered move, otherwise walk, crouch or jump. */
function neutral(f: FighterState, player: PlayerIndex, state: SimState, control: boolean, dirs: number): void {
  if (control && tryTaunt(f, player, state)) return;
  if (control && tryGroundMove(f, player, state)) return;
  const dash = control ? dashInput(f) : 0;
  if (dash !== 0) {
    f.state = dash === 1 ? "dash_forward" : "dash_back";
    f.stateFrame = 0;
    state.events.push({ type: "dash", player, dir: dash, x: f.x });
    return;
  }
  groundedControl(f, control ? dirs : 0);
}

/**
 * Advances one fighter's state machine by one frame, from its newest input.
 * A fighter in hit-stop is frozen: only the hit-stop counter runs down.
 * Sets the velocities that physics applies next.
 */
export function advanceFighter(f: FighterState, player: PlayerIndex, state: SimState): void {
  if (f.hitstop > 0) {
    f.hitstop -= 1;
    return;
  }
  const control = controlEnabled(state);
  const dirs = toFacingRelative(inputAt(f.input, 0), f.facing);
  f.stateFrame += 1;

  switch (f.state) {
    case "jumpsquat": {
      // A direction held during the squat still picks the jump direction.
      const intent = horizontalIntent(dirs);
      if (intent !== 0) f.jumpDir = intent;
      if (f.stateFrame >= MOVEMENT.jumpsquatFrames) launch(f, player, state.events);
      break;
    }
    case "airborne":
      // No air control; physics lands the fighter. One air attack per jump.
      if (f.move) f.move.tick += 1;
      else if (control) tryAirMove(f, player, state);
      break;
    case "landing":
      if (f.stateFrame >= MOVEMENT.landingFrames) {
        enter(f, "idle");
        neutral(f, player, state, control, dirs);
      }
      break;
    case "attack":
      if (tickGroundMove(f, player, state)) {
        f.state = "idle";
        f.stateFrame = 0;
        neutral(f, player, state, control, dirs);
      }
      break;
    case "hitstun":
    case "blockstun":
      if (f.state === "blockstun" && control && tryBlockPush(f, player, state)) break;
      f.stun -= 1;
      if (f.stun <= 0) {
        f.state = "idle";
        f.stateFrame = 0;
        groundedControl(f, control ? dirs : 0);
      }
      break;
    case "held": {
      // Held only while the opponent is in a throw that grabbed; otherwise released at once.
      const thrower = state.fighters[player === 0 ? 1 : 0];
      if (!(thrower.state === "attack" && thrower.move?.id === "throw" && thrower.move.grabbed) || f.stateFrame > 60) {
        enter(f, "idle");
      }
      break;
    }
    case "knockdown":
    case "ko":
      advanceDowned(f, player, state);
      break;
    case "victory":
      break;
    case "dash_forward":
      timedState(f, player, state, control, dirs, MOVES_V2.dashForwardFrames);
      break;
    case "dash_back":
      timedState(f, player, state, control, dirs, MOVES_V2.dashBackFrames);
      break;
    case "block_push":
      timedState(f, player, state, control, dirs, MOVES_V2.blockPushFrames);
      break;
    case "taunt":
      timedState(f, player, state, control, dirs, MOVES_V2.tauntFrames);
      break;
    default:
      f.comboHits = 0;
      neutral(f, player, state, control, dirs);
      break;
  }

  if (f.state !== "airborne" && f.state !== "knockdown" && f.state !== "ko") {
    f.vx = groundVelocity(f);
    f.vy = 0;
  }
}

/** Floor contact: the only way out of the airborne state. Ends any air attack. */
export function landFighter(f: FighterState, player: PlayerIndex, events: SimEvent[]): void {
  f.y = MOVEMENT.floorY;
  f.vx = 0;
  f.vy = 0;
  f.jumpDir = 0;
  f.move = null;
  enter(f, "landing");
  events.push({ type: "land", player });
}
