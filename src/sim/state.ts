// Creating and copying sim state.
import { COMBAT, ROUND } from "../data/combat";
import { MOVEMENT } from "../data/movement";
import { cloneInputHistory, createInputHistory } from "./inputHistory";
import { seedRng } from "./rng";
import type { Facing, FighterState, RoundState, SimEvent, SimState } from "./types";

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
    health: COMBAT.maxHealth,
    move: null,
    hitstop: 0,
    stun: 0,
    stunLow: false,
    pushLeft: 0,
    pushFrames: 0,
    comboHits: 0,
    consumedFrame: -1,
  };
}

function startingFighters(p1Slug: string, p2Slug: string): [FighterState, FighterState] {
  const center = MOVEMENT.stageWidth / 2;
  const half = MOVEMENT.startSeparation / 2;
  return [createFighter(p1Slug, center - half, 1), createFighter(p2Slug, center + half, -1)];
}

/** Two fighters centered on the stage, facing each other, P1 on the left. Training: no rounds. */
export function createSandboxState(seed: number, p1Slug: string, p2Slug: string): SimState {
  return {
    frame: 0,
    rng: seedRng(seed),
    fighters: startingFighters(p1Slug, p2Slug),
    projectiles: [],
    round: { phase: "fight", phaseFrame: 0, number: 1, wins: [0, 0], timer: 0, winner: -1, reason: "", training: true },
    events: [],
  };
}

/** A best-of-3 match starting at the round 1 intro. `skipIntro` starts in the fight phase (tests). */
export function createMatchState(seed: number, p1Slug: string, p2Slug: string, skipIntro = false): SimState {
  const round: RoundState = {
    phase: skipIntro ? "fight" : "intro",
    phaseFrame: 0,
    number: 1,
    wins: [0, 0],
    timer: ROUND.timerFrames,
    winner: -1,
    reason: "",
    training: false,
  };
  return { frame: 0, rng: seedRng(seed), fighters: startingFighters(p1Slug, p2Slug), projectiles: [], round, events: [] };
}

/** Puts both fighters back at their starting marks with full health (between rounds). */
export function resetFighters(state: SimState): void {
  const [a, b] = state.fighters;
  const fresh = startingFighters(a.slug, b.slug);
  fresh[0].input = a.input;
  fresh[1].input = b.input;
  fresh[0].consumedFrame = state.frame;
  fresh[1].consumedFrame = state.frame;
  state.fighters = fresh;
  state.projectiles = [];
}

export function cloneFighter(f: FighterState): FighterState {
  return { ...f, input: cloneInputHistory(f.input), move: f.move ? { ...f.move } : null };
}

function cloneEvent(e: SimEvent): SimEvent {
  return { ...e };
}

export function cloneState(s: SimState): SimState {
  return {
    frame: s.frame,
    rng: s.rng,
    fighters: [cloneFighter(s.fighters[0]), cloneFighter(s.fighters[1])],
    projectiles: s.projectiles.map((p) => ({ ...p })),
    round: { ...s.round, wins: [s.round.wins[0], s.round.wins[1]] },
    events: s.events.map(cloneEvent),
  };
}
