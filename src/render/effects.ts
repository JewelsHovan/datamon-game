// Effects layer (spec 004, R4-R6): generated effect animations played at the
// point of contact of sim events, screen shake, a white flash on the defender,
// a camera nudge toward big hits, and a reduced-effects switch. Effects only
// read sim events and state; they keep their own render-time clocks.
import { MOVES, type Segment } from "../data/moves";
import { MOVEMENT } from "../data/movement";
import { SUBPX } from "../sim/fixed";
import type { SimEvent, SimState } from "../sim/types";
import type { Camera } from "./camera";
import type { AtlasImage, Clip, ClipLoaderDeps } from "./clips";
import { browserClipDeps, clipFrameIndex, parseManifest } from "./clips";

export interface EffectAtlas {
  atlas: AtlasImage;
  clips: Record<string, Clip>;
}

export async function loadEffects(deps: ClipLoaderDeps = browserClipDeps()): Promise<EffectAtlas | null> {
  const json = await deps.fetchJson("./effects/manifest.json");
  if (!json) return null;
  try {
    const m = parseManifest(json);
    return { atlas: await deps.loadImage("./effects/atlas.png"), clips: m.clips };
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

export class EffectsLayer {
  private live: Live[] = [];
  private shakeAmp = 0;
  private shakeAge = 0;
  private nudge = 0;
  /** Last move tick each fighter's trail was spawned for. */
  private trailKey: [string, string] = ["", ""];
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
          if (e.move === "special") this.spawn("orb_burst", e.x, e.y, target.facing);
          this.spawn(big ? "hit_heavy" : "hit_light", e.x, e.y, (-target.facing) as 1 | -1);
          this.shake(big ? SHAKE.heavy : SHAKE.light, big ? Math.sign(target.x - state.fighters[e.player].x) * 3 : 0);
          if (!this.reduced) this.flash[e.target] = 2;
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
          this.spawn("block", e.x - 1200, e.y, -1);
          this.spawn("block", e.x + 1200, e.y, 1);
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
        case "teleport":
          this.spawn(e.phase === "out" ? "teleport_out" : "teleport_in", e.x, MOVEMENT.floorY, 1, true, 1);
          break;
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
        case "block_push": {
          const toward = (state.fighters[e.target].x >= state.fighters[e.player].x ? 1 : -1) as 1 | -1;
          this.spawn("rush_streaks", e.x, e.y, toward, true, 0.6);
          this.spawn("block", e.x, e.y, toward, true, 1);
          this.shake(1);
          break;
        }
        case "roll":
          this.spawn("dust", state.fighters[e.player].x, MOVEMENT.floorY, 1, false, 0.6);
          break;
        case "ko":
          this.spawn("hit_heavy", e.x, e.y - 9000, 1);
          this.shake(SHAKE.ko);
          if (!this.reduced) this.screenFlash = 6;
          break;
      }
    }
  }

  /**
   * Trails that follow a special while it runs, read from sim state every step:
   * Hotfix Charge streaks, Rapid Deploy streaks and the uppercut arc.
   */
  follow(state: SimState): void {
    state.fighters.forEach((f, i) => {
      const m = f.move;
      if (!m || f.hitstop > 0 || (m.id !== "charge" && m.id !== "rush")) {
        this.trailKey[i] = "";
        return;
      }
      const key = `${state.frame - m.tick}:${m.tick}`;
      if (this.trailKey[i] === key) return; // the same move tick (hit-stop just ended)
      this.trailKey[i] = key;
      const def = MOVES[m.id];
      const { segment, start } = segmentStart(def.segments, m.tick);
      if (segment.launch && m.tick === start) {
        this.spawn("uppercut_arc", f.x + f.facing * 2400, f.y - 10000, f.facing);
        return;
      }
      if (!segment.vx) return;
      if (m.id === "charge" && (m.tick - start) % 4 === 0) this.spawn("charge_streaks", f.x - f.facing * 3000, f.y - 6500, f.facing, true, 0.9);
      if (m.id === "rush" && segment.vx >= 300 && (m.tick - start) % 3 === 0) this.spawn("rush_streaks", f.x - f.facing * 2600, f.y - 8500, f.facing, true, 0.8);
    });
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
    if (!this.fx) return;
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

  /** Projectiles, drawn from sim state (their animation follows the sim frame). */
  drawProjectiles(ctx: CanvasRenderingContext2D, state: SimState, camera: Camera): void {
    const clip = this.fx?.clips.orb;
    if (!this.fx || !clip) {
      ctx.fillStyle = "#7ff";
      for (const p of state.projectiles) ctx.fillRect(Math.round(p.x / SUBPX) - camera.x - 8, Math.round(p.y / SUBPX) - camera.y - 8, 16, 16);
      return;
    }
    const f = clip.frames[clipFrameIndex(clip, state.frame)]!;
    for (const p of state.projectiles) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(Math.round(p.x / SUBPX) - camera.x, Math.round(p.y / SUBPX) - camera.y);
      if (p.vx < 0) ctx.scale(-1, 1);
      ctx.drawImage(this.fx.atlas, f.x, f.y, f.w, f.h, -f.ax, -f.ay, f.w, f.h);
      ctx.restore();
    }
  }

  get count(): number {
    return this.live.length;
  }
}
