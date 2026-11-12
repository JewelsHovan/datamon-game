// Spec 001 R8 / A12: fighters stay whole on screen at the walls and at the
// maximum separation (QA finding F5: a K.O. in the corner was cut off).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIGHTERS } from "../data/fighters";
import { MOVEMENT } from "../data/movement";
import { SUBPX } from "../sim/fixed";
import { MAX_SEPARATION, WALL_LEFT, WALL_RIGHT } from "../sim/physics";
import { createMatchState } from "../sim/state";
import { cameraFor } from "./camera";
import { VIEW_WIDTH } from "./screen";

const MARGIN_PX = MOVEMENT.screenMargin / SUBPX;

interface Frame { w: number; ax: number }
function frames(slug: string): { clip: string; i: number; f: Frame }[] {
  const m = JSON.parse(readFileSync(`public/fighters/${slug}/manifest.json`, "utf8")) as { clips: Record<string, { frames: Frame[] }> };
  return Object.entries(m.clips).flatMap(([clip, c]) => c.frames.map((f, i) => ({ clip, i, f })));
}

describe("fighters stay whole on screen (spec 001 A12)", () => {
  for (const slug of Object.keys(FIGHTERS)) {
    it(`${slug}: every frame's backward reach fits inside the ${MARGIN_PX} px margin`, () => {
      const over = frames(slug).filter(({ f }) => f.ax > MARGIN_PX).map(({ clip, i, f }) => `${clip}[${i}] ${f.ax}px`);
      expect(over).toEqual([]);
    });
  }

  /** Each fighter's center distance (px) from the nearer view edge. */
  function insets(x0: number, x1: number): number[] {
    const s = createMatchState(1, "julien-hovan", "felicia-gorgacheva", true);
    s.fighters[0].x = x0;
    s.fighters[1].x = x1;
    const cam = cameraFor(s);
    return s.fighters.map((f) => {
      const px = f.x / SUBPX - cam.x;
      return Math.min(px, VIEW_WIDTH - px);
    });
  }

  it("at the left wall, the right wall and at max separation mid-stage, both centers are at least the margin inside the view", () => {
    const cases: [number, number][] = [
      [WALL_LEFT, WALL_LEFT + 6000],
      [WALL_RIGHT - 6000, WALL_RIGHT],
      [WALL_LEFT, WALL_LEFT + MAX_SEPARATION],
      [WALL_RIGHT - MAX_SEPARATION, WALL_RIGHT],
      [40000, 40000 + MAX_SEPARATION],
    ];
    for (const [a, b] of cases) for (const inset of insets(a, b)) expect(inset).toBeGreaterThanOrEqual(MARGIN_PX);
  });
});
