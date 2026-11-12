// Keyboard state for both players. Key presses shorter than one sim step are
// latched so a quick tap still shows up in the next sample. Bindings are read
// live, so a rebind on the controls screen applies at once.
import { BUTTON_BITS, BUTTON_NAMES } from "./bits";
import { ALWAYS_BLOCKED_KEYS, KEYBOARD_BINDINGS, type KeyBindings } from "./keymap";

export interface KeyboardSource {
  /** Bitmask for one player, including taps since the last sample. */
  bits(player: 0 | 1): number;
  /** Clears the tap latch; call once after sampling both players. */
  endSample(): void;
  /** Every key code held right now, bound or not. */
  held(): ReadonlySet<string>;
  dispose(): void;
}

/** Fixed bindings, or a live source such as ControlBindings. */
export type BindingsSource = readonly [KeyBindings, KeyBindings] | { readonly current: readonly [KeyBindings, KeyBindings] };

/** The minimal event target the keyboard listens on (a Window in the game). */
export interface KeyTarget {
  addEventListener(type: "keydown" | "keyup" | "blur", listener: (e: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown" | "keyup" | "blur", listener: (e: KeyboardEvent) => void): void;
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

function resolve(source: BindingsSource): readonly [KeyBindings, KeyBindings] {
  return "current" in source ? source.current : source;
}

/** True when the game owns this key: bound for a player, or always blocked. */
export function isGameKey(code: string, bindings: readonly [KeyBindings, KeyBindings]): boolean {
  if (ALWAYS_BLOCKED_KEYS.has(code)) return true;
  for (const player of bindings) for (const name of BUTTON_NAMES) if (player[name].includes(code)) return true;
  return false;
}

/**
 * Game keys never reach the browser (no quick find, scrolling or focus moves).
 * Keys pressed with Ctrl or Meta are left alone: those are the player's own
 * browser shortcuts, and no game key uses a modifier.
 */
export function shouldPreventDefault(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey">, bindings: readonly [KeyBindings, KeyBindings]): boolean {
  if (e.ctrlKey || e.metaKey) return false;
  return isGameKey(e.code, bindings);
}

export function createKeyboard(target: KeyTarget = window, bindings: BindingsSource = KEYBOARD_BINDINGS): KeyboardSource {
  const held = new Set<string>();
  const tapped = new Set<string>();

  const onDown = (e: KeyboardEvent) => {
    if (shouldPreventDefault(e, resolve(bindings))) e.preventDefault();
    held.add(e.code);
    tapped.add(e.code);
  };
  const onUp = (e: KeyboardEvent) => {
    if (shouldPreventDefault(e, resolve(bindings))) e.preventDefault();
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
      return keysToBits(active, resolve(bindings)[player]);
    },
    endSample() {
      tapped.clear();
    },
    held: () => held,
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
    },
  };
}
