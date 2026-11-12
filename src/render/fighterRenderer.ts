// Draws a fighter from its clip set. The clip and frame come from sim
// counters (state and stateFrame), never from render time.
import { MOVEMENT } from "../data/movement";
import { MOVES, segmentAt } from "../data/moves";
import { downedFrame } from "../sim/combat";
import { SUBPX } from "../sim/fixed";
import type { FighterState } from "../sim/types";
import type { Camera } from "./camera";
import { clipFrameIndex, type Clip, type ClipFrame, type ClipSet } from "./clips";

export interface ClipChoice {
  clip: string;
  tick: number;
  /** Play the clip backwards (walking back reuses the walk clip). */
  reverse: boolean;
  /** An exact frame index (move timelines pick frames themselves); overrides `tick`. */
  frame?: number;
}

function moveChoice(f: FighterState): ClipChoice | null {
  const m = f.move;
  if (!m) return null;
  const def = MOVES[m.id];
  let frame = segmentAt(def.segments, m.tick).segment.frame;
  if (def.id === "throw" && !m.grabbed && m.tick > def.grabTick!) {
    // A whiffed throw keeps reaching for a moment, then recovers.
    frame = m.tick < def.grabTick! + 10 ? 0 : 6;
  }
  return { clip: def.clip, tick: m.tick, reverse: false, frame };
}

/** Which clip a fighter shows, and how far into it, from sim state only. */
export function clipForFighter(f: FighterState): ClipChoice {
  switch (f.state) {
    case "attack":
      return moveChoice(f) ?? { clip: "idle", tick: f.stateFrame, reverse: false };
    case "hitstun":
      // Crouching hits use crouch_hurt; standing hits snap back, stagger, then recover.
      if (f.stunLow) return { clip: "crouch_hurt", tick: 0, reverse: false, frame: f.stun <= 4 ? 2 : f.stateFrame < 6 ? 0 : 1 };
      return { clip: "hurt", tick: 0, reverse: false, frame: f.stun <= 4 ? 3 : f.stateFrame < 6 ? (f.comboHits % 2 === 0 ? 2 : 0) : 1 };
    case "blockstun":
      return { clip: "block", tick: 0, reverse: false, frame: f.stunLow ? 1 : 0 };
    case "held":
      return { clip: "hurt", tick: 0, reverse: false, frame: 0 };
    case "knockdown":
    case "ko":
      return { clip: "knockdown", tick: f.stateFrame, reverse: false, frame: downedFrame(f) };
    case "victory":
      return { clip: "victory", tick: f.stateFrame, reverse: false };
    case "idle":
      return { clip: "idle", tick: f.stateFrame, reverse: false };
    case "walk_forward":
      return { clip: "walk", tick: f.stateFrame, reverse: false };
    case "walk_back":
      return { clip: "walk_back", tick: f.stateFrame, reverse: false };
    case "crouch":
      return { clip: "crouch", tick: f.stateFrame, reverse: false };
    case "jumpsquat":
      return { clip: "jump", tick: 0, reverse: false, frame: 0 };
    case "landing":
      return { clip: "crouch", tick: 0, reverse: false, frame: 1 };
    case "airborne":
      return moveChoice(f) ?? { clip: "jump", tick: f.stateFrame, reverse: false };
  }
}

/** Looks a clip up by name, falling back to idle, then to any clip. */
export function resolveClip(set: ClipSet, name: string): Clip {
  const clip = set.clips[name] ?? set.clips.idle ?? Object.values(set.clips)[0];
  if (!clip) throw new Error(`${set.slug}: no clips`);
  return clip;
}

export function frameForFighter(set: ClipSet, f: FighterState): ClipFrame {
  let choice = clipForFighter(f);
  // Walk-sheet placeholders have no walk_back clip: play the walk cycle backwards instead.
  if (choice.clip === "walk_back" && !set.clips.walk_back) choice = { ...choice, clip: "walk", reverse: true };
  const clip = resolveClip(set, choice.clip);
  if (choice.frame !== undefined && set.clips[choice.clip]) {
    return clip.frames[Math.min(choice.frame, clip.frames.length - 1)]!;
  }
  let index = clipFrameIndex(clip, choice.tick);
  if (choice.reverse) index = clip.frames.length - 1 - index;
  return clip.frames[index]!;
}

const SHADOW_RX = 24;
const SHADOW_RY = 4;
const FLOOR_Y_PX = MOVEMENT.floorY / SUBPX;

/** A hard-edged ellipse on the floor that shrinks as the fighter rises. */
export function drawShadow(ctx: CanvasRenderingContext2D, f: FighterState, camera: Camera): void {
  const cx = Math.round(f.x / SUBPX) - camera.x;
  const cy = FLOOR_Y_PX - camera.y;
  const height = (MOVEMENT.floorY - f.y) / SUBPX;
  const shrink = 1 - Math.min(0.5, height / 240);
  const rx = SHADOW_RX * shrink;
  const ry = Math.max(2, Math.round(SHADOW_RY * shrink));
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  for (let dy = -ry + 1; dy < ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)));
    ctx.fillRect(cx - half, cy + dy, half * 2, 1);
  }
}

/**
 * Draws the fighter's current frame with its anchor on the fighter's
 * position. Art faces right; facing left mirrors around the anchor.
 */
export function drawFighter(
  ctx: CanvasRenderingContext2D,
  set: ClipSet,
  f: FighterState,
  camera: Camera,
  tint?: string,
): void {
  const frame = frameForFighter(set, f);
  const sx = Math.round(f.x / SUBPX) - camera.x;
  const sy = Math.round(f.y / SUBPX) - camera.y;
  const source = tint ? tinted(set, frame, tint) : null;
  const img = source ?? set.atlas;
  const ox = source ? 0 : frame.x;
  const oy = source ? 0 : frame.y;
  if (f.facing === set.artFacing) {
    ctx.drawImage(img, ox, oy, frame.w, frame.h, sx - frame.ax, sy - frame.ay, frame.w, frame.h);
    return;
  }
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(-1, 1);
  ctx.drawImage(img, ox, oy, frame.w, frame.h, -frame.ax, -frame.ay, frame.w, frame.h);
  ctx.restore();
}

let scratch: HTMLCanvasElement | null = null;

/** The frame as a solid silhouette of `color` (the hit flash). */
function tinted(set: ClipSet, frame: ClipFrame, color: string): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  scratch ??= document.createElement("canvas");
  scratch.width = frame.w;
  scratch.height = frame.h;
  const c = scratch.getContext("2d");
  if (!c) return null;
  c.clearRect(0, 0, frame.w, frame.h);
  c.drawImage(set.atlas, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = color;
  c.fillRect(0, 0, frame.w, frame.h);
  c.globalCompositeOperation = "source-over";
  return scratch;
}
