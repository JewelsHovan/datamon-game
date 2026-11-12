// Camera: follows the midpoint between the fighters, clamped to the stage.
import { MOVEMENT } from "../data/movement";
import { SUBPX } from "../sim/fixed";
import type { SimState } from "../sim/types";
import { VIEW_WIDTH } from "./screen";

export interface Camera {
  /** Left edge of the view in stage pixels (integer). */
  x: number;
  /** Top edge of the view in stage pixels (integer). */
  y: number;
}

export const STAGE_WIDTH_PX = MOVEMENT.stageWidth / SUBPX;

export function cameraFor(state: SimState): Camera {
  const [a, b] = state.fighters;
  const midPx = (a.x + b.x) / 2 / SUBPX;
  const x = Math.round(midPx - VIEW_WIDTH / 2);
  return { x: Math.max(0, Math.min(STAGE_WIDTH_PX - VIEW_WIDTH, x)), y: 0 };
}
