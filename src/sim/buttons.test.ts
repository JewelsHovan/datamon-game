// Spec 005 A1: the Punch / Kick / Special button scheme. Each input picks the
// right move from neutral, in the air, as a throw chord and as a cancel.
import { describe, expect, it } from "vitest";
import type { MoveId } from "../data/moves";
import { normalFor } from "./combat";
import {
  BUTTON_DOWN,
  BUTTON_KICK,
  BUTTON_LEFT,
  BUTTON_PUNCH,
  BUTTON_RIGHT,
  BUTTON_SPECIAL,
  BUTTON_UP,
  DIR_BACK,
  DIR_DOWN,
  DIR_FORWARD,
} from "./inputBits";
import { createMatchState } from "./state";
import { step } from "./step";
import type { SimState } from "./types";

const P = BUTTON_PUNCH;
const K = BUTTON_KICK;
const S = BUTTON_SPECIAL;
const R = BUTTON_RIGHT;
const LEFT = BUTTON_LEFT;
const D = BUTTON_DOWN;
const U = BUTTON_UP;

/** A fight-phase match with the fighters `gapPx` apart (P1 left, facing right). */
function duel(gapPx: number): SimState {
  const s = createMatchState(1, "julien-hovan", "julien-hovan", true);
  s.fighters[0].x = 64000 - gapPx * 50;
  s.fighters[1].x = 64000 + gapPx * 50;
  return s;
}

/** The move P1 is in after pressing `bits` for one frame from neutral, far from P2. */
function startsFromNeutral(bits: number): MoveId | undefined {
  return step(duel(400), [bits, 0]).fighters[0].move?.id;
}

describe("normalFor (R1)", () => {
  it("maps Punch and Kick with the held directions", () => {
    expect(normalFor(P, 0)).toBe("light_punch");
    expect(normalFor(P, DIR_FORWARD)).toBe("heavy_punch");
    expect(normalFor(K, 0)).toBe("light_kick");
    expect(normalFor(K, DIR_FORWARD)).toBe("heavy_kick");
    expect(normalFor(P, DIR_DOWN)).toBe("crouch_attack");
    expect(normalFor(K, DIR_DOWN)).toBe("crouch_attack");
    expect(normalFor(K, DIR_DOWN | DIR_FORWARD)).toBe("crouch_attack");
    expect(normalFor(P, DIR_BACK)).toBe("light_punch");
  });
});

describe("button scheme from neutral (A1)", () => {
  it("Punch starts light_punch, forward+Punch heavy_punch", () => {
    expect(startsFromNeutral(P)).toBe("light_punch");
    expect(startsFromNeutral(R | P)).toBe("heavy_punch");
  });

  it("Kick starts light_kick, forward+Kick heavy_kick", () => {
    expect(startsFromNeutral(K)).toBe("light_kick");
    expect(startsFromNeutral(R | K)).toBe("heavy_kick");
  });

  it("down+Kick and down+Punch start crouch_attack", () => {
    expect(startsFromNeutral(D | K)).toBe("crouch_attack");
    expect(startsFromNeutral(D | P)).toBe("crouch_attack");
    expect(startsFromNeutral(D | R | K)).toBe("crouch_attack");
  });

  it("back+Punch is still a light punch (back is not forward)", () => {
    expect(startsFromNeutral(LEFT | P)).toBe("light_punch");
  });

  it("Special starts special", () => {
    expect(startsFromNeutral(S)).toBe("special");
  });

  it("forward is relative to facing: P2 facing left uses left as forward", () => {
    const s = step(duel(400), [0, LEFT | P]);
    expect(s.fighters[1].facing).toBe(-1);
    expect(s.fighters[1].move?.id).toBe("heavy_punch");
    const k = step(duel(400), [0, R | K]); // right is back for P2
    expect(k.fighters[1].move?.id).toBe("light_kick");
  });
});

describe("throw chord (A1)", () => {
  it("Punch+Kick on the same frame is a throw", () => {
    expect(startsFromNeutral(P | K)).toBe("throw");
  });

  it("Punch then Kick one frame later converts the jab into a throw", () => {
    let s = step(duel(400), [P, 0]);
    expect(s.fighters[0].move?.id).toBe("light_punch");
    s = step(s, [P | K, 0]);
    expect(s.fighters[0].move?.id).toBe("throw");
  });

  it("Kick then Punch two frames later converts the kick into a throw", () => {
    let s = step(duel(400), [K, 0]);
    s = step(s, [K, 0]);
    s = step(s, [K | P, 0]);
    expect(s.fighters[0].move?.id).toBe("throw");
  });

  it("down+Punch then Kick converts the crouch attack into a throw", () => {
    let s = step(duel(400), [D | P, 0]);
    expect(s.fighters[0].move?.id).toBe("crouch_attack");
    s = step(s, [D | P | K, 0]);
    expect(s.fighters[0].move?.id).toBe("throw");
  });

  it("Punch and Kick three frames apart are two separate presses, not a throw", () => {
    let s = step(duel(400), [P, 0]);
    s = step(s, [P, 0]);
    s = step(s, [P, 0]);
    s = step(s, [P | K, 0]);
    expect(s.fighters[0].move?.id).toBe("light_punch");
  });
});

describe("air attacks (A1)", () => {
  function airborne(): SimState {
    let s = duel(400);
    for (let t = 0; t < 8; t++) s = step(s, [U, 0]);
    expect(s.fighters[0].state).toBe("airborne");
    return s;
  }

  it("Kick in the air starts air_attack", () => {
    const s = step(airborne(), [K, 0]);
    expect(s.fighters[0].move?.id).toBe("air_attack");
  });

  it("Punch in the air starts air_attack", () => {
    const s = step(airborne(), [P, 0]);
    expect(s.fighters[0].move?.id).toBe("air_attack");
  });
});

describe("cancels (A1)", () => {
  /** P1 lands `first` point blank, then presses `follow` on the first frame after hit-stop. */
  function afterHit(first: number, follow: number): { connected: MoveId; next: MoveId | undefined } {
    let s = step(duel(60), [first, 0]);
    const connected = s.fighters[0].move!.id;
    for (let t = 0; t < 30 && !s.events.some((e) => e.type === "hit"); t++) s = step(s, [0, 0]);
    expect(s.events.some((e) => e.type === "hit" && e.player === 0)).toBe(true);
    while (s.fighters[0].hitstop > 0) s = step(s, [0, 0]);
    s = step(s, [follow, 0]);
    return { connected, next: s.fighters[0].move?.id };
  }

  it("light_punch on hit cancels into heavy_punch on forward+Punch", () => {
    expect(afterHit(P, R | P)).toEqual({ connected: "light_punch", next: "heavy_punch" });
  });

  it("light_punch on hit cancels into heavy_kick on forward+Kick", () => {
    expect(afterHit(P, R | K)).toEqual({ connected: "light_punch", next: "heavy_kick" });
  });

  it("light_punch on hit cancels into special on Special", () => {
    expect(afterHit(P, S)).toEqual({ connected: "light_punch", next: "special" });
  });

  it("light_punch does not cancel into another light punch", () => {
    let s = step(duel(60), [P, 0]);
    while (!s.events.some((e) => e.type === "hit")) s = step(s, [0, 0]);
    while (s.fighters[0].hitstop > 0) s = step(s, [0, 0]);
    const tick = s.fighters[0].move!.tick;
    s = step(s, [P, 0]);
    // Still the first jab, one tick further (a new move would restart at tick 0).
    expect(s.fighters[0].move?.id).toBe("light_punch");
    expect(s.fighters[0].move?.tick).toBe(tick + 1);
  });

  it("light_kick on hit cancels into heavy_kick on forward+Kick, and into special", () => {
    expect(afterHit(K, R | K)).toEqual({ connected: "light_kick", next: "heavy_kick" });
    expect(afterHit(K, S)).toEqual({ connected: "light_kick", next: "special" });
  });

  it("light_kick does not cancel into heavy_punch", () => {
    expect(afterHit(K, R | P)).toEqual({ connected: "light_kick", next: "light_kick" });
  });

  it("heavy_punch on hit cancels into special", () => {
    expect(afterHit(R | P, S)).toEqual({ connected: "heavy_punch", next: "special" });
  });

  it("a whiffed light_punch does not cancel", () => {
    let s = step(duel(400), [P, 0]);
    for (let t = 0; t < 4; t++) s = step(s, [0, 0]);
    s = step(s, [R | P, 0]);
    expect(s.fighters[0].move?.id).toBe("light_punch");
  });
});
