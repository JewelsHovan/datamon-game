import { describe, expect, it } from "vitest";
import {
  BUTTON_DOWN,
  BUTTON_HEAVY,
  BUTTON_LEFT,
  BUTTON_LIGHT,
  BUTTON_RIGHT,
  BUTTON_SPECIAL,
  BUTTON_START,
  BUTTON_UP,
} from "./bits";
import { connectedPads, gamepadToBits, type GamepadLike } from "./gamepad";
import { KEYBOARD_BINDINGS } from "./keymap";
import { keysToBits } from "./keyboard";

function fakePad(pressed: number[] = [], axes: number[] = [0, 0, 0, 0], index = 0): GamepadLike {
  return {
    index,
    connected: true,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: 0 })),
    axes,
  };
}

describe("gamepad mapping (A7)", () => {
  it("maps the d-pad to directions", () => {
    expect(gamepadToBits(fakePad([12]))).toBe(BUTTON_UP);
    expect(gamepadToBits(fakePad([13]))).toBe(BUTTON_DOWN);
    expect(gamepadToBits(fakePad([14]))).toBe(BUTTON_LEFT);
    expect(gamepadToBits(fakePad([15]))).toBe(BUTTON_RIGHT);
    expect(gamepadToBits(fakePad([12, 15]))).toBe(BUTTON_UP | BUTTON_RIGHT);
  });

  it("maps the left stick past the deadzone, and ignores it inside", () => {
    expect(gamepadToBits(fakePad([], [-0.9, 0]))).toBe(BUTTON_LEFT);
    expect(gamepadToBits(fakePad([], [0.9, 0]))).toBe(BUTTON_RIGHT);
    expect(gamepadToBits(fakePad([], [0, -0.9]))).toBe(BUTTON_UP);
    expect(gamepadToBits(fakePad([], [0, 0.9]))).toBe(BUTTON_DOWN);
    expect(gamepadToBits(fakePad([], [0.7, 0.7]))).toBe(BUTTON_RIGHT | BUTTON_DOWN);
    expect(gamepadToBits(fakePad([], [0.3, -0.4]))).toBe(0);
    expect(gamepadToBits(fakePad([], [-0.49, 0.49]))).toBe(0);
  });

  it("maps face buttons to light, heavy and special, and Start to start", () => {
    expect(gamepadToBits(fakePad([0]))).toBe(BUTTON_LIGHT);
    expect(gamepadToBits(fakePad([1]))).toBe(BUTTON_HEAVY);
    expect(gamepadToBits(fakePad([2]))).toBe(BUTTON_SPECIAL);
    expect(gamepadToBits(fakePad([9]))).toBe(BUTTON_START);
  });

  it("combines d-pad, stick and buttons into one bitmask", () => {
    expect(gamepadToBits(fakePad([13, 0, 1], [0.8, 0]))).toBe(
      BUTTON_DOWN | BUTTON_RIGHT | BUTTON_LIGHT | BUTTON_HEAVY,
    );
  });

  it("reads nothing from a missing or disconnected pad", () => {
    expect(gamepadToBits(null)).toBe(0);
    expect(gamepadToBits({ ...fakePad([0]), connected: false })).toBe(0);
  });

  it("assigns connected pads to players in index order", () => {
    const pads = connectedPads([null, fakePad([], undefined, 3), fakePad([], undefined, 1)]);
    expect(pads.map((p) => p.index)).toEqual([1, 3]);
  });
});

describe("keyboard bindings", () => {
  it("follow the design table: P1 WASD + F G H, P2 arrows + , . /", () => {
    const p1 = keysToBits(new Set(["KeyW", "KeyD", "KeyF", "KeyG", "KeyH"]), KEYBOARD_BINDINGS[0]);
    expect(p1).toBe(BUTTON_UP | BUTTON_RIGHT | BUTTON_LIGHT | BUTTON_HEAVY | BUTTON_SPECIAL);
    const p2 = keysToBits(
      new Set(["ArrowDown", "ArrowLeft", "Comma", "Period", "Slash"]),
      KEYBOARD_BINDINGS[1],
    );
    expect(p2).toBe(BUTTON_DOWN | BUTTON_LEFT | BUTTON_LIGHT | BUTTON_HEAVY | BUTTON_SPECIAL);
    // P1 keys do nothing for P2 and the other way round.
    expect(keysToBits(new Set(["KeyW", "KeyA"]), KEYBOARD_BINDINGS[1])).toBe(0);
    expect(keysToBits(new Set(["ArrowUp"]), KEYBOARD_BINDINGS[0])).toBe(0);
  });
});
