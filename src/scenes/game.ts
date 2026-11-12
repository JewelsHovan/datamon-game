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
  /** Presentation hooks (audio): sim events, menu sounds, scene changes. */
  hooks?: GameHooks;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function fontReady(win: Window): Promise<void> {
  const fonts = (win.document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  // The font stylesheet loads without blocking the page (index.html), so wait for it first;
  // either way the title shows within 2.5 s, in the fallback font if the font is slow.
  const link = win.document.querySelector<HTMLLinkElement>('link[href*="Press+Start+2P"]');
  const sheet = link && !link.sheet ? new Promise<void>((r) => { link.addEventListener("load", () => r(), { once: true }); link.addEventListener("error", () => r(), { once: true }); }) : Promise.resolve();
  const font = sheet.then(() => fonts.load(`16px ${HUD_FONT}`)).then(() => undefined);
  await Promise.race([font, new Promise<void>((r) => setTimeout(r, 2500))]);
}

/** Menu art: portraits and preview clips, loaded on first use. */
class BrowserArt implements SceneArt {
  private readonly portraits = new Map<string, HTMLImageElement | null>();
  private readonly sets = new Map<string, ClipSet | null>();

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
      (alt ? loadAltClipSet(person) : loadClipSet(person)).then(
        (set) => this.sets.set(key, set),
        () => this.sets.delete(key),
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
  const playable = new Set<string>();
  void detectPlayable(people, browserClipDeps(), (slug) => playable.add(slug));
  let effects: Promise<EffectAtlas | null> | null = null;

  const bindings = new ControlBindings(safeLocalStorage(win));
  const keyboard = createKeyboard(win, bindings);
  let manager: SceneManager | null = null;
  const pads = createGamepads(win.navigator, (e) => {
    const who = `P${e.player + 1} CONTROLLER`;
    manager?.toast(e.type === "join" ? who : `${who} UNPLUGGED`, PLAYER_COLORS[e.player]);
  });
  const sampler = createInputSampler(keyboard, pads);

  const services: GameServices = {
    people,
    bindings,
    playable: () => playable,
    async loadFight(p1, p2): Promise<FightAssets> {
      effects ??= loadEffects();
      const mirror = p1.slug === p2.slug;
      const [s1, s2, fx, i1, i2] = await Promise.all([
        loadClipSet(p1),
        mirror ? loadAltClipSet(p2) : loadClipSet(p2),
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
    art: new BrowserArt(),
    prefersReducedMotion: win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    hooks: options.hooks ?? {},
  };
  const m = new SceneManager(services);
  manager = m;
  await fontReady(win);

  if (pick.direct) m.toVersus(matchFromPick(pick), false);
  else m.toTitle();

  win.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (m.key(e.code)) e.preventDefault();
  });

  const overlay = createDebugOverlay(options.overlay, win);
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
  win.document.addEventListener("visibilitychange", () => loop.setHidden(win.document.hidden));
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
  loop.start();
  return handle;
}
