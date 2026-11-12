import { describe, expect, it } from "vitest";
import {
  BUTTON_DOWN,
  BUTTON_HEAVY,
  BUTTON_LEFT,
  BUTTON_LIGHT,
  BUTTON_RIGHT,
  BUTTON_UP,
  DIR_BACK,
  DIR_FORWARD,
} from "./inputBits";
import {
  INPUT_HISTORY_LENGTH,
  createInputHistory,
  inputAt,
  isHeld,
  pushInput,
  resolveSocd,
  toFacingRelative,
  wasPressed,
} from "./inputHistory";

describe("input history (A7)", () => {
  it("left + right resolves to neutral", () => {
    expect(resolveSocd(BUTTON_LEFT | BUTTON_RIGHT)).toBe(0);
    expect(resolveSocd(BUTTON_LEFT | BUTTON_RIGHT | BUTTON_UP)).toBe(BUTTON_UP);
    expect(resolveSocd(BUTTON_LEFT | BUTTON_RIGHT | BUTTON_LIGHT)).toBe(BUTTON_LIGHT);
  });

  it("up + down resolves to neutral", () => {
    expect(resolveSocd(BUTTON_UP | BUTTON_DOWN)).toBe(0);
    expect(resolveSocd(BUTTON_UP | BUTTON_DOWN | BUTTON_RIGHT)).toBe(BUTTON_RIGHT);
  });

  it("SOCD is applied when the input is recorded", () => {
    const h = createInputHistory();
    pushInput(h, BUTTON_LEFT | BUTTON_RIGHT | BUTTON_UP | BUTTON_DOWN | BUTTON_HEAVY);
    expect(inputAt(h)).toBe(BUTTON_HEAVY);
  });

  it('"right" is forward when facing right and back when facing left', () => {
    expect(toFacingRelative(BUTTON_RIGHT, 1)).toBe(DIR_FORWARD);
    expect(toFacingRelative(BUTTON_RIGHT, -1)).toBe(DIR_BACK);
    expect(toFacingRelative(BUTTON_LEFT, 1)).toBe(DIR_BACK);
    expect(toFacingRelative(BUTTON_LEFT, -1)).toBe(DIR_FORWARD);
    expect(toFacingRelative(BUTTON_RIGHT | BUTTON_UP | BUTTON_LIGHT, -1)).toBe(
      DIR_BACK | BUTTON_UP | BUTTON_LIGHT,
    );
  });

  it('"pressed this frame" is true only on the first frame a button is held', () => {
    const h = createInputHistory();
    const pressed: boolean[] = [];
    for (const bits of [0, BUTTON_LIGHT, BUTTON_LIGHT, BUTTON_LIGHT, 0, BUTTON_LIGHT]) {
      pushInput(h, bits);
      pressed.push(wasPressed(h, BUTTON_LIGHT));
    }
    expect(pressed).toEqual([false, true, false, false, false, true]);
    expect(isHeld(h, BUTTON_LIGHT)).toBe(true);
    expect(wasPressed(h, BUTTON_HEAVY)).toBe(false);
  });

  it("holds at least 30 frames of history: each of the last 30 frames reads back exactly", () => {
    expect(INPUT_HISTORY_LENGTH).toBeGreaterThanOrEqual(30);
    const h = createInputHistory();
    const pushed: number[] = [];
    for (let frame = 0; frame < 75; frame++) {
      const bits = (frame * 37) & 0xff; // a different mix of buttons every frame
      pushed.push(resolveSocd(bits));
      pushInput(h, bits);
    }
    for (let age = 0; age < 30; age++) {
      expect(inputAt(h, age)).toBe(pushed[pushed.length - 1 - age]);
    }
    expect(inputAt(h, INPUT_HISTORY_LENGTH)).toBe(0);
  });
});
