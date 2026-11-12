// Spec 008: CPU opponent tests (A1-A5).
import { describe, expect, it } from "vitest";
import { MOVEMENT } from "../data/movement";
import { BUTTON_LEFT, BUTTON_LIGHT, BUTTON_RIGHT, BUTTON_UP } from "../sim/inputBits";
import { createMatchState, createSandboxState } from "../sim/state";
import { step } from "../sim/step";
import type { FighterState, SimEvent, SimState } from "../sim/types";
import { createCpu } from "./cpu";
import type { CpuLevel } from "./levels";

const SLUG = "julien-hovan";

function actionable(f: FighterState): boolean {
  return f.state === "idle" || f.state === "walk_forward" || f.state === "walk_back" || f.state === "crouch" || f.state === "landing";
}

describe("CPU basics (A1)", () => {
  it("is deterministic for a seed and never mutates the state", () => {
    const a = createCpu("hard", 1, 42);
    const b = createCpu("hard", 1, 42);
    let s = createSandboxState(3, SLUG, SLUG);
    const outA: number[] = [];
    const outB: number[] = [];
    for (let t = 0; t < 600; t++) {
      const before = JSON.stringify(s);
      const ia = a.decide(s);
      const ib = b.decide(s);
      expect(JSON.stringify(s)).toBe(before);
      outA.push(ia);
      outB.push(ib);
      s = step(s, [t % 40 < 20 ? BUTTON_RIGHT : 0, ia]);
    }
    expect(outB).toEqual(outA);
    expect(outA.some((x) => x !== 0)).toBe(true);
  });
});

/** P1 walks in and jabs every 24 frames; P2 is the CPU. Returns blocks / (blocks + hits) on the CPU. */
function blockRate(level: CpuLevel, seed: number): number {
  const cpu = createCpu(level, 1, seed);
  let s = createSandboxState(seed, SLUG, SLUG);
  let blocks = 0;
  let hits = 0;
  for (let t = 0; t < 4000; t++) {
    const [a, b] = s.fighters;
    const gap = Math.abs(b.x - a.x) / 100;
    let p1 = 0;
    if (actionable(a)) p1 = gap > 58 ? BUTTON_RIGHT * (a.facing === 1 ? 1 : 0) + BUTTON_LEFT * (a.facing === 1 ? 0 : 1) : t % 24 === 0 ? BUTTON_LIGHT : 0;
    s = step(s, [p1, cpu.decide(s)]);
    for (const e of s.events) {
      if (e.type === "block" && e.target === 1 && e.player === 0) blocks++;
      if (e.type === "hit" && e.target === 1 && e.player === 0) hits++;
    }
  }
  return blocks / Math.max(1, blocks + hits);
}

describe("blocking by level (A2)", () => {
  it("Hard blocks most close jabs, Normal about half, Easy few", () => {
    const avg = (lvl: CpuLevel) => [1, 2, 3].map((seed) => blockRate(lvl, seed)).reduce((x, y) => x + y) / 3;
    const hard = avg("hard");
    const normal = avg("normal");
    const easy = avg("easy");
    expect(hard).toBeGreaterThanOrEqual(0.7);
    expect(normal).toBeGreaterThanOrEqual(0.3);
    expect(normal).toBeLessThanOrEqual(0.7);
    expect(easy).toBeLessThanOrEqual(0.3);
  });
});

/** P1 jumps in at the CPU repeatedly. Returns the share of jumps hit before landing. */
function antiAirRate(level: CpuLevel, seed: number): number {
  const cpu = createCpu(level, 1, seed);
  let s = createSandboxState(seed, SLUG, SLUG);
  let jumps = 0;
  let airHits = 0;
  let wasAir = false;
  let hitThisJump = false;
  for (let t = 0; t < 6000; t++) {
    const [a, b] = s.fighters;
    const gap = Math.abs(b.x - a.x) / 100;
    const fwd = a.facing === 1 ? BUTTON_RIGHT : BUTTON_LEFT;
    let p1 = 0;
    if (actionable(a)) p1 = gap > 150 ? fwd : gap > 110 ? BUTTON_UP | fwd : a.facing === 1 ? BUTTON_LEFT : BUTTON_RIGHT;
    s = step(s, [p1, cpu.decide(s)]);
    const air = s.fighters[0].y < MOVEMENT.floorY || s.fighters[0].state === "airborne";
    if (air && !wasAir) {
      jumps++;
      hitThisJump = false;
    }
    if (air && !hitThisJump && s.events.some((e) => e.type === "hit" && e.target === 0)) {
      airHits++;
      hitThisJump = true;
    }
    wasAir = air;
  }
  return airHits / Math.max(1, jumps);
}

describe("anti-air by level (A3)", () => {
  it("Hard anti-airs at least half the jump-ins, Easy few", () => {
    const hard = [1, 2].map((seed) => antiAirRate("hard", seed)).reduce((x, y) => x + y) / 2;
    const easy = [1, 2].map((seed) => antiAirRate("easy", seed)).reduce((x, y) => x + y) / 2;
    expect(hard).toBeGreaterThanOrEqual(0.5);
    expect(easy).toBeLessThanOrEqual(0.2);
  });
});

interface MatchResult {
  winner: 0 | 1 | -1;
  frames: number;
  maxStuck: number;
}

function cpuMatch(p1: CpuLevel | null, p2: CpuLevel | null, seed: number, limit = 40000, slugs: [string, string] = [SLUG, SLUG]): MatchResult {
  const c1 = p1 ? createCpu(p1, 0, seed) : null;
  const c2 = p2 ? createCpu(p2, 1, seed + 1000) : null;
  let s: SimState = createMatchState(seed, slugs[0], slugs[1]);
  const stuck = [0, 0];
  let maxStuck = 0;
  for (let t = 1; t <= limit; t++) {
    s = step(s, [c1 ? c1.decide(s) : 0, c2 ? c2.decide(s) : 0]);
    s.fighters.forEach((f, i) => {
      const busy = !actionable(f) && f.state !== "airborne" && f.state !== "jumpsquat" && f.state !== "ko" && f.state !== "victory";
      stuck[i] = busy ? stuck[i]! + 1 : 0;
      maxStuck = Math.max(maxStuck, stuck[i]!);
    });
    const end = s.events.find((e): e is Extract<SimEvent, { type: "match_end" }> => e.type === "match_end");
    if (end) return { winner: end.winner, frames: t, maxStuck };
  }
  return { winner: -1, frames: limit, maxStuck };
}

describe("matches (A4, A5)", () => {
  it("every level beats a passive dummy, and Hard is faster than Easy", () => {
    const results = (["easy", "normal", "hard"] as CpuLevel[]).map((lvl) => cpuMatch(null, lvl, 5));
    for (const r of results) expect(r.winner).toBe(1);
    expect(results[2]!.frames).toBeLessThan(results[0]!.frames);
  });

  it("Hard vs Hard finishes without stuck states", () => {
    const r = cpuMatch("hard", "hard", 9);
    expect(r.winner).not.toBe(-1);
    expect(r.maxStuck).toBeLessThanOrEqual(300);
  });

  it("every launch fighter's CPU finishes Hard vs Hard matches without stuck states (spec 006 specials)", () => {
    const pairs: [string, string][] = [
      ["felicia-gorgacheva", "pentcho-tchomakov"],
      ["alex-andrianavalontsalama", "felicia-gorgacheva"],
      ["pentcho-tchomakov", "alex-andrianavalontsalama"],
    ];
    for (const [i, pair] of pairs.entries()) {
      const r = cpuMatch("hard", "hard", 21 + i, 40000, pair);
      expect(r.winner, pair.join(" vs ")).not.toBe(-1);
      expect(r.maxStuck).toBeLessThanOrEqual(300);
    }
  });

  it("Hard beats Easy in most of 5 seeded matches", () => {
    let hardWins = 0;
    for (const seed of [11, 12, 13, 14, 15]) {
      const r = cpuMatch("easy", "hard", seed);
      expect(r.maxStuck).toBeLessThanOrEqual(300);
      if (r.winner === 1) hardWins++;
    }
    expect(hardWins).toBeGreaterThanOrEqual(3);
  });
});
