// Pause (Esc or Start during a fight): the fight stays frozen underneath with
// both key legends showing; resume, controls, or quit to character select.
import { text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { FightScene } from "./fight";
import type { MenuInput, Scene, SceneManager } from "./manager";
import { drawPanel, GOLD, Menu } from "./ui";

export const PAUSE_ITEMS = ["RESUME", "CONTROLS", "QUIT TO SELECT"] as const;

export class PauseScene implements Scene {
  readonly name = "pause" as const;
  readonly menu: Menu;

  constructor(
    private readonly m: SceneManager,
    readonly fight: FightScene,
  ) {
    this.menu = new Menu(PAUSE_ITEMS, m.services.hooks);
  }

  step(input: MenuInput): void {
    // Punch or Start (Enter) confirms the selected item; RESUME is selected first,
    // so Start toggles back into the fight. Esc or Kick resumes from any item.
    const r = this.menu.step(input, this.fight.humans);
    if (r === null) return;
    if (r === "back" || r === 0) this.m.resume(this.fight);
    else if (r === 1) this.m.toControls(this);
    else this.m.toSelect(this.fight.match.mode, this.fight.match);
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    this.fight.render(ctx, frame, true);
    ctx.fillStyle = "rgba(8, 7, 24, 0.55)";
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    drawPanel(ctx, VIEW_WIDTH / 2 - 130, 118, 260, 136);
    text(ctx, "PAUSED", VIEW_WIDTH / 2, 132, 16, GOLD, "center");
    this.menu.draw(ctx, VIEW_WIDTH / 2, 166, frame, 8, 22);
    text(ctx, "ESC: RESUME", VIEW_WIDTH / 2, 236, 8, "#aeaadc", "center");
  }

  debug(): Record<string, unknown> {
    return { index: this.menu.index, item: this.menu.selected };
  }
}
