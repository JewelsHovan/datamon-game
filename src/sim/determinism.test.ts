import { describe, expect, it } from "vitest";
import { canonicalStringify, hashState } from "./hash";
import { nextU32 } from "./rng";
import { createSandboxState } from "./state";
import { step } from "./step";
import {
  SANDBOX_P1,
  SANDBOX_P2,
  SANDBOX_SCRIPT,
  SANDBOX_SCRIPT_SEED,
} from "./testing/sandboxScript";
import type { FighterStateName, JumpDir, SimState } from "./types";

/** Runs the script, recording the hash every 60th frame. Optionally JSON round-trips at `roundTripAt`. */
function runScript(roundTripAt?: number): { checkpoints: string[]; final: SimState } {
  let state = createSandboxState(SANDBOX_SCRIPT_SEED, SANDBOX_P1, SANDBOX_P2);
  const checkpoints: string[] = [];
  for (const inputs of SANDBOX_SCRIPT) {
    state = step(state, inputs);
    if (state.frame % 60 === 0) checkpoints.push(hashState(state));
    if (state.frame === roundTripAt) state = JSON.parse(JSON.stringify(state)) as SimState;
  }
  return { checkpoints, final: state };
}

describe("determinism (A5)", () => {
  it("the scripted sequence is 600 frames", () => {
    expect(SANDBOX_SCRIPT).toHaveLength(600);
  });

  it("the script walks both ways, crouches, does all three jumps and jumps over the opponent", () => {
    let state = createSandboxState(SANDBOX_SCRIPT_SEED, SANDBOX_P1, SANDBOX_P2);
    const seen = new Set<FighterStateName>();
    const jumps = new Set<JumpDir>();
    let sideSwaps = 0;
    let p1LeftOfP2 = state.fighters[0].x < state.fighters[1].x;
    for (const inputs of SANDBOX_SCRIPT) {
      state = step(state, inputs);
      for (const f of state.fighters) seen.add(f.state);
      for (const e of state.events) if (e.type === "jump") jumps.add(e.dir);
      const nowLeft = state.fighters[0].x < state.fighters[1].x;
      if (nowLeft !== p1LeftOfP2) sideSwaps++;
      p1LeftOfP2 = nowLeft;
    }
    expect([...seen].sort()).toEqual(
      ["airborne", "crouch", "idle", "jumpsquat", "landing", "walk_back", "walk_forward"].sort(),
    );
    expect([...jumps].sort()).toEqual([-1, 0, 1]);
    expect(sideSwaps).toBeGreaterThanOrEqual(1);
  });

  it("two runs from the same seed give identical hashes at every 60th frame", () => {
    const a = runScript();
    const b = runScript();
    expect(a.checkpoints).toHaveLength(10);
    expect(b.checkpoints).toEqual(a.checkpoints);
    expect(hashState(b.final)).toBe(hashState(a.final));
  });

  it("a run that JSON round-trips the state at frame 300 ends on the same final hash", () => {
    const plain = runScript();
    const roundTripped = runScript(300);
    expect(roundTripped.checkpoints).toEqual(plain.checkpoints);
    expect(hashState(roundTripped.final)).toBe(hashState(plain.final));
  });

  it("step leaves its input state untouched", () => {
    const start = createSandboxState(1, SANDBOX_P1, SANDBOX_P2);
    const before = canonicalStringify(start);
    step(start, [8, 4]);
    expect(canonicalStringify(start)).toBe(before);
  });

  it("the hash changes when the state changes and ignores key order", () => {
    const a = createSandboxState(1, SANDBOX_P1, SANDBOX_P2);
    const b = createSandboxState(2, SANDBOX_P1, SANDBOX_P2);
    expect(hashState(a)).not.toBe(hashState(b));
    expect(hashState({ x: 1, y: [2, 3] })).toBe(hashState({ y: [2, 3], x: 1 }));
    expect(hashState(a)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("the hash rejects non-integer numbers", () => {
    expect(() => hashState({ x: 1.5 })).toThrow(/non-integer/);
  });

  it("the seeded PRNG repeats its sequence from the same seed and survives a JSON round trip", () => {
    const a = { rng: 42 };
    const b = { rng: 42 };
    const seqA = Array.from({ length: 5 }, () => nextU32(a));
    const copy = JSON.parse(JSON.stringify(b)) as { rng: number };
    const seqB = Array.from({ length: 5 }, () => nextU32(copy));
    expect(seqB).toEqual(seqA);
    expect(new Set(seqA).size).toBe(5);
    for (const v of seqA) expect(Number.isInteger(v) && v >= 0 && v < 2 ** 32).toBe(true);
  });
});
