// Effects layer (spec 004, R4-R6): generated effect animations played at the
// point of contact of sim events, screen shake, a white flash on the defender,
// a camera nudge toward big hits, and a reduced-effects switch. Effects only
// read sim events and state; they keep their own render-time clocks.
import { COMBAT } from "../data/combat";
import { MOVEMENT } from "../data/movement";
import { firstActiveTick, MOVES, type MoveId, type Segment } from "../data/moves";
import { SUBPX } from "../sim/fixed";
import type { FighterState, SimEvent, SimState } from "../sim/types";
import type { Camera } from "./camera";
import type { AtlasImage, Clip, ClipLoaderDeps } from "./clips";
import { artUrl, browserClipDeps, clipFrameIndex, parseManifest } from "./clips";
import { drawGuardBreakMarker, drawOverlay, type GuardBreakMarker, type Overlay, type OverlayKind } from "./effectsOverlays";
import type { DefensiveReaction, PoseOptions } from "./signatureMotion";

export interface EffectAtlas {
  atlas: AtlasImage;
  clips: Record<string, Clip>;
}

const EFFECTS_DIR = "./effects";

export async function loadEffects(deps: ClipLoaderDeps = browserClipDeps()): Promise<EffectAtlas | null> {
  const json = await deps.fetchJson(`${EFFECTS_DIR}/manifest.json`);
  if (!json) return null;
  try {
    const m = parseManifest(json);
    return { atlas: await deps.loadImage(artUrl(EFFECTS_DIR, m.atlas, m.version)), clips: m.clips };
  } catch (err) {
    deps.warn(`effects unusable: ${String(err)}`);
    return null;
  }
}

interface Live {
  clip: string;
  /** Stage pixels. */
  x: number;
  y: number;
  facing: 1 | -1;
  age: number;
  additive: boolean;
  scale: number;
}

/** The segment showing at `tick` and the tick it started on. */
function segmentStart(segments: readonly Segment[], tick: number): { segment: Segment; start: number } {
  let t = 0;
  for (const segment of segments) {
    if (tick < t + segment.ticks) return { segment, start: t };
    t += segment.ticks;
  }
  const last = segments[segments.length - 1]!;
  return { segment: last, start: t - last.ticks };
}

/** Shake amplitude in pixels by hit strength. */
export const SHAKE = Object.freeze({ light: 2, heavy: 4, special: 4, ko: 8, decayFrames: 10 });

const CHARGE_STREAK_MOVES = new Set<MoveId>([
  "charge",
  "breaker_lariat",
  "anvil_drop",
  "granite_tackle",
  "cobalt_crush",
  "forge_breaker",
  "dragon_merge",
  "jade_palm",
  "lotus_strike",
  "pipeline_crush",
]);
const RUSH_STREAK_MOVES = new Set<MoveId>([
  "rush",
  "golden_rush",
  "velvet_cross",
  "canary_hop",
  "crown_dive",
  "cache_blink",
  "vector_slash",
  "crescent_feint",
  "turbo_blitz",
  "flash_knee",
  "tempest_kick",
  "spiral_dive",
  "shadow_pivot",
  "vortex_combo",
  "starlight_hop",
  "cascade_flurry",
  "fountain_dive",
  "blink_edge",
  "gale_kick",
  "wild_fang",
  "quant_counter",
]);
const UPPERCUT_MOVES = new Set<MoveId>([
  "rising_commit",
  "skyline_upper",
  "steel_counter",
  "skyward_hook",
  "mirror_step",
  "comet_upper",
  "null_counter",
  "silk_parry",
  "iron_guard",
  "cedar_upper",
  "cloud_rising",
]);
const SLAM_MOVES = new Set<MoveId>(["seismic_slam", "ground_fault", "tectonic_stomp", "oasis_wave", "frost_fault"]);
const SLIDE_DUST_MOVES = new Set<MoveId>(["golden_rush", "jet_sweep", "lightning_slide"]);
const COMMAND_GRAB_MOVES = new Set<MoveId>(["force_push", "titan_press", "vault_throw", "blue_shift_grab", "apex_pounce", "schema_lock"]);

const SIGNATURE_FOLLOW_MOVES = new Set<MoveId>(["charge", "teleport", "rush"]);

interface ReactionTimer {
  kind: "perfect_shield" | "throw_tech";
  ticks: number;
}

export class EffectsLayer {
  private live: Live[] = [];
  private overlays: Overlay[] = [];
  private guardBreakMarkers: [GuardBreakMarker | null, GuardBreakMarker | null] = [null, null];
  private reactions: [ReactionTimer | null, ReactionTimer | null] = [null, null];
  private shakeAmp = 0;
  private shakeAge = 0;
  private nudge = 0;
  /** Last move + tick each fighter's trail was spawned for (prevents duplicate spawns during hitstop). */
  private lastMove: [{ id: MoveId; tick: number } | null, { id: MoveId; tick: number } | null] = [null, null];
  /** Fighters to draw white this frame, with frames left. */
  readonly flash: [number, number] = [0, 0];
  /** Full-screen white flash frames left (K.O.). */
  screenFlash = 0;
  reduced: boolean;

  constructor(private readonly fx: EffectAtlas | null, reduced = false) {
    this.reduced = reduced;
  }

  private spawn(clip: string, x: number, y: number, facing: 1 | -1, additive = true, scale = 1): void {
    if (!this.fx?.clips[clip]) return;
    this.live.push({ clip, x: x / SUBPX, y: y / SUBPX, facing, age: 0, additive, scale });
  }

  private addOverlay(
    kind: OverlayKind,
    x: number,
    y: number,
    facing: 1 | -1,
    life: number,
    color: string,
    accent?: string,
    dx?: number,
  ): void {
    this.overlays.push({
      kind,
      x: x / SUBPX,
      y: y / SUBPX,
      facing,
      age: 0,
      life,
      color,
      accent,
      dx,
      reduced: this.reduced,
    });
  }

  private shake(amp: number, toward = 0): void {
    if (this.reduced) return;
    if (amp >= this.shakeAmp * (1 - this.shakeAge / SHAKE.decayFrames)) {
      this.shakeAmp = amp;
      this.shakeAge = 0;
    }
    this.nudge = toward;
  }

  /** Reacts to the events of one sim step. */
  onEvents(events: readonly SimEvent[], state: SimState): void {
    for (const e of events) {
      switch (e.type) {
        case "hit": {
          const big = e.strength !== "light";
          const target = state.fighters[e.target];
          const moveDef = MOVES[e.move];
          if (moveDef?.projectileTick !== undefined) {
            if (moveDef.projectileSpec?.kind === "shockwave") {
              this.spawn("dust", e.x, MOVEMENT.floorY, target.facing, false, 0.9);
            }
            this.spawn("orb_burst", e.x, e.y, target.facing);
          }
          this.spawn(big ? "hit_heavy" : "hit_light", e.x, e.y, (-target.facing) as 1 | -1);
          this.shake(big ? SHAKE.heavy : SHAKE.light, big ? Math.sign(target.x - state.fighters[e.player].x) * 3 : 0);
          if (!this.reduced) {
            this.flash[e.target] = 2;
            const attacker = state.fighters[e.player];
            if (e.move === "charge") {
              this.addOverlay("impact_ring", e.x, e.y, attacker.facing, 12, "#ffb347", "#ffffff");
            } else if (e.move === "teleport") {
              this.addOverlay("impact_ring", e.x, e.y, attacker.facing, 11, "#b388ff", "#7cf4ff");
            } else if (e.move === "rush" && attacker.move && attacker.move.tick >= 21) {
              this.addOverlay("impact_ring", e.x, e.y, attacker.facing, 12, "#7ef9ff", "#ffe680");
            }
          }
          break;
        }
        case "projectile": {
          const facing = state.fighters[e.player].facing;
          if (e.kind === "shockwave") {
            this.spawn("dust", e.x, MOVEMENT.floorY, facing, false, 0.8);
          } else {
            this.spawn("hit_light", e.x, e.y, facing, true, 0.65);
          }
          break;
        }
        case "block":
          this.spawn("block", e.x, e.y, state.fighters[e.target].facing === 1 ? 1 : -1);
          this.shake(1);
          break;
        case "clash":
          this.spawn("orb_burst", e.x, e.y, 1);
          this.spawn("orb_burst", e.x, e.y, -1);
          this.shake(SHAKE.light);
          break;
        case "tech":
          this.reactions[0] = { kind: "throw_tech", ticks: COMBAT.pushFrames };
          this.reactions[1] = { kind: "throw_tech", ticks: COMBAT.pushFrames };
          if (this.reduced) {
            this.spawn("block", e.x - 1200, e.y, -1, false, 0.85);
            this.spawn("block", e.x + 1200, e.y, 1, false, 0.85);
            this.addOverlay("tech_reduced", e.x, e.y, 1, 18, "#7fd6ff", "#0d0c22");
          } else {
            this.spawn("block", e.x - 1200, e.y, -1);
            this.spawn("block", e.x + 1200, e.y, 1);
            this.spawn("hit_light", e.x, e.y, 1, true, 0.9);
            this.spawn("dust", e.x - 1800, MOVEMENT.floorY, -1, false, 0.7);
            this.spawn("dust", e.x + 1800, MOVEMENT.floorY, 1, false, 0.7);
            this.addOverlay("tech_full", e.x, e.y, 1, 14, "#7fd6ff", "#ffffff");
            this.shake(SHAKE.light);
          }
          break;
        case "knockdown":
          this.spawn("dust", e.x, MOVEMENT.floorY, 1, false, 1);
          this.spawn("dust", e.x - 2400, MOVEMENT.floorY, -1, false, 1);
          this.shake(SHAKE.light);
          break;
        case "land":
          this.spawn("dust", state.fighters[e.player].x, MOVEMENT.floorY, 1, false, 0.6);
          break;
        case "dash": {
          // Dust kicked up behind the feet.
          const f = state.fighters[e.player];
          const behind = (-f.facing * e.dir) as 1 | -1;
          this.spawn("dust", e.x + behind * 1800, MOVEMENT.floorY, behind, false, 0.7);
          break;
        }
        case "teleport": {
          this.spawn(e.phase === "out" ? "teleport_out" : "teleport_in", e.x, MOVEMENT.floorY, 1, !this.reduced, 1);
          const caster = state.fighters[e.player];
          if (e.phase === "out") {
            const opp = state.fighters[e.player === 0 ? 1 : 0];
            const rawDx = Math.round((opp.x - e.x) / SUBPX);
            const dx = Math.max(-140, Math.min(140, rawDx));
            this.addOverlay("phase_streak", e.x, caster.y - 7600, caster.facing, 10, "#6ef3ff", "#b388ff", dx);
          } else if (!this.reduced) {
            this.addOverlay("impact_ring", e.x, caster.y - 7600, caster.facing, 10, "#7cf4ff", "#b388ff");
          }
          break;
        }
        case "wall_bounce":
          this.spawn("hit_heavy", e.x, e.y, (e.x < MOVEMENT.stageWidth / 2 ? 1 : -1) as 1 | -1, true, 1.2);
          this.spawn("dust", e.x, e.y + 4000, 1, false, 0.8);
          this.shake(SHAKE.heavy);
          if (!this.reduced) this.flash[e.player] = 2;
          break;
        case "armor":
          // The armor takes the hit: a shield flash on the charging fighter.
          this.spawn("block", e.x, e.y, state.fighters[e.player].facing, true, 1.2);
          this.shake(SHAKE.light);
          if (!this.reduced) this.flash[e.player] = 3;
          break;
        case "counter": {
          const facing = state.fighters[e.player].facing;
          this.spawn("block", e.x, e.y, facing);
          this.spawn("hit_heavy", e.x, e.y, facing);
          this.shake(SHAKE.heavy);
          if (!this.reduced) this.flash[e.player] = 3;
          break;
        }
        case "block_push": {
          const toward = (state.fighters[e.target].x >= state.fighters[e.player].x ? 1 : -1) as 1 | -1;
          this.spawn("rush_streaks", e.x, e.y, toward, true, 0.6);
          this.spawn("block", e.x, e.y, toward, true, 1);
          this.shake(1);
          break;
        }
        case "perfect_block": {
          this.reactions[e.player] = { kind: "perfect_shield", ticks: 12 };
          const facing = state.fighters[e.player].facing;
          if (this.reduced) {
            this.spawn("block", e.x, e.y, facing, false, 1.0);
            this.addOverlay("perfect_shield_reduced", e.x, e.y, facing, 18, "#4ef2ff", "#0d0c22");
          } else {
            this.spawn("block", e.x, e.y, facing, true, 1.35);
            this.spawn("orb_burst", e.x, e.y, facing, true, 0.9);
            this.addOverlay("perfect_shield_full", e.x, e.y, facing, 14, "#4ef2ff", "#ffffff");
            this.shake(SHAKE.light);
            this.flash[e.player] = 3;
          }
          break;
        }
        case "guard_break": {
          this.reactions[e.player] = null;
          const facing = state.fighters[e.player].facing;
          if (this.reduced) {
            this.spawn("hit_heavy", e.x, e.y, facing, false, 1.0);
            this.addOverlay("guard_break_reduced", e.x, e.y, facing, 24, "#ff4d6d", "#0d0c22");
          } else {
            this.spawn("hit_heavy", e.x, e.y, facing, true, 1.35);
            this.spawn("orb_burst", e.x, e.y, (-facing) as 1 | -1, true, 1.2);
            this.spawn("dust", state.fighters[e.player].x, MOVEMENT.floorY, facing, false, 0.95);
            this.addOverlay("guard_break_full", e.x, e.y, facing, 20, "#ff4d6d", "#ffab4c");
            this.shake(SHAKE.heavy);
            this.flash[e.player] = 4;
          }
          break;
        }
        case "callout":
          break;
        case "roll":
          this.spawn("dust", state.fighters[e.player].x, MOVEMENT.floorY, 1, false, 0.6);
          break;
        case "ko":
          this.reactions = [null, null];
          this.spawn("hit_heavy", e.x, e.y - 9000, 1);
          this.shake(SHAKE.ko);
          if (!this.reduced) this.screenFlash = 6;
          break;
        case "round_start":
          this.reactions = [null, null];
          break;
      }
    }
  }

  /**
   * Trails that follow a special while it runs, read from sim state every step:
   * armored charge streaks, fast rush/blink/glide streaks, rising uppercut arcs, and slam/slide dust.
   */
  follow(state: SimState): void {
    state.fighters.forEach((f, i) => {
      this.guardBreakMarkers[i] =
        f.state === "guard_break"
          ? { x: f.x / SUBPX, y: (f.y - 14800) / SUBPX, stateFrame: f.stateFrame }
          : null;
      const rx = this.reactions[i];
      if (rx) {
        const valid =
          rx.kind === "perfect_shield"
            ? f.state === "blockstun" || f.state === "airborne"
            : f.state === "idle";
        if (!valid) this.reactions[i] = null;
      }
      const m = f.move;
      if (!m) {
        this.lastMove[i] = null;
        return;
      }
      const isTrailMove =
        SIGNATURE_FOLLOW_MOVES.has(m.id) ||
        CHARGE_STREAK_MOVES.has(m.id) ||
        RUSH_STREAK_MOVES.has(m.id) ||
        UPPERCUT_MOVES.has(m.id) ||
        SLAM_MOVES.has(m.id) ||
        SLIDE_DUST_MOVES.has(m.id) ||
        COMMAND_GRAB_MOVES.has(m.id);
      if (!isTrailMove) {
        this.lastMove[i] = null;
        return;
      }
      const prev = this.lastMove[i];
      if (prev && prev.id === m.id && prev.tick === m.tick) return; // same move tick (frozen in hitstop)
      this.lastMove[i] = { id: m.id, tick: m.tick };
      const def = MOVES[m.id];
      const { segment, start } = segmentStart(def.segments, m.tick);
      if (SIGNATURE_FOLLOW_MOVES.has(m.id)) {
        this.followSignatureMove(f, m.id, m.tick, segment, start);
      }
      if (m.id === "rush" && segment.launch && m.tick === start) {
        this.spawn("uppercut_arc", f.x + f.facing * 2400, f.y - 10000, f.facing);
        return;
      }
      if (UPPERCUT_MOVES.has(m.id) && segment.active && m.tick === firstActiveTick(def)) {
        this.spawn("uppercut_arc", f.x + f.facing * 2400, f.y - 10000, f.facing);
      }
      if (
        SLAM_MOVES.has(m.id) &&
        ((segment.active && m.tick === start) ||
          (firstActiveTick(def) === -1 && m.tick === def.projectileTick))
      ) {
        this.spawn("dust", f.x + f.facing * 2400, MOVEMENT.floorY, f.facing, false, 0.8);
      }
      if (COMMAND_GRAB_MOVES.has(m.id) && m.grabbed && m.tick === def.tossTick) {
        this.spawn("dust", f.x + f.facing * 3200, MOVEMENT.floorY, f.facing, false, 0.9);
      }
      if (!segment.vx) return;
      if (CHARGE_STREAK_MOVES.has(m.id) && (m.tick - start) % 4 === 0) {
        this.spawn("charge_streaks", f.x - f.facing * 3000, f.y - 6500, f.facing, true, 0.9);
      }
      if (RUSH_STREAK_MOVES.has(m.id) && segment.vx >= 260 && (m.tick - start) % 3 === 0) {
        this.spawn("rush_streaks", f.x - f.facing * 2600, f.y - 8500, f.facing, true, 0.8);
      }
      if (SLIDE_DUST_MOVES.has(m.id) && segment.vx >= 300 && (m.tick - start) % 3 === 0) {
        this.spawn("dust", f.x - f.facing * 1200, MOVEMENT.floorY, f.facing, false, 0.65);
      }
    });
  }

  private followSignatureMove(
    f: SimState["fighters"][number],
    moveId: MoveId,
    tick: number,
    segment: Segment,
    start: number,
  ): void {
    if (moveId === "charge") {
      if (tick === 4) {
        this.spawn("dust", f.x - f.facing * 2000, MOVEMENT.floorY, (-f.facing) as 1 | -1, false, 0.75);
        this.addOverlay("armor_brace", f.x, f.y - 7200, f.facing, 6, this.reduced ? "#d89b3c" : "#ffb347");
      } else if (tick === 10) {
        this.spawn("dust", f.x - f.facing * 2200, MOVEMENT.floorY, (-f.facing) as 1 | -1, false, 0.85);
      } else if (tick === 24) {
        this.spawn("dust", f.x + f.facing * 2800, MOVEMENT.floorY, f.facing, false, 0.85);
      }
      if (tick >= 10 && tick <= 23) {
        const emitSmear = this.reduced ? tick === start : (tick - start) % 2 === 0;
        if (emitSmear) {
          this.addOverlay("charge_smear", f.x, f.y - 7200, f.facing, 6, this.reduced ? "#d89b3c" : "#ffb347", "#fff3c4");
        }
      }
      return;
    }

    if (moveId === "teleport") {
      if (tick === 4) {
        this.addOverlay("phase_collapse", f.x, f.y - 7800, f.facing, 6, "#7cf4ff", "#b388ff");
      } else if (tick === 23) {
        this.addOverlay("overhead_arc", f.x, f.y - 8200, f.facing, 8, "#7cf4ff", "#b388ff");
      }
      return;
    }

    if (moveId === "rush") {
      if (tick === 0) {
        this.spawn("dust", f.x - f.facing * 1200, MOVEMENT.floorY, (-f.facing) as 1 | -1, false, 0.55);
      } else if (tick === 3) {
        this.spawn("dust", f.x - f.facing * 1800, MOVEMENT.floorY, (-f.facing) as 1 | -1, false, 0.75);
        this.addOverlay("rush_smear", f.x, f.y - 8200, f.facing, 5, this.reduced ? "#58b8d8" : "#7ef9ff", "#ffffff");
      } else if (tick === 8 || tick === 11 || tick === 14) {
        const yOff = tick === 11 ? 10600 : tick === 14 ? 9200 : 9800;
        this.addOverlay("rush_smear", f.x, f.y - yOff, f.facing, 5, this.reduced ? "#58b8d8" : "#7ef9ff", "#ffffff");
      } else if (tick === 21 && segment.launch) {
        this.spawn("dust", f.x + f.facing * 1400, MOVEMENT.floorY, f.facing, false, 0.8);
        this.addOverlay("uppercut_wind", f.x, f.y - 9600, f.facing, 10, "#7ef9ff", "#ffe680");
      }
    }
  }

  /** Advances render-time clocks by one animation frame. */
  tick(): void {
    for (const l of this.live) l.age += 1;
    this.live = this.live.filter((l) => {
      const clip = this.fx!.clips[l.clip]!;
      let total = 0;
      for (const f of clip.frames) total += f.hold;
      return l.age < total;
    });
    for (const o of this.overlays) o.age += 1;
    this.overlays = this.overlays.filter((o) => o.age < o.life);
    for (const i of [0, 1] as const) {
      const rx = this.reactions[i];
      if (rx) {
        rx.ticks -= 1;
        if (rx.ticks <= 0) this.reactions[i] = null;
      }
    }
    if (this.shakeAge < SHAKE.decayFrames) this.shakeAge += 1;
    this.nudge *= 0.8;
    if (Math.abs(this.nudge) < 0.5) this.nudge = 0;
    for (const i of [0, 1] as const) if (this.flash[i] > 0) this.flash[i] -= 1;
    if (this.screenFlash > 0) this.screenFlash -= 1;
  }

  /** Current shake amplitude (pixels); 0 once decayed. */
  get amplitude(): number {
    if (this.reduced || this.shakeAge >= SHAKE.decayFrames) return 0;
    return this.shakeAmp * (1 - this.shakeAge / SHAKE.decayFrames);
  }

  /** Camera offset for this frame: shake (alternating sides) plus the nudge. */
  cameraOffset(frame: number): { x: number; y: number } {
    const a = this.amplitude;
    const sx = a === 0 ? 0 : Math.round(a) * (frame % 2 === 0 ? 1 : -1);
    const sy = a === 0 ? 0 : Math.round(a / 2) * (frame % 4 < 2 ? 1 : -1);
    return { x: sx + Math.round(this.nudge), y: sy };
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.fx) {
      for (const l of this.live) {
        const clip = this.fx.clips[l.clip]!;
        const f = clip.frames[clipFrameIndex(clip, l.age)]!;
        const w = Math.round(f.w * l.scale);
        const h = Math.round(f.h * l.scale);
        const ax = Math.round(f.ax * l.scale);
        const ay = Math.round(f.ay * l.scale);
        const sx = Math.round(l.x) - camera.x;
        const sy = Math.round(l.y) - camera.y;
        ctx.save();
        if (l.additive) ctx.globalCompositeOperation = "lighter";
        ctx.translate(sx, sy);
        if (l.facing === -1) ctx.scale(-1, 1);
        ctx.drawImage(this.fx.atlas, f.x, f.y, f.w, f.h, -ax, -ay, w, h);
        ctx.restore();
      }
    }
    for (const o of this.overlays) drawOverlay(ctx, o, camera);
    for (const marker of this.guardBreakMarkers) {
      if (marker) drawGuardBreakMarker(ctx, marker, camera, this.reduced);
    }
  }

  /** Projectiles, drawn from sim state (their animation follows the sim frame). */
  drawProjectiles(ctx: CanvasRenderingContext2D, state: SimState, camera: Camera): void {
    const orbClip = this.fx?.clips.orb;
    if (!this.fx || !orbClip) {
      for (const p of state.projectiles) {
        const sx = Math.round(p.x / SUBPX) - camera.x;
        const sy = Math.round(p.y / SUBPX) - camera.y;
        const kind = p.kind ?? "orb";
        switch (kind) {
          case "fast_packet":
            ctx.fillStyle = "#7ff";
            ctx.fillRect?.(sx - 12, sy - 4, 24, 8);
            ctx.fillStyle = "#ffe680";
            ctx.fillRect?.(sx - 6, sy - 2, 12, 4);
            break;
          case "slow_mine": {
            const pulse = Math.abs((state.frame % 16) - 8) < 4 ? 10 : 8;
            ctx.fillStyle = "#f9c";
            ctx.fillRect?.(sx - pulse, sy - pulse, pulse * 2, pulse * 2);
            break;
          }
          case "shockwave":
            ctx.fillStyle = "#fb5";
            ctx.fillRect?.(sx - 16, sy - 4, 32, 8);
            break;
          case "arc_burst":
            ctx.fillStyle = "#8ef";
            ctx.fillRect?.(sx - 7, sy - 11, 14, 22);
            break;
          default:
            ctx.fillStyle = "#7ff";
            ctx.fillRect?.(sx - 8, sy - 8, 16, 16);
            break;
        }
      }
      return;
    }

    const orbFrame = orbClip.frames[clipFrameIndex(orbClip, state.frame)];
    if (!orbFrame) return;
    for (const p of state.projectiles) {
      const sx = Math.round(p.x / SUBPX) - camera.x;
      const sy = Math.round(p.y / SUBPX) - camera.y;
      const kind = p.kind ?? "orb";
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(sx, sy);
      if (p.vx < 0) ctx.scale(-1, 1);

      switch (kind) {
        case "fast_packet":
          ctx.scale(1.45, 0.7);
          ctx.drawImage(this.fx.atlas, orbFrame.x, orbFrame.y, orbFrame.w, orbFrame.h, -orbFrame.ax, -orbFrame.ay, orbFrame.w, orbFrame.h);
          ctx.fillStyle = "#7ff";
          ctx.fillRect?.(-12, -2, 24, 4);
          ctx.fillStyle = "#ffe680";
          ctx.fillRect?.(-6, -1, 14, 2);
          break;
        case "slow_mine": {
          const pulse = 0.85 + 0.25 * (1 - Math.abs((state.frame % 16) - 8) / 8);
          ctx.scale(pulse, pulse);
          ctx.drawImage(this.fx.atlas, orbFrame.x, orbFrame.y, orbFrame.w, orbFrame.h, -orbFrame.ax, -orbFrame.ay, orbFrame.w, orbFrame.h);
          ctx.fillStyle = "#f9c";
          ctx.fillRect?.(-14, -2, 3, 4);
          ctx.fillRect?.(11, -2, 3, 4);
          ctx.fillRect?.(-2, -14, 4, 3);
          ctx.fillRect?.(-2, 11, 4, 3);
          break;
        }
        case "shockwave": {
          const dustClip = this.fx.clips.dust;
          const sc = dustClip ?? orbClip;
          const f = sc.frames[clipFrameIndex(sc, state.frame)] ?? orbFrame;
          if (dustClip) {
            ctx.scale(1.0, 0.7);
          } else {
            ctx.scale(1.35, 0.55);
          }
          ctx.drawImage(this.fx.atlas, f.x, f.y, f.w, f.h, -f.ax, -f.ay, f.w, f.h);
          ctx.fillStyle = "#fb5";
          ctx.fillRect?.(-16, 2, 32, 4);
          break;
        }
        case "arc_burst": {
          const arcClip = this.fx.clips.uppercut_arc;
          const f = arcClip?.frames[clipFrameIndex(arcClip, state.frame)];
          if (f) {
            ctx.scale(0.55, 0.55);
            ctx.rotate?.(-0.35);
            ctx.drawImage(this.fx.atlas, f.x, f.y, f.w, f.h, -f.ax, -f.ay, f.w, f.h);
          } else {
            ctx.rotate?.(-0.5);
            ctx.scale(1.15, 0.85);
            ctx.drawImage(this.fx.atlas, orbFrame.x, orbFrame.y, orbFrame.w, orbFrame.h, -orbFrame.ax, -orbFrame.ay, orbFrame.w, orbFrame.h);
          }
          break;
        }
        default:
          ctx.drawImage(this.fx.atlas, orbFrame.x, orbFrame.y, orbFrame.w, orbFrame.h, -orbFrame.ax, -orbFrame.ay, orbFrame.w, orbFrame.h);
          break;
      }

      ctx.restore();
    }
  }

  get count(): number {
    return this.live.length;
  }

  get overlayCount(): number {
    return this.overlays.length;
  }

  activeOverlayKinds(): readonly OverlayKind[] {
    return this.overlays.map((o) => o.kind);
  }

  /** Returns render-time pose options bound strictly to real sim outcomes for fighter `player`. */
  poseOptions(player: 0 | 1, f: FighterState): PoseOptions {
    let reaction: DefensiveReaction | null = null;
    if (f.state === "guard_break") {
      reaction = "guard_break";
    } else {
      const rx = this.reactions[player];
      if (rx && rx.ticks > 0) {
        const valid = rx.kind === "perfect_shield" ? f.state === "blockstun" || f.state === "airborne" : f.state === "idle";
        if (valid) reaction = rx.kind;
      }
    }
    return { reduced: this.reduced, reaction };
  }
}
