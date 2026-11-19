import { CPU_LEVELS, type CpuLevel } from "../ai/levels";
import type { Person } from "../data/catalog";
import { BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT, BUTTON_UP } from "../input/bits";
import { text } from "../render/hud";
import type { PlayerIndex } from "../sim/types";
import type { Match, MenuInput, Scene, SceneManager } from "./manager";
import { BACK_BITS, CONFIRM_BITS, DIM, drawBackdrop, drawPanel, drawSmooth, GOLD, INK, Menu, nav, pressed } from "./ui";

const TEAL = "#6be0ca";
const BOUTS = ["SEMIFINAL A", "SEMIFINAL B", "FINAL"] as const;
type Four<T> = [T, T, T, T];
type EntrantId = 0 | 1 | 2 | 3;
type Bout = 0 | 1 | 2;
type Slot = { cpu: boolean; slug: string | null };
type Entrant = { cpu: boolean; person: Person };
const IDS = [0, 1, 2, 3] as const;

export class Cup {
  readonly winners: [EntrantId | null, EntrantId | null, EntrantId | null] = [null, null, null];
  get next(): Bout | null {
    if (this.winners[0] === null) return 0;
    if (this.winners[1] === null) return 1;
    return this.winners[2] === null ? 2 : null;
  }

  constructor(readonly entrants: Four<Entrant>, readonly level: CpuLevel) {}

  pair(bout: Bout): [EntrantId, EntrantId] | null {
    if (bout === 0) return [0, 1];
    if (bout === 1) return [2, 3];
    const [a, b] = this.winners;
    return a === null || b === null ? null : [a, b];
  }

  match(seed: number): Match | null {
    const bout = this.next;
    if (bout === null) return null;
    const pair = this.pair(bout);
    if (!pair) return null;
    const [left, right] = pair;
    const a = this.entrants[left];
    const b = this.entrants[right];
    return { mode: "versus", p1: a.person, p2: b.person, seed, cpuLevel: null,
      cup: { bracket: this, bout, entrants: pair, cpu: [a.cpu ? this.level : null, b.cpu ? this.level : null], label: BOUTS[bout] } };
  }

  record(match: Match, winner: PlayerIndex): void {
    const bout = this.next;
    if (bout === null || match.cup?.bracket !== this || match.cup.bout !== bout) return;
    const pair = this.pair(bout);
    if (pair) this.winners[bout] = pair[winner];
  }
}

function header(ctx: CanvasRenderingContext2D, frame: number, subtitle: string): void {
  drawBackdrop(ctx, frame);
  text(ctx, "OFFICE CUP", 320, 22, 24, GOLD, "center");
  text(ctx, subtitle, 320, 56, 8, TEAL, "center");
}

function face(ctx: CanvasRenderingContext2D, m: SceneManager, person: Person | null, x: number, y: number): void {
  const img = person && m.services.art?.portrait(person);
  ctx.fillStyle = "#25214a";
  ctx.fillRect(x, y, 26, 26);
  if (img) drawSmooth(ctx, img, x, y, 26, 26);
  else if (!person) text(ctx, "?", x + 13, y + 7, 12, DIM, "center");
}

/** Setup reads the same playable roster and menu input as character select. */
export class CupSetupScene implements Scene {
  readonly name = "cupSetup" as const;
  private readonly slots: Four<Slot> = [{ cpu: false, slug: null }, { cpu: true, slug: null }, { cpu: true, slug: null }, { cpu: true, slug: null }];
  private level: CpuLevel = "normal";
  private row = 0;
  private field = 1;

  constructor(private readonly m: SceneManager, previous?: Cup) {
    if (previous) {
      this.level = previous.level;
      for (const i of IDS) this.slots[i] = { cpu: previous.entrants[i].cpu, slug: previous.entrants[i].person.slug };
      this.row = 5;
    }
  }

  private get pool(): Person[] {
    const ready = this.m.services.playable();
    return this.m.services.people.filter((p) => ready.has(p.slug));
  }

  step(input: MenuInput): void {
    if (input.escape || pressed(input, BACK_BITS)) {
      this.m.services.hooks.ui?.("back");
      this.m.toTitle();
      return;
    }
    const vertical = nav(input, BUTTON_UP) ? -1 : nav(input, BUTTON_DOWN) ? 1 : 0;
    if (vertical) {
      this.row = (this.row + vertical + 6) % 6;
      this.m.services.hooks.ui?.("move");
      return;
    }
    const horizontal = nav(input, BUTTON_LEFT) ? -1 : nav(input, BUTTON_RIGHT) ? 1 : 0;
    const slot = this.slots[this.row];
    if (horizontal) {
      if (slot && this.field === 0) slot.cpu = !slot.cpu;
      else if (slot) {
        const choices = [null, ...this.pool.map((p) => p.slug)];
        slot.slug = choices[(choices.indexOf(slot.slug) + choices.length + horizontal) % choices.length] ?? null;
      } else if (this.row === 4) {
        this.level = CPU_LEVELS[(CPU_LEVELS.indexOf(this.level) + CPU_LEVELS.length + horizontal) % CPU_LEVELS.length] ?? "normal";
      }
      this.m.services.hooks.ui?.("move");
      return;
    }
    if (!pressed(input, CONFIRM_BITS)) return;
    this.m.services.hooks.ui?.("confirm");
    if (slot) this.field = 1 - this.field;
    else if (this.row === 4) this.row = 5;
    else {
      const pool = this.pool;
      const first = pool[0];
      if (!first) return;
      const resolve = (s: Slot): Entrant => ({ cpu: s.cpu,
        person: pool.find((p) => p.slug === s.slug) ?? pool[Math.floor(this.m.services.random() * pool.length)] ?? first });
      const [a, b, c, d] = this.slots;
      this.m.toCupBracket(new Cup([resolve(a), resolve(b), resolve(c), resolve(d)], this.level));
    }
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    header(ctx, frame, "FOUR ENTRANTS / SINGLE ELIMINATION");
    text(ctx, "SLOT", 92, 83, 8, DIM, "left");
    text(ctx, "CONTROL", 201, 83, 8, DIM, "left");
    text(ctx, "FIGHTER", 363, 83, 8, DIM, "left");
    const pool = this.pool;
    this.slots.forEach((slot, i) => {
      const y = 98 + i * 37;
      const selected = i === this.row;
      drawPanel(ctx, 76, y, 488, 34, selected ? TEAL : "#3e3a80");
      text(ctx, `0${i + 1}`, 94, y + 12, 10, selected ? TEAL : DIM, "left");
      const typeOn = selected && this.field === 0;
      const fighterOn = selected && this.field === 1;
      text(ctx, typeOn ? `< ${slot.cpu ? "CPU" : "HUMAN"} >` : (slot.cpu ? "CPU" : "HUMAN"), 232, y + 12, 8, typeOn ? GOLD : INK, "center");
      const person = pool.find((p) => p.slug === slot.slug) ?? null;
      face(ctx, this.m, person, 326, y + 4);
      const name = person?.shortName.toUpperCase() ?? "RANDOM";
      text(ctx, fighterOn ? `< ${name} >` : name, 363, y + 12, 8, fighterOn ? GOLD : INK, "left");
    });
    text(ctx, `CPU LEVEL: < ${this.level.toUpperCase()} >`, 320, 257, 8, this.row === 4 ? GOLD : INK, "center");
    drawPanel(ctx, 187, 277, 266, 36, this.row === 5 ? GOLD : "#3e3a80");
    text(ctx, !pool.length ? "LOADING ROSTER" : "START CUP", 320, 290, 10, this.row === 5 ? GOLD : INK, "center");
    text(ctx, "UP/DOWN: ROW  LEFT/RIGHT: CHANGE", 320, 327, 8, INK, "center");
    text(ctx, "PUNCH/ENTER: SWITCH FIELD OR START   KICK: BACK", 320, 341, 8, DIM, "center");
  }

  debug(): Record<string, unknown> {
    return { row: this.row, field: this.field, slots: this.slots.map((s) => ({ ...s })), level: this.level };
  }

  describe(): string { return "Configure four human or CPU entrants. Up and down to choose a row; punch switches between control and fighter, left and right change the value."; }
}

export class CupBracketScene implements Scene {
  readonly name = "cupBracket" as const;
  private readonly menu: Menu;

  constructor(private readonly m: SceneManager, readonly cup: Cup) {
    const bout = cup.next;
    this.menu = new Menu([bout === null ? "NEW CUP" : `PLAY ${BOUTS[bout]}`, "RETURN TO TITLE"], m.services.hooks);
  }

  step(input: MenuInput): void {
    const action = this.menu.step(input);
    if (action === 0) {
      const match = this.cup.match(this.m.services.newSeed());
      if (match) this.m.toVersus(match);
      else this.m.toCupSetup(this.cup);
    } else if (action === 1) this.m.toTitle();
    else if (action === "back") this.menu.index = 1;
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    const done = this.cup.next === null;
    header(ctx, frame, done ? "CHAMPIONSHIP COMPLETE" : `${this.cup.level.toUpperCase()} CPU / BEST OF THREE`);
    const [a, b, champ] = this.cup.winners;
    const card = (id: EntrantId | null, x: number, y: number, w: number, color: string, fallback: string) => {
      const e = id === null ? null : this.cup.entrants[id];
      drawPanel(ctx, x, y, w, 39, color);
      if (!e || id === null) {
        text(ctx, fallback, x + 8, y + 16, 8, DIM, "left");
        return;
      }
      face(ctx, this.m, e.person, x + 7, y + 6);
      text(ctx, e.person.shortName.toUpperCase(), x + 40, y + 7, 8, INK, "left");
      text(ctx, `0${id + 1} / ${e.cpu ? "CPU" : "HUMAN"}`, x + 40, y + 23, 8, color === GOLD || color === TEAL ? color : DIM, "left");
    };
    // Trace the bracket like a circuit: each completed semifinal lights its path to the final.
    function trace(y1: number, y2: number, out: number, winner: EntrantId | null, first: EntrantId): void {
      ctx.fillStyle = "#433d74";
      ctx.fillRect(216, y1, 23, 2); ctx.fillRect(216, y2, 23, 2);
      ctx.fillRect(237, y1, 2, y2 - y1); ctx.fillRect(237, out, 20, 2);
      if (winner === null) return;
      const y = winner === first ? y1 : y2;
      ctx.fillStyle = TEAL;
      ctx.fillRect(216, y, 23, 2); ctx.fillRect(237, Math.min(y, out), 2, Math.abs(y - out)); ctx.fillRect(237, out, 20, 2);
    }
    trace(118, 163, 142, a, 0);
    trace(219, 264, 239, b, 2);
    ctx.fillStyle = champ === null ? "#433d74" : GOLD;
    const finalY = champ === null ? 142 : champ === a ? 142 : 239;
    if (champ === null) ctx.fillRect(421, 239, 15, 2);
    ctx.fillRect(421, finalY, 15, 2); ctx.fillRect(434, Math.min(190, finalY), 2, champ === null ? 98 : Math.abs(finalY - 190));
    ctx.fillRect(434, 190, 18, 2);
    text(ctx, "SEMIFINAL A", 52, 83, 8, this.cup.next === 0 ? TEAL : DIM, "left");
    text(ctx, "SEMIFINAL B", 52, 185, 8, this.cup.next === 1 ? TEAL : DIM, "left");
    text(ctx, "FINAL", 257, 104, 8, this.cup.next === 2 ? TEAL : DIM, "left");
    text(ctx, "CHAMPION", 452, 153, 8, GOLD, "left");
    const rows = [99, 144, 200, 245] as const;
    for (const id of IDS) card(id, 52, rows[id], 164, a === id || b === id ? TEAL : "#433d74", "");
    card(a, 257, 123, 164, champ !== null && champ === a ? GOLD : "#433d74", "WINNER A");
    card(b, 257, 220, 164, champ !== null && champ === b ? GOLD : "#433d74", "WINNER B");
    card(champ, 452, 171, 166, champ === null ? "#433d74" : GOLD, "WINNER FINAL");
    this.menu.draw(ctx, 320, 306, frame, 8, 19);
  }

  debug(): Record<string, unknown> {
    return { next: this.cup.next, winners: [...this.cup.winners], entrants: this.cup.entrants.map((e) => ({ cpu: e.cpu, slug: e.person.slug })), item: this.menu.selected };
  }

  describe(): string {
    const champ = this.cup.winners[2];
    const next = this.cup.next;
    if (champ !== null) return `${this.cup.entrants[champ].person.shortName}, entrant ${champ + 1}, wins the Office Cup.`;
    if (next === null) return "Office Cup bracket.";
    const names = this.cup.pair(next)?.map((id) => {
      const entry = this.cup.entrants[id];
      return `entrant ${id + 1}, ${entry.person.shortName}, ${entry.cpu ? "CPU" : "human"}`;
    });
    return `Next: ${BOUTS[next]}, ${names?.join(" versus ")}.`;
  }
}
