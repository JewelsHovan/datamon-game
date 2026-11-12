// Character select (spec 005, R6): a grid of all 37 people plus a random
// tile. Fighters with generated clips are lit; the rest are dimmed and
// "coming soon". Each player has a cursor (P1 blue, P2 red), moves it with
// their directions, picks with Punch (or Start) and cancels with Kick, with a
// large preview of the fighter under the cursor. VS CPU: P1 picks their
// fighter, then the CPU's (the random tile by default), then the CPU level.
import type { CpuLevel } from "../ai/cpu";
import type { Person } from "../data/catalog";
import { BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT, BUTTON_UP } from "../input/bits";
import { keyLabel } from "../input/keymap";
import { clipFrameIndex } from "../render/clips";
import { resolveClip } from "../render/fighterRenderer";
import { text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { GameMode, Match, MenuInput, Scene, SceneManager } from "./manager";
import { BACK_BITS, CONFIRM_BITS, DIM, drawBackdrop, drawPanel, drawSmooth, GOLD, INK, nav, PLAYER_COLORS, pressed } from "./ui";

export const GRID_COLS = 8;
export const CPU_LEVELS: readonly CpuLevel[] = ["easy", "normal", "hard"];
/** Frames between both picks locking in and the versus splash. */
export const READY_FRAMES = 40;

export type Tile = Person | "random";
type Stage = "pick" | "cpu" | "level" | "ready";

const TILE = 36;
const PITCH = 38;
const GRID_X = Math.round((VIEW_WIDTH - (GRID_COLS * PITCH - 2)) / 2);
const GRID_Y = 58;

export class SelectScene implements Scene {
  readonly name = "select" as const;
  readonly tiles: readonly Tile[];
  readonly cursor: [number, number];
  readonly locked: [Person | null, Person | null] = [null, null];
  stage: Stage = "pick";
  levelIndex = 1;
  private readyFrames = 0;
  private readonly refused: [number, number] = [0, 0];

  constructor(
    private readonly m: SceneManager,
    readonly mode: GameMode,
    previous: Match | null,
  ) {
    this.tiles = [...m.services.people, "random"];
    const playable = this.tiles.findIndex((t) => t !== "random" && this.isPlayable(t));
    let lastPlayable = -1;
    this.tiles.forEach((t, i) => {
      if (t !== "random" && this.isPlayable(t)) lastPlayable = i;
    });
    const first = playable >= 0 ? playable : 0;
    const random = this.tiles.length - 1;
    const indexOf = (p: Person | undefined) => (p ? this.tiles.findIndex((t) => t !== "random" && t.slug === p.slug) : -1);
    const prev1 = indexOf(previous?.p1);
    const prev2 = indexOf(previous?.p2);
    this.cursor = [
      prev1 >= 0 ? prev1 : first,
      prev2 >= 0 ? prev2 : mode === "cpu" ? random : lastPlayable >= 0 ? lastPlayable : first,
    ];
    if (previous?.cpuLevel) this.levelIndex = Math.max(0, CPU_LEVELS.indexOf(previous.cpuLevel));
  }

  isPlayable(t: Tile): boolean {
    if (t === "random") return this.playablePeople().length > 0;
    return this.m.services.playable().has(t.slug);
  }

  playablePeople(): Person[] {
    const set = this.m.services.playable();
    return this.m.services.people.filter((p) => set.has(p.slug));
  }

  get level(): CpuLevel {
    return CPU_LEVELS[this.levelIndex]!;
  }

  step(input: MenuInput): void {
    const hooks = this.m.services.hooks;
    for (const p of [0, 1] as const) if (this.refused[p] > 0) this.refused[p] -= 1;
    if (input.escape) {
      hooks.ui?.("back");
      this.m.toTitle();
      return;
    }
    if (this.mode !== "cpu") {
      for (const p of [0, 1] as const) this.control(p, p, input);
      this.stage = this.locked[0] && this.locked[1] ? "ready" : "pick";
    } else {
      this.stepCpuMode(input);
    }
    if (this.stage !== "ready") {
      this.readyFrames = 0;
      return;
    }
    this.readyFrames += 1;
    if (this.readyFrames >= READY_FRAMES) this.m.toVersus(this.match());
  }

  /** VS CPU: P1 drives every step (their fighter, the CPU's fighter, the level). */
  private stepCpuMode(input: MenuInput): void {
    const hooks = this.m.services.hooks;
    switch (this.stage) {
      case "pick":
        this.control(0, 0, input);
        if (this.locked[0]) this.stage = "cpu";
        break;
      case "cpu":
        if (this.control(1, 0, input) === "back") {
          this.locked[0] = null;
          this.stage = "pick";
        } else if (this.locked[1]) {
          this.stage = "level";
        }
        break;
      case "level":
        if (nav(input, BUTTON_LEFT, [0])) this.moveLevel(-1);
        else if (nav(input, BUTTON_RIGHT, [0])) this.moveLevel(1);
        if (pressed(input, CONFIRM_BITS, [0])) {
          hooks.ui?.("confirm");
          this.stage = "ready";
        } else if (pressed(input, BACK_BITS, [0])) {
          hooks.ui?.("back");
          this.locked[1] = null;
          this.stage = "cpu";
        }
        break;
      case "ready":
        if (pressed(input, BACK_BITS, [0])) {
          hooks.ui?.("back");
          this.stage = "level";
        }
        break;
    }
  }

  private moveLevel(delta: number): void {
    this.levelIndex = Math.max(0, Math.min(CPU_LEVELS.length - 1, this.levelIndex + delta));
    this.m.services.hooks.ui?.("move");
  }

  /**
   * One player drives one cursor: move, pick, cancel. Returns "back" when Kick
   * is pressed with nothing locked on this cursor (the caller decides what that undoes).
   */
  private control(c: 0 | 1, p: 0 | 1, input: MenuInput): "back" | null {
    const hooks = this.m.services.hooks;
    const players = [p] as const;
    if (this.locked[c]) {
      if (pressed(input, BACK_BITS, players)) {
        this.locked[c] = null;
        hooks.ui?.("back");
      }
      return null;
    }
    if (pressed(input, BACK_BITS, players)) return "back";
    if (nav(input, BUTTON_LEFT, players)) this.move(c, 0, -1);
    else if (nav(input, BUTTON_RIGHT, players)) this.move(c, 0, 1);
    if (nav(input, BUTTON_UP, players)) this.move(c, -1, 0);
    else if (nav(input, BUTTON_DOWN, players)) this.move(c, 1, 0);
    if (pressed(input, CONFIRM_BITS, players)) this.pick(c);
    return null;
  }

  private move(c: 0 | 1, dRow: number, dCol: number): void {
    const n = this.tiles.length;
    const rows = Math.ceil(n / GRID_COLS);
    let row = Math.floor(this.cursor[c] / GRID_COLS);
    let col = this.cursor[c] % GRID_COLS;
    const rowLen = (r: number) => Math.min(GRID_COLS, n - r * GRID_COLS);
    if (dCol !== 0) col = (col + dCol + rowLen(row)) % rowLen(row);
    if (dRow !== 0) {
      row = (row + dRow + rows) % rows;
      col = Math.min(col, rowLen(row) - 1);
    }
    this.cursor[c] = row * GRID_COLS + col;
    this.m.services.hooks.ui?.("move");
  }

  private pick(c: 0 | 1): void {
    const hooks = this.m.services.hooks;
    const tile = this.tiles[this.cursor[c]]!;
    if (tile === "random") {
      const choices = this.playablePeople();
      if (choices.length > 0) {
        this.locked[c] = choices[Math.min(choices.length - 1, Math.floor(this.m.services.random() * choices.length))]!;
        hooks.ui?.("confirm");
        return;
      }
    } else if (this.isPlayable(tile)) {
      this.locked[c] = tile;
      hooks.ui?.("confirm");
      return;
    }
    // Coming soon: cannot be picked.
    this.refused[c] = 14;
    hooks.ui?.("back");
  }

  match(): Match {
    return {
      mode: this.mode,
      p1: this.locked[0]!,
      p2: this.locked[1]!,
      cpuLevel: this.mode === "cpu" ? this.level : null,
      seed: this.m.services.newSeed(),
    };
  }

  // -------------------------------------------------------------- render ----

  private tileRect(i: number): { x: number; y: number } {
    return { x: GRID_X + (i % GRID_COLS) * PITCH, y: GRID_Y + Math.floor(i / GRID_COLS) * PITCH };
  }

  /** Which cursor is shown in each panel (VS CPU shows the CPU's cursor only once P1 is done). */
  private activeCursors(): (0 | 1)[] {
    if (this.mode !== "cpu") return [0, 1];
    return this.stage === "pick" ? [0] : [0, 1];
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    drawBackdrop(ctx, frame);
    const modeLabel = this.mode === "cpu" ? "VS CPU" : this.mode === "training" ? "TRAINING" : "VS PLAYER";
    text(ctx, "SELECT YOUR FIGHTER", VIEW_WIDTH / 2, 10, 16, GOLD, "center");
    text(ctx, modeLabel, VIEW_WIDTH / 2, 32, 8, INK, "center");
    this.drawGrid(ctx, frame);
    for (const c of [0, 1] as const) this.drawPanelFor(ctx, c, frame);
    if (this.mode === "cpu") this.drawLevel(ctx, frame);
    let hint = "PICK: PUNCH OR START   CANCEL: KICK   ESC: TITLE";
    if (this.mode === "cpu") {
      hint =
        this.stage === "pick" ? "PICK YOUR FIGHTER" : this.stage === "cpu" ? "PICK THE CPU'S FIGHTER (KICK: BACK)" : this.stage === "level" ? "PICK THE CPU LEVEL: LEFT / RIGHT, PUNCH" : "";
    }
    if (this.stage === "ready") {
      const flash = Math.floor(frame / 6) % 2 === 0;
      text(ctx, "GET READY!", VIEW_WIDTH / 2, 318, 16, flash ? GOLD : INK, "center");
    } else {
      text(ctx, hint, VIEW_WIDTH / 2, 324, 8, "#aeaadc", "center");
    }
    text(ctx, "DIMMED: COMING SOON", VIEW_WIDTH / 2, VIEW_HEIGHT - 16, 8, DIM, "center");
  }

  private drawGrid(ctx: CanvasRenderingContext2D, frame: number): void {
    const art = this.m.services.art;
    this.tiles.forEach((t, i) => {
      const { x, y } = this.tileRect(i);
      const lit = this.isPlayable(t);
      ctx.fillStyle = lit ? "#2c2870" : "#151333";
      ctx.fillRect(x, y, TILE, TILE);
      if (t === "random") {
        text(ctx, "?", x + TILE / 2, y + 10, 16, lit ? GOLD : DIM, "center");
        return;
      }
      const img = art?.portrait(t) ?? null;
      if (img) {
        ctx.save();
        if (!lit) {
          ctx.globalAlpha = 0.28;
          ctx.filter = "grayscale(1)";
        }
        drawSmooth(ctx, img, x + 1, y + 1, TILE - 2, TILE - 2);
        ctx.restore();
      }
      if (!lit) {
        ctx.fillStyle = "rgba(10, 9, 28, 0.35)";
        ctx.fillRect(x, y, TILE, TILE);
      }
    });
    // Cursors: P1 outside, P2 inside, so both show on the same tile.
    for (const c of this.activeCursors()) {
      const i = this.cursor[c];
      const { x, y } = this.tileRect(i);
      const locked = this.locked[c] !== null;
      const tag = c === 1 && this.mode === "cpu" ? "CPU" : `${c + 1}P`;
      text(ctx, tag, c === 0 ? x - 3 : x + TILE + 3, y - 13, 8, PLAYER_COLORS[c], c === 0 ? "left" : "right");
      if (!locked && Math.floor(frame / 10) % 4 === 3) continue;
      const shake = this.refused[c] > 0 ? (this.refused[c] % 4 < 2 ? 2 : -2) : 0;
      const pad = c === 0 ? 4 : 2;
      const fx = x - pad + shake;
      const fy = y - pad;
      const size = TILE + pad * 2;
      ctx.fillStyle = PLAYER_COLORS[c];
      ctx.fillRect(fx, fy, size, 2);
      ctx.fillRect(fx, fy + size - 2, size, 2);
      ctx.fillRect(fx, fy, 2, size);
      ctx.fillRect(fx + size - 2, fy, 2, size);
    }
  }

  private drawPanelFor(ctx: CanvasRenderingContext2D, c: 0 | 1, frame: number): void {
    const left = c === 0;
    const w = 150;
    const x = left ? 8 : VIEW_WIDTH - 8 - w;
    const y = 58;
    const h = 250;
    const cx = x + w / 2;
    drawPanel(ctx, x, y, w, h, PLAYER_COLORS[c]);
    const isCpu = this.mode === "cpu" && c === 1;
    text(ctx, isCpu ? "CPU" : `PLAYER ${c + 1}`, cx, y + 6, 8, PLAYER_COLORS[c], "center");
    if (isCpu && this.stage === "pick") {
      text(ctx, "PICK YOURS", cx, y + 110, 8, DIM, "center");
      text(ctx, "FIRST", cx, y + 124, 8, DIM, "center");
      return;
    }
    const tile: Tile = this.locked[c] ?? this.tiles[this.cursor[c]]!;
    const footY = y + 178;
    if (tile === "random") {
      text(ctx, "?", cx, y + 80, 40, GOLD, "center");
      text(ctx, "RANDOM", cx, footY + 10, 16, INK, "center");
      return;
    }
    const playable = this.isPlayable(tile);
    const art = this.m.services.art;
    const other = this.locked[left ? 1 : 0] ?? (this.activeCursors().includes(left ? 1 : 0) ? this.tiles[this.cursor[left ? 1 : 0]] : null);
    const alt = !left && other !== "random" && other?.slug === tile.slug;
    const set = playable ? (art?.clips(tile, alt) ?? null) : null;
    if (set) {
      const clip = resolveClip(set, "idle");
      const f = clip.frames[clipFrameIndex(clip, frame)]!;
      ctx.save();
      if (!left) {
        ctx.translate(cx * 2, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(set.atlas, f.x, f.y, f.w, f.h, Math.round(cx - f.ax), footY - f.ay, f.w, f.h);
      ctx.restore();
    } else {
      const img = art?.portrait(tile) ?? null;
      if (img) {
        ctx.save();
        if (!playable) {
          ctx.globalAlpha = 0.4;
          ctx.filter = "grayscale(1)";
        }
        drawSmooth(ctx, img, cx - 52, y + 50, 104, 98);
        ctx.restore();
      }
    }
    text(ctx, tile.shortName.toUpperCase(), cx, footY + 10, tile.shortName.length > 9 ? 8 : 16, INK, "center");
    if (!playable) {
      text(ctx, "COMING SOON", cx, footY + 34, 8, GOLD, "center");
      return;
    }
    const info = this.m.services.info(tile.slug);
    if (info.archetype) text(ctx, info.archetype.toUpperCase(), cx, footY + 32, 8, GOLD, "center");
    if (info.special) text(ctx, info.special.toUpperCase(), cx, footY + 46, 8, "#aeaadc", "center");
    if (this.locked[c]) {
      text(ctx, "READY", cx, footY + 60, 8, PLAYER_COLORS[c], "center");
    } else if (!isCpu) {
      const b = this.m.services.bindings;
      text(ctx, `${keyLabel(b.keyFor(c, "punch"))} PICK  ${keyLabel(b.keyFor(c, "kick"))} BACK`, cx, footY + 60, 8, DIM, "center");
    }
  }

  private drawLevel(ctx: CanvasRenderingContext2D, frame: number): void {
    const active = this.stage === "level";
    const y = GRID_Y + 5 * PITCH + 8;
    text(ctx, "CPU LEVEL", VIEW_WIDTH / 2, y, 8, active ? INK : DIM, "center");
    CPU_LEVELS.forEach((l, k) => {
      const on = k === this.levelIndex;
      const x = VIEW_WIDTH / 2 + (k - 1) * 84;
      const blink = active && on && Math.floor(frame / 12) % 2 === 0;
      text(ctx, l.toUpperCase(), x, y + 16, 8, on ? (blink ? INK : GOLD) : DIM, "center");
      if (on && (active || this.stage === "ready")) {
        ctx.fillStyle = GOLD;
        ctx.fillRect(x - l.length * 4 - 2, y + 27, l.length * 8 + 4, 1);
      }
    });
  }

  debug(): Record<string, unknown> {
    const slug = (t: Tile | null | undefined) => (t === "random" ? "random" : (t?.slug ?? null));
    return {
      mode: this.mode,
      stage: this.stage,
      cursors: [...this.cursor],
      under: this.cursor.map((i) => slug(this.tiles[i])),
      locked: this.locked.map((p) => p?.slug ?? null),
      level: this.level,
      tiles: this.tiles.map((t) => slug(t)),
      playable: [...this.m.services.playable()],
    };
  }
}
