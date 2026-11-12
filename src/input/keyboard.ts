// Keyboard state for both players. Key presses shorter than one sim step are
// latched so a quick tap still shows up in the next sample.
import { BUTTON_BITS, BUTTON_NAMES } from "./bits";
import { KEYBOARD_BINDINGS, boundKeyCodes, type KeyBindings } from "./keymap";

export interface KeyboardSource {
  /** Bitmask for one player, including taps since the last sample. */
  bits(player: 0 | 1): number;
  /** Clears the tap latch; call once after sampling both players. */
  endSample(): void;
  dispose(): void;
}

/** Bitmask for a set of held key codes under one player's bindings. */
export function keysToBits(held: ReadonlySet<string>, bindings: KeyBindings): number {
  let bits = 0;
  for (const name of BUTTON_NAMES) {
    for (const code of bindings[name]) {
      if (held.has(code)) {
        bits |= BUTTON_BITS[name];
        break;
      }
    }
  }
  return bits;
}

export function createKeyboard(
  target: Window = window,
  bindings: readonly [KeyBindings, KeyBindings] = KEYBOARD_BINDINGS,
): KeyboardSource {
  const held = new Set<string>();
  const tapped = new Set<string>();
  const bound = boundKeyCodes(bindings);

  const onDown = (e: KeyboardEvent) => {
    if (!bound.has(e.code)) return;
    e.preventDefault();
    held.add(e.code);
    tapped.add(e.code);
  };
  const onUp = (e: KeyboardEvent) => {
    if (!bound.has(e.code)) return;
    e.preventDefault();
    held.delete(e.code);
  };
  const onBlur = () => {
    held.clear();
    tapped.clear();
  };

  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  target.addEventListener("blur", onBlur);

  return {
    bits(player) {
      const active = new Set([...held, ...tapped]);
      return keysToBits(active, bindings[player]);
    },
    endSample() {
      tapped.clear();
    },
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
    },
  };
}
