// Spec 003 combat tests: frame data (A1), hits (A3), blocking and throws (A4),
// projectiles (A5), a scripted match (A6) and determinism with combat (A8).
import { describe, expect, it } from "vitest";
import { COMBAT } from "../data/combat";
import { firstActiveTick, moveDuration, MOVES, type MoveId } from "../data/moves";
import { blocks, hitRect } from "./combat";
import { hashState } from "./hash";
import {
  BUTTON_DOWN,
  BUTTON_KICK,
  BUTTON_LEFT,
  BUTTON_PUNCH,
  BUTTON_RIGHT,
  BUTTON_SPECIAL,
  BUTTON_UP,
} from "./inputBits";
import { pushInput } from "./inputHistory";
import { WALL_RIGHT } from "./physics";
import { createFighter, createMatchState } from "./state";
import { step } from "./step";
import type { InputPair, SimEvent, SimState } from "./types";

const P = BUTTON_PUNCH;
const K = BUTTON_KICK;
const S = BUTTON_SPECIAL;
const R = BUTTON_RIGHT;
const LEFT = BUTTON_LEFT;
const D = BUTTON_DOWN;
const U = BUTTON_UP;
const SLUG = "julien-hovan";

/** A fight-phase match with the fighters `gapPx` apart around the stage center (P1 left). */
function duel(gapPx: number): SimState {
  const s = createMatchState(1, SLUG, SLUG, true);
  const c = 64000;
  s.fighters[0].x = c - gapPx * 50;
  s.fighters[1].x = c + gapPx * 50;
  return s;
}

interface Run {
  state: SimState;
  /** Events per step, indexed from 1 (the first step run). */
  events: SimEvent[][];
}

function run(start: SimState, inputs: readonly InputPair[]): Run {
  let state = start;
  const events: SimEvent[][] = [[]];
  for (const pair of inputs) {
    state = step(state, pair);
    events.push(state.events);
  }
  return { state, events };
}

function frames(n: number, p1 = 0, p2 = 0): InputPair[] {
  return Array.from({ length: n }, () => [p1, p2] as InputPair);
}

function stepsWith(r: Run, type: SimEvent["type"]): number[] {
  return r.events.flatMap((evs, i) => (evs.some((e) => e.type === type) ? [i] : []));
}

/** Inputs that start `id` for P1 (facing right) with a single-frame press. */
function pressFor(id: MoveId): number {
  switch (id) {
    case "light_punch": return P;
    case "heavy_punch": return R | P;
    case "light_kick": return K;
    case "heavy_kick": return R | K;
    case "crouch_attack": return D | P;
    case "special": return S;
    case "throw": return P | K;
    default: return 0;
  }
}

describe("frame data (A1)", () => {
  const grounded: MoveId[] = ["light_punch", "heavy_punch", "light_kick", "heavy_kick", "crouch_attack"];
  for (const id of grounded) {
    it(`${id}: starts on the press frame, first active on its startup, lasts its duration`, () => {
      let s = duel(400); // too far to hit anything
      s = step(s, [pressFor(id), 0]);
      expect(s.fighters[0].move?.id).toBe(id);
      expect(s.fighters[0].move?.tick).toBe(0);
      const startup = firstActiveTick(MOVES[id]);
      let firstActive = -1;
      let ended = -1;
      for (let t = 1; t <= moveDuration(MOVES[id]) + 2; t++) {
        s = step(s, [0, 0]);
        if (firstActive < 0 && hitRect(s.fighters[0])) firstActive = t;
        if (ended < 0 && s.fighters[0].move === null) ended = t;
      }
      expect(firstActive).toBe(startup);
      expect(ended).toBe(moveDuration(MOVES[id]));
    });
  }

  it("a press buffered in the last frames of a move starts the next move as soon as it ends", () => {
    let s = duel(400);
    s = step(s, [P, 0]);
    const d = moveDuration(MOVES.light_punch);
    for (let t = 1; t < d - 2; t++) s = step(s, [0, 0]);
    s = step(s, [P, 0]); // pressed 2 frames before the move ends
    s = step(s, [0, 0]);
    s = step(s, [0, 0]);
    expect(s.fighters[0].move?.id).toBe("light_punch");
    expect(s.fighters[0].move?.tick).toBe(0);
  });

  it("a press older than the buffer is dropped", () => {
    let s = duel(400);
    s = step(s, [P, 0]);
    const d = moveDuration(MOVES.light_punch);
    for (let t = 1; t < d - COMBAT.bufferFrames - 2; t++) s = step(s, [0, 0]);
    s = step(s, [K, 0]); // too early to buffer into the end of the move
    for (let t = 0; t < COMBAT.bufferFrames + 4; t++) s = step(s, [0, 0]);
    expect(s.fighters[0].move).toBeNull();
  });
});

describe("hits (A3)", () => {
  it("a point-blank light punch hits, freezes both for 6 frames, then hitstun runs", () => {
    const r = run(duel(60), [[P, 0], ...frames(40)]);
    const hit = stepsWith(r, "hit");
    expect(hit).toEqual([1 + firstActiveTick(MOVES.light_punch)]);
    const h = hit[0]!;
    // Replay to inspect the state right after the hit.
    let s = duel(60);
    s = step(s, [P, 0]);
    for (let t = 2; t <= h; t++) s = step(s, [0, 0]);
    expect(s.fighters[0].hitstop).toBe(6);
    expect(s.fighters[1].hitstop).toBe(6);
    expect(s.fighters[1].state).toBe("hitstun");
    const frozenX = s.fighters[1].x;
    for (let t = 0; t < 6; t++) s = step(s, [0, 0]);
    expect(s.fighters[1].x).toBe(frozenX); // no pushback during hit-stop
    expect(s.fighters[1].hitstop).toBe(0);
    for (let t = 0; t < MOVES.light_punch.hitstun - 1; t++) s = step(s, [0, 0]);
    expect(s.fighters[1].state).toBe("hitstun");
    s = step(s, [0, 0]);
    expect(s.fighters[1].state).toBe("idle");
    expect(s.fighters[1].health).toBe(COMBAT.maxHealth - MOVES.light_punch.damage);
  });

  it("simultaneous attacks trade: both land and a trade event fires", () => {
    const r = run(duel(60), [[P, P], ...frames(20)]);
    expect(stepsWith(r, "trade").length).toBe(1);
    expect(r.state.fighters[0].health).toBeLessThan(COMBAT.maxHealth);
    expect(r.state.fighters[1].health).toBeLessThan(COMBAT.maxHealth);
  });

  it("a move hits at most once", () => {
    const r = run(duel(60), [[R | P, 0], ...frames(60)]);
    expect(r.events.flat().filter((e) => e.type === "hit").length).toBe(1);
  });

  it("a defender in the corner pushes the attacker back instead", () => {
    const s = duel(60);
    s.fighters[1].x = WALL_RIGHT;
    s.fighters[0].x = WALL_RIGHT - 6000;
    const before = s.fighters[0].x;
    const r = run(s, [[R | P, 0], ...frames(40)]);
    expect(stepsWith(r, "hit").length).toBe(1);
    expect(r.state.fighters[1].x).toBe(WALL_RIGHT);
    expect(before - r.state.fighters[0].x).toBeGreaterThanOrEqual(1000);
  });
});

describe("blocking and throws (A4)", () => {
  function holding(bits: number, facing: 1 | -1, state: "idle" | "crouch" = "idle") {
    const f = createFighter(SLUG, 64000, facing);
    f.state = state;
    pushInput(f.input, bits);
    return f;
  }

  it("standing block (back) stops mids and overheads but not lows", () => {
    const f = holding(LEFT, 1); // facing right, holding left = back
    expect(blocks(f, "mid")).toBe(true);
    expect(blocks(f, "overhead")).toBe(true);
    expect(blocks(f, "low")).toBe(false);
  });

  it("crouching block (down-back) stops lows and mids but not overheads", () => {
    const f = holding(LEFT | D, 1, "crouch");
    expect(blocks(f, "low")).toBe(true);
    expect(blocks(f, "mid")).toBe(true);
    expect(blocks(f, "overhead")).toBe(false);
  });

  it("in a match: standing block stops light_punch, but crouch_attack hits through it", () => {
    // P2 faces left, so holding right is back.
    const blocked = run(duel(60), [[P, R], ...frames(20, 0, R)]);
    expect(stepsWith(blocked, "block").length).toBe(1);
    expect(stepsWith(blocked, "hit").length).toBe(0);
    expect(blocked.state.fighters[1].health).toBe(COMBAT.maxHealth);
    const low = run(duel(60), [[D | P, R], ...frames(20, 0, R)]);
    expect(stepsWith(low, "hit").length).toBe(1);
  });

  it("in a match: crouching block stops crouch_attack", () => {
    const r = run(duel(60), [[D | P, R | D], ...frames(20, 0, R | D)]);
    expect(stepsWith(r, "block").length).toBe(1);
    expect(stepsWith(r, "hit").length).toBe(0);
  });

  it("a throw beats a standing block", () => {
    const r = run(duel(60), [[P | K, R], ...frames(60, 0, R)]);
    expect(stepsWith(r, "throw").length).toBe(1);
    expect(r.state.fighters[1].health).toBe(COMBAT.maxHealth - MOVES.throw.damage);
    expect(r.events.flat().some((e) => e.type === "knockdown" && e.player === 1)).toBe(true);
  });

  it("a throw whiffs on an airborne opponent", () => {
    let s = duel(60);
    for (let t = 0; t < 8; t++) s = step(s, [0, U]); // P2 jumps
    expect(s.fighters[1].state).toBe("airborne");
    const r = run(s, [[P | K, 0], ...frames(30)]);
    expect(stepsWith(r, "throw").length).toBe(0);
    expect(r.state.fighters[1].health).toBe(COMBAT.maxHealth);
  });
});

describe("projectiles (A5)", () => {
  it("travels, hits once, and is gone", () => {
    const r = run(duel(300), [[S, 0], ...frames(120)]);
    expect(stepsWith(r, "projectile").length).toBe(1);
    expect(r.events.flat().filter((e) => e.type === "hit" && e.move === "special").length).toBe(1);
    expect(r.state.projectiles.length).toBe(0);
    expect(r.state.fighters[1].health).toBe(COMBAT.maxHealth - MOVES.special.damage);
  });

  it("two projectiles cancel each other", () => {
    const r = run(duel(400), [[S, S], ...frames(120)]);
    expect(stepsWith(r, "clash").length).toBe(1);
    expect(r.events.flat().some((e) => e.type === "hit")).toBe(false);
    expect(r.state.projectiles.length).toBe(0);
  });

  it("a second special does nothing while the first projectile is still out", () => {
    const d = moveDuration(MOVES.special);
    const r = run(duel(540), [[S, 0], ...frames(d + 1), [S, 0], ...frames(3)]);
    expect(r.state.projectiles.length).toBe(1);
    expect(r.events.flat().filter((e) => e.type === "attack" && e.move === "special").length).toBe(1);
  });
});

/** P1 walks in and heavy-kicks; P2 stands still. Deterministic policy from state only. */
function scriptedMatch(maxFrames: number, roundTrip = -1): { state: SimState; hashes: string[]; events: SimEvent[] } {
  let s = createMatchState(7, SLUG, SLUG);
  const hashes: string[] = [];
  const events: SimEvent[] = [];
  for (let t = 1; t <= maxFrames; t++) {
    const [a, b] = s.fighters;
    const gap = Math.abs(b.x - a.x);
    const forward = a.facing === 1 ? R : LEFT;
    let p1 = 0;
    if (a.state === "idle" || a.state === "walk_forward") p1 = gap > 7000 ? forward : t % 2 === 0 ? forward | K : 0;
    s = step(s, [p1, 0]);
    events.push(...s.events);
    if (t % 500 === 0) hashes.push(hashState(s));
    if (t === roundTrip) s = JSON.parse(JSON.stringify(s)) as SimState;
    if (s.events.some((e) => e.type === "match_end")) break;
  }
  return { state: s, hashes, events };
}

describe("match flow (A6)", () => {
  it("a scripted match ends with P1 winning two rounds", () => {
    const { state, events } = scriptedMatch(20000);
    const end = events.find((e) => e.type === "match_end");
    expect(end).toEqual({ type: "match_end", winner: 0 });
    expect(state.round.wins).toEqual([2, 0]);
    expect(events.filter((e) => e.type === "round_start").length).toBe(2);
    expect(events.filter((e) => e.type === "ko").length).toBe(2);
  });
});

describe("determinism with combat (A8)", () => {
  it("the scripted match hashes the same every run, and across a JSON round trip", () => {
    const a = scriptedMatch(20000);
    const b = scriptedMatch(20000);
    const c = scriptedMatch(20000, 1500);
    expect(a.hashes.length).toBeGreaterThan(3);
    expect(b.hashes).toEqual(a.hashes);
    expect(c.hashes).toEqual(a.hashes);
    expect(hashState(c.state)).toBe(hashState(a.state));
  });
});

describe("QA fixes (2026-11-12 run)", () => {
  it("F1: a throw met by a jab on the same frame never leaves anyone held", () => {
    const r = run(duel(50), [[P | K, P], ...frames(40)]);
    const states = r.events.length;
    expect(states).toBeGreaterThan(0);
    let s = duel(50);
    s = step(s, [P | K, P]);
    for (let t = 0; t < 40; t++) {
      s = step(s, [0, 0]);
      expect(s.fighters[0].state).not.toBe("held");
      expect(s.fighters[1].state === "held" && !(s.fighters[0].move?.id === "throw" && s.fighters[0].move.grabbed)).toBe(false);
    }
  });

  it("F2: nothing lands after the time-out buzzer", () => {
    let s = duel(300);
    s.round.timer = 20;
    s = step(s, [0, S]); // P2 fires; the round times out before it arrives
    for (let t = 0; t < 120; t++) s = step(s, [0, 0]);
    expect(s.round.reason).toBe("time");
    expect(s.fighters[0].health).toBe(COMBAT.maxHealth);
    expect(s.projectiles.length).toBe(0);
  });

  it("F3: a projectile is gone once it leaves the screen, and the next special works", () => {
    let s = duel(80);
    s = step(s, [S, 0]);
    for (let t = 0; t < 14; t++) s = step(s, [0, U]); // P2 jumps over it
    let gone = -1;
    for (let t = 0; t < 120 && gone < 0; t++) {
      s = step(s, [0, 0]);
      if (s.projectiles.length === 0) gone = t;
    }
    expect(gone).toBeGreaterThanOrEqual(0);
    expect(gone).toBeLessThan(80);
    for (let t = 0; t < 40; t++) s = step(s, [0, 0]);
    s = step(s, [S, 0]);
    expect(s.fighters[0].move?.id).toBe("special");
  });

  it("F4: crouching does not dodge the projectile", () => {
    const r = run(duel(300), [[S, D], ...frames(120, 0, D)]);
    expect(r.events.flat().filter((e) => e.type === "hit" && e.move === "special").length).toBe(1);
  });
});
