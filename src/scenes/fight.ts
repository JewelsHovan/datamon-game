// The fight scene: a best-of-3 match (spec 003), or free training. The scene
// manager starts it with the picks from character select; the URL shortcuts
// ?p1=<slug>&p2=<slug>, ?mode=training and ?cpu=easy|normal|hard start one
// directly (browser checks). A mirror match draws P2 in the alternate palette.
// F2 hit and hurt boxes, F3 reduced effects (F1, the debug overlay, lives in
// game.ts). In VS CPU, P2's input each step comes from the CPU controller.
import { stageReact } from "../render/stage";
import type { CpuController, CpuLevel } from "../ai/cpu";
import { ROUND } from "../data/combat";
import { getPerson, type Person } from "../data/catalog";
import { BUTTON_START } from "../input/bits";
import { drawBoxes } from "../render/boxesOverlay";
import { cameraFor, type Camera } from "../render/camera";
import { EffectsLayer } from "../render/effects";
import { drawFighter, drawShadow } from "../render/fighterRenderer";
import { Hud, legendLines } from "../render/hud";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import { drawStage } from "../render/stage";
import { createMatchState, createSandboxState } from "../sim/state";
import { step } from "../sim/step";
import type { InputPair, PlayerIndex, SimEvent, SimState } from "../sim/types";
import type { FightAssets, MenuInput, Match, Scene, SceneManager } from "./manager";
import { pressed } from "./ui";

export const DEFAULT_P1 = "julien-hovan";
/** Only Julien has generated clips so far, so the default match is a mirror match. */
export const DEFAULT_P2 = "julien-hovan";
export const DEFAULT_SEED = 1;
/** K.O. slow motion: this many steps at a quarter sim rate. */
const SLOWMO_FRAMES = 30;
/** Match-over frames before the results screen (the sim would restart the match at ROUND.matchOverFrames). */
export const RESULTS_DELAY = 150;
const CPU_LEVELS: readonly CpuLevel[] = ["easy", "normal", "hard"];

export interface FighterPick {
  p1: Person;
  p2: Person;
  seed: number;
  training: boolean;
  /** ?cpu=easy|normal|hard: P2 is the CPU at that level. */
  cpu: CpuLevel | null;
  /** The URL asks for a fight straight away (any of ?p1, ?p2, ?mode=training, ?cpu). */
  direct: boolean;
}

/** Reads ?p1, ?p2, ?seed, ?mode and ?cpu. Unknown slugs and levels fall back to the defaults with a warning. */
export function pickFighters(search: string, warn: (msg: string) => void = console.warn): FighterPick {
  const params = new URLSearchParams(search);
  const pick = (key: "p1" | "p2", fallback: string): Person => {
    const slug = params.get(key);
    const fallbackPerson = getPerson(fallback);
    if (!fallbackPerson) throw new Error(`default fighter ${fallback} missing from the catalog`);
    if (slug === null || slug === "") return fallbackPerson;
    const person = getPerson(slug);
    if (person) return person;
    warn(`Unknown fighter "${slug}" for ${key}; using ${fallback}.`);
    return fallbackPerson;
  };
  const seedParam = Number(params.get("seed"));
  const training = params.get("mode") === "training";
  let cpu: CpuLevel | null = null;
  const cpuParam = params.get("cpu");
  if (cpuParam !== null) {
    cpu = CPU_LEVELS.find((l) => l === cpuParam.toLowerCase()) ?? null;
    if (!cpu) {
      warn(`Unknown CPU level "${cpuParam}"; using normal.`);
      cpu = "normal";
    }
  }
  return {
    p1: pick("p1", DEFAULT_P1),
    p2: pick("p2", DEFAULT_P2),
    seed: Number.isInteger(seedParam) && params.has("seed") ? seedParam : DEFAULT_SEED,
    training,
    cpu: training ? null : cpu,
    direct: params.has("p1") || params.has("p2") || training || cpu !== null,
  };
}

/** The match a URL shortcut starts. */
export function matchFromPick(pick: FighterPick): Match {
  return {
    mode: pick.training ? "training" : pick.cpu ? "cpu" : "versus",
    p1: pick.p1,
    p2: pick.p2,
    cpuLevel: pick.cpu,
    seed: pick.seed,
  };
}

export class FightScene implements Scene {
  readonly name = "fight" as const;
  state: SimState;
  /** CPU controllers per slot; null for a human player. */
  readonly cpu: [CpuController | null, CpuController | null];
  readonly effects: EffectsLayer;
  readonly hud: Hud;
  /** Every sim event so far (newest last, capped). */
  readonly log: SimEvent[] = [];
  showBoxes = false;
  private slowmo = 0;
  private slowCounter = 0;
  private renderFrame = 0;

  constructor(
    private readonly m: SceneManager,
    readonly match: Match,
    readonly assets: FightAssets,
  ) {
    const { p1, p2, seed } = match;
    this.state = match.mode === "training" ? createSandboxState(seed, p1.slug, p2.slug) : createMatchState(seed, p1.slug, p2.slug);
    const level = match.mode === "cpu" ? match.cpuLevel : null;
    this.cpu = [null, level ? m.services.createCpu(level, 1, seed) : null];
    this.effects = new EffectsLayer(assets.effects, m.services.prefersReducedMotion ?? false);
    this.hud = new Hud([p1, p2], assets.portraits, ["", this.cpu[1] ? "CPU" : ""]);
  }

  /** Player slots driven by people (CPU slots excluded). */
  get humans(): PlayerIndex[] {
    return ([0, 1] as const).filter((p) => this.cpu[p] === null);
  }

  /** The inputs for this step: sampled devices for humans, decide() for CPU slots. */
  inputsFor(input: MenuInput): InputPair {
    const [a, b] = this.cpu;
    return [a ? a.decide(this.state) : input.held[0], b ? b.decide(this.state) : input.held[1]];
  }

  step(input: MenuInput): void {
    if (input.escape || pressed(input, BUTTON_START, this.humans)) {
      this.m.services.hooks.ui?.("confirm");
      this.m.toPause(this);
      return;
    }
    if (this.slowmo > 0) {
      this.slowmo -= 1;
      if (this.slowCounter++ % 4 !== 0) return;
    }
    this.state = step(this.state, this.inputsFor(input));
    const events = this.state.events;
    // Every step, even without events: audio's last-10-seconds tick reads the round clock.
    this.m.services.hooks.simEvents?.(events, this.state);
    this.effects.follow(this.state);
    if (events.length) {
      this.effects.onEvents(events, this.state);
      this.hud.onEvents(events);
      for (const e of events) {
        this.log.push(e);
        if (e.type === "ko") {
          this.slowmo = SLOWMO_FRAMES;
          this.slowCounter = 0;
          stageReact("ko", e.x); // background coworkers stop and watch
        }
      }
      if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
    }
    const r = this.state.round;
    if (!r.training && r.phase === "matchover" && r.phaseFrame >= RESULTS_DELAY) {
      this.m.toResults(this, r.wins[0] >= ROUND.roundsToWin ? 0 : 1);
    }
  }

  key(code: string): boolean {
    if (code === "F2") {
      this.showBoxes = !this.showBoxes;
      return true;
    }
    if (code === "F3") {
      this.effects.reduced = !this.effects.reduced;
      return true;
    }
    return false;
  }

  /** Draws the fight; `paused` freezes render-time effects and shows the key legends. */
  render(ctx: CanvasRenderingContext2D, _frame: number, paused = false): void {
    const { state, effects, hud } = this;
    const clipSets = this.assets.clipSets;
    if (!paused) {
      this.renderFrame += 1;
      effects.tick();
      hud.tick(state);
    }
    const base = cameraFor(state);
    const off = effects.cameraOffset(this.renderFrame);
    const camera: Camera = { x: base.x + off.x, y: base.y + off.y };
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    drawStage(ctx, camera);
    for (const f of state.fighters) drawShadow(ctx, f, camera);
    // The fighter being hit is drawn last, so impacts read on top.
    const order: (0 | 1)[] = state.fighters[0].state === "hitstun" || state.fighters[0].state === "knockdown" ? [1, 0] : [0, 1];
    // Round 1 opens with both fighters' intro clips (spec 012).
    const introFrame = state.round.phase === "intro" && state.round.number === 1 && !state.round.training ? state.round.phaseFrame : -1;
    for (const i of order) drawFighter(ctx, clipSets[i], state.fighters[i], camera, effects.flash[i] > 0 ? "#ffffff" : undefined, introFrame);
    effects.drawProjectiles(ctx, state, camera);
    effects.draw(ctx, camera);
    if (this.showBoxes) drawBoxes(ctx, state, camera);
    if (effects.screenFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(effects.screenFlash / 6) * 0.7})`;
      ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    }
    const { bindings } = this.m.services;
    for (const i of [0, 1] as const) {
      const cpu = this.cpu[i];
      hud.legends[i] = cpu ? [`CPU ${cpu.level.toUpperCase()}`] : legendLines(bindings.current[i], this.m.services.hasPad(i));
    }
    const r = state.round;
    hud.draw(ctx, state, paused || r.training || (r.phase === "intro" && r.number === 1));
  }

  debug(): Record<string, unknown> {
    const r = this.state.round;
    return {
      mode: this.match.mode,
      fighters: [this.match.p1.slug, this.match.p2.slug],
      cpu: this.cpu.map((c) => c?.level ?? null),
      phase: r.phase,
      round: r.number,
      wins: [...r.wins],
      legends: this.hud.legends,
    };
  }
}
