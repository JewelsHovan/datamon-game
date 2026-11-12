// The fight scene: a best-of-3 match (spec 003), or free training with
// ?mode=training. ?p1=<slug>&p2=<slug> picks the fighters (a mirror match draws
// P2 in the alternate palette). F1 debug overlay, F2 hit and hurt boxes, F3
// reduced effects. window.__game exposes the sim for browser checks.
import { getPerson, type Person } from "../data/catalog";
import { FixedStepLoop, type LoopStats } from "../engine/loop";
import { createGamepads } from "../input/gamepad";
import { createKeyboard } from "../input/keyboard";
import { createInputSampler } from "../input/sampler";
import { drawBoxes } from "../render/boxesOverlay";
import { cameraFor, type Camera } from "../render/camera";
import { loadAltClipSet, loadClipSet, type ClipSet } from "../render/clips";
import { createDebugOverlay } from "../render/debugOverlay";
import { EffectsLayer, loadEffects } from "../render/effects";
import { drawFighter, drawShadow } from "../render/fighterRenderer";
import { HUD_FONT, Hud, text } from "../render/hud";
import { createScreen, VIEW_HEIGHT, VIEW_WIDTH } from "../render/screen";
import { drawStage } from "../render/stage";
import { hashState } from "../sim/hash";
import { createMatchState, createSandboxState } from "../sim/state";
import { step } from "../sim/step";
import type { SimEvent, SimState } from "../sim/types";

export const DEFAULT_P1 = "julien-hovan";
/** Only Julien has generated clips so far, so the default match is a mirror match. */
export const DEFAULT_P2 = "julien-hovan";
export const DEFAULT_SEED = 1;
/** K.O. slow motion: render frames at a quarter sim rate. */
const SLOWMO_FRAMES = 30;

export interface FighterPick {
  p1: Person;
  p2: Person;
  seed: number;
  training: boolean;
}

/** Reads ?p1, ?p2, ?seed and ?mode. Unknown slugs fall back to the defaults with a warning. */
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
  return {
    p1: pick("p1", DEFAULT_P1),
    p2: pick("p2", DEFAULT_P2),
    seed: Number.isInteger(seedParam) && params.has("seed") ? seedParam : DEFAULT_SEED,
    training: params.get("mode") === "training",
  };
}

export interface GameHandle {
  /** Sim frames run so far. */
  readonly simFrame: number;
  /** Stable hash of the current sim state. */
  hashState(): string;
  /** A JSON copy of the current sim state. */
  snapshot(): SimState;
  /** Render-side info: where each fighter's clips came from, the loop stats, toggles. */
  info(): { clipSources: [string, string]; stats: LoopStats; boxes: boolean; reducedEffects: boolean; liveEffects: number };
  /** Every sim event so far (newest last, capped). */
  events(): SimEvent[];
}

declare global {
  interface Window {
    __game?: GameHandle;
  }
}

export interface SandboxOptions {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  search: string;
  win?: Window;
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
  await Promise.race([fonts.load(`16px ${HUD_FONT}`).then(() => undefined), new Promise<void>((r) => setTimeout(r, 2500))]);
}

const CONTROLS = [
  "P1  WASD move   F light   G heavy   H special   F+G throw",
  "P2  ARROWS move   ,  light   .  heavy   /  special   ,+. throw",
];

export async function startSandbox(options: SandboxOptions): Promise<GameHandle> {
  const win = options.win ?? window;
  const { p1, p2, seed, training } = pickFighters(options.search);
  const screen = createScreen(options.canvas, win);
  const { ctx } = screen;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, screen.canvas.width, screen.canvas.height);
  const mirror = p1.slug === p2.slug;
  const [set1, set2, fx, portrait1, portrait2] = await Promise.all([
    loadClipSet(p1),
    mirror ? loadAltClipSet(p2) : loadClipSet(p2),
    loadEffects(),
    loadImage(p1.portraitUrl),
    loadImage(p2.portraitUrl),
    fontReady(win),
  ]);
  const clipSets: [ClipSet, ClipSet] = [set1, set2];

  let state = training ? createSandboxState(seed, p1.slug, p2.slug) : createMatchState(seed, p1.slug, p2.slug);
  const sampler = createInputSampler(createKeyboard(win), createGamepads(win.navigator));
  const overlay = createDebugOverlay(options.overlay, win);
  const reduceMotion = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const effects = new EffectsLayer(fx, reduceMotion);
  const hud = new Hud([p1, p2], [portrait1, portrait2]);
  const log: SimEvent[] = [];
  let showBoxes = false;
  let slowmo = 0;
  let slowCounter = 0;
  let renderFrame = 0;

  win.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "F2") {
      e.preventDefault();
      showBoxes = !showBoxes;
    } else if (e.code === "F3") {
      e.preventDefault();
      effects.reduced = !effects.reduced;
    }
  });

  const loop = new FixedStepLoop({
    step() {
      if (slowmo > 0 && slowCounter++ % 4 !== 0) return;
      state = step(state, sampler.sample());
      if (state.events.length) {
        effects.onEvents(state.events, state);
        hud.onEvents(state.events);
        for (const e of state.events) {
          log.push(e);
          if (e.type === "ko") {
            slowmo = SLOWMO_FRAMES;
            slowCounter = 0;
          }
        }
        if (log.length > 500) log.splice(0, log.length - 500);
      }
    },
    render(stats) {
      renderFrame += 1;
      if (slowmo > 0) slowmo -= 1;
      effects.tick();
      hud.tick(state);
      const base = cameraFor(state);
      const off = effects.cameraOffset(renderFrame);
      const camera: Camera = { x: base.x + off.x, y: base.y + off.y };
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
      drawStage(ctx, camera);
      for (const f of state.fighters) drawShadow(ctx, f, camera);
      // The fighter being hit is drawn last, so impacts read on top.
      const order: (0 | 1)[] = state.fighters[0].state === "hitstun" || state.fighters[0].state === "knockdown" ? [1, 0] : [0, 1];
      for (const i of order) drawFighter(ctx, clipSets[i], state.fighters[i], camera, effects.flash[i] > 0 ? "#ffffff" : undefined);
      effects.drawProjectiles(ctx, state, camera);
      effects.draw(ctx, camera);
      if (showBoxes) drawBoxes(ctx, state, camera);
      if (effects.screenFlash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${(effects.screenFlash / 6) * 0.7})`;
        ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
      }
      hud.draw(ctx, state);
      if (state.round.training || (state.round.phase === "intro" && state.round.number === 1)) {
        CONTROLS.forEach((line, k) => text(ctx, line, VIEW_WIDTH / 2, VIEW_HEIGHT - 26 + k * 12, 8, "#d8d6ff", "center"));
      }
      overlay.update(state, stats);
    },
  });

  win.document.addEventListener("visibilitychange", () => {
    loop.setHidden(win.document.hidden);
  });
  loop.setHidden(win.document.hidden);

  const handle: GameHandle = {
    get simFrame() {
      return state.frame;
    },
    hashState: () => hashState(state),
    snapshot: () => JSON.parse(JSON.stringify(state)) as SimState,
    info: () => ({
      clipSources: [clipSets[0].source, clipSets[1].source],
      stats: { ...loop.stats },
      boxes: showBoxes,
      reducedEffects: effects.reduced,
      liveEffects: effects.count,
    }),
    events: () => log.slice(),
  };
  win.__game = handle;
  loop.start();
  return handle;
}
