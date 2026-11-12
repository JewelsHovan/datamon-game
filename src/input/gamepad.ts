// Gamepad API to bitmask. The mapping is a pure function over a minimal
// gamepad shape, so tests can feed it fake pads.
import { BUTTON_BITS, BUTTON_DOWN, BUTTON_LEFT, BUTTON_NAMES, BUTTON_RIGHT, BUTTON_UP } from "./bits";
import { GAMEPAD_BINDINGS, type GamepadBindings } from "./keymap";

/** The parts of the Gamepad interface the mapping reads. */
export interface GamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly buttons: readonly { readonly pressed: boolean; readonly value?: number }[];
  readonly axes: readonly number[];
}

export function gamepadToBits(
  pad: GamepadLike | null | undefined,
  bindings: GamepadBindings = GAMEPAD_BINDINGS,
): number {
  if (!pad || !pad.connected) return 0;
  let bits = 0;
  for (const name of BUTTON_NAMES) {
    for (const index of bindings.buttons[name]) {
      if (pad.buttons[index]?.pressed) {
        bits |= BUTTON_BITS[name];
        break;
      }
    }
  }
  const x = pad.axes[bindings.axisX] ?? 0;
  const y = pad.axes[bindings.axisY] ?? 0;
  if (x <= -bindings.deadzone) bits |= BUTTON_LEFT;
  if (x >= bindings.deadzone) bits |= BUTTON_RIGHT;
  // Standard mapping: negative y is up.
  if (y <= -bindings.deadzone) bits |= BUTTON_UP;
  if (y >= bindings.deadzone) bits |= BUTTON_DOWN;
  return bits;
}

/** Connected pads in index order: the first drives P1, the second P2. */
export function connectedPads(pads: readonly (GamepadLike | null)[]): GamepadLike[] {
  return pads
    .filter((p): p is GamepadLike => p !== null && p.connected)
    .sort((a, b) => a.index - b.index);
}

export interface GamepadSource {
  /** Bitmasks for P1 and P2 from the first two connected pads. */
  read(): [number, number];
}

export function createGamepads(nav: Navigator | undefined = globalThis.navigator): GamepadSource {
  return {
    read() {
      if (!nav || typeof nav.getGamepads !== "function") return [0, 0];
      const pads = connectedPads(nav.getGamepads());
      return [gamepadToBits(pads[0]), gamepadToBits(pads[1])];
    },
  };
}
