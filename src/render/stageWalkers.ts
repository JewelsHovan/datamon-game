// Background walkers (spec 009, R3): coworkers crossing the office behind the fight.
// Pure and seeded so it is testable and deterministic; the renderer advances it once per
// animation frame (a cosmetic, render-time clock).

export interface Walker {
  /** Index into the cast (which coworker). */
  who: number;
  /** Position in mid-layer pixels. */
  x: number;
  /** 1 walking right, -1 walking left. */
  dir: 1 | -1;
  /** Pixels per frame. */
  speed: number;
  /** Frames to wait off-stage before (re)entering. */
  wait: number;
  /** Frames walked, drives the walk cycle. */
  steps: number;
  /** Frames left watching the fight (after a K.O.); faces `watchDir`. */
  watching: number;
  watchDir: 1 | -1;
}

export interface WalkerState {
  rng: number;
  width: number;
  walkers: Walker[];
}

function next(state: WalkerState): number {
  // mulberry32
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function spawn(state: WalkerState, w: Walker, castSize: number): void {
  w.dir = next(state) < 0.5 ? 1 : -1;
  w.x = w.dir === 1 ? -40 : state.width + 40;
  w.speed = 0.45 + next(state) * 0.4;
  w.who = Math.floor(next(state) * castSize);
  w.steps = 0;
}

export function createWalkers(seed: number, count: number, width: number, castSize: number): WalkerState {
  const state: WalkerState = { rng: seed >>> 0, width, walkers: [] };
  for (let i = 0; i < count; i++) {
    const w: Walker = { who: 0, x: 0, dir: 1, speed: 0.5, wait: 0, steps: 0, watching: 0, watchDir: 1 };
    spawn(state, w, castSize);
    // Start spread across the floor so the office is not empty at the first frame.
    w.x = Math.floor(next(state) * width);
    w.wait = 0;
    state.walkers.push(w);
  }
  return state;
}

/** One frame. `koAt` (mid-layer x) makes everyone stop and face the fight for a while. */
export function stepWalkers(state: WalkerState, castSize: number, koAt: number | null = null): void {
  for (const w of state.walkers) {
    if (koAt !== null) {
      w.watching = 100;
      w.watchDir = koAt >= w.x ? 1 : -1;
    }
    if (w.watching > 0) {
      w.watching -= 1;
      continue;
    }
    if (w.wait > 0) {
      w.wait -= 1;
      if (w.wait === 0) spawn(state, w, castSize);
      continue;
    }
    w.x += w.dir * w.speed;
    w.steps += 1;
    if (w.x < -60 || w.x > state.width + 60) w.wait = 60 + Math.floor(next(state) * 240);
  }
}
