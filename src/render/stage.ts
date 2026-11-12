// Placeholder stage: a sky gradient and a floor line. Floor markers scroll
// with the camera so camera motion is visible.
import { MOVEMENT } from "../data/movement";
import { SUBPX } from "../sim/fixed";
import { STAGE_WIDTH_PX, type Camera } from "./camera";
import { VIEW_HEIGHT, VIEW_WIDTH } from "./screen";

export const FLOOR_Y_PX = MOVEMENT.floorY / SUBPX;
const MARKER_SPACING = 80;

let sky: CanvasGradient | null = null;
let skyCtx: CanvasRenderingContext2D | null = null;

export function drawStage(ctx: CanvasRenderingContext2D, camera: Camera): void {
  if (sky === null || skyCtx !== ctx) {
    sky = ctx.createLinearGradient(0, 0, 0, FLOOR_Y_PX);
    sky.addColorStop(0, "#1b2a4a");
    sky.addColorStop(0.6, "#3d5a8a");
    sky.addColorStop(1, "#9fb8d8");
    skyCtx = ctx;
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_WIDTH, FLOOR_Y_PX);

  // Ground below the floor line.
  ctx.fillStyle = "#3a3346";
  ctx.fillRect(0, FLOOR_Y_PX, VIEW_WIDTH, VIEW_HEIGHT - FLOOR_Y_PX);
  ctx.fillStyle = "#e8e0c8";
  ctx.fillRect(0, FLOOR_Y_PX, VIEW_WIDTH, 1);

  // Markers every 80 stage pixels, a taller one at the stage center.
  ctx.fillStyle = "#5c5470";
  const first = Math.ceil(camera.x / MARKER_SPACING) * MARKER_SPACING;
  for (let x = first; x <= camera.x + VIEW_WIDTH; x += MARKER_SPACING) {
    const sx = x - camera.x;
    const tall = x === STAGE_WIDTH_PX / 2;
    ctx.fillRect(sx, FLOOR_Y_PX + 2, 1, tall ? 12 : 6);
  }
}
