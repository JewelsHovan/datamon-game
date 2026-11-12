// F2 overlay: hurtboxes (blue), hitboxes (red), pushboxes (green) and projectiles (cyan),
// straight from the sim, so what you see is what the hit detection uses.
import type { Rect } from "../data/fighterBoxes";
import { PROJECTILE } from "../data/combat";
import { hitRect, hurtRects } from "../sim/combat";
import { SUBPX } from "../sim/fixed";
import { pushboxOf } from "../sim/physics";
import type { SimState } from "../sim/types";
import type { Camera } from "./camera";

function outline(ctx: CanvasRenderingContext2D, r: Rect, camera: Camera, color: string, fill: string): void {
  const x = Math.round(r.left / SUBPX) - camera.x;
  const y = Math.round(r.top / SUBPX) - camera.y;
  const w = Math.round((r.right - r.left) / SUBPX);
  const h = Math.round((r.bottom - r.top) / SUBPX);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function drawBoxes(ctx: CanvasRenderingContext2D, state: SimState, camera: Camera): void {
  for (const f of state.fighters) {
    const pb = pushboxOf(f);
    outline(ctx, pb, camera, "#63e294", "rgba(99,226,148,0.08)");
    for (const r of hurtRects(f)) outline(ctx, r, camera, "#4fb0ff", "rgba(79,176,255,0.18)");
    const hit = hitRect(f);
    if (hit) outline(ctx, hit, camera, "#ff6170", "rgba(255,97,112,0.35)");
  }
  for (const p of state.projectiles) {
    outline(ctx, { left: p.x - PROJECTILE.halfW, right: p.x + PROJECTILE.halfW, top: p.y - PROJECTILE.halfH, bottom: p.y + PROJECTILE.halfH }, camera, "#7fffff", "rgba(127,255,255,0.3)");
  }
}
