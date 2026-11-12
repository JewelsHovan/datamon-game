// Hit and hurt boxes per fighter (spec 003, R3). Derived from the art by
// art/pipeline/boxes.py into src/data/boxes/<slug>.json; fighters without
// generated art use the generic boxes below. Pure data: src/sim reads it.
//
// Box units in the JSON: pixels in anchor space for art facing right. x grows
// forward from the fighter's position (body center), y grows downward from the
// floor, so y is negative above the floor. A box is [x, y, w, h].
import { BOXES } from "./boxes/index";
import type { MoveDef } from "./moves";

export type BoxPx = readonly [number, number, number, number];

export interface FrameBoxes {
  hurt: BoxPx[];
  reach: BoxPx | null;
}

export interface FighterBoxes {
  fighter: string;
  manifestVersion: number;
  clips: Record<string, FrameBoxes[]>;
}

/** A box in stage subpixels: left/top inclusive, right/bottom exclusive. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const GENERIC_HURT: Readonly<Record<string, BoxPx[]>> = {
  stand: [[-16, -142, 32, 32], [-24, -112, 48, 46], [-22, -66, 44, 66]],
  crouch: [[-16, -96, 34, 30], [-26, -68, 52, 68]],
  air: [[-22, -124, 46, 112]],
};

const GENERIC_REACH: Readonly<Record<string, BoxPx>> = {
  light_punch: [16, -124, 50, 22],
  heavy_punch: [16, -120, 58, 24],
  light_kick: [10, -98, 64, 32],
  heavy_kick: [10, -114, 66, 40],
  crouch_attack: [16, -32, 70, 30],
  air_attack: [8, -46, 56, 46],
};

/** Which representative frame stands in for a non-attack pose. */
const POSE_FRAMES: Readonly<Record<"stand" | "crouch" | "air", readonly [string, number]>> = {
  stand: ["idle", 0],
  crouch: ["crouch", 2],
  air: ["jump", 3],
};

export function boxesFor(slug: string): FighterBoxes | undefined {
  return BOXES[slug];
}

/** Hurtboxes for a pose (standing, crouching, airborne). */
export function poseHurt(slug: string, pose: "stand" | "crouch" | "air"): readonly BoxPx[] {
  const b = BOXES[slug];
  const [clip, frame] = POSE_FRAMES[pose];
  return b?.clips[clip]?.[frame]?.hurt ?? GENERIC_HURT[pose]!;
}

/** Hurtboxes while showing frame `frame` of a move's clip (extended limbs are hittable). */
export function moveHurt(slug: string, move: MoveDef, frame: number): readonly BoxPx[] {
  const b = BOXES[slug];
  return b?.clips[move.clip]?.[frame]?.hurt ?? GENERIC_HURT[move.air ? "air" : move.id === "crouch_attack" ? "crouch" : "stand"]!;
}

/** The hitbox of an active frame: the art's reach box, or the generic one for that move. */
export function moveHitbox(slug: string, move: MoveDef, frame: number): BoxPx | null {
  const reach = BOXES[slug]?.clips[move.clip]?.[frame]?.reach;
  return reach ?? GENERIC_REACH[move.id] ?? null;
}

/** Converts a pixel box in anchor space to a stage rect for a fighter at (x, y) facing `facing`. */
export function toRect(box: BoxPx, x: number, y: number, facing: 1 | -1): Rect {
  const [bx, by, bw, bh] = box;
  const left = facing === 1 ? x + bx * 100 : x - (bx + bw) * 100;
  return { left, top: y + by * 100, right: left + bw * 100, bottom: y + (by + bh) * 100 };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Center of the overlap of two rects (they must overlap). */
export function overlapCenter(a: Rect, b: Rect): { x: number; y: number } {
  const l = Math.max(a.left, b.left);
  const r = Math.min(a.right, b.right);
  const t = Math.max(a.top, b.top);
  const btm = Math.min(a.bottom, b.bottom);
  return { x: Math.floor((l + r) / 2), y: Math.floor((t + btm) / 2) };
}
