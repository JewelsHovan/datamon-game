// Default bindings, one data table per device (docs/game-design.md, "Controls").
// Keys are KeyboardEvent.code values, so they follow physical positions on any layout.
import type { ButtonName } from "./bits";

export type KeyBindings = Readonly<Record<ButtonName, readonly string[]>>;

/** Keyboard bindings for P1 (index 0) and P2 (index 1). */
export const KEYBOARD_BINDINGS: readonly [KeyBindings, KeyBindings] = [
  {
    up: ["KeyW"],
    down: ["KeyS"],
    left: ["KeyA"],
    right: ["KeyD"],
    light: ["KeyF"],
    heavy: ["KeyG"],
    special: ["KeyH"],
    start: ["Enter"],
  },
  {
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    light: ["Comma"],
    heavy: ["Period"],
    special: ["Slash"],
    start: ["NumpadEnter"],
  },
];

export interface GamepadBindings {
  /** Standard-mapping button indices per game button. */
  readonly buttons: Readonly<Record<ButtonName, readonly number[]>>;
  /** Left stick axes. */
  readonly axisX: number;
  readonly axisY: number;
  /** Stick deflection needed to count as a direction (0..1). */
  readonly deadzone: number;
}

/** Gamepad bindings (W3C standard mapping): d-pad or left stick, face buttons for attacks. */
export const GAMEPAD_BINDINGS: GamepadBindings = {
  buttons: {
    up: [12],
    down: [13],
    left: [14],
    right: [15],
    light: [0], // bottom face button (A / Cross)
    heavy: [1], // right face button (B / Circle)
    special: [2], // left face button (X / Square)
    start: [9], // Start / Options
  },
  axisX: 0,
  axisY: 1,
  deadzone: 0.5,
};

/** Every key code bound for either player (the page stops their default action). */
export function boundKeyCodes(bindings: readonly KeyBindings[] = KEYBOARD_BINDINGS): Set<string> {
  const codes = new Set<string>();
  for (const player of bindings) {
    for (const keys of Object.values(player)) for (const code of keys) codes.add(code);
  }
  return codes;
}
