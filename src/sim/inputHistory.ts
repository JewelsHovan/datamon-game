// Per-player input history: a ring buffer of SOCD-resolved bitmasks,
// "pressed this frame" detection and facing-relative directions.
import {
  ALL_BUTTONS,
  BUTTON_DOWN,
  BUTTON_LEFT,
  BUTTON_RIGHT,
  BUTTON_UP,
  DIR_BACK,
  DIR_FORWARD,
} from "./inputBits";
import type { Facing, InputHistory } from "./types";

/** Frames of history kept per player (the design asks for at least 30). */
export const INPUT_HISTORY_LENGTH = 32;

export function createInputHistory(): InputHistory {
  return { frames: new Array<number>(INPUT_HISTORY_LENGTH).fill(0), head: 0 };
}

export function cloneInputHistory(history: InputHistory): InputHistory {
  return { frames: history.frames.slice(), head: history.head };
}

/** Simultaneous opposite directions (SOCD) cancel out, per axis. */
export function resolveSocd(bits: number): number {
  let out = bits & ALL_BUTTONS;
  if ((out & BUTTON_LEFT) !== 0 && (out & BUTTON_RIGHT) !== 0) {
    out &= ~(BUTTON_LEFT | BUTTON_RIGHT);
  }
  if ((out & BUTTON_UP) !== 0 && (out & BUTTON_DOWN) !== 0) {
    out &= ~(BUTTON_UP | BUTTON_DOWN);
  }
  return out;
}

/** Records this frame's raw bitmask (SOCD resolved) as the newest entry. */
export function pushInput(history: InputHistory, rawBits: number): void {
  history.head = (history.head + 1) % INPUT_HISTORY_LENGTH;
  history.frames[history.head] = resolveSocd(rawBits);
}

/** The bitmask `age` frames ago (0 = this frame). Ages beyond the buffer read as neutral. */
export function inputAt(history: InputHistory, age = 0): number {
  if (age < 0 || age >= INPUT_HISTORY_LENGTH) return 0;
  const index = (history.head - age + INPUT_HISTORY_LENGTH) % INPUT_HISTORY_LENGTH;
  return history.frames[index] ?? 0;
}

export function isHeld(history: InputHistory, bit: number, age = 0): boolean {
  return (inputAt(history, age) & bit) !== 0;
}

/** True only on the first frame `bit` is held. */
export function wasPressed(history: InputHistory, bit: number, age = 0): boolean {
  return isHeld(history, bit, age) && !isHeld(history, bit, age + 1);
}

/**
 * Converts left/right into back/forward for a fighter facing `facing`.
 * The result uses DIR_BACK / DIR_FORWARD in place of the left/right bits;
 * every other bit passes through.
 */
export function toFacingRelative(bits: number, facing: Facing): number {
  const left = (bits & BUTTON_LEFT) !== 0;
  const right = (bits & BUTTON_RIGHT) !== 0;
  const forward = facing === 1 ? right : left;
  const back = facing === 1 ? left : right;
  let out = bits & ~(BUTTON_LEFT | BUTTON_RIGHT);
  if (forward) out |= DIR_FORWARD;
  if (back) out |= DIR_BACK;
  return out;
}
