// The per-player input bitmask: the sim's only outside influence.
// Defined here (not in src/input) because src/sim may only import from
// src/sim and src/data; src/input/bits.ts re-exports it.
//
// Buttons are Punch, Kick and Special (spec 005). The punch and kick bits keep
// the values of the old light and heavy bits, so recorded inputs stay valid.

export const BUTTON_UP = 1 << 0;
export const BUTTON_DOWN = 1 << 1;
export const BUTTON_LEFT = 1 << 2;
export const BUTTON_RIGHT = 1 << 3;
export const BUTTON_PUNCH = 1 << 4;
export const BUTTON_KICK = 1 << 5;
export const BUTTON_SPECIAL = 1 << 6;
export const BUTTON_START = 1 << 7;

/** Old name of BUTTON_PUNCH (same bit). */
export const BUTTON_LIGHT = BUTTON_PUNCH;
/** Old name of BUTTON_KICK (same bit). */
export const BUTTON_HEAVY = BUTTON_KICK;

/** Every defined bit; anything else in a sampled mask is dropped. */
export const ALL_BUTTONS = 0xff;

export const BUTTON_NAMES = [
  "up",
  "down",
  "left",
  "right",
  "punch",
  "kick",
  "special",
  "start",
] as const;

export type ButtonName = (typeof BUTTON_NAMES)[number];

export const BUTTON_BITS: Readonly<Record<ButtonName, number>> = Object.freeze({
  up: BUTTON_UP,
  down: BUTTON_DOWN,
  left: BUTTON_LEFT,
  right: BUTTON_RIGHT,
  punch: BUTTON_PUNCH,
  kick: BUTTON_KICK,
  special: BUTTON_SPECIAL,
  start: BUTTON_START,
});

// Facing-relative directions reuse the left/right bit positions:
// BACK replaces left and FORWARD replaces right once facing is applied.
export const DIR_UP = BUTTON_UP;
export const DIR_DOWN = BUTTON_DOWN;
export const DIR_BACK = BUTTON_LEFT;
export const DIR_FORWARD = BUTTON_RIGHT;
