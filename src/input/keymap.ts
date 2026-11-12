// Default bindings, one data table per device (docs/game-design.md, "Controls").
// Keys are KeyboardEvent.code values, so they follow physical positions on any layout.
// Players can rebind keys on the controls screen (src/input/bindings.ts).
import type { ButtonName } from "./bits";

export type KeyBindings = Readonly<Record<ButtonName, readonly string[]>>;

/** Keyboard defaults for P1 (index 0) and P2 (index 1): the home-row split. */
export const KEYBOARD_BINDINGS: readonly [KeyBindings, KeyBindings] = [
  {
    up: ["KeyW"],
    down: ["KeyS"],
    left: ["KeyA"],
    right: ["KeyD"],
    punch: ["KeyF"],
    kick: ["KeyG"],
    special: ["KeyH"],
    start: ["Enter"],
  },
  {
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    punch: ["KeyL"],
    kick: ["Semicolon"],
    special: ["Quote"],
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
    punch: [0], // bottom face button (A / Cross)
    kick: [1], // right face button (B / Circle)
    special: [2, 3], // left or top face button (X / Square, Y / Triangle)
    start: [9], // Start / Options
  },
  axisX: 0,
  axisY: 1,
  deadzone: 0.5,
};

/**
 * Keys whose browser default is always stopped while the game has focus, bound
 * or not: quick find in Firefox (' and /), page scrolling (space, arrows),
 * focus moves (Tab) and history navigation (Backspace in older browsers).
 */
export const ALWAYS_BLOCKED_KEYS: ReadonlySet<string> = new Set([
  "Quote",
  "Slash",
  "Space",
  "Tab",
  "Backspace",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "NumpadEnter",
  "Escape",
]);

/** Every key code bound for either player (the page stops their default action). */
export function boundKeyCodes(bindings: readonly KeyBindings[] = KEYBOARD_BINDINGS): Set<string> {
  const codes = new Set<string>();
  for (const player of bindings) {
    for (const keys of Object.values(player)) for (const code of keys) codes.add(code);
  }
  return codes;
}

const PUNCTUATION: Readonly<Record<string, string>> = {
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  IntlBackslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Space: "SPACE",
  Enter: "ENTER",
  NumpadEnter: "NUM ENTER",
  Backspace: "BKSP",
  ShiftLeft: "L-SHIFT",
  ShiftRight: "R-SHIFT",
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
};

/** A short label for a key code, as printed on the key ("KeyF" -> "F", "Quote" -> "'"). */
export function keyLabel(code: string | undefined): string {
  if (!code) return "--";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `NUM ${code.slice(6)}`;
  return PUNCTUATION[code] ?? code.replace(/^Numpad/, "NUM ").toUpperCase();
}
