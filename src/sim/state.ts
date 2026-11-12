// Creating and copying sim state.
import { MOVEMENT } from "../data/movement";
import { cloneInputHistory, createInputHistory } from "./inputHistory";
import { seedRng } from "./rng";
import type { Facing, FighterState, SimEvent, SimState } from "./types";

export function createFighter(slug: string, x: number, facing: Facing): FighterState {
  return {
    slug,
    x,
    y: MOVEMENT.floorY,
    vx: 0,
    vy: 0,
    facing,
    state: "idle",
    stateFrame: 0,
    jumpDir: 0,
    input: createInputHistory(),
  };
}

/** Two fighters centered on the stage, facing each other, P1 on the left. */
export function createSandboxState(seed: number, p1Slug: string, p2Slug: string): SimState {
  const center = MOVEMENT.stageWidth / 2;
  const half = MOVEMENT.startSeparation / 2;
  return {
    frame: 0,
    rng: seedRng(seed),
    fighters: [createFighter(p1Slug, center - half, 1), createFighter(p2Slug, center + half, -1)],
    events: [],
  };
}

export function cloneFighter(f: FighterState): FighterState {
  return { ...f, input: cloneInputHistory(f.input) };
}

function cloneEvent(e: SimEvent): SimEvent {
  return { ...e };
}

export function cloneState(s: SimState): SimState {
  return {
    frame: s.frame,
    rng: s.rng,
    fighters: [cloneFighter(s.fighters[0]), cloneFighter(s.fighters[1])],
    events: s.events.map(cloneEvent),
  };
}
