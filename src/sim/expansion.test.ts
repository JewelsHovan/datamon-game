// Spec 016: 12-fighter expansion mechanics, directional specials, per-fighter
// physics/combat modifiers, multi-kind projectiles, parry/counter stances,
// command grabs, startup invuln, archetype cancel chains, and determinism.
import { describe, expect, it } from "vitest";
import { COMBAT } from "../data/combat";
import { FIGHTERS, fighterInfo } from "../data/fighters";
import { MOVEMENT } from "../data/movement";
import { isHidden } from "../render/fighterRenderer";
import { hurtRects } from "./combat";
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
const U = BUTTON_UP;
const CENTER = 64000;

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

describe("directional 2nd specials across all 37 fighters", () => {
  const slugs = Object.keys(FIGHTERS);

  it("has all 37 fighters registered", () => {
    expect(slugs).toHaveLength(37);
  });

  for (const slug of slugs) {
    const info = FIGHTERS[slug]!;
    it(`${slug}: S -> ${info.specialMove}, Forward+S -> ${info.altSpecialMove}`, () => {
      const neutral = step(duel(slug, "julien-hovan", 180), [S, 0]);
      expect(neutral.fighters[0].move?.id).toBe(info.specialMove);

      const forward = step(duel(slug, "julien-hovan", 180), [R | S, 0]);
      expect(forward.fighters[0].move?.id).toBe(info.altSpecialMove);
    });
  }

  it("Julien can use Forward+S (rising_commit) while his Data Orb is out, while neutral S is blocked", () => {
    const orbRun = run(duel("julien-hovan", "julien-hovan", 300), [[S, 0], ...frames(20)]);
    expect(orbRun.state.projectiles).toHaveLength(1);
    expect(orbRun.state.projectiles[0]!.kind).toBe("orb");
    // Wait for special recovery to finish while the orb is still flying.
    const idleAgain = run(orbRun.state, frames(20));
    expect(idleAgain.state.projectiles).toHaveLength(1);
    expect(idleAgain.state.fighters[0].move).toBeNull();

    // Neutral S is blocked while orb is active.
    const neutralRetry = step(idleAgain.state, [S, 0]);
    expect(neutralRetry.fighters[0].move).toBeNull();

    // Forward+S (rising_commit) has no projectileTick so it starts cleanly.
    const alt = step(idleAgain.state, [R | S, 0]);
    expect(alt.fighters[0].move?.id).toBe("rising_commit");
  });
});

describe("multi-kind projectiles: Ethan and Vincent", () => {
  it("Ethan can have rate_mine and packet_sniper active at the same time, and mine launches on contact", () => {
    const r = run(duel("ethan-pirso", "julien-hovan", 200), [
      [R | S, 0], // rate_mine (28f duration, spawns slow_mine on tick 12)
      ...frames(28),
      [S, 0], // packet_sniper (spawns fast_packet on tick 15)
      ...frames(16),
    ]);
    const kinds = r.state.projectiles.map((p) => p.kind).sort();
    expect(kinds).toEqual(["fast_packet", "slow_mine"]);

    // Stationary mine stays at vx === 0 and launches when the opponent walks into it.
    const mineOnly = run(duel("ethan-pirso", "julien-hovan", 180), [[R | S, 0], ...frames(30)]);
    const mine = mineOnly.state.projectiles.find((p) => p.kind === "slow_mine")!;
    expect(mine).toBeDefined();
    expect(mine.vx).toBe(0);
    const mineX = mine.x;
    const walked = run(mineOnly.state, frames(45, 0, L));
    expect(walked.events.some((e) => e.type === "hit" && e.move === "rate_mine")).toBe(true);
    expect(walked.states.some((s) => s.fighters[1].state === "knockdown" && s.fighters[1].y < MOVEMENT.floorY)).toBe(true);
    // Mine did not drift before detonation.
    expect(walked.states[0]!.projectiles[0]!.x).toBe(mineX);
  });

  it("Ethan cannot spawn a second rate_mine while one slow_mine is already out", () => {
    const first = run(duel("ethan-pirso", "julien-hovan", 240), [[R | S, 0], ...frames(28)]);
    expect(first.state.projectiles).toHaveLength(1);
    const second = step(first.state, [R | S, 0]);
    expect(second.fighters[0].move).toBeNull();
  });

  it("Vincent's ground_fault hits a standing blocker (low) and is blocked by a crouching blocker", () => {
    const standing = run(duel("vincent-anctil", "julien-hovan", 150), [[S, R], ...frames(45, 0, R)]);
    expect(standing.events.some((e) => e.type === "hit" && e.move === "ground_fault")).toBe(true);
    expect(standing.events.some((e) => e.type === "block" && e.move === "ground_fault")).toBe(false);

    const crouching = run(duel("vincent-anctil", "julien-hovan", 150), [[S, R | D], ...frames(45, 0, R | D)]);
    expect(crouching.events.some((e) => e.type === "block" && e.move === "ground_fault")).toBe(true);
    expect(crouching.events.some((e) => e.type === "hit" && e.move === "ground_fault")).toBe(false);
  });

  it("Vincent's arc_beacon rises with vy < 0 and hits a jumping opponent", () => {
    const r = run(duel("vincent-anctil", "julien-hovan", 240), [[R | S, 0], ...frames(12)]);
    const arc = r.state.projectiles.find((p) => p.kind === "arc_burst")!;
    expect(arc).toBeDefined();
    expect(arc.vy).toBeLessThan(0);
    const y0 = arc.y;
    const after = run(r.state, frames(5));
    expect(after.state.projectiles[0]!.y).toBeLessThan(y0);

    // Anti-air snipe against a forward jump.
    const antiAir = run(duel("vincent-anctil", "julien-hovan", 160), [
      [0, U | L],
      ...frames(4),
      [R | S, 0],
      ...frames(35),
    ]);
    expect(antiAir.events.some((e) => e.type === "hit" && e.move === "arc_beacon")).toBe(true);
  });
});

describe("counter / parry stance: Megane and Tyler", () => {
  it("Megane's rollback_parry absorbs a strike for 0 damage, emits counter, and lands the reversal launch", () => {
    const startHealth = fighterInfo("megane-darnaud").health;
    // Megane starts rollback_parry on frame 1 (counter window ticks 3..16); Julien jabs on frame 3 (active tick 3 -> frame 6).
    const r = run(duel("megane-darnaud", "julien-hovan", 55), [
      [S, 0],
      [0, 0],
      [0, P],
      ...frames(45),
    ]);
    expect(r.events.some((e) => e.type === "counter" && e.player === 0 && e.target === 1)).toBe(true);
    expect(r.state.fighters[0].health).toBe(startHealth);
    expect(r.events.some((e) => e.type === "hit" && e.player === 0 && e.move === "rollback_parry")).toBe(true);
    expect(r.states.some((s) => s.fighters[1].state === "knockdown" && s.fighters[1].y < MOVEMENT.floorY)).toBe(true);
  });

  it("Megane's rollback_parry ends cleanly after whiff recovery without throwing the reversal", () => {
    const r = run(duel("megane-darnaud", "julien-hovan", 55), [[S, 0], ...frames(30)]);
    expect(r.events.some((e) => e.type === "counter")).toBe(false);
    expect(r.events.some((e) => e.type === "hit")).toBe(false);
    expect(r.state.fighters[0].state).toBe("idle");
    expect(r.state.fighters[0].move).toBeNull();
  });

  it("Tyler's steel_counter absorbs a strike for 0 damage, emits counter, and lands the reversal launch", () => {
    const startHealth = fighterInfo("tyler-nagano").health;
    const r = run(duel("tyler-nagano", "julien-hovan", 55), [
      [R | S, 0],
      [0, 0],
      [0, P],
      ...frames(50),
    ]);
    expect(r.events.some((e) => e.type === "counter" && e.player === 0 && e.target === 1)).toBe(true);
    expect(r.state.fighters[0].health).toBe(startHealth);
    expect(r.events.some((e) => e.type === "hit" && e.player === 0 && e.move === "steel_counter")).toBe(true);
    expect(r.states.some((s) => s.fighters[1].state === "knockdown" && s.fighters[1].y < MOVEMENT.floorY)).toBe(true);
  });

  it("Tyler's steel_counter ends cleanly on whiff without throwing the reversal", () => {
    const r = run(duel("tyler-nagano", "julien-hovan", 55), [[R | S, 0], ...frames(30)]);
    expect(r.events.some((e) => e.type === "counter")).toBe(false);
    expect(r.events.some((e) => e.type === "hit")).toBe(false);
    expect(r.state.fighters[0].state).toBe("idle");
  });
});

describe("command grab: Scott's force_push", () => {
  it("beats a standing blocker and deals damagePct-scaled slam damage", () => {
    const r = run(duel("scott-carr", "julien-hovan", 75), [[S, R], ...frames(45, 0, R)]);
    expect(r.events.some((e) => e.type === "throw" && e.player === 0)).toBe(true);
    const hit = r.events.find((e) => e.type === "hit" && e.player === 0 && e.move === "force_push") as
      | Extract<SimEvent, { type: "hit" }>
      | undefined;
    expect(hit).toBeDefined();
    expect(hit!.damage).toBe(Math.floor((145 * 110) / 100));
    expect(r.states.some((s) => s.fighters[1].state === "knockdown")).toBe(true);
  });

  it("beats a crouching blocker", () => {
    const r = run(duel("scott-carr", "julien-hovan", 75), [[S, R | D], ...frames(45, 0, R | D)]);
    expect(r.events.some((e) => e.type === "throw" && e.player === 0)).toBe(true);
    expect(r.events.some((e) => e.type === "hit" && e.move === "force_push")).toBe(true);
  });

  it("beats an opponent in blockstun", () => {
    const s = duel("scott-carr", "julien-hovan", 65);
    s.fighters[1].state = "blockstun";
    s.fighters[1].stun = 20;
    const r = run(s, [[S, R], ...frames(45, 0, R)]);
    expect(r.events.some((e) => e.type === "throw" && e.player === 0)).toBe(true);
    expect(r.events.some((e) => e.type === "hit" && e.move === "force_push")).toBe(true);
  });

  it("whiffs against a jumping opponent", () => {
    const r = run(duel("scott-carr", "julien-hovan", 75), [
      [0, U],
      ...frames(5), // P2 is now airborne
      [S, 0],
      ...frames(35),
    ]);
    expect(r.events.some((e) => e.type === "throw")).toBe(false);
    expect(r.events.some((e) => e.type === "hit")).toBe(false);
    expect(r.state.fighters[1].health).toBe(COMBAT.maxHealth);
  });
});

describe("startup invulnerability: skyline_upper & rising_commit", () => {
  it("Jerry's skyline_upper invuln startup beats an incoming attack cleanly", () => {
    const jerryHp = fighterInfo("jerry-zhu").health;
    // P2 starts heavy_punch (L+P facing left, startup 8); Jerry starts skyline_upper 4 frames later so invuln covers P2's active frame.
    const r = run(duel("jerry-zhu", "julien-hovan", 50), [[0, L | P], ...frames(4), [S, 0], ...frames(35)]);
    expect(r.state.fighters[0].health).toBe(jerryHp);
    expect(r.events.some((e) => e.type === "hit" && e.player === 0 && e.move === "skyline_upper")).toBe(true);
    expect(r.states.some((s) => s.fighters[1].state === "knockdown")).toBe(true);
  });

  it("Julien's rising_commit invuln startup beats an incoming attack cleanly", () => {
    const julienHp = fighterInfo("julien-hovan").health;
    const r = run(duel("julien-hovan", "julien-hovan", 50), [[0, L | P], ...frames(4), [R | S, 0], ...frames(35)]);
    expect(r.state.fighters[0].health).toBe(julienHp);
    expect(r.events.some((e) => e.type === "hit" && e.player === 0 && e.move === "rising_commit")).toBe(true);
    expect(r.states.some((s) => s.fighters[1].state === "knockdown")).toBe(true);
  });
});

describe("archetype traits, cancel chains, and per-fighter modifiers", () => {
  it("Antonia's rush-chain allows light_punch -> light_kick and light_punch -> crouch_attack -> golden_rush", () => {
    const lpLk = run(duel("antonia-nistor", "julien-hovan", 45), [
      [P, 0],
      ...frames(8), // hits at tick 3, hitstop 6 -> cancels on frame 11
      [K, 0],
      ...frames(15),
    ]);
    const moves1 = lpLk.events.filter((e) => e.type === "attack" && e.player === 0).map((e) => (e as { move: string }).move);
    expect(moves1).toEqual(["light_punch", "light_kick"]);
    expect(lpLk.events.filter((e) => e.type === "hit" && e.player === 0)).toHaveLength(2);

    const chain = run(duel("antonia-nistor", "julien-hovan", 45), [
      [P, R],
      ...frames(7, 0, R), // light_punch blocked standing on frame 4, hitstop 4 (frames 5..8)
      [D | P, R], // cancels into crouch_attack on frame 9
      ...frames(12, 0, R | D), // P2 crouch-blocks crouch_attack on frame 15, hitstop 6 (frames 16..21)
      [S, R], // cancels into golden_rush on frame 22; P2 stands and gets hit low!
      ...frames(35, 0, R),
    ]);
    const moves2 = chain.events.filter((e) => e.type === "attack" && e.player === 0).map((e) => (e as { move: string }).move);
    expect(moves2).toEqual(["light_punch", "crouch_attack", "golden_rush"]);
    expect(chain.events.filter((e) => e.type === "block" && e.player === 0)).toHaveLength(2);
    expect(chain.events.some((e) => e.type === "hit" && e.player === 0 && e.move === "golden_rush")).toBe(true);
  });

  it("heavy-cancel lets Pentcho cancel heavy_kick into charge", () => {
    const r = run(duel("pentcho-tchomakov", "julien-hovan", 55), [
      [R | K, 0],
      ...frames(21), // heavy_kick active tick 10 + hitstop 11 -> cancels on tick 22
      [S, 0],
      ...frames(45),
    ]);
    const moves = r.events.filter((e) => e.type === "attack" && e.player === 0).map((e) => (e as { move: string }).move);
    expect(moves).toEqual(["heavy_kick", "charge"]);
  });

  it("poke-cancel lets Saransh cancel crouch_attack into cache_blink", () => {
    const r = run(duel("saransh-padhy", "julien-hovan", 55), [
      [D | P, 0],
      ...frames(14), // crouch_attack active tick 6 + hitstop 8 -> cancels on tick 15
      [S, 0],
      ...frames(35),
    ]);
    const moves = r.events.filter((e) => e.type === "attack" && e.player === 0).map((e) => (e as { move: string }).move);
    expect(moves).toEqual(["crouch_attack", "cache_blink"]);
  });

  it("Pentcho's Iron Schema reduces special chip damage by 50%", () => {
    const r = run(duel("julien-hovan", "pentcho-tchomakov", 140), [[S, R], ...frames(35, 0, R)]);
    expect(r.events.some((e) => e.type === "block" && e.move === "special")).toBe(true);
    // Data Orb chip is 12 -> 50% resist -> 6 damage.
    expect(r.state.fighters[1].health).toBe(1100 - 6);
  });

  it("Scott has 1150 HP, +25% throw range, and +25% throw damage", () => {
    const s = duel("scott-carr", "julien-hovan", 85); // distance = 8500 (<= 7200*1.25 = 9000, > 7200)
    expect(s.fighters[0].health).toBe(1150);
    expect(s.fighters[0].maxHealth).toBe(1150);

    const scottThrow = run(s, [[P | K, 0], ...frames(35)]);
    expect(scottThrow.events.some((e) => e.type === "throw" && e.player === 0)).toBe(true);
    const hit = scottThrow.events.find((e) => e.type === "hit" && e.move === "throw") as
      | Extract<SimEvent, { type: "hit" }>
      | undefined;
    expect(hit?.damage).toBe(Math.floor((120 * 125) / 100));

    // At the same 85px gap, Julien's baseline throw whiffs.
    const julienThrow = run(duel("julien-hovan", "julien-hovan", 85), [[P | K, 0], ...frames(25)]);
    expect(julienThrow.events.some((e) => e.type === "throw")).toBe(false);
  });

  it("Saransh has 10f backdash invulnerability and cache_blink vanishes and lands a 2-hit lunge", () => {
    const dash = run(duel("saransh-padhy", "julien-hovan", 200), [[L, 0], [0, 0], [L, 0]]);
    expect(dash.state.fighters[0].state).toBe("dash_back");
    expect(hurtRects(dash.state.fighters[0])).toEqual([]);
    const f9 = run(dash.state, frames(9));
    expect(f9.state.fighters[0].stateFrame).toBe(9);
    expect(hurtRects(f9.state.fighters[0])).toEqual([]);
    const f10 = step(f9.state, [0, 0]);
    expect(f10.fighters[0].stateFrame).toBe(10);
    expect(hurtRects(f10.fighters[0]).length).toBeGreaterThan(0);

    const blink = run(duel("saransh-padhy", "julien-hovan", 110), [[S, 0], ...frames(40)]);
    expect(blink.states.some((st) => isHidden(st.fighters[0]))).toBe(true);
    const blinkHits = blink.events.filter((e) => e.type === "hit" && e.player === 0 && e.move === "cache_blink");
    expect(blinkHits).toHaveLength(2);
    expect(blink.states.some((st) => st.fighters[1].state === "knockdown")).toBe(true);
  });

  it("per-fighter physics modifiers scale dash speed, jump height, gravity, pushback, and combo floor", () => {
    // Antonia dashSpeedPct: 122 covers more distance than Julien (100).
    const antoniaDash = run(duel("antonia-nistor", "julien-hovan", 250), [[R, 0], [0, 0], [R, 0], ...frames(18)]);
    const julienDash = run(duel("julien-hovan", "julien-hovan", 250), [[R, 0], [0, 0], [R, 0], ...frames(18)]);
    expect(antoniaDash.state.fighters[0].x).toBeGreaterThan(julienDash.state.fighters[0].x);

    // Scott gravityOffset: 6 & jumpVyPct: 94 lands sooner than Julien.
    const scottJump = run(duel("scott-carr", "julien-hovan", 200), [[U, 0], ...frames(45)]);
    const julienJump = run(duel("julien-hovan", "julien-hovan", 200), [[U, 0], ...frames(45)]);
    const scottLand = scottJump.states.findIndex((s) => s.fighters[0].state === "landing");
    const julienLand = julienJump.states.findIndex((s) => s.fighters[0].state === "landing");
    expect(scottLand).toBeGreaterThan(0);
    expect(scottLand).toBeLessThan(julienLand);

    // Ethan pushbackPct: 125 pushes a blocker further than Julien's 100%.
    const ethanBlock = run(duel("ethan-pirso", "julien-hovan", 50), [[P, R], ...frames(20, 0, R)]);
    const julienBlock = run(duel("julien-hovan", "julien-hovan", 50), [[P, R], ...frames(20, 0, R)]);
    expect(ethanBlock.state.fighters[1].x).toBeGreaterThan(julienBlock.state.fighters[1].x);

    // Jerry comboFloorPct: 60 preserves at least 60% damage at high combo counts.
    const jerryState = duel("jerry-zhu", "julien-hovan", 45);
    jerryState.fighters[1].state = "hitstun";
    jerryState.fighters[1].stun = 20;
    jerryState.fighters[1].comboHits = 8; // 100 - 80 = 20 -> clamped to Jerry's 60% floor
    const jerryHit = run(jerryState, [[P, 0], ...frames(6)]);
    const dmg = (jerryHit.events.find((e) => e.type === "hit") as Extract<SimEvent, { type: "hit" }>).damage;
    // base = floor(40 * 102 / 100) = 40; floor(40 * 60 / 100) = 24
    expect(dmg).toBe(24);
  });
});

describe("determinism across pairings of all 8 new fighters", () => {
  function script(seed: number, length: number): InputPair[] {
    const holder = { rng: seedRng(seed) };
    const rand = () => nextU32(holder);
    const masks = [0, R, L, D, P, K, S, R | S, L | S, R | P, L | K, D | P, D | S, P | K, R | K];
    const out: InputPair[] = [];
    let a = 0;
    let b = 0;
    let ha = 0;
    let hb = 0;
    for (let i = 0; i < length; i++) {
      if (ha-- <= 0) {
        a = masks[rand() % masks.length]!;
        ha = 1 + (rand() % 12);
      }
      if (hb-- <= 0) {
        b = masks[rand() % masks.length]!;
        hb = 1 + (rand() % 12);
      }
      out.push([a, b]);
    }
    return out;
  }

  function hashes(p1: string, p2: string, roundTripAt = -1): string[] {
    let state = createMatchState(19, p1, p2);
    const out: string[] = [];
    for (const pair of script(29, 2400)) {
      state = step(state, pair);
      if (state.frame % 120 === 0) out.push(hashState(state));
      if (state.frame === roundTripAt) state = JSON.parse(JSON.stringify(state)) as SimState;
    }
    return out;
  }

  const pairings = [
    ["ethan-pirso", "megane-darnaud"],
    ["jerry-zhu", "scott-carr"],
    ["antonia-nistor", "vincent-anctil"],
    ["saransh-padhy", "tyler-nagano"],
    ["andrea-vreugdenhil", "emile-moffatt"],
    ["guillaume-pregent", "jonathan-kim"],
    ["logan-labossiere", "oyku-cildir"],
    ["wild-guevera", "william-chan"],
  ] as const;

  for (const [p1, p2] of pairings) {
    it(`${p1} vs ${p2}: 2400-frame identical hashes and JSON round-trip invariance`, () => {
      const a = hashes(p1, p2);
      expect(a).toHaveLength(20);
      expect(hashes(p1, p2)).toEqual(a);
      expect(hashes(p1, p2, 1000)).toEqual(a);
    });
  }

  it("Spec 017 new mechanics: Emile titan_press command grab, Dana mirror_step parry, Guillaume P. railgun + mine", () => {
    // Emile's titan_press grabs through standing block.
    const grab = run(duel("emile-moffatt", "julien-hovan", 70), [[S, R], ...frames(35, 0, R)]);
    expect(grab.events.some((e) => e.type === "throw" && e.player === 0)).toBe(true);
    const grabHit = grab.events.find((e) => e.type === "hit" && e.move === "titan_press") as
      | Extract<SimEvent, { type: "hit" }>
      | undefined;
    expect(grabHit).toBeDefined();

    // Dana's mirror_step absorbs an attack on counter frames and triggers reversal hit.
    const parry = run(duel("dana-domanko", "julien-hovan", 52), [[S, 0], ...frames(4), [0, P], ...frames(30)]);
    expect(parry.events.some((e) => e.type === "counter" && e.player === 0)).toBe(true);
    expect(parry.events.some((e) => e.type === "hit" && e.player === 0 && e.move === "mirror_step")).toBe(true);

    // Guillaume Pregent can place anchor_mine (F+S) and still fire rail_shot (S) concurrently.
    const mine = run(duel("guillaume-pregent", "julien-hovan", 240), [[R | S, 0], ...frames(30)]);
    expect(mine.state.projectiles.some((p) => p.kind === "slow_mine")).toBe(true);
    const rail = run(mine.state, [[S, 0], ...frames(20)]);
    expect(rail.state.projectiles.some((p) => p.kind === "slow_mine")).toBe(true);
    expect(rail.state.projectiles.some((p) => p.kind === "fast_packet")).toBe(true);
  });
});
