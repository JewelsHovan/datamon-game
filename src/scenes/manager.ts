// Scene manager (spec 005, R5): owns the flow title -> select -> versus ->
// fight -> results -> select or rematch, with pause and controls on top.
// Every scene steps at the fixed 60 Hz rate with the sampled input, so the
// whole flow runs headless in tests with fake inputs; drawing is separate.
// Devices, assets and audio come in through GameServices (src/scenes/game.ts
// builds the browser ones).
import type { CpuController, CpuLevel } from "../ai/cpu";
import type { Person } from "../data/catalog";
import type { ControlBindings } from "../input/bindings";
import { BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT, BUTTON_UP } from "../input/bits";
import type { ClipSet } from "../render/clips";
import type { EffectAtlas } from "../render/effects";
import { text } from "../render/hud";
import { VIEW_WIDTH } from "../render/screen";
import type { InputPair, PlayerIndex, SimEvent, SimState } from "../sim/types";
import { ControlsScene } from "./controls";
import { FightScene } from "./fight";
import { PauseScene } from "./pause";
import { ResultsScene } from "./results";
import type { FighterInfo } from "./roster";
import { SelectScene } from "./select";
import { TitleScene } from "./title";
import { VersusScene } from "./versus";

export type SceneName = "title" | "select" | "versus" | "fight" | "pause" | "results" | "controls";

/** VS CPU (P2 is the CPU), VS PLAYER (two humans), or free training. */
export type GameMode = "cpu" | "versus" | "training";

export interface Match {
  mode: GameMode;
  p1: Person;
  p2: Person;
  /** Difficulty of the CPU in P2's slot (VS CPU only). */
  cpuLevel: CpuLevel | null;
  seed: number;
}

/** Everything a fight draws with, loaded during the versus splash. */
export interface FightAssets {
  clipSets: [ClipSet, ClipSet];
  effects: EffectAtlas | null;
  portraits: [CanvasImageSource | null, CanvasImageSource | null];
}

/** Render-only art for menus; lazily loaded, null while loading. */
export interface SceneArt {
  portrait(person: Person): CanvasImageSource | null;
  clips(person: Person, alt: boolean): ClipSet | null;
}

/** Presentation hooks (audio wiring point). None of them can change the flow. */
export interface GameHooks {
  /** Every sim step during a fight (events may be empty), e.g. audio.onEvents(events, state.round). */
  simEvents?(events: readonly SimEvent[], state: SimState): void;
  /** Menu cursor moves, confirms and backs, e.g. audio.ui(kind). */
  ui?(kind: "move" | "confirm" | "back"): void;
  /**
   * The scene changed, e.g. audio.music(name === "fight" ? "fight" : ...). `detail` is the
   * scene's own words for screen readers (Scene.describe), e.g. "Julien H. versus Felicia G.".
   */
  scene?(name: SceneName, mode: GameMode | null, detail?: string): void;
}

/** Page fullscreen (spec 014, src/shell/fullscreen.ts). */
export interface FullscreenService {
  readonly enabled: boolean;
  toggle(): unknown;
}

export interface GameServices {
  readonly people: readonly Person[];
  readonly bindings: ControlBindings;
  /** Slugs known to be playable so far (grows while manifests are checked). */
  playable(): ReadonlySet<string>;
  loadFight(p1: Person, p2: Person): Promise<FightAssets>;
  /** Whether a player has a gamepad assigned (their key legend shows pad buttons). */
  hasPad(player: PlayerIndex): boolean;
  /** Key codes held right now (the controls screen waits for a captured key's release). */
  heldKeys(): ReadonlySet<string>;
  /** Uniform in [0, 1); presentation-side randomness only (random tile). */
  random(): number;
  /** A fresh match seed. */
  newSeed(): number;
  createCpu(level: CpuLevel, player: PlayerIndex, seed: number): CpuController;
  info(slug: string): FighterInfo;
  readonly art: SceneArt | null;
  /** prefers-reduced-motion: fights start with reduced effects. */
  readonly prefersReducedMotion?: boolean;
  readonly hooks: GameHooks;
  /** Fullscreen toggle; missing or not enabled leaves the FULLSCREEN menu items out (spec 014). */
  readonly fullscreen?: FullscreenService;
  /** Something the game needs failed to load: the page shows the failure screen (spec 014). */
  fatal?(err: unknown): void;
  /** Whether sound is muted, for the mute key on the pause screen. */
  soundMuted?(): boolean;
  /**
   * Mutes or unmutes the sound for everyone (the pause menu's SOUND item, so a phone can mute
   * without a keyboard); returns whether it is now muted. Missing: the pause menu has no SOUND item.
   */
  toggleSound?(): boolean;
  /**
   * P1 is playing with the on-screen touch controls right now (spec 015: they show on touch and
   * hide when a keyboard or gamepad takes over). Hints then name the touch buttons, not keys.
   */
  touchControls?(): boolean;
}

export interface MenuInput {
  /** Bits held this step, per player (keyboard and pad). */
  held: InputPair;
  /** Bits newly pressed this step. */
  pressed: InputPair;
  /** Newly pressed bits plus auto-repeat for held directions (menu cursors). */
  nav: InputPair;
  /** Esc was pressed since the last step. */
  escape: boolean;
}

export interface Scene {
  readonly name: SceneName;
  step(input: MenuInput): void;
  render(ctx: CanvasRenderingContext2D, frame: number): void;
  /** A raw key press, at event time. Return true to consume it (no default, no Esc handling). */
  key?(code: string): boolean;
  /** State for tests and browser checks. */
  debug?(): Record<string, unknown>;
  /** What the screen shows, in words, for screen readers (spec 014), e.g. "Julien H. versus Felicia G.". */
  describe?(): string;
}

const DIRS = [BUTTON_UP, BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT] as const;
/** Menu auto-repeat: first repeat after this many frames held, then every REPEAT_EVERY. */
const REPEAT_DELAY = 18;
const REPEAT_EVERY = 5;
const TOAST_FRAMES = 150;

export class SceneManager {
  scene!: Scene;
  /** The fight in progress (also while paused and on the results screen), or null. */
  fight: FightScene | null = null;
  /** Steps run since the manager started. */
  frame = 0;
  readonly toasts: { text: string; color: string; age: number }[] = [];
  private prev: [number, number] = [0, 0];
  private readonly heldFor: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  private escape = false;
  private mode: GameMode | null = null;

  constructor(readonly services: GameServices) {}

  go(scene: Scene): void {
    this.scene = scene;
    this.services.hooks.scene?.(scene.name, this.mode, scene.describe?.());
  }

  /** The window lost focus: a fight in progress pauses itself (spec 014, R7). */
  blur(): void {
    if (this.fight && this.scene === this.fight) this.toPause(this.fight);
  }

  /** Whether the menus offer FULLSCREEN. */
  get canFullscreen(): boolean {
    return this.services.fullscreen?.enabled === true;
  }

  /** Hints name the touch buttons (P1 plays by touch) rather than keys; read every frame, so they follow the device. */
  get touchHints(): boolean {
    return this.services.touchControls?.() === true;
  }

  toggleFullscreen(): void {
    void this.services.fullscreen?.toggle();
  }

  /** Runs one 60 Hz step with the sampled input. */
  step(held: InputPair): void {
    const pressed: [number, number] = [held[0] & ~this.prev[0], held[1] & ~this.prev[1]];
    const nav: [number, number] = [pressed[0], pressed[1]];
    for (const p of [0, 1] as const) {
      DIRS.forEach((bit, k) => {
        const t = (held[p] & bit) !== 0 ? this.heldFor[p]![k]! + 1 : 0;
        this.heldFor[p]![k] = t;
        if (t > REPEAT_DELAY && (t - REPEAT_DELAY) % REPEAT_EVERY === 0) nav[p] |= bit;
      });
    }
    this.prev = [held[0], held[1]];
    const input: MenuInput = { held, pressed, nav, escape: this.escape };
    this.escape = false;
    this.scene.step(input);
    this.frame += 1;
    for (const t of this.toasts) t.age += 1;
    while (this.toasts.length && this.toasts[0]!.age >= TOAST_FRAMES) this.toasts.shift();
  }

  /** A raw key press from the page. Returns true when the game consumed it. */
  key(code: string): boolean {
    if (this.scene.key?.(code)) return true;
    if (code === "Escape") this.escape = true;
    return false;
  }

  render(ctx: CanvasRenderingContext2D, frame: number): void {
    this.scene.render(ctx, frame);
    this.toasts.forEach((t, i) => {
      if (Math.floor(t.age / 8) % 2 === 1 && t.age < 24) return; // blink in
      text(ctx, t.text, VIEW_WIDTH / 2, 66 + i * 14, 8, t.color, "center");
    });
  }

  toast(message: string, color = "#eeedff"): void {
    this.toasts.push({ text: message, color, age: 0 });
  }

  // ------------------------------------------------------------- flow ----

  toTitle(): void {
    this.fight = null;
    this.mode = null;
    this.go(new TitleScene(this));
  }

  /** Character select for `mode`; `previous` puts the cursors back on the last picks. */
  toSelect(mode: GameMode, previous: Match | null = null): void {
    this.fight = null;
    this.mode = mode;
    this.go(new SelectScene(this, mode, previous));
  }

  /** The versus splash, which loads the fight's assets; `splash` false skips the 2 s card (URL shortcuts). */
  toVersus(match: Match, splash = true): void {
    this.mode = match.mode;
    this.go(new VersusScene(this, match, splash));
  }

  toFight(match: Match, assets: FightAssets): void {
    this.mode = match.mode;
    this.fight = new FightScene(this, match, assets);
    this.go(this.fight);
  }

  toPause(fight: FightScene): void {
    this.go(new PauseScene(this, fight));
  }

  resume(fight: FightScene): void {
    this.go(fight);
  }

  toResults(fight: FightScene, winner: PlayerIndex): void {
    this.go(new ResultsScene(this, fight, winner));
  }

  /** The controls screen; Back returns to `back`. */
  toControls(back: Scene): void {
    this.go(new ControlsScene(this, back));
  }
}
