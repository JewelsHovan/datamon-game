// Minimal fight HUD (spec 003, R7): health bars with a delayed damage trail,
// portraits and names, round pips, the timer, the announcer and combo text,
// and each player's key legend under their bar (spec 005, R7).
// Drawn at the 640x360 internal resolution in the Press Start 2P pixel font.
import { COMBAT, ROUND } from "../data/combat";
import type { Person } from "../data/catalog";
import { keyLabel, type KeyBindings } from "../input/keymap";
import type { SimEvent, SimState } from "../sim/types";
import { VIEW_WIDTH } from "./screen";

export const HUD_FONT = '"Press Start 2P", ui-monospace, monospace';

const BAR_W = 250;
const BAR_H = 12;
const BAR_Y = 18;
const MARGIN = 16;
const TRAIL_DELAY = 24;

interface Popup {
  text: string;
  color: string;
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
}

export class Hud {
  private trail: [number, number] = [COMBAT.maxHealth, COMBAT.maxHealth];
  private trailWait: [number, number] = [0, 0];
  private popups: Popup[] = [];
  private combo: [{ hits: number; age: number }, { hits: number; age: number }] = [{ hits: 0, age: 99 }, { hits: 0, age: 99 }];

  constructor(
    private readonly people: [Person, Person],
    private readonly portraits: [CanvasImageSource | null, CanvasImageSource | null],
    /** Appended to each name, e.g. "CPU". */
    private readonly tags: [string, string] = ["", ""],
  ) {}

  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === "hit") {
        this.trailWait[e.target] = TRAIL_DELAY;
        if (e.combo >= 2) this.combo[e.player] = { hits: e.combo, age: 0 };
      } else if (e.type === "block") {
        this.trailWait[e.target] = TRAIL_DELAY;
      } else if (e.type === "trade") {
        this.popups.push({ text: "MERGE CONFLICT!", color: "#ff6170", x: VIEW_WIDTH / 2, y: 120, age: 0, life: 55, size: 16 });
      } else if (e.type === "tech") {
        this.popups.push({ text: "TECH", color: "#7fd6ff", x: VIEW_WIDTH / 2, y: 120, age: 0, life: 40, size: 16 });
      } else if (e.type === "round_start") {
        this.trail = [COMBAT.maxHealth, COMBAT.maxHealth];
      }
    }
  }

  /** Advances render-time clocks (trail drain, popups, combo fade). */
  tick(state: SimState): void {
    for (const i of [0, 1] as const) {
      const h = state.fighters[i].health;
      if (this.trail[i] < h) this.trail[i] = h;
      if (this.trailWait[i] > 0) this.trailWait[i] -= 1;
      else if (this.trail[i] > h) this.trail[i] = Math.max(h, this.trail[i] - 12);
      this.combo[i].age += 1;
    }
    for (const p of this.popups) p.age += 1;
    this.popups = this.popups.filter((p) => p.age < p.life);
  }

  /** Key legend lines per player, drawn under the bars when draw() is asked to. */
  legends: [readonly string[] | null, readonly string[] | null] = [null, null];

  draw(ctx: CanvasRenderingContext2D, state: SimState, showLegends = false): void {
    ctx.save();
    ctx.textBaseline = "top";
    for (const i of [0, 1] as const) this.drawBar(ctx, state, i);
    if (showLegends) for (const i of [0, 1] as const) this.drawLegend(ctx, i);
    this.drawTimer(ctx, state);
    this.drawAnnouncer(ctx, state);
    for (const i of [0, 1] as const) this.drawCombo(ctx, i);
    for (const p of this.popups) {
      const t = p.age / p.life;
      const pop = p.age < 6 ? 1.4 - p.age * 0.066 : 1;
      text(ctx, p.text, p.x, p.y - Math.round(t * 12), Math.round(p.size * pop), p.color, "center");
    }
    if (state.round.training) {
      text(ctx, "TRAINING", VIEW_WIDTH / 2, 50, 8, "#9fb8d8", "center");
    }
    ctx.restore();
  }

  private drawBar(ctx: CanvasRenderingContext2D, state: SimState, i: 0 | 1): void {
    const f = state.fighters[i];
    const left = i === 0;
    const x0 = left ? MARGIN + 34 : VIEW_WIDTH - MARGIN - 34 - BAR_W;
    // Frame
    ctx.fillStyle = "#0d0c22";
    ctx.fillRect(x0 - 2, BAR_Y - 2, BAR_W + 4, BAR_H + 4);
    ctx.fillStyle = "#3e3a80";
    ctx.fillRect(x0 - 1, BAR_Y - 1, BAR_W + 2, BAR_H + 2);
    ctx.fillStyle = "#1b1a48";
    ctx.fillRect(x0, BAR_Y, BAR_W, BAR_H);
    // Bars drain toward the outer edge, anchored at the center of the screen.
    const w = (hp: number) => Math.round((BAR_W * hp) / COMBAT.maxHealth);
    const trailW = w(this.trail[i]);
    const hpW = w(f.health);
    const anchorRight = left; // P1's bar is anchored on its right (center) end
    const at = (width: number) => (anchorRight ? x0 + BAR_W - width : x0);
    ctx.fillStyle = "#ff6170";
    ctx.fillRect(at(trailW), BAR_Y, trailW, BAR_H);
    const low = f.health <= COMBAT.maxHealth * 0.25;
    ctx.fillStyle = low ? "#ffab4c" : "#ffc94a";
    ctx.fillRect(at(hpW), BAR_Y, hpW, BAR_H);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(at(hpW), BAR_Y, hpW, 3);
    // Portrait
    const px = left ? MARGIN : VIEW_WIDTH - MARGIN - 30;
    ctx.fillStyle = "#0d0c22";
    ctx.fillRect(px - 1, BAR_Y - 4, 32, 30);
    const img = this.portraits[i];
    if (img) {
      ctx.save();
      if (!left) {
        ctx.translate(px + 30, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, BAR_Y - 3, 30, 28);
      } else {
        ctx.drawImage(img, px, BAR_Y - 3, 30, 28);
      }
      ctx.restore();
    }
    // Name and round pips
    const name = this.people[i].shortName.toUpperCase() + (i === 1 && state.fighters[0].slug === state.fighters[1].slug ? " (ALT)" : "") + (this.tags[i] ? ` ${this.tags[i]}` : "");
    text(ctx, name, left ? x0 : x0 + BAR_W, BAR_Y + BAR_H + 6, 8, "#eeedff", left ? "left" : "right");
    if (!state.round.training) {
      for (let k = 0; k < ROUND.roundsToWin; k++) {
        const won = state.round.wins[i] > k;
        const cx = left ? x0 + BAR_W - 6 - k * 14 : x0 + 6 + k * 14;
        ctx.fillStyle = "#0d0c22";
        ctx.fillRect(cx - 5, BAR_Y + BAR_H + 5, 10, 10);
        ctx.fillStyle = won ? "#ffc94a" : "#3e3a80";
        ctx.fillRect(cx - 4, BAR_Y + BAR_H + 6, 8, 8);
      }
    }
  }

  private drawLegend(ctx: CanvasRenderingContext2D, i: 0 | 1): void {
    const lines = this.legends[i];
    if (!lines || lines.length === 0) return;
    const left = i === 0;
    const width = Math.max(...lines.map((l) => l.length)) * 8 + 10;
    const x = left ? MARGIN + 34 : VIEW_WIDTH - MARGIN - 34;
    const y = BAR_Y + BAR_H + 22;
    ctx.fillStyle = "rgba(13, 12, 34, 0.72)";
    ctx.fillRect(left ? x - 5 : x - width + 5, y - 4, width, lines.length * 12 + 6);
    ctx.fillStyle = left ? "#4aa8ff" : "#ff5a5a";
    ctx.fillRect(left ? x - 5 : x + 4, y - 4, 1, lines.length * 12 + 6);
    lines.forEach((line, k) => text(ctx, line, x, y + k * 12, 8, "#eeedff", left ? "left" : "right"));
  }

  private drawTimer(ctx: CanvasRenderingContext2D, state: SimState): void {
    const r = state.round;
    const label = r.training ? "--" : String(Math.ceil(r.timer / 60)).padStart(2, "0");
    const urgent = !r.training && r.timer <= 600 && r.phase === "fight";
    text(ctx, label, VIEW_WIDTH / 2, BAR_Y - 2, 16, urgent ? "#ff6170" : "#eeedff", "center");
  }

  private drawAnnouncer(ctx: CanvasRenderingContext2D, state: SimState): void {
    const r = state.round;
    let line = "";
    let color = "#ffc94a";
    let size = 24;
    if (r.phase === "intro") {
      if (r.phaseFrame < 60) line = `ROUND ${r.number}`;
      else { line = "FIGHT!"; color = "#ff6170"; size = 32; }
    } else if (r.phase === "ko") {
      if (r.phaseFrame < 70) {
        line = r.reason === "time" ? "TIME" : r.winner === 2 ? "DOUBLE K.O." : "K.O.";
        color = "#ff6170";
        size = 32;
        if (r.phaseFrame < 8) size = 40 - r.phaseFrame;
      } else if (r.winner === 2) {
        line = "DRAW";
      } else if (r.winner === 0 || r.winner === 1) {
        line = `${this.people[r.winner].shortName.toUpperCase()} WINS`;
        size = 16;
      }
    } else if (r.phase === "matchover" && (r.wins[0] >= ROUND.roundsToWin || r.wins[1] >= ROUND.roundsToWin)) {
      const w = r.wins[0] >= ROUND.roundsToWin ? 0 : 1;
      text(ctx, `${this.people[w].shortName.toUpperCase()}`, VIEW_WIDTH / 2, 120, 24, "#ffc94a", "center");
      text(ctx, "WINS THE MATCH", VIEW_WIDTH / 2, 156, 16, "#eeedff", "center");
      if (state.fighters[w].health >= COMBAT.maxHealth) text(ctx, "PERFECT", VIEW_WIDTH / 2, 186, 16, "#63e294", "center");
      text(ctx, "PROD IS DOWN.", VIEW_WIDTH / 2, 230, 8, "#aeaadc", "center");
      return;
    }
    if (line) text(ctx, line, VIEW_WIDTH / 2, 130 - Math.round(size / 2), size, color, "center");
  }

  private drawCombo(ctx: CanvasRenderingContext2D, i: 0 | 1): void {
    const c = this.combo[i];
    if (c.age > 70 || c.hits < 2) return;
    const left = i === 0;
    const x = left ? MARGIN + 4 : VIEW_WIDTH - MARGIN - 4;
    text(ctx, `${c.hits} HITS`, x, 96, 16, "#ffc94a", left ? "left" : "right");
    text(ctx, "COMBO", x, 116, 8, "#eeedff", left ? "left" : "right");
  }
}

/** Pixel-font text with a hard 1px dark outline. */
export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign,
): void {
  ctx.font = `${size}px ${HUD_FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#0d0c22";
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [2, 2]] as const) ctx.fillText(s, Math.round(x) + dx, Math.round(y) + dy);
  ctx.fillStyle = color;
  ctx.fillText(s, Math.round(x), Math.round(y));
}

/** How a player's four directions read on a legend: "WASD", "ARROWS", or the four keys. */
export function moveLabel(b: KeyBindings): string {
  const keys = [b.up[0], b.left[0], b.down[0], b.right[0]];
  if (keys.join() === "ArrowUp,ArrowLeft,ArrowDown,ArrowRight") return "ARROWS";
  const labels = keys.map(keyLabel);
  return labels.every((l) => l.length === 1) ? labels.join("") : labels.join(" ");
}

/** A player's key legend (their actual bindings), two lines; pad buttons when they hold a gamepad. */
export function legendLines(b: KeyBindings, hasPad = false): [string, string] {
  if (hasPad) return ["A PUNCH  B KICK  X/Y SPECIAL", "D-PAD MOVE  A+B THROW"];
  const p = keyLabel(b.punch[0]);
  const k = keyLabel(b.kick[0]);
  const s = keyLabel(b.special[0]);
  return [`${p} PUNCH  ${k} KICK  ${s} SPECIAL`, `${moveLabel(b)} MOVE  ${p}+${k} THROW`];
}
