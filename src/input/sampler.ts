// Samples every device once per sim step into one bitmask per player.
// Touch controls (spec 015) drive P1 only and merge with P1's keyboard and pad;
// P1's keyboard or pad input hides them (P2's never does).
import type { InputPair } from "../sim/types";
import type { GamepadSource } from "./gamepad";
import type { KeyboardSource } from "./keyboard";
import type { TouchSource } from "./touch";

export interface InputSampler {
  sample(): InputPair;
}

export function createInputSampler(keyboard: KeyboardSource, gamepads: GamepadSource, touch: TouchSource | null = null): InputSampler {
  return {
    sample() {
      const [pad1, pad2] = gamepads.read();
      const p1 = keyboard.bits(0) | pad1;
      touch?.otherInput?.(p1);
      const pair: InputPair = [p1 | (touch?.bits() ?? 0), keyboard.bits(1) | pad2];
      keyboard.endSample();
      touch?.endSample();
      return pair;
    },
  };
}
