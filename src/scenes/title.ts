// Title screen: the game name, "press start" and the mode menu
// (VS CPU, VS PLAYER, TRAINING, CONTROLS, and FULLSCREEN where the page can go fullscreen).
import { keyLabel } from "../input/keymap";
import { moveLabel, text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { GameMode, MenuInput, Scene, SceneManager } from "./manager";
import { drawBackdrop, FULLSCREEN_ITEM, GOLD, INK, Menu } from "./ui";

export const TITLE_ITEMS = ["VS CPU", "VS PLAYER", "TRAINING", "CONTROLS"] as const;
/** The title's hint on touch (QA 2026-11-12 F3), in place of the keys and the gamepad line. */
export const TOUCH_TITLE_HINT = "MOVE: D-PAD   CONFIRM: PUNCH   BACK: KICK";
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
    this.hints().forEach((line, k) => text(ctx, line, VIEW_WIDTH / 2, VIEW_HEIGHT - 34 + k * 14, 8, "#aeaadc", "center"));
  }

  /** The lines under the menu: the keys and the gamepad join, or on touch the touch buttons. */
  hints(): string[] {
    // P1 plays by touch: name the on-screen buttons (a key press brings the key hints back).
    if (this.m.touchHints) return [TOUCH_TITLE_HINT];
    const b = this.m.services.bindings;
    const [k1, k2] = b.current;
    const m1 = moveLabel(k1);
    const m2 = moveLabel(k2);
    const moves = m1 === "ARROWS" || m2 === "ARROWS" ? `${m1} OR ${m2}` : `ARROWS, ${m1} OR ${m2}`;
    const p1 = keyLabel(b.keyFor(0, "punch"));
    const p2 = keyLabel(b.keyFor(1, "punch"));
    const confirm = p1 === "ENTER" || p2 === "ENTER" ? `${p1} OR ${p2}` : `ENTER, ${p1} OR ${p2}`;
    const back = `${keyLabel(b.keyFor(0, "kick"))} OR ${keyLabel(b.keyFor(1, "kick"))}`;
    return [`MOVE: ${moves}   CONFIRM: ${confirm}   BACK: ${back}`, "GAMEPADS: PRESS ANY BUTTON TO JOIN"];
  }

  debug(): Record<string, unknown> {
    return { index: this.menu.index, item: this.menu.selected, items: [...this.menu.items], hints: this.hints() };
  }
}
