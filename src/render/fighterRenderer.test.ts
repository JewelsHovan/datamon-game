import { describe, expect, it } from "vitest";
import { createFighter } from "../sim/state";
import type { FighterState } from "../sim/types";
import type { AtlasImage, ClipSet } from "./clips";
import { clipForFighter, drawFighter, frameForFighter } from "./fighterRenderer";

const atlas = { width: 400, height: 200 } as unknown as AtlasImage;
const frame = (x: number, hold = 8) => ({ x, y: 0, w: 40, h: 100, ax: 10, ay: 99, hold });
const set: ClipSet = {
  slug: "test",
  source: "manifest",
  atlas,
  artFacing: 1,
  clips: {
    idle: { loop: true, frames: [frame(0)] },
    walk: { loop: true, frames: [frame(40), frame(80), frame(120), frame(160)] },
  },
};

function fighter(patch: Partial<FighterState>): FighterState {
  return { ...createFighter("test", 50000, 1), ...patch };
}

describe("fighter rendering (R6)", () => {
  it("walk frames come from stateFrame and holds; walking back plays the cycle in reverse", () => {
    const fwd = [0, 8, 16, 24, 32].map(
      (t) => frameForFighter(set, fighter({ state: "walk_forward", stateFrame: t })).x,
    );
    expect(fwd).toEqual([40, 80, 120, 160, 40]);
    const back = [0, 8, 16, 24].map(
      (t) => frameForFighter(set, fighter({ state: "walk_back", stateFrame: t })).x,
    );
    expect(back).toEqual([160, 120, 80, 40]);
  });

  it("missing clips fall back to idle", () => {
    expect(clipForFighter(fighter({ state: "crouch" })).clip).toBe("crouch");
    expect(frameForFighter(set, fighter({ state: "crouch" })).x).toBe(0);
    expect(frameForFighter(set, fighter({ state: "airborne", stateFrame: 12 })).x).toBe(0);
  });

  it("puts the anchor on the fighter's position, mirrored around it when facing left", () => {
    const calls: { op: string; args: number[] }[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, op: string) => (...args: number[]) => calls.push({ op, args: args.slice(op === "drawImage" ? 1 : 0) }),
      },
    ) as unknown as CanvasRenderingContext2D;
    const camera = { x: 100, y: 0 };

    drawFighter(ctx, set, fighter({ x: 50000, y: 32000, facing: 1 }), camera);
    // Screen position (400, 320); anchor (10, 99) sits on it.
    expect(calls).toEqual([{ op: "drawImage", args: [0, 0, 40, 100, 390, 221, 40, 100] }]);

    calls.length = 0;
    drawFighter(ctx, set, fighter({ x: 50000, y: 32000, facing: -1 }), camera);
    expect(calls.map((c) => c.op)).toEqual(["save", "translate", "scale", "drawImage", "restore"]);
    expect(calls[1]!.args).toEqual([400, 320]);
    expect(calls[2]!.args).toEqual([-1, 1]);
    expect(calls[3]!.args).toEqual([0, 0, 40, 100, -10, -99, 40, 100]);
  });
});
