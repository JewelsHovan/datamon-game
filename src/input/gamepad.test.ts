import { describe, expect, it } from "vitest";
import {
  BUTTON_DOWN,
  BUTTON_KICK,
  BUTTON_LEFT,
  BUTTON_PUNCH,
  BUTTON_RIGHT,
  BUTTON_SPECIAL,
  BUTTON_START,
  BUTTON_UP,
} from "./bits";
import { connectedPads, createGamepads, gamepadToBits, PadSlots, type GamepadLike, type PadEvent } from "./gamepad";
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

  it("maps A to punch, B to kick, X or Y to special, and Start to start (spec 005 R4)", () => {
    expect(gamepadToBits(fakePad([0]))).toBe(BUTTON_PUNCH);
    expect(gamepadToBits(fakePad([1]))).toBe(BUTTON_KICK);
    expect(gamepadToBits(fakePad([2]))).toBe(BUTTON_SPECIAL);
    expect(gamepadToBits(fakePad([3]))).toBe(BUTTON_SPECIAL);
    expect(gamepadToBits(fakePad([9]))).toBe(BUTTON_START);
  });

  it("combines d-pad, stick and buttons into one bitmask", () => {
    expect(gamepadToBits(fakePad([13, 0, 1], [0.8, 0]))).toBe(
      BUTTON_DOWN | BUTTON_RIGHT | BUTTON_PUNCH | BUTTON_KICK,
    );
  });

  it("reads nothing from a missing or disconnected pad", () => {
    expect(gamepadToBits(null)).toBe(0);
    expect(gamepadToBits({ ...fakePad([0]), connected: false })).toBe(0);
  });

  it("lists connected pads in index order", () => {
    const pads = connectedPads([null, fakePad([], undefined, 3), fakePad([], undefined, 1)]);
    expect(pads.map((p) => p.index)).toEqual([1, 3]);
  });
});

describe("gamepad join and assignment (spec 005 A4)", () => {
  const idle = (index: number) => fakePad([], undefined, index);
  const pressing = (index: number, buttons: number[] = [0]) => fakePad(buttons, undefined, index);

  it("a connected pad drives no one until a button on it is pressed", () => {
    const slots = new PadSlots();
    expect(slots.update([idle(0), idle(1)])).toEqual([]);
    expect(slots.slots).toEqual([null, null]);
    expect(slots.bits()).toEqual([0, 0]);
  });

  it("pad A pressed first goes to P1, a second pad to P2, unplugging P1's pad frees P1", () => {
    const slots = new PadSlots();
    // Pad 2 presses first even though pad 0 has the lower index.
    expect(slots.update([idle(0), null, pressing(2)])).toEqual([{ type: "join", player: 0, pad: 2 }]);
    expect(slots.update([idle(0), null, idle(2)])).toEqual([]);
    expect(slots.update([pressing(0, [9]), null, idle(2)])).toEqual([{ type: "join", player: 1, pad: 0 }]);
    expect(slots.slots).toEqual([2, 0]);
    // P1's pad is unplugged: P1 is free, P2 keeps its pad.
    expect(slots.update([idle(0), null, null])).toEqual([{ type: "leave", player: 0, pad: 2 }]);
    expect(slots.slots).toEqual([null, 0]);
    expect(slots.has(0)).toBe(false);
    expect(slots.has(1)).toBe(true);
    // The next pad that presses a button takes the free P1 slot.
    expect(slots.update([idle(0), pressing(1)])).toEqual([{ type: "join", player: 0, pad: 1 }]);
    expect(slots.slots).toEqual([1, 0]);
  });

  it("a disconnected pad (connected: false) also frees its slot", () => {
    const slots = new PadSlots();
    slots.update([pressing(0)]);
    expect(slots.update([{ ...idle(0), connected: false }])).toEqual([{ type: "leave", player: 0, pad: 0 }]);
  });

  it("a third pad is ignored while both players have one", () => {
    const slots = new PadSlots();
    slots.update([pressing(0), pressing(1)]);
    expect(slots.slots).toEqual([0, 1]);
    expect(slots.update([idle(0), idle(1), pressing(2)])).toEqual([]);
    expect(slots.slots).toEqual([0, 1]);
  });

  it("the joining press is held back until released, then the pad drives its player", () => {
    const slots = new PadSlots();
    slots.update([pressing(0, [0])]);
    expect(slots.bits()).toEqual([0, 0]);
    slots.update([pressing(0, [0, 15])]);
    expect(slots.bits()).toEqual([BUTTON_RIGHT, 0]);
    slots.update([idle(0)]);
    expect(slots.bits()).toEqual([0, 0]);
    slots.update([pressing(0, [0])]);
    expect(slots.bits()).toEqual([BUTTON_PUNCH, 0]);
  });

  it("createGamepads polls navigator.getGamepads and reports joins", () => {
    let list: (GamepadLike | null)[] = [null];
    const nav = { getGamepads: () => list } as unknown as Navigator;
    const events: PadEvent[] = [];
    const source = createGamepads(nav, (e) => events.push(e));
    expect(source.read()).toEqual([0, 0]);
    list = [pressing(0, [1])];
    source.read();
    list = [pressing(0, [2])];
    expect(source.read()).toEqual([BUTTON_SPECIAL, 0]);
    expect(events).toEqual([{ type: "join", player: 0, pad: 0 }]);
    expect(source.has(0)).toBe(true);
  });
});

describe("keyboard bindings", () => {
  it("follow the design table: P1 WASD + F G H, P2 arrows + L ; '", () => {
    const p1 = keysToBits(new Set(["KeyW", "KeyD", "KeyF", "KeyG", "KeyH", "Enter"]), KEYBOARD_BINDINGS[0]);
    expect(p1).toBe(BUTTON_UP | BUTTON_RIGHT | BUTTON_PUNCH | BUTTON_KICK | BUTTON_SPECIAL | BUTTON_START);
    const p2 = keysToBits(
      new Set(["ArrowDown", "ArrowLeft", "KeyL", "Semicolon", "Quote"]),
      KEYBOARD_BINDINGS[1],
    );
    expect(p2).toBe(BUTTON_DOWN | BUTTON_LEFT | BUTTON_PUNCH | BUTTON_KICK | BUTTON_SPECIAL);
    // P1 keys do nothing for P2 and the other way round.
    expect(keysToBits(new Set(["KeyW", "KeyA", "KeyF"]), KEYBOARD_BINDINGS[1])).toBe(0);
    expect(keysToBits(new Set(["ArrowUp", "KeyL"]), KEYBOARD_BINDINGS[0])).toBe(0);
  });
});
