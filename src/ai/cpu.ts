// CPU opponent (spec 008, spec 016). The CPU only presses buttons: decide(state) returns an
// input bitmask, so every rule of the sim applies to it. It sees the opponent through a reaction
// delay, keeps its own seeded random generator (no Math.random), and acts through short input
// scripts ("plans") so presses produce real press edges.
//
// Buttons follow the round 3 scheme: Punch = BUTTON_LIGHT, Kick = BUTTON_HEAVY, Special.
// Punch = jab, forward+Punch = heavy punch, Kick = snap kick, forward+Kick = roundhouse,
// down+Kick = sweep, Punch+Kick = throw, Punch in the air = air kick,
// Special = signature primary special, forward+Special = signature secondary special.
import { fighterInfo, type FighterInfo } from "../data/fighters";
import { MOVEMENT } from "../data/movement";
import { firstActiveTick, MOVES, type HitHeight, type MoveId, type ProjectileKind } from "../data/moves";
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
export const REACH: Readonly<Record<MoveId, number>> = {
  // Normals & throw
  light_punch: 66,
  heavy_punch: 76,
  light_kick: 86,
  heavy_kick: 92,
  crouch_attack: 98,
  air_attack: 74,
  throw: 72,
  // Long-range projectiles & teleport
  special: 9999,
  teleport: 9999,
  packet_sniper: 9999,
  twin_thread: 9999,
  ground_fault: 9999,
  phantom_ping: 9999,
  prism_volley: 9999,
  signal_beam: 9999,
  spark_bolt: 9999,
  rail_shot: 9999,
  node_pulse: 9999,
  shadow_pivot: 9999,
  horizon_orb: 9999,
  solar_dart: 9999,
  blink_edge: 9999,
  cryo_ping: 9999,
  // Mines / traps, angled anti-air bursts & floor shockwaves (260-360)
  rate_mine: 320,
  mirage_trap: 280,
  arc_beacon: 280,
  seismic_slam: 340,
  static_tether: 310,
  pulse_beacon: 290,
  tectonic_stomp: 320,
  anchor_mine: 280,
  oasis_wave: 330,
  mirage_arc: 280,
  trap_socket: 280,
  frost_fault: 310,
  // Advancing specials, slides, flurries & overheads (155-235)
  charge: 230,
  rush: 170,
  canary_hop: 175,
  velvet_cross: 185,
  breaker_lariat: 200,
  golden_rush: 210,
  crown_dive: 185,
  cache_blink: 210,
  anvil_drop: 190,
  vector_slash: 165,
  crescent_feint: 160,
  turbo_blitz: 195,
  flash_knee: 160,
  granite_tackle: 215,
  tempest_kick: 200,
  spiral_dive: 180,
  dragon_merge: 170,
  cobalt_crush: 175,
  vortex_combo: 185,
  jet_sweep: 190,
  lotus_strike: 165,
  starlight_hop: 185,
  forge_breaker: 200,
  cascade_flurry: 190,
  fountain_dive: 175,
  gale_kick: 210,
  lightning_slide: 195,
  wild_fang: 210,
  jade_palm: 155,
  // Anti-airs / counters / command grabs (92-118)
  rising_commit: 95,
  skyline_upper: 100,
  skyward_hook: 95,
  comet_upper: 100,
  cedar_upper: 100,
  cloud_rising: 98,
  rollback_parry: 100,
  steel_counter: 105,
  mirror_step: 105,
  null_counter: 105,
  silk_parry: 100,
  iron_guard: 105,
  force_push: 115,
  titan_press: 118,
  vault_throw: 110,
  blue_shift_grab: 115,
  apex_pounce: 118,
};

const ANTI_AIR_SPECIALS: ReadonlySet<MoveId> = new Set([
  "skyline_upper",
  "rising_commit",
  "arc_beacon",
  "skyward_hook",
  "pulse_beacon",
  "comet_upper",
  "cedar_upper",
  "mirage_arc",
  "cloud_rising",
]);
const COUNTER_SPECIALS: ReadonlySet<MoveId> = new Set([
  "rollback_parry",
  "steel_counter",
  "mirror_step",
  "null_counter",
  "silk_parry",
  "iron_guard",
]);
const OVERHEAD_SPECIALS: ReadonlySet<MoveId> = new Set([
  "canary_hop",
  "velvet_cross",
  "crown_dive",
  "anvil_drop",
  "crescent_feint",
  "spiral_dive",
  "shadow_pivot",
  "cobalt_crush",
  "starlight_hop",
  "fountain_dive",
]);
const COMMAND_GRAB_SPECIALS: ReadonlySet<MoveId> = new Set([
  "force_push",
  "titan_press",
  "vault_throw",
  "blue_shift_grab",
  "apex_pounce",
]);
const MINE_SPECIALS: ReadonlySet<MoveId> = new Set([
  "rate_mine",
  "mirage_trap",
  "static_tether",
  "anchor_mine",
  "trap_socket",
]);
const LOW_SLIDE_SPECIALS: ReadonlySet<MoveId> = new Set([
  "golden_rush",
  "jet_sweep",
  "lightning_slide",
]);
/** Tick when a vanish-phase special reappears so the CPU waits to pick its block direction. */
const VANISH_REAPPEAR_TICK: Partial<Record<MoveId, number>> = {
  teleport: 16,
  cache_blink: 12,
  shadow_pivot: 15,
  blink_edge: 14,
};

function isArcAntiAir(id: MoveId): boolean {
  return MOVES[id].projectileSpec?.kind === "arc_burst";
}

function isTeleport(id: MoveId): boolean {
  return MOVES[id].reappearTick !== undefined;
}

interface SpecialOption {
  id: MoveId;
  bits: number;
}

interface ShotView {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: ProjectileKind;
}

/** What the CPU saw of the opponent on one frame. */
interface View {
  frame: number;
  x: number;
  y: number;
  vx: number;
  state: FighterState["state"];
  move: MoveId | null;
  moveTick: number;
  /** Opponent's projectiles and traps. */
  shots: ShotView[];
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

function fighterSpecials(info: FighterInfo, fwd: number): [SpecialOption, SpecialOption] {
  return [
    { id: info.specialMove, bits: S },
    { id: info.altSpecialMove, bits: fwd | S },
  ];
}

function findSpecialByRole(info: FighterInfo, fwd: number, role: ReadonlySet<MoveId>): SpecialOption | null {
  for (const opt of fighterSpecials(info, fwd)) {
    if (role.has(opt.id)) return opt;
  }
  return null;
}

/** Per-kind projectile ownership check matching combat.ts so multi-kind zoners can layer tools. */
function canUseSpecial(state: SimState, player: PlayerIndex, moveId: MoveId): boolean {
  const spec = MOVES[moveId].projectileSpec;
  if (!spec) return true;
  return !state.projectiles.some((p) => p.owner === player && (p.kind ?? "orb") === spec.kind);
}

function canCancelToSpecial(info: FighterInfo, moveId: MoveId): boolean {
  if (moveId === "light_punch" || moveId === "light_kick" || moveId === "heavy_punch") return true;
  if (moveId === "crouch_attack") return info.chainTrait !== "standard";
  if (moveId === "heavy_kick") return info.chainTrait === "heavy-cancel";
  return false;
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
      shots: state.projectiles
        .filter((p) => p.owner !== player)
        .map((p) => ({
          x: p.x,
          y: p.y,
          vx: p.vx,
          vy: p.vy ?? 0,
          kind: p.kind ?? "orb",
        })),
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
      const info = fighterInfo(me.slug);
      const fwd = me.facing === 1 ? BUTTON_RIGHT : BUTTON_LEFT;
      const back = me.facing === 1 ? BUTTON_LEFT : BUTTON_RIGHT;
      const dist = Math.abs(v.x - me.x) / 100;
      const opAir = v.y < MOVEMENT.floorY;

      // 1. Combo: a connected normal cancels into a heavier normal or either signature special.
      if (me.state === "attack" && me.move?.connected && comboTried !== state.frame - me.move.tick) {
        comboTried = state.frame - me.move.tick;
        const m = me.move.id;
        const canChainNormal = m === "light_punch" || m === "light_kick";
        if ((canChainNormal || canCancelToSpecial(info, m)) && chance(lv.combo)) {
          const comboSpecials = fighterSpecials(info, fwd).filter(
            (o) =>
              dist <= REACH[o.id] &&
              canUseSpecial(state, player, o.id) &&
              !COUNTER_SPECIALS.has(o.id) &&
              !COMMAND_GRAB_SPECIALS.has(o.id) &&
              !MINE_SPECIALS.has(o.id) &&
              !isArcAntiAir(o.id) &&
              !isTeleport(o.id),
          );
          const pickSpecial = comboSpecials.length > 0;
          if (canChainNormal && (!pickSpecial || chance(0.5))) {
            const finisher = m === "light_punch" ? fwd | P : fwd | K;
            return start([0, ...press(finisher)], true);
          }
          if (pickSpecial) {
            const chosen = comboSpecials[between(0, comboSpecials.length - 1)]!;
            return start([0, ...press(chosen.bits)], true);
          }
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

        // Jump clear of an unblockable command grab.
        if (v.move && COMMAND_GRAB_SPECIALS.has(v.move)) {
          const grabTick = MOVES[v.move].commandGrabTick ?? 10;
          if (v.moveTick <= grabTick && dist < REACH[v.move] + 15 && lastThreat !== `cg${v.frame - v.moveTick}`) {
            lastThreat = `cg${v.frame - v.moveTick}`;
            if (chance(lv.block)) return start([...hold(U | back, 3), ...hold(0, 8)], true);
          }
        }

        // Block (or counter) melee attacks in range and react to incoming projectiles / traps.
        let threat: { key: string; height: HitHeight; melee: boolean } | null = null;
        const vanishEnd = v.move ? VANISH_REAPPEAR_TICK[v.move] : undefined;
        const hiddenVanish = vanishEnd !== undefined && v.moveTick < vanishEnd;
        if (v.move && v.move !== "throw" && !COMMAND_GRAB_SPECIALS.has(v.move) && !hiddenVanish) {
          const def = MOVES[v.move];
          const startup = firstActiveTick(def);
          const inCounterStance = def.counterJumpTick !== undefined && v.moveTick < def.counterJumpTick;
          // Pure projectile moves are guarded via v.shots; hybrid melee+wave moves only threaten melee up close.
          if (startup >= 0 && !inCounterStance) {
            const meleeReach = def.projectileTick !== undefined ? 85 : REACH[v.move];
            if (v.moveTick <= startup + 6 && dist < meleeReach + 18) {
              threat = { key: `m${v.frame - v.moveTick}`, height: def.height, melee: true };
            }
          }
        }

        if (!threat) {
          // Stationary mines ahead: evade or jump over rather than walking blindly into them on Normal/Hard.
          if (lv.block >= 0.3) {
            const mine = v.shots.find(
              (s) => s.vx === 0 && Math.sign(s.x - me.x) === me.facing && Math.abs(me.x - s.x) / 100 < 78,
            );
            if (mine) {
              const mineKey = `mine${Math.round(mine.x / 3000)}`;
              if (mineKey !== lastThreat) {
                lastThreat = mineKey;
                const mineGap = Math.abs(me.x - mine.x) / 100;
                if (mineGap >= 38 && dist > 95 && chance(0.55)) {
                  return start([...hold(U | fwd, 3), ...hold(0, 10)], true);
                }
                return start(hold(back, 12), true);
              }
            }
          }

          // Moving projectiles heading toward the CPU.
          const shot = v.shots.find(
            (s) =>
              s.vx !== 0 &&
              Math.sign(me.x - s.x) === Math.sign(s.vx) &&
              Math.abs(me.x - s.x) / 100 < 160 &&
              !(s.vy < 0 && s.y < -15000),
          );
          if (shot) {
            const key = `p${Math.round(shot.x / 3000)}`;
            if (shot.kind === "shockwave") {
              if (key !== lastThreat) {
                lastThreat = key;
                const gap = Math.abs(me.x - shot.x) / 100;
                if (gap > 50 && gap < 135 && lv.block >= 0.3 && chance(0.55)) {
                  return start([...hold(U | fwd, 3), ...hold(0, 10)], true);
                }
                if (chance(lv.block)) return start(hold(blockBits(me, "low"), 20), true);
              }
            } else {
              threat = { key, height: "mid", melee: false };
            }
          }
        }

        if (threat && threat.key !== lastThreat) {
          lastThreat = threat.key;
          const counterOpt = threat.melee && dist < 95 && lv.block >= 0.3
            ? findSpecialByRole(info, fwd, COUNTER_SPECIALS)
            : null;
          if (counterOpt && chance(lv.special * 0.5)) return start(press(counterOpt.bits), true);
          if (chance(lv.block)) return start(hold(blockBits(me, threat.height), 20), true);
        }

        // Anti-air: hit a jump-in before it lands using anti-air specials on Normal/Hard or heavy punch.
        const aaOpt = findSpecialByRole(info, fwd, ANTI_AIR_SPECIALS);
        const aaArc = aaOpt ? isArcAntiAir(aaOpt.id) : false;
        const aaRange = aaArc ? 260 : 95;
        if (opAir && v.state === "airborne" && dist < aaRange && lastAntiAir !== v.frame - (v.frame % 30)) {
          lastAntiAir = v.frame - (v.frame % 30);
          if (chance(lv.antiAir)) {
            if (
              aaOpt &&
              lv.antiAir >= 0.3 &&
              dist <= REACH[aaOpt.id] &&
              canUseSpecial(state, player, aaOpt.id) &&
              (!aaArc || dist >= 55)
            ) {
              return start(press(aaOpt.bits), true);
            }
            if (dist < 95) return start(press(fwd | P), true);
          }
        }
      }

      // After taking a hit or blocking, a player guards for a moment instead of mashing back.
      const stunnedNow = me.state === "hitstun" || me.state === "blockstun";
      const recovered = wasStunned && !stunnedNow && actionable(me);
      wasStunned = stunnedNow;
      if (recovered && dist < 110 && !(plan && plan.urgent) && chance(lv.block)) {
        return start(hold(blockBits(me, "mid"), between(18, 32)), true);
      }

      // 3. Air: attack on the way down when the opponent is close below.
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

      const mineAhead =
        lv.block >= 0.3 &&
        v.shots.some((s) => s.vx === 0 && Math.sign(s.x - me.x) === me.facing && Math.abs(me.x - s.x) / 100 < 90);
      const isZoner = info.archetype === "zoner";
      const specialChance = isZoner ? Math.min(0.75, lv.special * 1.4) : lv.special;
      const specials = fighterSpecials(info, fwd);

      if (dist > 220) {
        const longSpecials = specials.filter(
          (o) =>
            dist <= REACH[o.id] &&
            canUseSpecial(state, player, o.id) &&
            !ANTI_AIR_SPECIALS.has(o.id) &&
            !COUNTER_SPECIALS.has(o.id) &&
            !COMMAND_GRAB_SPECIALS.has(o.id),
        );
        if (longSpecials.length > 0 && chance(specialChance)) {
          const mineOpt = longSpecials.find((o) => MINE_SPECIALS.has(o.id));
          const pick = mineOpt && chance(0.55) ? mineOpt : longSpecials[between(0, longSpecials.length - 1)]!;
          return start(press(pick.bits));
        }
        if (!mineAhead && chance(isZoner ? lv.aggression * 0.55 : lv.aggression)) {
          return start(hold(fwd, between(12, 30)));
        }
        return start(hold(chance(0.5) ? back : 0, 12));
      }

      if (dist > 110) {
        if (!mineAhead && chance(lv.jumpIn)) return start([...hold(U | fwd, 3), ...hold(0, 10)]);
        const midSpecials = specials.filter(
          (o) =>
            dist <= REACH[o.id] &&
            canUseSpecial(state, player, o.id) &&
            !ANTI_AIR_SPECIALS.has(o.id) &&
            !COUNTER_SPECIALS.has(o.id) &&
            !COMMAND_GRAB_SPECIALS.has(o.id),
        );
        if (midSpecials.length > 0) {
          const onlyDataOrb = midSpecials.length === 1 && midSpecials[0]!.id === "special";
          if (chance(specialChance * (onlyDataOrb ? 0.5 : 1))) {
            const mineOpt = midSpecials.find((o) => MINE_SPECIALS.has(o.id));
            const pick = mineOpt && chance(0.5) ? mineOpt : midSpecials[between(0, midSpecials.length - 1)]!;
            return start(press(pick.bits));
          }
        }
        if (!mineAhead && chance(isZoner ? lv.aggression * 0.65 : lv.aggression)) {
          return start(hold(fwd, between(8, 20)));
        }
        return start(hold(back, between(6, 14)));
      }

      // Close: nobody pokes into a jump on purpose (that is the anti-air decision above).
      if (opAir) return start(hold(0, 6));
      // Counters bait close-range attacks on Normal/Hard.
      const opThreatening = actionable(state.fighters[player === 0 ? 1 : 0]) || v.state === "attack";
      const counterOpt = findSpecialByRole(info, fwd, COUNTER_SPECIALS);
      if (counterOpt && lv.block >= 0.3 && opThreatening && dist <= 95 && chance(lv.special * 0.45)) {
        return start(press(counterOpt.bits));
      }

      // Jabs are faster than any reaction: players guard in range by anticipation.
      if (dist < 100 && opThreatening && chance(lv.block * 0.85)) return start(hold(blockBits(me, "mid"), between(14, 30)));

      // Command grab / throw / overhead special mixups against blocking or close opponents.
      const opBlocking = v.state === "blockstun" || v.state === "walk_back" || v.state === "crouch";
      const grabOpt = findSpecialByRole(info, fwd, COMMAND_GRAB_SPECIALS);
      if (grabOpt && dist <= REACH[grabOpt.id] && (opBlocking || chance(0.25)) && chance(lv.throw * 1.15)) {
        return start(press(grabOpt.bits));
      }
      if (dist < 72 && (opBlocking || chance(0.2)) && chance(lv.throw)) return start(press(P | K));

      const overheadOpt = findSpecialByRole(info, fwd, OVERHEAD_SPECIALS);
      if (overheadOpt && opBlocking && dist <= REACH[overheadOpt.id] && chance(lv.special * 1.2 + 0.15)) {
        return start(press(overheadOpt.bits));
      }
      const lowSlideOpt = findSpecialByRole(info, fwd, LOW_SLIDE_SPECIALS);
      if (lowSlideOpt && !opBlocking && dist > 65 && dist <= REACH[lowSlideOpt.id] && chance(lv.special * 0.35)) {
        return start(press(lowSlideOpt.bits));
      }

      if (mineAhead || chance(1 - lv.aggression * 0.9)) return start(hold(back, between(6, 14)));
      const r = rnd();
      if (dist < 70 && r < 0.4) return start(press(P));
      if (r < 0.6) return start(press(K));
      if (r < 0.75) return start(press(D | K));
      if (r < 0.88) return start(press(fwd | K));
      return start(press(fwd | P));
    },
  };
}
