// Pause (Esc or Start during a fight, or the window losing focus): the fight
// stays frozen underneath with both key legends showing; resume, controls,
// fullscreen (where the page can go fullscreen) or quit to character select.
// The panel lists the mute key (M, spec 010) with what it will do.
import { text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { FightScene } from "./fight";
import type { MenuInput, Scene, SceneManager } from "./manager";
import { drawPanel, FULLSCREEN_ITEM, GOLD, Menu } from "./ui";

export const PAUSE_ITEMS = ["RESUME", "CONTROLS", "QUIT TO SELECT"] as const;

/** The pause menu: FULLSCREEN sits before QUIT TO SELECT, and only when the page can go fullscreen. */
export function pauseItems(fullscreen: boolean): readonly string[] {
  return fullscreen ? ["RESUME", "CONTROLS", FULLSCREEN_ITEM, "QUIT TO SELECT"] : PAUSE_ITEMS;
}

const TOP = 110;
const ITEM_GAP = 22;

export class PauseScene implements Scene {
  readonly name = "pause" as const;
  readonly menu: Menu;

  constructor(
    private readonly m: SceneManager,
    readonly fight: FightScene,
  ) {
    this.menu = new Menu(pauseItems(m.canFullscreen), m.services.hooks);
  }

  /** "M: MUTE", or "M: UNMUTE" while the sound is off. */
  get muteHint(): string {
    return this.m.services.soundMuted?.() ? "M: UNMUTE" : "M: MUTE";
  }

  step(input: MenuInput): void {
    // Punch or Start (Enter) confirms the selected item; RESUME is selected first,
    // so Start toggles back into the fight. Esc or Kick resumes from any item.
    const r = this.menu.step(input, this.fight.humans);
    if (r === null) return;
    const item = r === "back" ? "RESUME" : this.menu.items[r]!;
    if (item === "RESUME") this.m.resume(this.fight);
    else if (item === "CONTROLS") this.m.toControls(this);
    else if (item === FULLSCREEN_ITEM) this.m.toggleFullscreen();
    else this.m.toSelect(this.fight.match.mode, this.fight.match);
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    this.fight.render(ctx, frame, true);
    ctx.fillStyle = "rgba(8, 7, 24, 0.55)";
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    const items = this.menu.items.length;
    const hintY = TOP + 46 + items * ITEM_GAP + 8;
    drawPanel(ctx, VIEW_WIDTH / 2 - 130, TOP, 260, hintY + 22 - TOP);
    text(ctx, "PAUSED", VIEW_WIDTH / 2, TOP + 14, 16, GOLD, "center");
    this.menu.draw(ctx, VIEW_WIDTH / 2, TOP + 46, frame, 8, ITEM_GAP);
    text(ctx, `ESC: RESUME   ${this.muteHint}`, VIEW_WIDTH / 2, hintY, 8, "#aeaadc", "center");
  }

  debug(): Record<string, unknown> {
    return { index: this.menu.index, item: this.menu.selected, items: [...this.menu.items], hint: `ESC: RESUME   ${this.muteHint}` };
  }

  describe(): string {
    return this.fight.describe();
  }
}
