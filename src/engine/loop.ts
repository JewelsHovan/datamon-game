// Real-time loop: a fixed 60 Hz simulation driven by an accumulator, drawing
// once per animation frame after stepping (no interpolation). The clock and
// the frame scheduler are injectable so the loop runs under a fake clock in tests.

export const SIM_HZ = 60;
export const STEP_MS = 1000 / SIM_HZ;
/** At most this many sim steps per animation frame; time beyond that is dropped. */
export const MAX_STEPS_PER_FRAME = 5;
/** Float slack so deltas like 1000/60 never lose a step to rounding. */
const EPSILON_MS = 1e-6;
/** Render FPS is averaged over windows of this length. */
const FPS_WINDOW_MS = 500;

export interface Clock {
  /** Milliseconds, monotonic. */
  now(): number;
}

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface LoopStats {
  /** Sim steps run on the last animation frame. */
  stepsLastFrame: number;
  /** Sim steps run since the loop was created. */
  totalSteps: number;
  /** Animation frames drawn since the loop was created. */
  frames: number;
  /** Animation frames per second, measured over the last half second. */
  fps: number;
}

export interface LoopHooks {
  /** Runs one fixed sim step (sample input, then step the sim). */
  step(): void;
  /** Draws the latest sim state; called once per animation frame, after stepping. */
  render(stats: Readonly<LoopStats>): void;
}

export const performanceClock: Clock = { now: () => performance.now() };

export const animationFrameScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(() => callback()),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class FixedStepLoop {
  private accumulator = 0;
  private lastTime: number | null = null;
  private hidden = false;
  private fpsWindowStart: number | null = null;
  private fpsWindowFrames = 0;
  private handle: number | null = null;
  readonly stats: LoopStats = { stepsLastFrame: 0, totalSteps: 0, frames: 0, fps: 0 };

  constructor(
    private readonly hooks: LoopHooks,
    private readonly clock: Clock = performanceClock,
  ) {}

  /** Time banked toward the next step, in milliseconds (always below one step after a frame). */
  get accumulatorMs(): number {
    return this.accumulator;
  }

  /**
   * Adds `deltaMs` of real time and runs the steps it pays for, at most
   * MAX_STEPS_PER_FRAME. Whole steps beyond the cap are dropped, not queued.
   */
  advance(deltaMs: number): number {
    this.accumulator += deltaMs > 0 ? deltaMs : 0;
    let steps = 0;
    while (this.accumulator + EPSILON_MS >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      this.hooks.step();
      this.accumulator -= STEP_MS;
      steps++;
    }
    if (this.accumulator < 0) this.accumulator = 0;
    if (this.accumulator + EPSILON_MS >= STEP_MS) this.accumulator = 0;
    this.stats.stepsLastFrame = steps;
    this.stats.totalSteps += steps;
    return steps;
  }

  /** One animation frame: step as real time requires, then draw once. Returns steps run. */
  frame(): number {
    const now = this.clock.now();
    const delta = this.lastTime === null || this.hidden ? 0 : now - this.lastTime;
    this.lastTime = now;
    const steps = this.hidden ? 0 : this.advance(delta);
    if (this.hidden) this.stats.stepsLastFrame = 0;
    this.measureFps(now);
    this.stats.frames++;
    this.hooks.render(this.stats);
    return steps;
  }

  /**
   * Hidden tabs do not bank time: while hidden nothing steps, and the first
   * frame after the tab is visible again starts from a fresh timestamp.
   */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.lastTime = null;
    this.accumulator = 0;
    this.fpsWindowStart = null;
  }

  /** Runs `frame` on every animation frame until `stop`. */
  start(scheduler: FrameScheduler = animationFrameScheduler): void {
    if (this.scheduler !== null) return;
    this.scheduler = scheduler;
    const tick = () => {
      this.frame();
      if (this.scheduler === scheduler) this.handle = scheduler.request(tick);
    };
    this.handle = scheduler.request(tick);
  }

  stop(): void {
    if (this.scheduler !== null && this.handle !== null) this.scheduler.cancel(this.handle);
    this.scheduler = null;
    this.handle = null;
  }

  private scheduler: FrameScheduler | null = null;

  private measureFps(now: number): void {
    if (this.fpsWindowStart === null) {
      this.fpsWindowStart = now;
      this.fpsWindowFrames = 0;
      return;
    }
    this.fpsWindowFrames++;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= FPS_WINDOW_MS) {
      this.stats.fps = (this.fpsWindowFrames * 1000) / elapsed;
      this.fpsWindowStart = now;
      this.fpsWindowFrames = 0;
    }
  }
}
