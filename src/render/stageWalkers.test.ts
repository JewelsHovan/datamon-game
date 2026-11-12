// Spec 009 A3: the walker scheduler is deterministic for a seed, keeps walkers moving, and
// stops everyone to watch on a K.O.
import { describe, expect, it } from "vitest";
import { createWalkers, stepWalkers } from "./stageWalkers";

function run(seed: number, frames: number, koAt = -1) {
  const s = createWalkers(seed, 4, 1088, 7);
  for (let t = 0; t < frames; t++) stepWalkers(s, 7, t === koAt ? 500 : null);
  return s;
}

describe("stage walkers", () => {
  it("is deterministic for a seed", () => {
    expect(JSON.stringify(run(3, 2000))).toBe(JSON.stringify(run(3, 2000)));
    expect(JSON.stringify(run(3, 2000))).not.toBe(JSON.stringify(run(4, 2000)));
  });

  it("walkers cross the floor and come back", () => {
    const s = createWalkers(5, 4, 1088, 7);
    const start = s.walkers.map((w) => w.x);
    let respawns = 0;
    for (let t = 0; t < 6000; t++) {
      const waiting = s.walkers.map((w) => w.wait > 0);
      stepWalkers(s, 7);
      s.walkers.forEach((w, i) => {
        if (waiting[i] && w.wait === 0) respawns++;
      });
    }
    expect(respawns).toBeGreaterThan(2);
    expect(s.walkers.map((w) => w.x)).not.toEqual(start);
  });

  it("on a K.O. everyone stops and faces the fight", () => {
    const s = run(7, 300, 299);
    for (const w of s.walkers) {
      expect(w.watching).toBeGreaterThan(90);
      expect(w.watchDir).toBe(500 >= w.x ? 1 : -1);
    }
    const xs = s.walkers.map((w) => w.x);
    for (let t = 0; t < 50; t++) stepWalkers(s, 7);
    expect(s.walkers.map((w) => w.x)).toEqual(xs);
  });
});
