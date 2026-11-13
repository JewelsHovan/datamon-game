// Spec 008, spec 016, spec 017: CPU opponent tests (A1-A5 + 37-fighter kit coverage).
import { describe, expect, it } from "vitest";
import { FIGHTERS } from "../data/fighters";
import { MOVEMENT } from "../data/movement";
import { MOVES, type MoveId } from "../data/moves";
import { BUTTON_DOWN, BUTTON_LEFT, BUTTON_LIGHT, BUTTON_RIGHT, BUTTON_SPECIAL, BUTTON_UP } from "../sim/inputBits";
import { createMatchState, createSandboxState } from "../sim/state";
import { step } from "../sim/step";
import type { FighterState, SimEvent, SimState } from "../sim/types";
import { createCpu, REACH } from "./cpu";
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

describe("expanded 37-fighter CPU roster (spec 016, spec 017)", () => {
  const allSlugs = Object.keys(FIGHTERS);

  it("every MoveId in MOVES has a finite positive REACH entry", () => {
    const moveIds = Object.keys(MOVES) as MoveId[];
    expect(moveIds.length).toBeGreaterThanOrEqual(81);
    for (const id of moveIds) {
      const r = REACH[id];
      expect(Number.isFinite(r), `REACH[${id}] should be finite`).toBe(true);
      expect(r, `REACH[${id}] should be positive`).toBeGreaterThan(0);
    }
  });

  it("is deterministic and completes multi-hundred-frame bouts for all 37 fighters without stuck states", () => {
    expect(allSlugs).toHaveLength(37);
    for (let i = 0; i < allSlugs.length; i++) {
      const slug = allSlugs[i]!;
      const opp = allSlugs[(i + 1) % allSlugs.length]!;
      const c1a = createCpu("hard", 0, 100 + i);
      const c1b = createCpu("hard", 0, 100 + i);
      const c2 = createCpu("normal", 1, 200 + i);
      let s = createSandboxState(100 + i, slug, opp);
      const stuck = [0, 0];
      let maxStuck = 0;
      const inputsA: number[] = [];
      const inputsB: number[] = [];

      for (let t = 0; t < 420; t++) {
        const ia = c1a.decide(s);
        const ib = c1b.decide(s);
        inputsA.push(ia);
        inputsB.push(ib);
        s = step(s, [ia, c2.decide(s)]);
        s.fighters.forEach((f, idx) => {
          const busy = !actionable(f) && f.state !== "airborne" && f.state !== "jumpsquat" && f.state !== "ko" && f.state !== "victory";
          stuck[idx] = busy ? stuck[idx]! + 1 : 0;
          maxStuck = Math.max(maxStuck, stuck[idx]!);
        });
      }

      expect(inputsB, slug).toEqual(inputsA);
      expect(inputsA.some((x) => x !== 0), slug).toBe(true);
      expect(maxStuck, slug).toBeLessThanOrEqual(240);
    }
  });

  it("Ethan Pirso layers both packet_sniper (S) and rate_mine (fwd | S) via per-kind projectile checks", () => {
    const cpu = createCpu("hard", 0, 77);
    let s = createSandboxState(77, "ethan-pirso", "julien-hovan");
    const movesSeen = new Set<MoveId>();
    const kindsSeen = new Set<string>();

    for (let t = 0; t < 900; t++) {
      // Opponent holds back at range so Ethan stays in zoning distance.
      const opBack = s.fighters[1].facing === 1 ? BUTTON_LEFT : BUTTON_RIGHT;
      const p1 = t % 45 < 10 ? opBack : 0;
      s = step(s, [cpu.decide(s), p1]);
      for (const e of s.events) {
        if (e.type === "attack" && e.player === 0) movesSeen.add(e.move);
        if (e.type === "projectile" && e.player === 0 && e.kind) kindsSeen.add(e.kind);
      }
    }

    expect(movesSeen.has("packet_sniper")).toBe(true);
    expect(movesSeen.has("rate_mine")).toBe(true);
    expect(kindsSeen.has("fast_packet")).toBe(true);
    expect(kindsSeen.has("slow_mine")).toBe(true);
  });

  it("Julien and Jerry punish jump-ins with rising_commit (fwd | S) and skyline_upper (S) anti-airs", () => {
    for (const [slug, expectedAA] of [
      ["julien-hovan", "rising_commit"],
      ["jerry-zhu", "skyline_upper"],
    ] as const) {
      const cpu = createCpu("hard", 1, 55);
      let s = createSandboxState(55, "alex-andrianavalontsalama", slug);
      const aaMoves = new Set<MoveId>();

      for (let t = 0; t < 1800; t++) {
        const [a, b] = s.fighters;
        const gap = Math.abs(b.x - a.x) / 100;
        const fwd = a.facing === 1 ? BUTTON_RIGHT : BUTTON_LEFT;
        let p1 = 0;
        if (actionable(a)) p1 = gap > 150 ? fwd : gap > 105 ? BUTTON_UP | fwd : a.facing === 1 ? BUTTON_LEFT : BUTTON_RIGHT;
        s = step(s, [p1, cpu.decide(s)]);
        for (const e of s.events) {
          if (e.type === "attack" && e.player === 1) aaMoves.add(e.move);
        }
      }

      expect(aaMoves.has(expectedAA), `${slug} should use ${expectedAA}`).toBe(true);
    }
  });

  it("Scott Carr pressures blocking foes with force_push (S) command grab and breaker_lariat (fwd | S)", () => {
    const cpu = createCpu("hard", 0, 88);
    let s = createSandboxState(88, "scott-carr", "tyler-nagano");
    const movesSeen = new Set<MoveId>();

    for (let t = 0; t < 1800; t++) {
      // Opponent holds crouch-back to block up close.
      const opBack = s.fighters[1].facing === 1 ? BUTTON_LEFT : BUTTON_RIGHT;
      s = step(s, [cpu.decide(s), opBack | BUTTON_DOWN]);
      for (const e of s.events) {
        if (e.type === "attack" && e.player === 0) movesSeen.add(e.move);
      }
    }

    expect(movesSeen.has("force_push")).toBe(true);
    expect(movesSeen.has("breaker_lariat")).toBe(true);
  });

  it("Vincent, Megane, and Tyler use both their neutral (S) and directional (fwd | S) specials", () => {
    const cases: { slug: string; opp: string; expected: [MoveId, MoveId]; oppHold: number }[] = [
      { slug: "vincent-anctil", opp: "alex-andrianavalontsalama", expected: ["ground_fault", "arc_beacon"], oppHold: BUTTON_UP },
      { slug: "megane-darnaud", opp: "julien-hovan", expected: ["rollback_parry", "velvet_cross"], oppHold: BUTTON_DOWN },
      { slug: "tyler-nagano", opp: "julien-hovan", expected: ["anvil_drop", "steel_counter"], oppHold: BUTTON_DOWN },
    ];
    for (const [idx, c] of cases.entries()) {
      const cpu = createCpu("hard", 0, 91 + idx);
      const oppCpu = createCpu("normal", 1, 191 + idx);
      let s = createSandboxState(91 + idx, c.slug, c.opp);
      const seen = new Set<MoveId>();

      for (let t = 0; t < 2400; t++) {
        const opDir = c.oppHold === BUTTON_UP
          ? (s.fighters[1].facing === 1 ? BUTTON_RIGHT : BUTTON_LEFT)
          : (s.fighters[1].facing === 1 ? BUTTON_LEFT : BUTTON_RIGHT);
        const p2 = t % 120 < 40 ? opDir | c.oppHold : oppCpu.decide(s);
        s = step(s, [cpu.decide(s), p2]);
        for (const e of s.events) {
          if (e.type === "attack" && e.player === 0) seen.add(e.move);
        }
      }

      expect(seen.has(c.expected[0]), `${c.slug} missing ${c.expected[0]}`).toBe(true);
      expect(seen.has(c.expected[1]), `${c.slug} missing ${c.expected[1]}`).toBe(true);
    }
  });

  it("all 37 fighters finish Hard vs Hard matches cleanly and use specials", () => {
    for (let i = 0; i < allSlugs.length; i++) {
      const p1 = allSlugs[i]!;
      const p2 = allSlugs[(i + 13) % allSlugs.length]!;
      const c1 = createCpu("hard", 0, 300 + i);
      const c2 = createCpu("hard", 1, 400 + i);
      let s = createMatchState(300 + i, p1, p2);
      const seenP1 = new Set<MoveId>();
      const seenP2 = new Set<MoveId>();
      let finished = false;
      const stuck = [0, 0];
      let maxStuck = 0;

      for (let t = 1; t <= 40000; t++) {
        s = step(s, [c1.decide(s), c2.decide(s)]);
        s.fighters.forEach((f, idx) => {
          const busy = !actionable(f) && f.state !== "airborne" && f.state !== "jumpsquat" && f.state !== "ko" && f.state !== "victory";
          stuck[idx] = busy ? stuck[idx]! + 1 : 0;
          maxStuck = Math.max(maxStuck, stuck[idx]!);
        });
        for (const e of s.events) {
          if (e.type === "attack") {
            if (e.player === 0) seenP1.add(e.move);
            else seenP2.add(e.move);
          }
        }
        if (s.events.some((e) => e.type === "match_end")) {
          finished = true;
          break;
        }
      }

      expect(finished, `${p1} vs ${p2}`).toBe(true);
      expect(maxStuck, `${p1} vs ${p2}`).toBeLessThanOrEqual(300);
      const f1 = FIGHTERS[p1]!;
      const f2 = FIGHTERS[p2]!;
      expect(seenP1.has(f1.specialMove) || seenP1.has(f1.altSpecialMove), p1).toBe(true);
      expect(seenP2.has(f2.specialMove) || seenP2.has(f2.altSpecialMove), p2).toBe(true);
    }
  });

  it("Spec 017 archetype showcase fighters execute both specials and win/complete simulated bouts cleanly", () => {
    // Verify each showcased archetype uses both signature specials (S and fwd | S) under realistic pressure.
    const showcases: { slug: string; opp: string; expected: [MoveId, MoveId]; oppMode: "block" | "range" | "jump" | "normal" }[] = [
      { slug: "guillaume-pregent", opp: "julien-hovan", expected: ["rail_shot", "anchor_mine"], oppMode: "range" },
      { slug: "emile-moffatt", opp: "tyler-nagano", expected: ["titan_press", "tectonic_stomp"], oppMode: "block" },
      { slug: "dana-domanko", opp: "julien-hovan", expected: ["mirror_step", "crescent_feint"], oppMode: "normal" },
      { slug: "wild-guevera", opp: "tyler-nagano", expected: ["wild_fang", "apex_pounce"], oppMode: "block" },
      { slug: "william-chan", opp: "alex-andrianavalontsalama", expected: ["jade_palm", "cloud_rising"], oppMode: "jump" },
    ];

    for (const [idx, c] of showcases.entries()) {
      const cpu = createCpu("hard", 0, 501 + idx);
      const oppCpu = createCpu("normal", 1, 601 + idx);
      let s = createSandboxState(501 + idx, c.slug, c.opp);
      const seen = new Set<MoveId>();

      for (let t = 0; t < 2400; t++) {
        const f1 = s.fighters[1];
        const fwd1 = f1.facing === 1 ? BUTTON_RIGHT : BUTTON_LEFT;
        const back1 = f1.facing === 1 ? BUTTON_LEFT : BUTTON_RIGHT;
        let p2 = 0;
        if (c.oppMode === "range") {
          p2 = t % 50 < 12 ? back1 : 0;
        } else if (c.oppMode === "block") {
          p2 = t % 120 < 80 ? back1 | BUTTON_DOWN : oppCpu.decide(s);
        } else if (c.oppMode === "jump") {
          const gap = Math.abs(f1.x - s.fighters[0].x) / 100;
          if (actionable(f1)) p2 = gap > 150 ? fwd1 : gap > 105 ? BUTTON_UP | fwd1 : back1;
        } else {
          p2 = t % 120 < 40 ? back1 | BUTTON_DOWN : oppCpu.decide(s);
        }
        const i1 = cpu.decide(s);
        expect(Number.isInteger(i1) && i1 >= 0, `${c.slug} valid bitmask`).toBe(true);
        s = step(s, [i1, p2]);
        for (const e of s.events) {
          if (e.type === "attack" && e.player === 0) seen.add(e.move);
        }
      }

      expect(seen.has(c.expected[0]), `${c.slug} missing ${c.expected[0]}`).toBe(true);
      expect(seen.has(c.expected[1]), `${c.slug} missing ${c.expected[1]}`).toBe(true);

      // Also verify each showcased fighter beats a passive dummy cleanly in a full match.
      const matchRes = cpuMatch("hard", null, 700 + idx, 40000, [c.slug, "julien-hovan"]);
      expect(matchRes.winner, `${c.slug} should win vs passive`).toBe(0);
      expect(matchRes.maxStuck, `${c.slug} maxStuck`).toBeLessThanOrEqual(300);
    }
  });

  it("Hard CPU avoids walking blindly into an active stationary slow_mine", () => {
    const cpu = createCpu("hard", 1, 61);
    let s = createSandboxState(61, "ethan-pirso", "julien-hovan");
    let mineWalkIns = 0;
    let mineSpawns = 0;

    for (let t = 0; t < 1200; t++) {
      // Ethan repeatedly plants rate_mine (fwd | S) at range.
      const fwd1 = s.fighters[0].facing === 1 ? BUTTON_RIGHT : BUTTON_LEFT;
      const p1 = t % 90 === 10 ? fwd1 | BUTTON_SPECIAL : t % 90 === 11 ? fwd1 | BUTTON_SPECIAL : 0;
      s = step(s, [p1, cpu.decide(s)]);
      for (const e of s.events) {
        if (e.type === "projectile" && e.player === 0 && e.kind === "slow_mine") mineSpawns++;
        if (e.type === "hit" && e.player === 0 && e.move === "rate_mine") mineWalkIns++;
      }
    }

    expect(mineSpawns).toBeGreaterThan(0);
    expect(mineWalkIns).toBeLessThan(mineSpawns);
  });
});
