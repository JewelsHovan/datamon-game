// Two-fighter sandbox: the dev entry scene. ?p1=<slug>&p2=<slug> picks the
// fighters; F1 toggles the debug overlay; window.__game exposes the sim for
// browser checks.
import { getPerson, type Person } from "../data/catalog";
import { FixedStepLoop, type LoopStats } from "../engine/loop";
import { createGamepads } from "../input/gamepad";
import { createKeyboard } from "../input/keyboard";
import { createInputSampler } from "../input/sampler";
import { cameraFor } from "../render/camera";
import { loadClipSet, type ClipSet } from "../render/clips";
import { createDebugOverlay } from "../render/debugOverlay";
import { drawFighter, drawShadow } from "../render/fighterRenderer";
import { createScreen } from "../render/screen";
import { drawStage } from "../render/stage";
import { hashState } from "../sim/hash";
import { createSandboxState } from "../sim/state";
import { step } from "../sim/step";
import type { SimState } from "../sim/types";

export const DEFAULT_P1 = "julien-hovan";
export const DEFAULT_P2 = "felicia-gorgacheva";
export const DEFAULT_SEED = 1;

export interface FighterPick {
  p1: Person;
  p2: Person;
  seed: number;
}

/** Reads ?p1, ?p2 and ?seed. Unknown slugs fall back to the defaults with a warning. */
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
  };
}

export interface GameHandle {
  /** Sim frames run so far. */
  readonly simFrame: number;
  /** Stable hash of the current sim state. */
  hashState(): string;
  /** A JSON copy of the current sim state. */
  snapshot(): SimState;
  /** Render-side info: where each fighter's clips came from and the loop stats. */
  info(): { clipSources: [string, string]; stats: LoopStats };
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

export async function startSandbox(options: SandboxOptions): Promise<GameHandle> {
  const win = options.win ?? window;
  const { p1, p2, seed } = pickFighters(options.search);
  const screen = createScreen(options.canvas, win);
  const { ctx } = screen;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, screen.canvas.width, screen.canvas.height);
  const clipSets: [ClipSet, ClipSet] = await Promise.all([loadClipSet(p1), loadClipSet(p2)]);

  let state = createSandboxState(seed, p1.slug, p2.slug);
  const sampler = createInputSampler(createKeyboard(win), createGamepads(win.navigator));
  const overlay = createDebugOverlay(options.overlay, win);

  const loop = new FixedStepLoop({
    step() {
      state = step(state, sampler.sample());
    },
    render(stats) {
      const camera = cameraFor(state);
      drawStage(ctx, camera);
      for (const f of state.fighters) drawShadow(ctx, f, camera);
      state.fighters.forEach((f, i) => drawFighter(ctx, clipSets[i]!, f, camera));
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
    }),
  };
  win.__game = handle;
  loop.start();
  return handle;
}
