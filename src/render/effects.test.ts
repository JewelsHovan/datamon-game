// Spec 004 A4 and A5: shake decays to zero; reduced effects means no shake and no flash.
import { describe, expect, it } from "vitest";
import { createMatchState } from "../sim/state";
import type { SimEvent } from "../sim/types";
import { EffectsLayer, SHAKE } from "./effects";

const state = createMatchState(1, "julien-hovan", "julien-hovan", true);
const heavyHit: SimEvent = { type: "hit", player: 0, target: 1, move: "heavy_punch", strength: "heavy", x: 64000, y: 21000, damage: 90, combo: 1 };

describe("effects layer feel (spec 004)", () => {
  it("a heavy hit shakes the screen, and the shake decays to zero", () => {
    const fx = new EffectsLayer(null);
    fx.onEvents([heavyHit], state);
    expect(fx.amplitude).toBe(SHAKE.heavy);
    expect(fx.flash[1]).toBe(2);
    let last = fx.amplitude;
    for (let i = 0; i < SHAKE.decayFrames; i++) {
      fx.tick();
      expect(fx.amplitude).toBeLessThanOrEqual(last);
      last = fx.amplitude;
    }
    expect(fx.amplitude).toBe(0);
    expect(fx.cameraOffset(3)).toEqual({ x: 0, y: 0 });
  });

  it("a K.O. shakes harder and flashes the screen", () => {
    const fx = new EffectsLayer(null);
    fx.onEvents([{ type: "ko", player: 1, x: 64000, y: 32000 }], state);
    expect(fx.amplitude).toBe(SHAKE.ko);
    expect(fx.screenFlash).toBeGreaterThan(0);
  });

  it("with reduced effects on, nothing shakes or flashes", () => {
    const fx = new EffectsLayer(null, true);
    fx.onEvents([heavyHit, { type: "ko", player: 1, x: 64000, y: 32000 }], state);
    expect(fx.amplitude).toBe(0);
    expect(fx.flash).toEqual([0, 0]);
    expect(fx.screenFlash).toBe(0);
    expect(fx.cameraOffset(1)).toEqual({ x: 0, y: 0 });
  });
});
