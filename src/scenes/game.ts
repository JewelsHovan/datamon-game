// Browser bootstrap: devices, rebindable keys, gamepad joining, asset loading,
// the fixed-step loop and the scene manager. Boots the title screen, or a
// fight straight away for the URL shortcuts (?p1=&p2=, ?mode=training,
// ?cpu=easy|normal|hard). window.__game exposes the state for browser checks.
import { createCpu } from "../ai/cpu";
import { getPeople, type Person } from "../data/catalog";
import { FixedStepLoop, type LoopStats } from "../engine/loop";
import { ControlBindings, safeLocalStorage } from "../input/bindings";
import { createGamepads } from "../input/gamepad";
import { createKeyboard } from "../input/keyboard";
import { createInputSampler } from "../input/sampler";
import { browserClipDeps, loadAltClipSet, loadClipSet, type ClipSet } from "../render/clips";
import { createDebugOverlay } from "../render/debugOverlay";
import { loadEffects, type EffectAtlas } from "../render/effects";
import { HUD_FONT } from "../render/hud";
import { createScreen } from "../render/screen";
import { stageInfo, type StageInfo } from "../render/stage";
import { AssetLoadError } from "../shell/failure";
import { createFullscreen } from "../shell/fullscreen";
import { hashState } from "../sim/hash";
import type { SimEvent, SimState } from "../sim/types";
import { matchFromPick, pickFighters } from "./fight";
import { SceneManager, type FightAssets, type GameHooks, type GameServices, type SceneArt, type SceneName } from "./manager";
import { detectPlayable, fighterInfo } from "./roster";
import { PLAYER_COLORS } from "./ui";

export interface GameHandle {
  /** Sim frames run in the current (or last) fight; 0 before the first fight. */
  readonly simFrame: number;
  /** Stable hash of the current fight's sim state ("" without a fight). */
  hashState(): string;
  /** A JSON copy of the current fight's sim state, or null. */
  snapshot(): SimState | null;
  /** Render-side info: where each fighter's clips came from, the loop stats, toggles. */
  info(): { clipSources: [string, string] | null; stats: LoopStats; boxes: boolean; reducedEffects: boolean; liveEffects: number; stage: StageInfo };
  /** Every sim event of the current fight (newest last, capped). */
  events(): SimEvent[];
  /** The current scene. */
  readonly scene: SceneName;
  /** Scene-manager steps run so far (60 per second). */
  readonly frame: number;
  /** The current scene's state (cursors, menu index, picks, key test...). */
  menu(): Record<string, unknown> | null;
}

declare global {
  interface Window {
    __game?: GameHandle;
  }
}

export interface GameOptions {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  search: string;
  win?: Window;
  /** Presentation hooks (audio, screen reader): sim events, menu sounds, scene changes. */
  hooks?: GameHooks;
  /**
   * Something the game needs failed to load after startup (a fighter's atlas, the effects):
   * the game has stopped and released the keyboard; show the failure screen (spec 014).
   * Startup failures (the font) reject startGame instead.
   */
  onFatal?(err: unknown): void;
  /** Whether sound is muted (the pause screen shows the mute key). */
  soundMuted?(): boolean;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** How the pixel font arrived: loaded, still loading after the wait (the fallback font draws), or failed. */
export type FontState = "ready" | "slow" | "failed";

async function fontReady(win: Window): Promise<FontState> {
  const fonts = (win.document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return "ready";
  // The font stylesheet loads without blocking the page (index.html), so wait for it first;
  // either way the title shows within 2.5 s, in the fallback font if the font is slow.
  // A stylesheet that errored (data-failed, set by its onerror) or a face that does not load
  // is a failure (spec 014): the page shows the failure screen instead of drawing without it.
  const link = win.document.querySelector<HTMLLinkElement>('link[href*="Press+Start+2P"]');
  const sheet: Promise<boolean> =
    !link || link.sheet
      ? Promise.resolve(true)
      : link.dataset.failed
        ? Promise.resolve(false)
        : new Promise<boolean>((r) => {
            link.addEventListener("load", () => r(true), { once: true });
            link.addEventListener("error", () => r(false), { once: true });
          });
  const font = sheet.then((ok): Promise<FontState> | FontState =>
    ok ? fonts.load(`16px ${HUD_FONT}`).then((faces) => (faces.length > 0 ? "ready" : "failed"), () => "failed") : "failed",
  );
  return Promise.race([font, new Promise<FontState>((r) => setTimeout(() => r("slow"), 2500))]);
}

/** Menu art: portraits and preview clips, loaded on first use. A clip set that fails to load is fatal. */
class BrowserArt implements SceneArt {
  private readonly portraits = new Map<string, HTMLImageElement | null>();
  private readonly sets = new Map<string, ClipSet | null>();

  constructor(private readonly onError: (err: unknown) => void) {}

  portrait(person: Person): HTMLImageElement | null {
    if (!this.portraits.has(person.slug)) {
      this.portraits.set(person.slug, null);
      void loadImage(person.portraitUrl).then((img) => this.portraits.set(person.slug, img));
    }
    return this.portraits.get(person.slug) ?? null;
  }

  clips(person: Person, alt: boolean): ClipSet | null {
    const key = `${person.slug}${alt ? ":alt" : ""}`;
    if (!this.sets.has(key)) {
      this.sets.set(key, null);
      // On failure the entry stays null (no retry every frame) and the game stops on the failure screen.
      (alt ? loadAltClipSet(person) : loadClipSet(person)).then(
        (set) => this.sets.set(key, set),
        (err: unknown) => this.onError(new AssetLoadError(fighterArt(person), err)),
      );
    }
    return this.sets.get(key) ?? null;
  }
}

export async function startGame(options: GameOptions): Promise<GameHandle> {
  const win = options.win ?? window;
  const screen = createScreen(options.canvas, win);
  const { ctx } = screen;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, screen.canvas.width, screen.canvas.height);
  // Something on screen at once: on a cold load the pixel font and manifests take a moment.
  ctx.fillStyle = "#aeaadc";
  ctx.font = "bold 12px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("LOADING", screen.canvas.width / 2, screen.canvas.height / 2);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";

  const people = getPeople();
  const pick = pickFighters(options.search);
  const font = fontReady(win);
  const playable = new Set<string>();
  void detectPlayable(people, browserClipDeps(), (slug) => playable.add(slug));
  // A missing effects atlas is a failed load (spec 014), not a fight without effects.
  let effects: Promise<EffectAtlas> | null = null;
  const loadEffectsOrFail = () =>
    loadEffects().then((fx) => fx ?? Promise.reject(new AssetLoadError("the effects")), (err: unknown) => Promise.reject(new AssetLoadError("the effects", err)));
  const named = <T>(what: string, p: Promise<T>) => p.catch((err: unknown) => Promise.reject(new AssetLoadError(what, err)));

  // Everything to undo when a load fails mid-game: the loop stops and the page gets its keys back
  // (the game blocks Enter, Space and Tab, which the failure screen's Reload button needs).
  const cleanups: (() => void)[] = [];
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const undo of cleanups.splice(0).reverse()) undo();
  };
  const listen = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
    win.addEventListener(type, fn);
    cleanups.push(() => win.removeEventListener(type, fn));
  };

  const bindings = new ControlBindings(safeLocalStorage(win));
  const keyboard = createKeyboard(win, bindings);
  cleanups.push(() => keyboard.dispose());
  let manager: SceneManager | null = null;
  const pads = createGamepads(win.navigator, (e) => {
    const who = `P${e.player + 1} CONTROLLER`;
    manager?.toast(e.type === "join" ? who : `${who} UNPLUGGED`, PLAYER_COLORS[e.player]);
  });
  const sampler = createInputSampler(keyboard, pads);
  const fullscreen = createFullscreen(win.document);

  const fatal = (err: unknown) => {
    if (stopped) return;
    console.error("The game cannot continue", err);
    stop();
    options.onFatal?.(err);
  };

  const services: GameServices = {
    people,
    bindings,
    playable: () => playable,
    async loadFight(p1, p2): Promise<FightAssets> {
      effects ??= loadEffectsOrFail();
      const mirror = p1.slug === p2.slug;
      const [s1, s2, fx, i1, i2] = await Promise.all([
        named(fighterArt(p1), loadClipSet(p1)),
        named(fighterArt(p2), mirror ? loadAltClipSet(p2) : loadClipSet(p2)),
        effects,
        loadImage(p1.portraitUrl),
        loadImage(p2.portraitUrl),
      ]);
      return { clipSets: [s1, s2], effects: fx, portraits: [i1, i2] };
    },
    hasPad: (player) => pads.has(player),
    heldKeys: () => keyboard.held(),
    random: () => Math.random(),
    newSeed: () => Math.floor(Math.random() * 0x7fffffff),
    createCpu,
    info: fighterInfo,
    art: new BrowserArt(fatal),
    prefersReducedMotion: win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    hooks: options.hooks ?? {},
    fullscreen,
    fatal,
    soundMuted: options.soundMuted,
  };
  const m = new SceneManager(services);
  manager = m;
  // A startup failure rejects startGame (main.ts shows the failure screen) with the keyboard released.
  try {
    if ((await font) === "failed") throw new AssetLoadError("the pixel font");
    if (pick.direct) m.toVersus(matchFromPick(pick), false);
    else m.toTitle();
  } catch (err) {
    stop();
    throw err;
  }

  listen("keydown", (e) => {
    if (e.repeat) return;
    if (m.key(e.code)) e.preventDefault();
  });
  // Spec 014: losing focus mid-fight pauses (held keys are already released on blur by the keyboard).
  listen("blur", () => m.blur());
  const onDoubleClick = () => void fullscreen.toggle();
  options.canvas.addEventListener("dblclick", onDoubleClick);
  cleanups.push(() => options.canvas.removeEventListener("dblclick", onDoubleClick));

  const overlay = createDebugOverlay(options.overlay, win);
  cleanups.push(() => overlay.dispose());
  let renderFrame = 0;
  const loop = new FixedStepLoop({
    step() {
      m.step(sampler.sample());
    },
    render(stats) {
      renderFrame += 1;
      m.render(ctx, renderFrame);
      if (m.fight) overlay.update(m.fight.state, stats);
    },
  });
  cleanups.push(() => loop.stop());
  const onVisibility = () => loop.setHidden(win.document.hidden);
  win.document.addEventListener("visibilitychange", onVisibility);
  cleanups.push(() => win.document.removeEventListener("visibilitychange", onVisibility));
  loop.setHidden(win.document.hidden);

  const handle: GameHandle = {
    get simFrame() {
      return m.fight?.state.frame ?? 0;
    },
    hashState: () => (m.fight ? hashState(m.fight.state) : ""),
    snapshot: () => (m.fight ? (JSON.parse(JSON.stringify(m.fight.state)) as SimState) : null),
    info: () => ({
      clipSources: m.fight ? [m.fight.assets.clipSets[0].source, m.fight.assets.clipSets[1].source] : null,
      stats: { ...loop.stats },
      boxes: m.fight?.showBoxes ?? false,
      reducedEffects: m.fight?.effects.reduced ?? false,
      liveEffects: m.fight?.effects.count ?? 0,
      stage: stageInfo(),
    }),
    events: () => m.fight?.log.slice() ?? [],
    get scene() {
      return m.scene.name;
    },
    get frame() {
      return m.frame;
    },
    menu: () => m.scene.debug?.() ?? null,
  };
  win.__game = handle;
  if (!stopped) loop.start();
  return handle;
}

/** A fighter's art in words for the failure screen: "Julien H.'s fighter art". */
function fighterArt(person: Person): string {
  return `${person.shortName}'s fighter art`;
}
