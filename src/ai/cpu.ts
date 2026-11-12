// CPU opponent (spec 008). The CPU only presses buttons: decide(state) returns an input
// bitmask, so every rule of the sim applies to it. It sees the opponent through a reaction
// delay, keeps its own seeded random generator (no Math.random), and acts through short input
// scripts ("plans") so presses produce real press edges.
//
// Buttons follow the round 3 scheme: Punch = BUTTON_LIGHT, Kick = BUTTON_HEAVY, Special.
// Punch = jab, forward+Punch = heavy punch, Kick = snap kick, forward+Kick = roundhouse,
// down+Kick = sweep, Punch+Kick = throw, Punch in the air = air kick.
import { fighterInfo } from "../data/fighters";
import { MOVEMENT } from "../data/movement";
import { firstActiveTick, MOVES, type HitHeight, type MoveId } from "../data/moves";
import {
  BUTTON_DOWN,
  BUTTON_HEAVY,
  BUTTON_LEFT,
  BUTTON_LIGHT,
  BUTTON_RIGHT,
  BUTTON_SPECIAL,
  BUTTON_UP,
} from "../sim/inputBits";
import type { FighterState, PlayerIndex, SimState } from "../sim/types";
import { LEVELS, type CpuLevel, type LevelParams } from "./levels";

export type { CpuLevel } from "./levels";

export interface CpuController {
  readonly level: CpuLevel;
  /** Input bitmask for `player` this step, from the latest sim state only. */
  decide(state: SimState): number;
}

const P = BUTTON_LIGHT;
const K = BUTTON_HEAVY;
const S = BUTTON_SPECIAL;
const U = BUTTON_UP;
const D = BUTTON_DOWN;

/** Rough reach of each move from the attacker's center to the far edge of its hitbox, in px. */
const REACH: Readonly<Record<MoveId, number>> = {
  light_punch: 66, heavy_punch: 76, light_kick: 86, heavy_kick: 92, crouch_attack: 98,
  air_attack: 74, throw: 72, special: 9999, teleport: 9999, charge: 230, rush: 170,
};

/** What the CPU saw of the opponent on one frame. */
interface View {
  frame: number;
  x: number;
  y: number;
  vx: number;
  state: FighterState["state"];
  move: MoveId | null;
  moveTick: number;
  /** Opponent's projectiles: x and direction. */
  shots: { x: number; vx: number }[];
}

interface Plan {
  steps: number[];
  i: number;
  urgent: boolean;
}

/** mulberry32: small, fast, integer-state PRNG. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function actionable(f: FighterState): boolean {
  return f.state === "idle" || f.state === "walk_forward" || f.state === "walk_back" || f.state === "crouch" || f.state === "landing";
}

function hold(bits: number, frames: number): number[] {
  return Array.from({ length: frames }, () => bits);
}

/** A press: held two frames, then released so the next press registers. */
function press(bits: number): number[] {
  return [bits, bits, 0];
}

export function createCpu(level: CpuLevel, player: PlayerIndex, seed: number): CpuController {
  const lv: LevelParams = LEVELS[level];
  const rnd = makeRng((seed * 2654435761) ^ (player + 1) * 40503);
  const chance = (p: number) => rnd() < p;
  const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const views: View[] = [];
  let plan: Plan | null = null;
  let wait = 0;
  /** What the CPU holds while it waits between decisions: nothing, or its guard when close. */
  let waitBits = 0;
  let lastThreat = "";
  let lastAntiAir = -1;
  let comboTried = -1;
  let wasStunned = false;

  function see(state: SimState): View {
    const op = state.fighters[player === 0 ? 1 : 0];
    views.push({
      frame: state.frame,
      x: op.x,
      y: op.y,
      vx: op.vx,
      state: op.state,
      move: op.move?.id ?? null,
      moveTick: op.move?.tick ?? 0,
      shots: state.projectiles.filter((p) => p.owner !== player).map((p) => ({ x: p.x, vx: p.vx })),
    });
    while (views.length > lv.reaction + 1) views.shift();
    return views[0]!;
  }

  function start(steps: number[], urgent = false): number {
    plan = { steps, i: 0, urgent };
    return next();
  }

  function next(): number {
    if (!plan) return 0;
    const bits = plan.steps[plan.i] ?? 0;
    plan.i += 1;
    if (plan.i >= plan.steps.length) plan = null;
    return bits;
  }

  function blockBits(me: FighterState, height: HitHeight): number {
    const back = me.facing === 1 ? BUTTON_LEFT : BUTTON_RIGHT;
    const right = chance(lv.correctHeight);
    const crouch = height === "low" ? right : height === "overhead" ? !right : chance(0.3);
    return crouch ? back | D : back;
  }

  return {
    level,
    decide(state: SimState): number {
      const me = state.fighters[player];
      const v = see(state);
      if (!state.round.training && (state.round.phase !== "fight" || state.round.winner !== -1)) {
        plan = null;
        return 0;
      }
      const fwd = me.facing === 1 ? BUTTON_RIGHT : BUTTON_LEFT;
      const back = me.facing === 1 ? BUTTON_LEFT : BUTTON_RIGHT;
      const dist = Math.abs(v.x - me.x) / 100;
      const opAir = v.y < MOVEMENT.floorY;

      // 1. Combo: a light attack that connected cancels into something heavier.
      if (me.state === "attack" && me.move?.connected && comboTried !== state.frame - me.move.tick) {
        comboTried = state.frame - me.move.tick;
        const m = me.move.id;
        if ((m === "light_punch" || m === "light_kick") && chance(lv.combo)) {
          const finisher = state.projectiles.some((p) => p.owner === player) || chance(0.5)
            ? (m === "light_punch" ? fwd | P : fwd | K)
            : S;
          return start([0, ...press(finisher)], true);
        }
      }

      // 2. Reactions (only when free to act; urgent plans are not interrupted).
      const free = actionable(me) || me.state === "blockstun";
      if (free && !(plan && plan.urgent)) {
        // Throw tech: answer a throw with a throw.
        if (v.move === "throw" && v.moveTick <= 2 && dist < 85 && lastThreat !== `t${v.frame - v.moveTick}`) {
          lastThreat = `t${v.frame - v.moveTick}`;
          if (chance(lv.tech)) return start(press(P | K), true);
        }
        // Block attacks in range and incoming projectiles.
        let threat: { key: string; height: HitHeight } | null = null;
        // The projectile special is blocked as a shot below; a teleport is guarded once it reappears.
        if (v.move && v.move !== "throw" && v.move !== "special" && !(v.move === "teleport" && v.moveTick < 16)) {
          const def = MOVES[v.move];
          const startup = firstActiveTick(def);
          if (v.moveTick <= startup + 6 && dist < REACH[v.move] + 18) threat = { key: `m${v.frame - v.moveTick}`, height: def.height };
        }
        const shot = v.shots.find((s) => Math.sign(me.x - s.x) === Math.sign(s.vx) && Math.abs(me.x - s.x) / 100 < 150);
        if (!threat && shot) threat = { key: `p${Math.round(shot.x / 3000)}`, height: "mid" };
        if (threat && threat.key !== lastThreat) {
          lastThreat = threat.key;
          if (chance(lv.block)) return start(hold(blockBits(me, threat.height), 20), true);
        }
        // Anti-air: hit a jump-in before it lands.
        if (opAir && v.state === "airborne" && dist < 95 && lastAntiAir !== v.frame - (v.frame % 30)) {
          lastAntiAir = v.frame - (v.frame % 30);
          if (chance(lv.antiAir)) return start(press(fwd | P), true);
        }
      }

      // After taking a hit or blocking, a player guards for a moment instead of mashing back.
      const stunnedNow = me.state === "hitstun" || me.state === "blockstun";
      const recovered = wasStunned && !stunnedNow && actionable(me);
      wasStunned = stunnedNow;
      if (recovered && dist < 110 && !(plan && plan.urgent) && chance(lv.block)) {
        return start(hold(blockBits(me, "mid"), between(18, 32)), true);
      }

      // 3. Air: kick on the way down when the opponent is close below.
      if (me.state === "airborne" && !me.move && dist < 80 && me.vy > 0) return press(P)[0]!;

      if (plan) return next();
      if (!actionable(me)) return 0;
      if (wait > 0) {
        wait -= 1;
        return waitBits;
      }
      wait = between(lv.gap[0], lv.gap[1]);
      waitBits = dist < 100 && chance(lv.block) ? blockBits(me, "mid") : 0;

      // 4. Mistakes (mostly Easy): something random.
      if (chance(lv.mistake)) {
        const pick = [P, K, S, U, D | K, fwd, back][between(0, 6)]!;
        return start(pick === fwd || pick === back ? hold(pick, 12) : press(pick));
      }

      // 5. Neutral, by distance.
      const opDown = v.state === "knockdown" || v.state === "ko";
      if (opDown) return start(hold(chance(0.5) ? back : 0, 16));
      const myShot = state.projectiles.some((p) => p.owner === player);
      const mySpecial = fighterInfo(me.slug).specialMove;
      if (dist > 220) {
        // Long range suits the projectile and the teleport; the charge and rush need to close in first.
        if (!myShot && (mySpecial === "special" || mySpecial === "teleport") && chance(lv.special)) return start(press(S));
        if (chance(lv.aggression)) return start(hold(fwd, between(12, 30)));
        return start(hold(chance(0.5) ? back : 0, 12));
      }
      if (dist > 110) {
        if (chance(lv.jumpIn)) return start([...hold(U | fwd, 3), ...hold(0, 10)]);
        if (!myShot && chance(lv.special * (mySpecial === "special" ? 0.5 : 1))) return start(press(S));
        if (chance(lv.aggression)) return start(hold(fwd, between(8, 20)));
        return start(hold(back, between(6, 14)));
      }
      // Close: nobody pokes into a jump on purpose (that is the anti-air decision above).
      if (opAir) return start(hold(0, 6));
      // Jabs are faster than any reaction: players guard in range by anticipation.
      const opThreatening = actionable(state.fighters[player === 0 ? 1 : 0]) || v.state === "attack";
      if (dist < 100 && opThreatening && chance(lv.block * 0.85)) return start(hold(blockBits(me, "mid"), between(14, 30)));
      // Throw a blocker, otherwise pick an attack, or step out.
      const opBlocking = v.state === "blockstun" || v.state === "walk_back" || v.state === "crouch";
      if (dist < 72 && (opBlocking || chance(0.2)) && chance(lv.throw)) return start(press(P | K));
      if (chance(1 - lv.aggression * 0.9)) return start(hold(back, between(6, 14)));
      const r = rnd();
      if (dist < 70 && r < 0.4) return start(press(P));
      if (r < 0.6) return start(press(K));
      if (r < 0.75) return start(press(D | K));
      if (r < 0.88) return start(press(fwd | K));
      return start(press(fwd | P));
    },
  };
}
