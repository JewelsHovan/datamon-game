// Spec 012 (A4) movement and reaction mechanics, and spec 006 (A2) signature
// specials: dashes, crouch and air hurt, juggles, wall bounce, get-up roll,
// block push, taunt, round 1 intro, the winner's taunt, Context Switch,
// Hotfix Charge, Rapid Deploy, and determinism with all four launch fighters.
import { describe, expect, it } from "vitest";
import { KNOCKDOWN, MOVES_V2, ROUND } from "../data/combat";
import { firstActiveTick, moveDuration, MOVES, type MoveId } from "../data/moves";
import { clipForFighter, isHidden } from "../render/fighterRenderer";
import { applyHits, hurtRects, knockDown } from "./combat";
import { hashState } from "./hash";
import { BUTTON_DOWN, BUTTON_KICK, BUTTON_LEFT, BUTTON_PUNCH, BUTTON_RIGHT, BUTTON_SPECIAL } from "./inputBits";
import { WALL_RIGHT } from "./physics";
import { nextU32, seedRng } from "./rng";
import { createMatchState } from "./state";
import { step } from "./step";
import type { InputPair, SimEvent, SimState } from "./types";

const P = BUTTON_PUNCH;
const K = BUTTON_KICK;
const S = BUTTON_SPECIAL;
const R = BUTTON_RIGHT;
const L = BUTTON_LEFT;
const D = BUTTON_DOWN;
const JULIEN = "julien-hovan";
const FELICIA = "felicia-gorgacheva";
const PENTCHO = "pentcho-tchomakov";
const ALEX = "alex-andrianavalontsalama";
const CENTER = 64000;

/** A fight-phase match with the fighters `gapPx` apart around `center` (P1 left, facing right). */
function duel(p1: string, p2: string, gapPx: number, center = CENTER): SimState {
  const s = createMatchState(1, p1, p2, true);
  s.fighters[0].x = center - gapPx * 50;
  s.fighters[1].x = center + gapPx * 50;
  return s;
}

interface Run {
  state: SimState;
  states: SimState[];
  events: SimEvent[];
}

function run(start: SimState, inputs: readonly InputPair[]): Run {
  let state = start;
  const states: SimState[] = [];
  const events: SimEvent[] = [];
  for (const pair of inputs) {
    state = step(state, pair);
    states.push(state);
    events.push(...state.events);
  }
  return { state, states, events };
}

function frames(n: number, p1 = 0, p2 = 0): InputPair[] {
  return Array.from({ length: n }, () => [p1, p2] as InputPair);
}

function count(r: Run, type: SimEvent["type"], player?: 0 | 1): number {
  return r.events.filter((e) => e.type === type && (player === undefined || ("player" in e && e.player === player))).length;
}

/** Steps with no input until `done` holds (or `max` steps). */
function until(start: SimState, done: (s: SimState) => boolean, max = 300): Run {
  let state = start;
  const states: SimState[] = [];
  const events: SimEvent[] = [];
  for (let i = 0; i < max && !done(state); i++) {
    state = step(state, [0, 0]);
    states.push(state);
    events.push(...state.events);
  }
  return { state, states, events };
}

describe("v2 timing (spec 012 A3)", () => {
  // Spec 003's frame data (src/data/moves.ts at 52510f0): startup and total ticks per move.
  const SPEC_003: Partial<Record<MoveId, { startup?: number; total: number }>> = {
    light_punch: { startup: 3, total: 14 },
    heavy_punch: { startup: 8, total: 27 },
    light_kick: { startup: 4, total: 18 },
    heavy_kick: { startup: 10, total: 32 },
    crouch_attack: { startup: 6, total: 24 },
    special: { total: 39 },
    throw: { total: 34 },
  };
  for (const [id, want] of Object.entries(SPEC_003) as [MoveId, { startup?: number; total: number }][]) {
    it(`${id}: startup and total within 2 frames of spec 003`, () => {
      if (want.startup !== undefined) expect(Math.abs(firstActiveTick(MOVES[id]) - want.startup)).toBeLessThanOrEqual(2);
      expect(Math.abs(moveDuration(MOVES[id]) - want.total)).toBeLessThanOrEqual(2);
    });
  }
  it("air_attack: startup within 2 frames of spec 003 (it lasts until landing)", () => {
    expect(Math.abs(firstActiveTick(MOVES.air_attack) - 3)).toBeLessThanOrEqual(2);
  });
});

describe("dashes (spec 012 A4)", () => {
  it("a double tap of forward dashes: a dash event, the dash state and more ground than walking", () => {
    const r = run(duel(JULIEN, JULIEN, 200), [[R, 0], [0, 0], [R, 0], ...frames(18)]);
    expect(count(r, "dash", 0)).toBe(1);
    expect(r.states[2]!.fighters[0].state).toBe("dash_forward");
    const startX = r.states[1]!.fighters[0].x;
    const travelled = r.state.fighters[0].x - startX;
    expect(travelled).toBeGreaterThanOrEqual(6500);
    expect(travelled).toBeLessThanOrEqual(7500);
    // Walking for the same 16 frames covers well under half of that.
    expect(travelled).toBeGreaterThan(2 * 16 * 180);
    expect(r.state.fighters[0].state).toBe("idle");
  });

  it("two taps further apart than the window just walk", () => {
    const r = run(duel(JULIEN, JULIEN, 200), [[R, 0], ...frames(MOVES_V2.dashWindow + 2), [R, 0], ...frames(4)]);
    expect(count(r, "dash")).toBe(0);
  });

  it("a double tap of back dashes backward, and the back dash cannot be hit for its first frames", () => {
    const r = run(duel(JULIEN, JULIEN, 200), [[L, 0], [0, 0], [L, 0]]);
    const f = r.state.fighters[0];
    expect(f.state).toBe("dash_back");
    expect(hurtRects(f)).toEqual([]);
    const later = run(r.state, frames(MOVES_V2.dashBackInvuln));
    const g = later.state.fighters[0];
    expect(g.state).toBe("dash_back");
    expect(hurtRects(g).length).toBeGreaterThan(0);
    expect(g.x).toBeLessThan(r.states[0]!.fighters[0].x - 2500);
  });

  it("a back dash goes through a jab that would have hit a standing fighter", () => {
    // P2 jabs from point blank; P1 back-dashes on the frame the jab becomes active.
    const jabHits = run(duel(JULIEN, JULIEN, 60), [[0, P], ...frames(10)]);
    expect(count(jabHits, "hit", 1)).toBe(1);
    const dodged = run(duel(JULIEN, JULIEN, 60), [[L, P], [0, 0], [L, 0], ...frames(10)]);
    expect(count(dodged, "hit", 1)).toBe(0);
  });
});

describe("reactions (spec 012 A4)", () => {
  it("walking back uses walk_back", () => {
    const r = run(duel(JULIEN, JULIEN, 200), frames(4, L));
    expect(r.state.fighters[0].state).toBe("walk_back");
    expect(clipForFighter(r.state.fighters[0]).clip).toBe("walk_back");
  });

  it("a crouching fighter hit by a kick staggers in crouch_hurt", () => {
    const r = run(duel(JULIEN, JULIEN, 50), [...frames(3, 0, D), [K, D], ...frames(10, 0, D)]);
    expect(count(r, "hit", 0)).toBe(1);
    const hurt = r.states.find((s) => s.fighters[1].state === "hitstun")!;
    expect(hurt.fighters[1].stunLow).toBe(true);
    expect(clipForFighter(hurt.fighters[1]).clip).toBe("crouch_hurt");
  });

  it("an airborne fighter hit by a kick is launched into air_hurt", () => {
    const s = duel(JULIEN, JULIEN, 60);
    const victim = s.fighters[1];
    victim.state = "airborne";
    victim.y -= 6000;
    victim.vy = -200;
    applyHits(s, [{ kind: "strike", attacker: 0, target: 1, move: "light_kick", x: victim.x, y: victim.y - 9000 }]);
    expect(victim.state).toBe("knockdown");
    expect(victim.tumble).toBe(true);
    expect(clipForFighter(victim).clip).toBe("air_hurt");
  });
});

describe("juggles (spec 012 A4)", () => {
  function launched(): SimState {
    const s = duel(JULIEN, JULIEN, 60);
    knockDown(s.fighters[1], 1, s, 900);
    // Rise a few frames so the fighter is clear of the floor.
    return run(s, frames(6)).state;
  }
  const jab = (s: SimState) => {
    const v = s.fighters[1];
    applyHits(s, [{ kind: "strike", attacker: 0, target: 1, move: "light_punch", x: v.x, y: v.y - 8000 }]);
  };

  it("a launched fighter can be hit exactly twice before falling out of reach", () => {
    const s = launched();
    expect(hurtRects(s.fighters[1]).length).toBeGreaterThan(0);
    jab(s);
    expect(s.fighters[1].juggle).toBe(1);
    expect(s.fighters[1].vy).toBeLessThan(0);
    const t = run(s, frames(8)).state;
    expect(hurtRects(t.fighters[1]).length).toBeGreaterThan(0);
    jab(t);
    expect(t.fighters[1].juggle).toBe(MOVES_V2.maxJuggle);
    const u = run(t, frames(4)).state;
    expect(u.fighters[1].y).toBeLessThan(32000);
    expect(hurtRects(u.fighters[1])).toEqual([]);
  });

  it("a juggled fighter lands, lies down and gets up", () => {
    const s = launched();
    jab(s);
    const r = until(s, (st) => st.fighters[1].state === "idle");
    expect(count(r, "knockdown", 1)).toBe(1);
    expect(r.state.fighters[1].juggle).toBe(0);
    expect(r.state.fighters[1].tumble).toBe(false);
  });
});

describe("wall bounce (spec 012 A4)", () => {
  it("a launched fighter bounces off the wall once per combo", () => {
    const s = duel(JULIEN, JULIEN, 60, WALL_RIGHT - 4000);
    const victim = s.fighters[1];
    expect(victim.facing).toBe(-1); // slides toward the right wall
    knockDown(victim, 1, s, 700);
    const first = until(s, (st) => st.events.some((e) => e.type === "wall_bounce"), 60);
    expect(count(first, "wall_bounce", 1)).toBe(1);
    const v = first.state.fighters[1];
    expect(v.wallBounced).toBe(true);
    expect(v.slideDir).toBe(-1);
    // A juggle hit sends the fighter back toward the wall: no second bounce in the same combo.
    applyHits(first.state, [{ kind: "strike", attacker: 0, target: 1, move: "light_punch", x: v.x, y: v.y - 8000 }]);
    expect(first.state.fighters[1].slideDir).toBe(1);
    const rest = until(first.state, (st) => st.fighters[1].state === "idle");
    expect(count(rest, "wall_bounce")).toBe(0);
    expect(rest.state.fighters[1].wallBounced).toBe(false);
  });

  it("a knockdown in the open never bounces", () => {
    const s = duel(JULIEN, JULIEN, 60);
    knockDown(s.fighters[1], 1, s, 700);
    const r = until(s, (st) => st.fighters[1].state === "idle");
    expect(count(r, "wall_bounce")).toBe(0);
  });
});

describe("get-up roll (spec 012 A4)", () => {
  /** P2 (facing left, so back is right) knocked down in the open, holding `hold`. */
  function downed(hold: number): Run {
    const s = duel(JULIEN, JULIEN, 60);
    knockDown(s.fighters[1], 1, s, 0);
    const inputs: InputPair[] = frames(KNOCKDOWN.totalFrames + 20, 0, hold);
    let state = s;
    const states: SimState[] = [];
    const events: SimEvent[] = [];
    for (const pair of inputs) {
      state = step(state, pair);
      states.push(state);
      events.push(...state.events);
      if (state.fighters[1].state === "idle" || state.fighters[1].state === "walk_back") break;
    }
    return { state, states, events };
  }

  it("holding back while lying rolls backward, invulnerable, and stands up sooner", () => {
    const still = downed(0);
    const rolled = downed(R);
    expect(count(still, "roll")).toBe(0);
    expect(count(rolled, "roll", 1)).toBe(1);
    const rolling = rolled.states.find((st) => st.fighters[1].rollFrom >= 0 && st.fighters[1].stateFrame > st.fighters[1].rollFrom + 10)!;
    expect(hurtRects(rolling.fighters[1])).toEqual([]);
    expect(clipForFighter(rolling.fighters[1]).clip).toBe("getup_roll");
    const extra = rolled.state.fighters[1].x - still.state.fighters[1].x;
    expect(extra).toBeGreaterThanOrEqual(MOVES_V2.rollFrames * MOVES_V2.rollSpeed - 1000);
    expect(rolled.states.length).toBeLessThan(still.states.length);
  });
});

describe("block push (spec 012 A4)", () => {
  it("Punch+Kick in blockstun pushes the attacker away", () => {
    const base = run(duel(JULIEN, JULIEN, 50), [[P, R], ...frames(6, 0, R), ...frames(20)]);
    const pushed = run(duel(JULIEN, JULIEN, 50), [[P, R], ...frames(6, 0, R), [0, R | P | K], ...frames(19)]);
    expect(count(base, "block", 0)).toBe(1);
    expect(count(pushed, "block_push", 1)).toBe(1);
    expect(pushed.states.some((s) => s.fighters[1].state === "block_push")).toBe(true);
    const gap = (r: Run) => r.state.fighters[1].x - r.state.fighters[0].x;
    expect(gap(pushed) - gap(base)).toBeGreaterThanOrEqual(5000);
  });

  it("Punch+Kick pressed during the block's hit-stop still pushes", () => {
    // The jab is blocked on frame 4; the press lands on frame 5, inside the hit-stop.
    const r = run(duel(JULIEN, JULIEN, 50), [[P, R], ...frames(3, 0, R), [0, R | P | K], ...frames(20)]);
    const blockedAt = r.states.findIndex((s) => s.events.some((e) => e.type === "block"));
    expect(blockedAt).toBeGreaterThanOrEqual(0);
    expect(r.states[blockedAt + 1]!.fighters[1].hitstop).toBeGreaterThan(0);
    expect(count(r, "block_push", 1)).toBe(1);
  });

  it("Punch+Kick outside blockstun is a throw attempt, not a push", () => {
    const r = run(duel(JULIEN, JULIEN, 200), [[0, P | K], ...frames(5)]);
    expect(count(r, "block_push")).toBe(0);
  });
});

describe("taunt (spec 012 A4)", () => {
  it("down+Special taunts, and the taunt can be punished", () => {
    const r = run(duel(JULIEN, JULIEN, 50), [[0, D | S], ...frames(6)]);
    expect(count(r, "taunt", 1)).toBe(1);
    expect(r.state.fighters[1].state).toBe("taunt");
    expect(clipForFighter(r.state.fighters[1]).clip).toBe("taunt");
    expect(count(r, "projectile")).toBe(0);
    const punished = run(r.state, [[P, 0], ...frames(10)]);
    expect(count(punished, "hit", 0)).toBe(1);
    expect(punished.state.fighters[1].state).toBe("hitstun");
  });

  it("an unpunished taunt lasts its frames, then the fighter is free", () => {
    const r = run(duel(JULIEN, JULIEN, 200), [[0, D | S], ...frames(MOVES_V2.tauntFrames)]);
    expect(r.state.fighters[1].state).toBe("idle");
  });
});

describe("round intro and the winner's taunt (spec 012 A4)", () => {
  it("round 1's intro plays the intro clip; other states keep their clips", () => {
    const s = createMatchState(1, JULIEN, FELICIA);
    expect(s.round.phase).toBe("intro");
    expect(clipForFighter(s.fighters[0], 10).clip).toBe("intro");
    expect(clipForFighter(s.fighters[0]).clip).toBe("idle");
  });

  function winRound(s: SimState): Run {
    s.fighters[1].health = 1;
    return run(s, [[P, 0], ...frames(ROUND.koFrames)]);
  }

  it("the winner taunts before the victory pose on a round that does not end the match", () => {
    const r = winRound(duel(JULIEN, JULIEN, 50));
    expect(count(r, "ko", 1)).toBe(1);
    const states = r.states.map((s) => s.fighters[0].state);
    const taunt = states.indexOf("taunt");
    const victory = states.indexOf("victory");
    expect(taunt).toBeGreaterThan(0);
    expect(victory).toBeGreaterThan(taunt);
    expect(count(r, "taunt", 0)).toBe(1);
  });

  it("the match-winning round goes straight to the victory pose", () => {
    const s = duel(JULIEN, JULIEN, 50);
    s.round.wins = [1, 0];
    const r = winRound(s);
    const states = r.states.map((st) => st.fighters[0].state);
    expect(states).toContain("victory");
    expect(states).not.toContain("taunt");
  });
});

describe("Context Switch (spec 006 A2)", () => {
  it("Felicia vanishes, cannot be hit, reappears behind the opponent and kicks", () => {
    const r = run(duel(FELICIA, JULIEN, 120), [[S, 0], ...frames(40)]);
    expect(r.events.filter((e) => e.type === "teleport").map((e) => (e as { phase: string }).phase)).toEqual(["out", "in"]);
    const vanished = r.states.filter((s) => isHidden(s.fighters[0]));
    expect(vanished.length).toBeGreaterThanOrEqual(6);
    for (const s of vanished) expect(hurtRects(s.fighters[0])).toEqual([]);
    expect(r.state.fighters[0].x).toBeGreaterThan(r.state.fighters[1].x);
    expect(count(r, "hit", 0)).toBe(1);
  });

  it("a cornered opponent: she reappears in front instead", () => {
    const s = duel(FELICIA, JULIEN, 120, WALL_RIGHT - 6000);
    s.fighters[1].x = WALL_RIGHT;
    const r = run(s, [[S, 0], ...frames(20)]);
    expect(count(r, "teleport", 0)).toBe(2);
    expect(r.state.fighters[0].x).toBeLessThan(r.state.fighters[1].x);
  });

  it("a jab into the vanish whiffs", () => {
    const r = run(duel(FELICIA, JULIEN, 60), [[S, 0], ...frames(7), [0, P], ...frames(8)]);
    expect(count(r, "hit", 1)).toBe(0);
  });
});

describe("Hotfix Charge (spec 006 A2)", () => {
  it("Pentcho's charge absorbs one hit, keeps going and knocks the opponent down", () => {
    const r = run(duel(PENTCHO, JULIEN, 70), [[S, 0], [0, 0], [0, P], ...frames(45)]);
    expect(count(r, "armor", 0)).toBe(1);
    expect(count(r, "hit", 1)).toBe(1);
    const afterArmor = r.states.find((s) => s.events.some((e) => e.type === "armor"))!;
    expect(afterArmor.fighters[0].state).toBe("attack");
    expect(afterArmor.fighters[0].move?.id).toBe("charge");
    expect(afterArmor.fighters[0].health).toBeLessThan(1100);
    expect(count(r, "hit", 0)).toBe(1);
    expect(r.states.some((s) => s.fighters[1].state === "knockdown")).toBe(true);
  });

  it("only the first hit is absorbed", () => {
    const s = duel(PENTCHO, JULIEN, 70);
    const r = run(s, [[S, 0], ...frames(5)]);
    const p = r.state.fighters[0];
    applyHits(r.state, [{ kind: "strike", attacker: 1, target: 0, move: "light_punch", x: p.x, y: p.y - 9000 }]);
    expect(r.state.fighters[0].state).toBe("attack");
    applyHits(r.state, [{ kind: "strike", attacker: 1, target: 0, move: "light_punch", x: p.x, y: p.y - 9000 }]);
    expect(r.state.fighters[0].state).toBe("hitstun");
  });

  it("Pentcho deals 108% damage", () => {
    const r = run(duel(PENTCHO, JULIEN, 70), [[S, 0], ...frames(30)]);
    const hit = r.events.find((e) => e.type === "hit" && e.player === 0) as { damage: number } | undefined;
    expect(hit?.damage).toBe(Math.floor((110 * 108) / 100));
  });
});

describe("Rapid Deploy (spec 006 A2)", () => {
  it("Alex dashes in for three punches and an uppercut that launches", () => {
    const r = run(duel(ALEX, JULIEN, 90), [[S, 0], ...frames(60)]);
    const hits = r.events.filter((e) => e.type === "hit" && e.player === 0);
    expect(hits).toHaveLength(4);
    const launchedAt = r.states.findIndex((s) => s.fighters[1].state === "knockdown");
    expect(launchedAt).toBeGreaterThan(0);
    expect(Math.min(...r.states.map((s) => s.fighters[1].y))).toBeLessThan(32000 - 5000);
  });

  it("the launch can be juggled: a jab right after Alex recovers hits the falling opponent", () => {
    for (const pressAt of [58, 64, 70]) {
      const inputs: InputPair[] = [[S, 0], ...frames(pressAt - 1), [P, 0], ...frames(12)];
      const r = run(duel(ALEX, JULIEN, 90), inputs);
      expect(r.events.filter((e) => e.type === "hit" && e.player === 0)).toHaveLength(5);
      expect(r.states.some((s) => s.fighters[1].juggle === 1)).toBe(true);
    }
  });

  it("each segment hits at most once", () => {
    const r = run(duel(ALEX, JULIEN, 30), [[S, 0], ...frames(60)]);
    expect(r.events.filter((e) => e.type === "hit" && e.player === 0).length).toBeLessThanOrEqual(4);
  });
});

describe("Data Orb (spec 006 A2)", () => {
  it("Julien's special still throws the projectile", () => {
    const r = run(duel(JULIEN, JULIEN, 200), [[S, 0], ...frames(30)]);
    expect(count(r, "projectile", 0)).toBe(1);
  });
});

describe("determinism with all four fighters (spec 006 A2)", () => {
  /** Random but repeatable inputs: each player holds a random mask for 1-12 frames. */
  function script(seed: number, length: number): InputPair[] {
    const holder = { rng: seedRng(seed) };
    const rand = () => nextU32(holder);
    const masks = [0, R, L, D, P, K, S, R | P, L | K, D | P, D | S, P | K, R | K];
    const out: InputPair[] = [];
    let a = 0, b = 0, ha = 0, hb = 0;
    for (let i = 0; i < length; i++) {
      if (ha-- <= 0) { a = masks[rand() % masks.length]!; ha = 1 + (rand() % 12); }
      if (hb-- <= 0) { b = masks[rand() % masks.length]!; hb = 1 + (rand() % 12); }
      out.push([a, b]);
    }
    return out;
  }

  function hashes(p1: string, p2: string, roundTripAt = -1): string[] {
    let state = createMatchState(7, p1, p2);
    const out: string[] = [];
    for (const pair of script(11, 2400)) {
      state = step(state, pair);
      if (state.frame % 120 === 0) out.push(hashState(state));
      if (state.frame === roundTripAt) state = JSON.parse(JSON.stringify(state)) as SimState;
    }
    return out;
  }

  for (const [p1, p2] of [[FELICIA, PENTCHO], [ALEX, JULIEN], [PENTCHO, ALEX], [FELICIA, FELICIA]] as const) {
    it(`${p1} vs ${p2}: identical hashes on every run and across a JSON round trip`, () => {
      const a = hashes(p1, p2);
      expect(a).toHaveLength(20);
      expect(hashes(p1, p2)).toEqual(a);
      expect(hashes(p1, p2, 1000)).toEqual(a);
    });
  }
});
