// Controls screen (spec 005, R3), from the title and the pause menu. Both
// players' bindings side by side; pick an action with Start (Enter) and press
// a key to rebind it (a key already in use swaps). Every row is also the live
// key test: an action lights up in its player's color while held, so two
// players can check which key combinations their keyboard registers.
// Punch, Kick and Special do nothing here except light up, so all six attack
// keys can be held at once for the test.
import { ACTION_LABELS, BINDABLE_ACTIONS } from "../input/bindings";
import { BUTTON_BITS, BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT, BUTTON_START, BUTTON_UP, type ButtonName } from "../input/bits";
import { keyLabel } from "../input/keymap";
import { text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { MenuInput, Scene, SceneManager } from "./manager";
import { DIM, drawBackdrop, GOLD, INK, nav, PLAYER_COLORS, pressed } from "./ui";

const ROW_Y = 54;
const ROW_H = 17;
const COL_W = 230;
const COL_X = [VIEW_WIDTH / 2 - 16 - COL_W, VIEW_WIDTH / 2 + 16] as const;
const RESTORE_ROW = BINDABLE_ACTIONS.length;
const BACK_ROW = RESTORE_ROW + 1;

export class ControlsScene implements Scene {
  readonly name = "controls" as const;
  col: 0 | 1 = 0;
  row = 0;
  /** The action waiting for a key, or null. */
  capturing: { player: 0 | 1; action: ButtonName } | null = null;
  status = "";
  private waitRelease: string | null = null;
  private lit: readonly [number, number] = [0, 0];

  constructor(
    private readonly m: SceneManager,
    readonly back: Scene,
  ) {}

  step(input: MenuInput): void {
    this.lit = input.held;
    if (this.waitRelease) {
      // The key just bound may now be a Start key: ignore it until it is released.
      if (this.m.services.heldKeys().has(this.waitRelease)) return;
      this.waitRelease = null;
    }
    if (this.capturing) return;
    const hooks = this.m.services.hooks;
    if (input.escape) {
      hooks.ui?.("back");
      this.m.go(this.back);
      return;
    }
    if (nav(input, BUTTON_UP)) this.moveRow(-1);
    else if (nav(input, BUTTON_DOWN)) this.moveRow(1);
    if (this.row < RESTORE_ROW && (nav(input, BUTTON_LEFT) || nav(input, BUTTON_RIGHT))) {
      this.col = this.col === 0 ? 1 : 0;
      hooks.ui?.("move");
    }
    if (!pressed(input, BUTTON_START)) return;
    hooks.ui?.("confirm");
    if (this.row === BACK_ROW) {
      this.m.go(this.back);
    } else if (this.row === RESTORE_ROW) {
      this.m.services.bindings.restoreDefaults();
      this.status = "DEFAULTS RESTORED";
    } else {
      this.capturing = { player: this.col, action: BINDABLE_ACTIONS[this.row]! };
      this.status = "";
    }
  }

  private moveRow(delta: number): void {
    this.row = (this.row + delta + BACK_ROW + 1) % (BACK_ROW + 1);
    this.m.services.hooks.ui?.("move");
  }

  /** While waiting for a key, the next key press is the new binding (Esc cancels). */
  key(code: string): boolean {
    const cap = this.capturing;
    if (!cap) return false;
    if (code === "Escape") {
      this.capturing = null;
      this.status = "CANCELLED";
      return true;
    }
    const r = this.m.services.bindings.rebind(cap.player, cap.action, code);
    if (!r.ok) {
      this.status = `${keyLabel(code)} IS RESERVED, PICK ANOTHER KEY`;
      return true;
    }
    const swap = r.swapped ? `  (SWAPPED WITH P${r.swapped.player + 1} ${ACTION_LABELS[r.swapped.action]})` : "";
    this.status = `P${cap.player + 1} ${ACTION_LABELS[cap.action]} = ${keyLabel(code)}${swap}`;
    this.capturing = null;
    this.waitRelease = code;
    this.m.services.hooks.ui?.("confirm");
    return true;
  }

  /** Actions currently lit per player (the key test). */
  litActions(): [ButtonName[], ButtonName[]] {
    const of = (p: 0 | 1) => BINDABLE_ACTIONS.filter((a) => (this.lit[p] & BUTTON_BITS[a]) !== 0);
    return [of(0), of(1)];
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    drawBackdrop(ctx, frame);
    const bindings = this.m.services.bindings;
    text(ctx, "CONTROLS", VIEW_WIDTH / 2, 8, 16, GOLD, "center");
    for (const p of [0, 1] as const) {
      const x0 = COL_X[p];
      text(ctx, `PLAYER ${p + 1}`, x0 + COL_W / 2, 34, 8, PLAYER_COLORS[p], "center");
      BINDABLE_ACTIONS.forEach((action, r) => {
        const y = ROW_Y + r * ROW_H;
        const lit = (this.lit[p] & BUTTON_BITS[action]) !== 0;
        const selected = this.row === r && this.col === p;
        ctx.fillStyle = lit ? PLAYER_COLORS[p] : "rgba(13, 12, 34, 0.85)";
        ctx.fillRect(x0, y, COL_W, ROW_H - 3);
        if (selected) {
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = 2;
          ctx.strokeRect(x0 - 1, y - 1, COL_W + 2, ROW_H - 1);
        }
        // Lit rows keep light text: the pixel font's dark outline makes dark text unreadable on color.
        const ink = lit ? "#ffffff" : INK;
        text(ctx, ACTION_LABELS[action], x0 + 8, y + 3, 8, lit ? "#ffffff" : DIM, "left");
        const capturing = this.capturing && this.capturing.player === p && this.capturing.action === action;
        const label = capturing ? (Math.floor(frame / 15) % 2 === 0 ? "PRESS A KEY" : "") : keyLabel(bindings.keyFor(p, action));
        text(ctx, label, x0 + COL_W - 8, y + 3, 8, capturing ? GOLD : ink, "right");
      });
    }
    const items = ["RESTORE DEFAULTS", "BACK"];
    items.forEach((item, k) => {
      const on = this.row === RESTORE_ROW + k;
      text(ctx, on ? `> ${item} <` : item, VIEW_WIDTH / 2, ROW_Y + BINDABLE_ACTIONS.length * ROW_H + 8 + k * 16, 8, on ? GOLD : DIM, "center");
    });
    if (this.status) text(ctx, this.status, VIEW_WIDTH / 2, 240, 8, GOLD, "center");
    const lines = [
      "KEY TEST: HOLD KEYS AND THEIR ACTIONS LIGHT UP.",
      "IF A KEY DOES NOT LIGHT UP WHILE OTHERS ARE HELD, THIS KEYBOARD",
      "CANNOT REGISTER THAT COMBINATION: REBIND IT.",
    ];
    lines.forEach((l, k) => text(ctx, l, VIEW_WIDTH / 2, 262 + k * 13, 8, "#aeaadc", "center"));
    const start = keyLabel(bindings.keyFor(0, "start"));
    const footer = this.capturing ? `PRESS A KEY FOR P${this.capturing.player + 1} ${ACTION_LABELS[this.capturing.action]}   ESC: CANCEL` : `MOVE: DIRECTIONS   ${start} OR START: REBIND   ESC: BACK`;
    text(ctx, footer, VIEW_WIDTH / 2, VIEW_HEIGHT - 18, 8, INK, "center");
  }

  debug(): Record<string, unknown> {
    return {
      col: this.col,
      row: this.row,
      capturing: this.capturing,
      status: this.status,
      lit: this.litActions(),
      bindings: this.m.services.bindings.current,
    };
  }
}
