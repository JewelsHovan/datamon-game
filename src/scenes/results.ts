// Results: the match winner in their victory pose, then Rematch (same
// fighters, a fresh match) or Character select.
import { clipFrameIndex } from "../render/clips";
import { resolveClip } from "../render/fighterRenderer";
import { text } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import type { PlayerIndex } from "../sim/types";
import type { FightScene } from "./fight";
import type { MenuInput, Scene, SceneManager } from "./manager";
import { drawBackdrop, drawPanel, GOLD, INK, Menu, PLAYER_COLORS } from "./ui";

export const RESULTS_ITEMS = ["REMATCH", "CHARACTER SELECT"] as const;

export class ResultsScene implements Scene {
  readonly name = "results" as const;
  readonly menu: Menu;

  constructor(
    private readonly m: SceneManager,
    readonly fight: FightScene,
    readonly winner: PlayerIndex,
  ) {
    this.menu = new Menu(fight.match.cup ? ["VIEW BRACKET"] : RESULTS_ITEMS, m.services.hooks);
  }

  step(input: MenuInput): void {
    const match = this.fight.match;
    const r = this.menu.step(input, match.cup ? undefined : this.fight.humans);
    if (r === null) return;
    if (match.cup) this.m.toCupBracket(match.cup.bracket);
    else if (r === 0) this.m.toFight({ ...match, seed: this.m.services.newSeed() }, this.fight.assets);
    else this.m.toSelect(match.mode, match);
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    drawBackdrop(ctx, frame);
    const w = this.winner;
    const match = this.fight.match;
    const person = w === 0 ? match.p1 : match.p2;
    const cpuWon = this.fight.cpu[w] !== null;
    // Winner in the victory pose, on a spotlight.
    const set = this.fight.assets.clipSets[w];
    const clip = resolveClip(set, "victory");
    const f = clip.frames[clipFrameIndex(clip, frame)]!;
    ctx.fillStyle = "rgba(255, 201, 74, 0.12)";
    ctx.fillRect(VIEW_WIDTH / 2 - 90, 60, 180, 196);
    ctx.drawImage(set.atlas, f.x, f.y, f.w, f.h, Math.round(VIEW_WIDTH / 2 - f.ax), 250 - f.ay, f.w, f.h);
    const title = match.cup
      ? `#${match.cup.entrants[w] + 1} ${match.cup.bout === 2 ? "WINS THE CUP" : "ADVANCES"}`
      : cpuWon ? "CPU WINS" : `PLAYER ${w + 1} WINS`;
    text(ctx, title, VIEW_WIDTH / 2, 16, 16, PLAYER_COLORS[w], "center");
    text(ctx, person.shortName.toUpperCase(), VIEW_WIDTH / 2, 38, 16, GOLD, "center");
    const wins = this.fight.state.round.wins;
    text(ctx, `${wins[0]} - ${wins[1]}`, VIEW_WIDTH / 2, 262, 8, INK, "center");
    drawPanel(ctx, VIEW_WIDTH / 2 - 120, 278, 240, 64);
    this.menu.draw(ctx, VIEW_WIDTH / 2, 288, frame, 8, 22);
    const quote = this.m.services.info(person.slug).winQuote ?? "MERGED TO MAIN.";
    text(ctx, quote, VIEW_WIDTH / 2, VIEW_HEIGHT - 12, 8, "#aeaadc", "center");
  }

  debug(): Record<string, unknown> {
    return { winner: this.winner, index: this.menu.index, item: this.menu.selected };
  }

  describe(): string {
    const match = this.fight.match;
    const person = this.winner === 0 ? match.p1 : match.p2;
    const who = match.cup ? `entrant ${match.cup.entrants[this.winner] + 1}, ${person.shortName},`
      : this.fight.cpu[this.winner] ? `the CPU, ${person.shortName},` : `player ${this.winner + 1}, ${person.shortName},`;
    const [a, b] = this.fight.state.round.wins;
    return `${who} wins ${Math.max(a, b)} to ${Math.min(a, b)}`;
  }
}
