// Pause (Esc or Start during a fight, or the window losing focus): the fight
// stays frozen underneath with both key legends showing; resume, controls,
// sound on or off, fullscreen (where the page can go fullscreen) or quit to
// character select. With a keyboard the panel lists the mute key (M, spec 010)
// with what it will do; on touch it names the touch buttons instead.
import { text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { FightScene } from "./fight";
import type { MenuInput, Scene, SceneManager } from "./manager";
import { drawPanel, FULLSCREEN_ITEM, GOLD, Menu } from "./ui";

export const PAUSE_ITEMS = ["RESUME", "CONTROLS", "QUIT TO SELECT"] as const;
/** Mutes or unmutes the sound for everyone; reads SOUND ON or SOUND OFF (QA 2026-11-12 F3: no mute without a keyboard). */
export const SOUND_ITEM = "SOUND";

/**
 * The pause menu: SOUND after CONTROLS when the game can mute, FULLSCREEN before
 * QUIT TO SELECT when the page can go fullscreen.
 */
export function pauseItems(fullscreen: boolean, sound = false): readonly string[] {
  return ["RESUME", "CONTROLS", ...(sound ? [SOUND_ITEM] : []), ...(fullscreen ? [FULLSCREEN_ITEM] : []), "QUIT TO SELECT"];
}

/** The SOUND item's words: what the sound is now. */
export function soundLabel(muted: boolean): string {
  return muted ? "SOUND OFF" : "SOUND ON";
}

/** The line under the pause menu: the keys with a keyboard, the touch buttons on touch. */
export const TOUCH_PAUSE_HINT = "PUNCH: SELECT   KICK: RESUME";

const TOP = 110;
const ITEM_GAP = 22;

export class PauseScene implements Scene {
  readonly name = "pause" as const;
  readonly menu: Menu;

  constructor(
    private readonly m: SceneManager,
    readonly fight: FightScene,
  ) {
    this.menu = new Menu(pauseItems(m.canFullscreen, m.services.toggleSound !== undefined), m.services.hooks);
    this.menu.labelOf = (item) => (item === SOUND_ITEM ? soundLabel(this.m.services.soundMuted?.() === true) : item);
  }

  /** "M: MUTE", or "M: UNMUTE" while the sound is off. */
  get muteHint(): string {
    return this.m.services.soundMuted?.() ? "M: UNMUTE" : "M: MUTE";
  }

  get hint(): string {
    return this.m.touchHints ? TOUCH_PAUSE_HINT : `ESC: RESUME   ${this.muteHint}`;
  }

  step(input: MenuInput): void {
    // Punch or Start (Enter) confirms the selected item; RESUME is selected first,
    // so Start toggles back into the fight. Esc or Kick resumes from any item.
    const r = this.menu.step(input, this.fight.humans);
    if (r === null) return;
    const item = r === "back" ? "RESUME" : this.menu.items[r]!;
    if (item === "RESUME") this.m.resume(this.fight);
    else if (item === "CONTROLS") this.m.toControls(this);
    else if (item === SOUND_ITEM) this.m.services.toggleSound?.();
    else if (item === FULLSCREEN_ITEM) this.m.toggleFullscreen();
    else this.m.toSelect(this.fight.match.mode, this.fight.match);
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    this.fight.render(ctx, frame, true);
    ctx.fillStyle = "rgba(8, 7, 24, 0.55)";
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    const items = this.menu.items.length;
    const hintY = TOP + 46 + items * ITEM_GAP + 8; // five items end at y 296, inside the 360 px view
    drawPanel(ctx, VIEW_WIDTH / 2 - 130, TOP, 260, hintY + 22 - TOP);
    text(ctx, "PAUSED", VIEW_WIDTH / 2, TOP + 14, 16, GOLD, "center");
    this.menu.draw(ctx, VIEW_WIDTH / 2, TOP + 46, frame, 8, ITEM_GAP);
    text(ctx, this.hint, VIEW_WIDTH / 2, hintY, 8, "#aeaadc", "center");
  }

  debug(): Record<string, unknown> {
    return { index: this.menu.index, item: this.menu.labelOf(this.menu.selected), items: this.menu.labels, hint: this.hint };
  }

  describe(): string {
    return this.fight.describe();
  }
}
