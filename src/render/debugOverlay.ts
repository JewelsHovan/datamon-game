// F1 debug overlay: sim frame, render FPS, steps run on the last animation
// frame, and each fighter's state name.
import type { LoopStats } from "../engine/loop";
import type { SimState } from "../sim/types";

export interface DebugOverlay {
  readonly visible: boolean;
  toggle(): void;
  update(state: SimState, stats: Readonly<LoopStats>): void;
  dispose(): void;
}

export function formatOverlay(state: SimState, stats: Readonly<LoopStats>): string {
  const [p1, p2] = state.fighters;
  return [
    `sim frame   ${state.frame}`,
    `render fps  ${stats.fps.toFixed(1)}`,
    `steps/frame ${stats.stepsLastFrame}`,
    `P1 state    ${p1.state} (${p1.slug})`,
    `P2 state    ${p2.state} (${p2.slug})`,
  ].join("\n");
}

export function createDebugOverlay(el: HTMLElement, win: Window = window): DebugOverlay {
  let visible = !el.hidden;
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== "F1") return;
    e.preventDefault();
    if (!e.repeat) overlay.toggle();
  };
  const overlay: DebugOverlay = {
    get visible() {
      return visible;
    },
    toggle() {
      visible = !visible;
      el.hidden = !visible;
    },
    update(state, stats) {
      if (visible) el.textContent = formatOverlay(state, stats);
    },
    dispose() {
      win.removeEventListener("keydown", onKey);
    },
  };
  win.addEventListener("keydown", onKey);
  return overlay;
}
