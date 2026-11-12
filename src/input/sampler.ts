// Samples every device once per sim step into one bitmask per player.
import type { InputPair } from "../sim/types";
import type { GamepadSource } from "./gamepad";
import type { KeyboardSource } from "./keyboard";

export interface InputSampler {
  sample(): InputPair;
}

export function createInputSampler(keyboard: KeyboardSource, gamepads: GamepadSource): InputSampler {
  return {
    sample() {
      const [pad1, pad2] = gamepads.read();
      const pair: InputPair = [keyboard.bits(0) | pad1, keyboard.bits(1) | pad2];
      keyboard.endSample();
      return pair;
    },
  };
}
