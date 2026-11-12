// One 60 Hz simulation step, in the fixed order of operations from
// docs/game-design.md ("Game loop architecture", rule 6).
import { advanceFighter } from "./fighter";
import { pushInput } from "./inputHistory";
import { applyMovement, midpoint, resolveSpacing, updateFacing } from "./physics";
import { cloneState } from "./state";
import type { InputPair, SimState } from "./types";

/** A hit found by hit detection, applied afterwards. Combat (spec 003) fills it in. */
export type PendingHit = never;

/** Detect hits for both fighters at once, so trades happen. No-op until combat. */
export function detectHits(_state: SimState): PendingHit[] {
  return [];
}

/** Apply damage, hit-stop and stun from detected hits. No-op until combat. */
export function applyHits(_state: SimState, _hits: readonly PendingHit[]): void {
  // Intentionally empty: combat core fills this slot.
}

/** Round timer and round state. No-op until match flow. */
export function advanceRound(_state: SimState): void {
  // Intentionally empty: match flow fills this slot.
}

/**
 * Advances the sim by one frame. Uses only `prev` and the two input bitmasks;
 * returns a new state and leaves `prev` untouched.
 */
export function step(prev: SimState, inputs: InputPair): SimState {
  const state = cloneState(prev);
  const [p1, p2] = state.fighters;
  state.frame += 1;
  state.events = [];

  // 1. Read inputs.
  pushInput(p1.input, inputs[0]);
  pushInput(p2.input, inputs[1]);

  // 2. Advance state machines.
  advanceFighter(p1, 0, state.events);
  advanceFighter(p2, 1, state.events);

  // 3. Movement and gravity.
  const previousMid = midpoint(state.fighters);
  applyMovement(p1, 0, state.events);
  applyMovement(p2, 1, state.events);

  // 4. Pushboxes, walls and the screen limit; then facing.
  resolveSpacing(state.fighters, previousMid);
  updateFacing(state.fighters);

  // 5. Detect hits for both fighters at once.
  const hits = detectHits(state);

  // 6. Apply hits.
  applyHits(state, hits);

  // 7. Round timers and round state.
  advanceRound(state);

  // 8. Emit events: state.events now holds everything this step produced.
  return state;
}

/** Runs `step` over a list of input pairs, returning the final state. */
export function runSteps(start: SimState, inputs: readonly InputPair[]): SimState {
  let state = start;
  for (const pair of inputs) state = step(state, pair);
  return state;
}
