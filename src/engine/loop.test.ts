import { describe, expect, it } from "vitest";
import { FixedStepLoop, MAX_STEPS_PER_FRAME, STEP_MS, type FrameScheduler } from "./loop";

/** A fake clock plus a manual frame scheduler: each `tick(delta)` is one animation frame. */
function harness() {
  let time = 1000;
  let steps = 0;
  let renders = 0;
  const pending: (() => void)[] = [];
  const scheduler: FrameScheduler = {
    request(cb) {
      pending.push(cb);
      return pending.length;
    },
    cancel() {
      pending.length = 0;
    },
  };
  const loop = new FixedStepLoop(
    {
      step: () => steps++,
      render: () => renders++,
    },
    { now: () => time },
  );
  loop.start(scheduler);
  const runFrame = () => {
    const cb = pending.shift();
    if (!cb) throw new Error("no frame scheduled");
    cb();
  };
  // The first frame only sets the time base.
  runFrame();
  return {
    loop,
    get steps() {
      return steps;
    },
    get renders() {
      return renders;
    },
    tick(deltaMs: number) {
      time += deltaMs;
      runFrame();
    },
  };
}

describe("fixed-step loop (A3)", () => {
  it("60 deltas of 1000/60 ms run 60 steps", () => {
    const h = harness();
    for (let i = 0; i < 60; i++) h.tick(1000 / 60);
    expect(h.steps).toBe(60);
    expect(h.loop.accumulatorMs).toBeLessThan(STEP_MS);
  });

  it("120 deltas of 1000/120 ms run 60 steps", () => {
    const h = harness();
    for (let i = 0; i < 120; i++) h.tick(1000 / 120);
    expect(h.steps).toBe(60);
  });

  it("one 1000 ms delta runs exactly 5 steps and leaves the accumulator below one step", () => {
    const h = harness();
    h.tick(1000);
    expect(MAX_STEPS_PER_FRAME).toBe(5);
    expect(h.steps).toBe(5);
    expect(h.loop.stats.stepsLastFrame).toBe(5);
    expect(h.loop.accumulatorMs).toBeLessThan(STEP_MS);
    // The dropped time is not paid back on the next frames.
    h.tick(1000 / 60);
    expect(h.steps).toBe(6);
  });

  it("draws exactly once per animation frame, after stepping", () => {
    const h = harness();
    const rendersBefore = h.renders;
    h.tick(50); // 3 steps
    h.tick(1); // 0 steps
    expect(h.renders - rendersBefore).toBe(2);
  });

  it("uneven frame times still average 60 steps per second", () => {
    const h = harness();
    const deltas = [7, 16, 33, 5, 21, 18, 12]; // sums to 112 ms
    let elapsed = 0;
    while (elapsed < 10_000) {
      for (const d of deltas) {
        h.tick(d);
        elapsed += d;
      }
    }
    const expected = Math.floor(elapsed / STEP_MS);
    expect(Math.abs(h.steps - expected)).toBeLessThanOrEqual(1);
  });

  it("returning to a hidden tab does not fast-forward", () => {
    const h = harness();
    h.tick(1000 / 60);
    expect(h.steps).toBe(1);
    h.loop.setHidden(true);
    h.tick(30_000); // a frame while hidden steps nothing
    expect(h.steps).toBe(1);
    h.loop.setHidden(false);
    h.tick(30_000); // first frame back: fresh time base, no catch-up
    expect(h.steps).toBe(1);
    h.tick(1000 / 60);
    expect(h.steps).toBe(2);
  });

  it("measures render FPS", () => {
    const h = harness();
    for (let i = 0; i < 120; i++) h.tick(1000 / 60);
    expect(h.loop.stats.fps).toBeGreaterThan(59);
    expect(h.loop.stats.fps).toBeLessThan(61);
  });

  it("stop cancels the scheduled frame", () => {
    const h = harness();
    h.loop.stop();
    expect(() => h.tick(16)).toThrow("no frame scheduled");
  });
});
