// One 60 Hz simulation step, in the fixed order of operations from
// docs/game-design.md ("Game loop architecture", rule 6).
import { advancePush, advanceProjectiles, applyHits, detectHits } from "./combat";
import { advanceFighter } from "./fighter";
import { pushInput } from "./inputHistory";
import { applyMovement, midpoint, resolveSpacing, updateFacing } from "./physics";
import { advanceRound } from "./round";
import { cloneState } from "./state";
import type { InputPair, SimState } from "./types";

export { applyHits, detectHits, type PendingHit } from "./combat";
export { advanceRound } from "./round";

/**
 * Advances the sim by one frame. Uses only `prev` and the two input bitmasks;
 * returns a new state and leaves `prev` untouched.
 */
export function step(prev: SimState, inputs: InputPair): SimState {
  const state = cloneState(prev);
  const [p1, p2] = state.fighters;
  state.frame += 1;
  state.events = [];

  // 1. Read inputs (recorded even during hit-stop, so presses buffer through it).
  pushInput(p1.input, inputs[0]);
  pushInput(p2.input, inputs[1]);

  // 2. Advance state machines. Fighters in hit-stop stay frozen this step.
  const frozen = [p1.hitstop > 0, p2.hitstop > 0] as const;
  advanceFighter(p1, 0, state);
  advanceFighter(p2, 1, state);

  // 3. Movement, gravity and pushback; projectiles fly.
  const previousMid = midpoint(state.fighters);
  if (!frozen[0]) {
    applyMovement(p1, 0, state.events);
    advancePush(p1);
  }
  if (!frozen[1]) {
    applyMovement(p2, 1, state.events);
    advancePush(p2);
  }
  advanceProjectiles(state);

  // 4. Pushboxes, walls and the screen limit; then facing.
  resolveSpacing(state.fighters, previousMid);
  updateFacing(state.fighters);

  // 5-6. Detect hits for both fighters at once (trades happen), then apply them. Only while the
  // round is being fought: nothing lands after a K.O. or the time-out buzzer.
  if (state.round.training || state.round.phase === "fight") {
    const hits = detectHits(state);
    applyHits(state, hits);
  }

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
