// Draws a fighter from its clip set. The clip and frame come from sim
// counters (state and stateFrame), never from render time.
import { MOVEMENT } from "../data/movement";
import { SUBPX } from "../sim/fixed";
import type { FighterState } from "../sim/types";
import type { Camera } from "./camera";
import { clipFrameIndex, type Clip, type ClipFrame, type ClipSet } from "./clips";

export interface ClipChoice {
  clip: string;
  tick: number;
  /** Play the clip backwards (walking back reuses the walk clip). */
  reverse: boolean;
}

/** Which clip a fighter shows, and how far into it, from sim state only. */
export function clipForFighter(f: FighterState): ClipChoice {
  switch (f.state) {
    case "idle":
      return { clip: "idle", tick: f.stateFrame, reverse: false };
    case "walk_forward":
      return { clip: "walk", tick: f.stateFrame, reverse: false };
    case "walk_back":
      return { clip: "walk", tick: f.stateFrame, reverse: true };
    case "crouch":
      return { clip: "crouch", tick: f.stateFrame, reverse: false };
    case "jumpsquat":
    case "landing":
      // The crouch clip's first frame doubles as the pre-jump squat and the landing squat.
      return { clip: "crouch", tick: 0, reverse: false };
    case "airborne":
      return { clip: "jump", tick: f.stateFrame, reverse: false };
  }
}

/** Looks a clip up by name, falling back to idle, then to any clip. */
export function resolveClip(set: ClipSet, name: string): Clip {
  const clip = set.clips[name] ?? set.clips.idle ?? Object.values(set.clips)[0];
  if (!clip) throw new Error(`${set.slug}: no clips`);
  return clip;
}

export function frameForFighter(set: ClipSet, f: FighterState): ClipFrame {
  const choice = clipForFighter(f);
  const clip = resolveClip(set, choice.clip);
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
): void {
  const frame = frameForFighter(set, f);
  const sx = Math.round(f.x / SUBPX) - camera.x;
  const sy = Math.round(f.y / SUBPX) - camera.y;
  if (f.facing === set.artFacing) {
    ctx.drawImage(set.atlas, frame.x, frame.y, frame.w, frame.h, sx - frame.ax, sy - frame.ay, frame.w, frame.h);
    return;
  }
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(-1, 1);
  ctx.drawImage(set.atlas, frame.x, frame.y, frame.w, frame.h, -frame.ax, -frame.ay, frame.w, frame.h);
  ctx.restore();
}
