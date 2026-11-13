// Shared menu logic and drawing for the scenes: a vertical list menu either
// player can drive, input helpers, player colors and backdrops.
import { BUTTON_DOWN, BUTTON_KICK, BUTTON_PUNCH, BUTTON_START, BUTTON_UP } from "../input/bits";
import { text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { GameHooks, MenuInput } from "./manager";

export const PLAYER_COLORS = ["#4aa8ff", "#ff5a5a"] as const;
export const INK = "#eeedff";
export const GOLD = "#ffc94a";
export const DIM = "#8a87b8";

/** The FULLSCREEN item, on the title and pause menus when the page can go fullscreen (spec 014). */
export const FULLSCREEN_ITEM = "FULLSCREEN";

/** Punch or Start confirms in menus; Kick goes back. */
export const CONFIRM_BITS = BUTTON_PUNCH | BUTTON_START;
export const BACK_BITS = BUTTON_KICK;

export type Players = readonly (0 | 1)[];
export const BOTH: Players = [0, 1];

export function pressed(input: MenuInput, bits: number, players: Players = BOTH): boolean {
  return players.some((p) => (input.pressed[p] & bits) !== 0);
}

export function nav(input: MenuInput, bits: number, players: Players = BOTH): boolean {
  return players.some((p) => (input.nav[p] & bits) !== 0);
}

/** A vertical list menu. step() returns the confirmed item index, "back", or null. */
export class Menu {
  index = 0;
  /** What an item reads on screen (an item whose words follow a setting, such as SOUND ON / SOUND OFF). */
  labelOf: (item: string) => string = (item) => item;

  constructor(
    readonly items: readonly string[],
    private readonly hooks: GameHooks,
  ) {}

  get selected(): string {
    return this.items[this.index]!;
  }

  /** The items as they read on screen. */
  get labels(): string[] {
    return this.items.map((item) => this.labelOf(item));
  }

  step(input: MenuInput, players: Players = BOTH): number | "back" | null {
    if (nav(input, BUTTON_UP, players)) this.move(-1);
    else if (nav(input, BUTTON_DOWN, players)) this.move(1);
    if (pressed(input, CONFIRM_BITS, players)) {
      this.hooks.ui?.("confirm");
      return this.index;
    }
    if (pressed(input, BACK_BITS, players) || input.escape) {
      this.hooks.ui?.("back");
      return "back";
    }
    return null;
  }

  private move(delta: number): void {
    this.index = (this.index + delta + this.items.length) % this.items.length;
    this.hooks.ui?.("move");
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, y: number, frame: number, size = 16, gap = 26): void {
    this.labels.forEach((item, i) => {
      const on = i === this.index;
      const yy = y + i * gap;
      text(ctx, item, cx, yy, size, on ? GOLD : DIM, "center");
      if (on && Math.floor(frame / 16) % 2 === 0) {
        const half = (item.length * size) / 2;
        text(ctx, ">", cx - half - size - 6, yy, size, GOLD, "left");
        text(ctx, "<", cx + half + 6, yy, size, GOLD, "left");
      }
    });
  }
}

let backdropCache: { ctx: CanvasRenderingContext2D; g: CanvasGradient } | null = null;

/** Dark navy backdrop with a slow scrolling grid (render time only). */
export function drawBackdrop(ctx: CanvasRenderingContext2D, frame: number): void {
  if (!backdropCache || backdropCache.ctx !== ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
    g.addColorStop(0, "#0b0a1f");
    g.addColorStop(0.55, "#17154a");
    g.addColorStop(1, "#2a1f5c");
    backdropCache = { ctx, g };
  }
  ctx.fillStyle = backdropCache.g;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  ctx.fillStyle = "rgba(120, 110, 220, 0.12)";
  const off = Math.floor(frame / 3) % 24;
  for (let x = -24 + off; x < VIEW_WIDTH; x += 24) ctx.fillRect(x, 0, 1, VIEW_HEIGHT);
  for (let y = -24 + off; y < VIEW_HEIGHT; y += 24) ctx.fillRect(0, y, VIEW_WIDTH, 1);
}

/** A framed dark panel. */
export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, border = "#3e3a80"): void {
  ctx.fillStyle = "#0d0c22";
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = border;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = "rgba(13, 12, 34, 0.92)";
  ctx.fillRect(x, y, w, h);
}

/** Draws an image scaled into a box with smoothing (portraits downscale cleanly). */
export function drawSmooth(ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, x, y, w, h);
  ctx.imageSmoothingEnabled = prev;
}
