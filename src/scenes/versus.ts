// Versus splash (about 2 seconds): both fighters face off while the fight's
// clips, effects and portraits load. The fight starts once both are done.
// URL shortcuts use it with no splash, as a loading screen only.
import { text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { FightAssets, Match, MenuInput, Scene, SceneManager } from "./manager";
import { drawBackdrop, drawSmooth, GOLD, INK, PLAYER_COLORS } from "./ui";

export const VERSUS_FRAMES = 120;

export class VersusScene implements Scene {
  readonly name = "versus" as const;
  frames = 0;
  assets: FightAssets | null = null;
  error: string | null = null;

  constructor(
    private readonly m: SceneManager,
    readonly match: Match,
    private readonly splash = true,
  ) {
    m.services.loadFight(match.p1, match.p2).then(
      (a) => {
        this.assets = a;
      },
      (err: unknown) => {
        this.error = String(err);
        console.error("Failed to load the fight", err);
      },
    );
  }

  step(_input: MenuInput): void {
    this.frames += 1;
    if (this.error && this.frames >= 180) {
      this.m.toSelect(this.match.mode, this.match);
      return;
    }
    if (this.assets && (!this.splash || this.frames >= VERSUS_FRAMES)) this.m.toFight(this.match, this.assets);
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    if (!this.splash) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
      text(ctx, this.error ? "COULD NOT LOAD THE FIGHT" : "LOADING", VIEW_WIDTH / 2, VIEW_HEIGHT / 2 - 4, 8, INK, "center");
      return;
    }
    drawBackdrop(ctx, frame);
    // Diagonal halves in the players' colors slide in.
    const t = Math.min(1, this.frames / 18);
    const slide = Math.round((1 - t) * 200);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = PLAYER_COLORS[0];
    ctx.beginPath();
    ctx.moveTo(-slide, 0);
    ctx.lineTo(VIEW_WIDTH / 2 + 40 - slide, 0);
    ctx.lineTo(VIEW_WIDTH / 2 - 40 - slide, VIEW_HEIGHT);
    ctx.lineTo(-slide, VIEW_HEIGHT);
    ctx.fill();
    ctx.fillStyle = PLAYER_COLORS[1];
    ctx.beginPath();
    ctx.moveTo(VIEW_WIDTH / 2 + 40 + slide, 0);
    ctx.lineTo(VIEW_WIDTH + slide, 0);
    ctx.lineTo(VIEW_WIDTH + slide, VIEW_HEIGHT);
    ctx.lineTo(VIEW_WIDTH / 2 - 40 + slide, VIEW_HEIGHT);
    ctx.fill();
    ctx.restore();

    const { p1, p2, mode, cpuLevel } = this.match;
    const art = this.m.services.art;
    const people = [p1, p2] as const;
    for (const i of [0, 1] as const) {
      const person = people[i];
      const left = i === 0;
      const cx = left ? 150 - slide : VIEW_WIDTH - 150 + slide;
      const img = art?.portrait(person) ?? null;
      if (img) {
        ctx.save();
        if (!left) {
          ctx.translate(cx * 2, 0);
          ctx.scale(-1, 1);
        }
        drawSmooth(ctx, img, cx - 72, 70, 144, 136);
        ctx.restore();
      }
      text(ctx, person.shortName.toUpperCase(), cx, 222, 16, INK, "center");
      const info = this.m.services.info(person.slug);
      const tag = !left && mode === "cpu" ? `CPU ${(cpuLevel ?? "normal").toUpperCase()}` : `PLAYER ${i + 1}`;
      text(ctx, tag, cx, 246, 8, PLAYER_COLORS[i], "center");
      if (info.archetype) text(ctx, info.archetype.toUpperCase(), cx, 262, 8, "#aeaadc", "center");
    }
    const pop = this.frames < 24 ? 2 - this.frames / 24 : 1;
    text(ctx, "VS", VIEW_WIDTH / 2, 130 - Math.round(16 * pop), Math.round(32 * pop), GOLD, "center");
    const label = mode === "training" ? "TRAINING" : mode === "cpu" ? "VS CPU" : "BEST OF 3";
    text(ctx, label, VIEW_WIDTH / 2, 300, 8, INK, "center");
    if (this.frames >= VERSUS_FRAMES && !this.assets) text(ctx, this.error ? "COULD NOT LOAD THE FIGHT" : "LOADING", VIEW_WIDTH / 2, 320, 8, INK, "center");
  }

  debug(): Record<string, unknown> {
    return { frames: this.frames, loaded: this.assets !== null, error: this.error };
  }
}
