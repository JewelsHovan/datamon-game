// Spec 018 verification: Cardinal Shield (Guard drain, Pushblock cost, Shield Break, regeneration),
// 3-frame Perfect Shield (Just Defend), Air Shield vs projectiles/aerials vs grounded anti-airs,
// 8-frame Throw Escape vs untechable Command Grabs, 3-Way Wakeup (Back/Forward Roll + Quick Rise +
// vulnerable roll tail), Counter/Punish hitstun & callouts, and Martin Dawson / Walid Aissa kits.
import { describe, expect, it } from "vitest";
import { COMBAT, KNOCKDOWN, MOVES_V2, SHIELD } from "../data/combat";
import { MOVEMENT } from "../data/movement";
import { MOVES } from "../data/moves";
import { hurtRects } from "./combat";
import { hashState } from "./hash";
import {
  BUTTON_KICK as K,
  BUTTON_LEFT as L,
  BUTTON_PUNCH as P,
  BUTTON_RIGHT as R,
  BUTTON_SPECIAL as S,
  BUTTON_UP as U,
} from "./inputBits";
import { createSandboxState } from "./state";
import { step } from "./step";
import type { InputPair, SimEvent, SimState } from "./types";

const JULIEN = "julien-hovan";

function duel(p1 = JULIEN, p2 = JULIEN, gapPx = 52): SimState {
  const s = createSandboxState(42, p1, p2);
  const center = MOVEMENT.stageWidth / 2;
  const half = Math.floor((gapPx * 100) / 2);
  s.fighters[0].x = center - half;
  s.fighters[1].x = center + half;
  return s;
}

function frames(n: number, p1 = 0, p2 = 0): InputPair[] {
  return Array.from({ length: n }, () => [p1, p2] as InputPair);
}

function run(start: SimState, inputs: readonly InputPair[]): { state: SimState; states: SimState[]; events: SimEvent[] } {
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

describe("Spec 018: Cardinal Shield, Perfect Shield & Air Shield", () => {
  it("drains Guard on normal block, regenerates after cooldown, and spends Guard on Pushblock", () => {
    // P2 holds Back (Right) from frame 0 -> normal block on frame 4 (age = 3 >= perfectWindowFrames).
    const blocked = run(duel(JULIEN, JULIEN, 52), [[P, R], ...frames(4, 0, R)]);
    expect(blocked.events.some((e) => e.type === "block")).toBe(true);
    expect(blocked.events.some((e) => e.type === "perfect_block")).toBe(false);
    const guardAfterJab = blocked.state.fighters[1].guard;
    expect(guardAfterJab).toBeLessThan(SHIELD.maxGuard);

    // Pushblock spends SHIELD.pushCost Guard, and refuses when Guard < SHIELD.pushCost.
    const pushed = run(blocked.state, [[0, R | P | K], ...frames(5, 0, R)]);
    expect(pushed.events.some((e) => e.type === "block_push" && e.player === 1)).toBe(true);
    expect(pushed.state.fighters[1].guard).toBe(guardAfterJab - SHIELD.pushCost);

    const lowGuardStart = duel(JULIEN, JULIEN, 52);
    lowGuardStart.fighters[1].guard = 260;
    const lowBlocked = run(lowGuardStart, [[P, R], ...frames(4, 0, R), [0, R | P | K], ...frames(4, 0, R)]);
    expect(lowBlocked.events.some((e) => e.type === "block_push")).toBe(false);

    // Waiting past regenDelay outside blockstun restores Guard cleanly back toward maxGuard.
    const regen = run(pushed.state, frames(60));
    expect(regen.state.fighters[1].guard).toBeGreaterThan(pushed.state.fighters[1].guard);
    expect(hashState(regen.state)).toBeTruthy();
  });

  it("triggers Shield Break (guard_break) at 0 Guard and refills Guard on punish hit", () => {
    const start = duel(JULIEN, JULIEN, 48);
    start.fighters[1].guard = 50;
    start.fighters[1].guardCooldown = 20;
    // Light punch (14f total) drains > 60 Guard -> breaks Shield quickly so attacker recovers while defender is still staggered!
    const broken = run(start, [[P, R], ...frames(23, 0, R)]);
    expect(broken.events.some((e) => e.type === "guard_break" && e.player === 1)).toBe(true);
    expect(broken.state.fighters[0].state).toBe("idle");
    expect(broken.state.fighters[1].state).toBe("guard_break");
    expect(broken.state.fighters[1].stun).toBeGreaterThanOrEqual(20);

    // Attacker punishes the staggered defender -> hits cleanly and restores defender's Guard to full.
    const punished = run(broken.state, [[R | P, R], ...frames(14, 0, R)]);
    expect(punished.events.some((e) => e.type === "hit" && e.target === 1)).toBe(true);
    expect(punished.events.some((e) => e.type === "callout" && e.kind === "punish" && e.player === 0)).toBe(true);
    expect(punished.state.fighters[1].guard).toBe(SHIELD.maxGuard);
  });

  it("3-frame Perfect Shield negates chip damage, restores Guard, and shortens blockstun", () => {
    const normalStart = duel(JULIEN, JULIEN, 130);
    normalStart.fighters[1].guard = 600;
    normalStart.fighters[1].guardCooldown = 40;
    // Normal block against Data Orb (holds Back the whole time -> takes chip and loses Guard).
    const normalOrb = run(normalStart, [[S, R], ...frames(35, 0, R)]);
    expect(normalOrb.events.some((e) => e.type === "block")).toBe(true);
    expect(normalOrb.events.some((e) => e.type === "perfect_block")).toBe(false);
    expect(normalOrb.state.fighters[1].health).toBeLessThan(normalStart.fighters[1].health);
    expect(normalOrb.state.fighters[1].guard).toBeLessThan(600);

    // Perfect Shield: tap Back within 3 frames before light_punch active frame (tick 3 -> step 4).
    const perfStart = duel(JULIEN, JULIEN, 52);
    perfStart.fighters[1].guard = 600;
    perfStart.fighters[1].guardCooldown = 10;
    // Step 1: [P, 0], Step 2: [0, 0], Step 3: [0, R] (age=1 on Step 4 when jab becomes active!).
    const perfJab = run(perfStart, [[P, 0], [0, 0], [0, R], [0, R]]);
    expect(perfJab.events.some((e) => e.type === "perfect_block" && e.player === 1)).toBe(true);
    expect(perfJab.state.fighters[1].guard).toBe(600 + SHIELD.perfectGuardRestore);
    expect(perfJab.state.fighters[1].stun).toBe(MOVES.light_punch.blockstun - SHIELD.perfectStunReduction);
  });

  it("Air Shield blocks projectiles in mid-air at 1.5x Guard cost, while grounded anti-airs hit clean", () => {
    // Projectile vs airborne blocker holding Back (P1 fires Data Orb; P2 jumps as orb approaches so it meets airborne hurtbox).
    const airProj = run(duel(JULIEN, JULIEN, 140), [
      [S, 0],
      ...frames(14),
      [0, U],
      ...frames(20, 0, R),
    ]);
    expect(airProj.events.some((e) => e.type === "block" && e.target === 1)).toBe(true);
    expect(airProj.events.some((e) => e.type === "hit" && e.target === 1)).toBe(false);
    expect(airProj.state.fighters[1].guard).toBeLessThan(SHIELD.maxGuard - SHIELD.drainSpecial);

    // Grounded anti-air (rising_commit) vs jumping defender holding Back -> hits clean (air-unblockable!).
    const antiAir = run(duel(JULIEN, JULIEN, 58), [
      [0, U | L], // P2 jumps forward
      ...frames(6, 0, R), // P2 holds Back in the air
      [R | S, R], // P1 fires grounded rising_commit uppercut
      ...frames(15, 0, R),
    ]);
    expect(antiAir.events.some((e) => e.type === "hit" && e.target === 1)).toBe(true);
  });
});

describe("Spec 018: Throw Tech, 3-Way Wakeup, Counter/Punish & Martin/Walid Kits", () => {
  it("escapes a normal throw within 8 frames via Punch+Kick, while command grabs stay untechable", () => {
    // Normal throw teched 4 frames after grab connects.
    const teched = run(duel(JULIEN, JULIEN, 52), [
      [P | K, 0],
      ...frames(5), // throw grabs on tick 3 (step 4)
      [0, P | K], // defender techs inside 8-frame window
      ...frames(15),
    ]);
    expect(teched.events.some((e) => e.type === "throw")).toBe(true);
    expect(teched.events.some((e) => e.type === "tech")).toBe(true);
    expect(teched.state.fighters[1].health).toBe(COMBAT.maxHealth);

    // Martin Dawson's schema_lock (F+S command grab) cannot be teched even when mashing P+K!
    const cmdGrab = run(duel("martin-dawson", JULIEN, 64), [
      [R | S, R],
      ...frames(9, 0, R),
      [0, P | K],
      [0, 0],
      [0, P | K],
      ...frames(25),
    ]);
    expect(cmdGrab.events.some((e) => e.type === "throw" && e.player === 0)).toBe(true);
    expect(cmdGrab.events.some((e) => e.type === "tech")).toBe(false);
    expect(cmdGrab.state.fighters[1].health).toBeLessThan(COMBAT.maxHealth);
  });

  it("supports Forward Cross-Up Roll (with vulnerable final 5f) and Quick Rise on wakeup", () => {
    const knocked = duel(JULIEN, JULIEN, 80);
    knocked.fighters[1].state = "knockdown";
    knocked.fighters[1].stateFrame = KNOCKDOWN.koHoldFrame - 1;

    // P2 faces left (-1), so holding Left (L) is Forward -> rolls forward toward/past P1!
    const fwdRoll = run(knocked, frames(40, 0, L));
    expect(fwdRoll.events.some((e) => e.type === "roll" && e.player === 1)).toBe(true);
    expect(fwdRoll.states[2]?.fighters[1].x).toBeLessThan(knocked.fighters[1].x);
    // Early roll frames are invulnerable; final 5 frames expose standing hurtboxes.
    const early = fwdRoll.states.find((s) => s.fighters[1].rollFrom >= 0 && s.fighters[1].stateFrame - s.fighters[1].rollFrom === 10);
    const tail = fwdRoll.states.find(
      (s) => s.fighters[1].rollFrom >= 0 && s.fighters[1].stateFrame - s.fighters[1].rollFrom === MOVES_V2.rollFrames - 2,
    );
    expect(early && hurtRects(early.fighters[1])).toEqual([]);
    expect(tail && hurtRects(tail.fighters[1]).length).toBeGreaterThan(0);

    // Quick Rise: holding Up at koHoldFrame stands up faster than neutral wakeup.
    const neutralRise = run(knocked, frames(60));
    const quickRise = run(knocked, frames(60, 0, U));
    const idleAt = (states: SimState[]) => states.findIndex((s) => s.fighters[1].state === "idle" || s.fighters[1].state === "jumpsquat");
    expect(idleAt(quickRise.states)).toBeLessThan(idleAt(neutralRise.states));
  });

  it("grants +3f hitstun and COUNTER! callout when stuffing attack startup, and tests Martin & Walid specials", () => {
    // P2 starts heavy_punch (slow startup) 1 frame after P1 starts light_punch -> P1 counter-hits P2's startup!
    const counter = run(duel(JULIEN, JULIEN, 52), [[P, 0], [0, L | P], ...frames(3)]);
    expect(counter.events.some((e) => e.type === "callout" && e.kind === "counter" && e.player === 0)).toBe(true);
    const hitState = counter.states.find((s) => s.fighters[1].state === "hitstun");
    expect(hitState?.fighters[1].stun).toBe(MOVES.light_punch.hitstun + COMBAT.counterHitstunBonus);

    // Martin's pipeline_crush absorbs a jab with armor and lands knockdown smash.
    const martinArmor = run(duel("martin-dawson", JULIEN, 62), [[S, 0], ...frames(3), [0, P], ...frames(28)]);
    expect(martinArmor.events.some((e) => e.type === "armor" && e.player === 0)).toBe(true);
    expect(martinArmor.events.some((e) => e.type === "hit" && e.move === "pipeline_crush")).toBe(true);

    // Walid's vector_lance (S) and tensor_arc (F+S) can layer fast_packet + arc_burst simultaneously.
    const walidZones = run(duel("walid-aissa", JULIEN, 240), [[R | S, 0], ...frames(26), [S, 0], ...frames(18)]);
    const kinds = walidZones.state.projectiles.map((p) => p.kind).sort();
    expect(kinds).toEqual(["arc_burst", "fast_packet"]);
  });
});
