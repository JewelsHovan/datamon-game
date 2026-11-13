// Title screen: the game name, "press start" and the mode menu
// (VS CPU, VS PLAYER, TRAINING, CONTROLS, and FULLSCREEN where the page can go fullscreen).
import { keyLabel } from "../input/keymap";
import { moveLabel, text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { GameMode, MenuInput, Scene, SceneManager } from "./manager";
import { drawBackdrop, FULLSCREEN_ITEM, GOLD, INK, Menu } from "./ui";

export const TITLE_ITEMS = ["VS CPU", "VS PLAYER", "TRAINING", "CONTROLS"] as const;
const MODES: Readonly<Record<string, GameMode>> = { "VS CPU": "cpu", "VS PLAYER": "versus", TRAINING: "training" };

/** The title menu: FULLSCREEN comes last, and only when the page can go fullscreen. */
export function titleItems(fullscreen: boolean): readonly string[] {
  return fullscreen ? [...TITLE_ITEMS, FULLSCREEN_ITEM] : TITLE_ITEMS;
}

export class TitleScene implements Scene {
  readonly name = "title" as const;
  readonly menu: Menu;

  constructor(private readonly m: SceneManager) {
    this.menu = new Menu(titleItems(m.canFullscreen), m.services.hooks);
  }

  step(input: MenuInput): void {
    const r = this.menu.step(input);
    if (r === null || r === "back") return;
    const item = this.menu.items[r]!;
    const mode = MODES[item];
    if (mode) this.m.toSelect(mode);
    else if (item === FULLSCREEN_ITEM) this.m.toggleFullscreen();
    else this.m.toControls(this);
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    drawBackdrop(ctx, frame);
    const bob = Math.round(Math.sin(frame / 40) * 2);
    text(ctx, "COMPASS", VIEW_WIDTH / 2, 52 + bob, 40, GOLD, "center");
    text(ctx, "CARDINAL CLASH", VIEW_WIDTH / 2, 102, 16, "#ff6170", "center");
    if (Math.floor(frame / 30) % 2 === 0) text(ctx, "PRESS START", VIEW_WIDTH / 2, 138, 8, INK, "center");
    this.menu.draw(ctx, VIEW_WIDTH / 2, 170, frame, 16, this.menu.items.length > 4 ? 26 : 28);
    const b = this.m.services.bindings;
    const [k1, k2] = b.current;
    const confirm = `${keyLabel(b.keyFor(0, "start"))}, ${keyLabel(b.keyFor(0, "punch"))} OR ${keyLabel(b.keyFor(1, "punch"))}`;
    const back = `${keyLabel(b.keyFor(0, "kick"))} OR ${keyLabel(b.keyFor(1, "kick"))}`;
    text(ctx, `MOVE: ${moveLabel(k1)} OR ${moveLabel(k2)}   CONFIRM: ${confirm}   BACK: ${back}`, VIEW_WIDTH / 2, VIEW_HEIGHT - 34, 8, "#aeaadc", "center");
    text(ctx, "GAMEPADS: PRESS ANY BUTTON TO JOIN", VIEW_WIDTH / 2, VIEW_HEIGHT - 20, 8, "#aeaadc", "center");
  }

  debug(): Record<string, unknown> {
    return { index: this.menu.index, item: this.menu.selected, items: [...this.menu.items] };
  }
}
