// Title screen: the game name, "press start" and the mode menu
// (VS CPU, VS PLAYER, TRAINING, CONTROLS).
import { keyLabel } from "../input/keymap";
import { moveLabel, text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { GameMode, MenuInput, Scene, SceneManager } from "./manager";
import { drawBackdrop, GOLD, INK, Menu } from "./ui";

export const TITLE_ITEMS = ["VS CPU", "VS PLAYER", "TRAINING", "CONTROLS"] as const;
const MODES: readonly (GameMode | null)[] = ["cpu", "versus", "training", null];

export class TitleScene implements Scene {
  readonly name = "title" as const;
  readonly menu: Menu;

  constructor(private readonly m: SceneManager) {
    this.menu = new Menu(TITLE_ITEMS, m.services.hooks);
  }

  step(input: MenuInput): void {
    const r = this.menu.step(input);
    if (r === null || r === "back") return;
    const mode = MODES[r];
    if (mode) this.m.toSelect(mode);
    else this.m.toControls(this);
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    drawBackdrop(ctx, frame);
    const bob = Math.round(Math.sin(frame / 40) * 2);
    text(ctx, "COMPASS", VIEW_WIDTH / 2, 52 + bob, 40, GOLD, "center");
    text(ctx, "CARDINAL CLASH", VIEW_WIDTH / 2, 102, 16, "#ff6170", "center");
    if (Math.floor(frame / 30) % 2 === 0) text(ctx, "PRESS START", VIEW_WIDTH / 2, 138, 8, INK, "center");
    this.menu.draw(ctx, VIEW_WIDTH / 2, 170, frame, 16, 28);
    const b = this.m.services.bindings;
    const [k1, k2] = b.current;
    const confirm = `${keyLabel(b.keyFor(0, "start"))}, ${keyLabel(b.keyFor(0, "punch"))} OR ${keyLabel(b.keyFor(1, "punch"))}`;
    const back = `${keyLabel(b.keyFor(0, "kick"))} OR ${keyLabel(b.keyFor(1, "kick"))}`;
    text(ctx, `MOVE: ${moveLabel(k1)} OR ${moveLabel(k2)}   CONFIRM: ${confirm}   BACK: ${back}`, VIEW_WIDTH / 2, VIEW_HEIGHT - 34, 8, "#aeaadc", "center");
    text(ctx, "GAMEPADS: PRESS ANY BUTTON TO JOIN", VIEW_WIDTH / 2, VIEW_HEIGHT - 20, 8, "#aeaadc", "center");
  }

  debug(): Record<string, unknown> {
    return { index: this.menu.index, item: this.menu.selected };
  }
}
