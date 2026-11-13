import { describe, expect, it } from "vitest";
import { fitScreen, NO_INSETS, type Insets } from "../render/screen";
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
import type { GamepadSource } from "./gamepad";
import { createKeyboard, type KeyTarget } from "./keyboard";
import { KEYBOARD_BINDINGS } from "./keymap";
import { createInputSampler } from "./sampler";
import {
  canvasRectToCss,
  DPAD_DEAD_ZONE,
  dpadBits,
  HUD_BARS,
  layoutTouch,
  overlaps,
  PAUSE_GAP,
  PAUSE_MIN,
  pauseSizeIn,
  TOUCH_BUTTON_BITS,
  TOUCH_BUTTONS,
  TouchState,
  type Rect,
} from "./touch";

const R = 70; // d-pad radius in CSS pixels

/** A point at `deg` degrees (0 = right, 90 = down, screen coordinates) and `dist` from the center. */
function at(deg: number, dist = R * 0.8): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [Math.cos(rad) * dist, Math.sin(rad) * dist];
}

describe("d-pad (A1)", () => {
  it("maps the 8 directions", () => {
    const cases: [number, number][] = [
      [0, BUTTON_RIGHT],
      [45, BUTTON_RIGHT | BUTTON_DOWN],
      [90, BUTTON_DOWN],
      [135, BUTTON_LEFT | BUTTON_DOWN],
      [180, BUTTON_LEFT],
      [225, BUTTON_LEFT | BUTTON_UP],
      [270, BUTTON_UP],
      [315, BUTTON_RIGHT | BUTTON_UP],
    ];
    for (const [deg, bits] of cases) expect(dpadBits(...at(deg), R), `${deg} deg`).toBe(bits);
  });

  it("gives each direction a 45 degree sector", () => {
    expect(dpadBits(...at(22), R)).toBe(BUTTON_RIGHT);
    expect(dpadBits(...at(23), R)).toBe(BUTTON_RIGHT | BUTTON_DOWN);
    expect(dpadBits(...at(67), R)).toBe(BUTTON_RIGHT | BUTTON_DOWN);
    expect(dpadBits(...at(68), R)).toBe(BUTTON_DOWN);
    expect(dpadBits(...at(-22), R)).toBe(BUTTON_RIGHT);
    expect(dpadBits(...at(-23), R)).toBe(BUTTON_RIGHT | BUTTON_UP);
  });

  it("is neutral inside the dead zone and reads past the pad's edge", () => {
    const dead = R * DPAD_DEAD_ZONE;
    for (let deg = 0; deg < 360; deg += 15) {
      expect(dpadBits(...at(deg, dead * 0.95), R)).toBe(0);
      expect(dpadBits(...at(deg, dead * 1.1), R)).not.toBe(0);
    }
    expect(dpadBits(0, 0, R)).toBe(0);
    expect(dpadBits(R * 3, 0, R)).toBe(BUTTON_RIGHT); // finger slid off the pad, still held right
  });

  it("slides between directions without lifting (one finger, many moves)", () => {
    const t = new TouchState();
    const seen: number[] = [];
    for (const deg of [180, 135, 90, 45, 0]) {
      t.set(1, dpadBits(...at(deg), R));
      seen.push(t.held());
      t.endSample();
    }
    expect(seen).toEqual([BUTTON_LEFT, BUTTON_LEFT | BUTTON_DOWN, BUTTON_DOWN, BUTTON_RIGHT | BUTTON_DOWN, BUTTON_RIGHT]);
    t.set(1, dpadBits(0, 0, R)); // back to the center: neutral, finger still down
    expect(t.held()).toBe(0);
  });
});

describe("buttons (A1)", () => {
  it("map to bits; Throw is Punch+Kick and Pause is Start", () => {
    expect(TOUCH_BUTTON_BITS).toEqual({
      punch: BUTTON_PUNCH,
      kick: BUTTON_KICK,
      special: BUTTON_SPECIAL,
      throw: BUTTON_PUNCH | BUTTON_KICK,
      pause: BUTTON_START,
    });
  });

  it("hold together with a direction (multi-touch)", () => {
    const t = new TouchState();
    t.set(1, dpadBits(...at(0), R)); // finger 1 holds right
    t.set(2, TOUCH_BUTTON_BITS.kick); // finger 2 presses Kick
    expect(t.bits()).toBe(BUTTON_RIGHT | BUTTON_KICK);
    t.release(2);
    t.endSample();
    expect(t.bits()).toBe(BUTTON_RIGHT);
    t.set(3, TOUCH_BUTTON_BITS.special);
    t.set(4, TOUCH_BUTTON_BITS.punch);
    expect(t.bits()).toBe(BUTTON_RIGHT | BUTTON_SPECIAL | BUTTON_PUNCH);
    t.reset();
    expect(t.bits()).toBe(0);
  });
});

// --- sampler -------------------------------------------------------------

function fakeKeyTarget() {
  const listeners = new Map<string, ((e: KeyboardEvent) => void)[]>();
  const target: KeyTarget = {
    addEventListener: (type, l) => listeners.set(type, [...(listeners.get(type) ?? []), l]),
    removeEventListener: () => {},
  };
  const fire = (type: "keydown" | "keyup", code: string) => {
    const e = { code, ctrlKey: false, metaKey: false, repeat: false, preventDefault: () => {} } as unknown as KeyboardEvent;
    for (const l of listeners.get(type) ?? []) l(e);
  };
  return { target, fire };
}

const noPads: GamepadSource = { read: () => [0, 0], has: () => false };

describe("touch through the sampler (A1)", () => {
  it("latches a tap shorter than one step into the next sample, once", () => {
    const touch = new TouchState();
    const { target } = fakeKeyTarget();
    const sampler = createInputSampler(createKeyboard(target, KEYBOARD_BINDINGS), noPads, touch);
    touch.set(7, TOUCH_BUTTON_BITS.punch);
    touch.release(7); // lifted before the step
    expect(sampler.sample()).toEqual([BUTTON_PUNCH, 0]);
    expect(sampler.sample()).toEqual([0, 0]);
  });

  it("latches a d-pad flick released between steps", () => {
    const touch = new TouchState();
    const { target } = fakeKeyTarget();
    const sampler = createInputSampler(createKeyboard(target, KEYBOARD_BINDINGS), noPads, touch);
    touch.set(3, dpadBits(...at(270), R));
    touch.release(3);
    expect(sampler.sample()).toEqual([BUTTON_UP, 0]);
    expect(sampler.sample()).toEqual([0, 0]);
  });

  it("merges touch with P1's keyboard and pad bits, never P2's", () => {
    const touch = new TouchState();
    const { target, fire } = fakeKeyTarget();
    const pads: GamepadSource = { read: () => [BUTTON_SPECIAL, 0], has: (p) => p === 0 };
    const sampler = createInputSampler(createKeyboard(target, KEYBOARD_BINDINGS), pads, touch);
    fire("keydown", "KeyA"); // P1 left
    fire("keydown", "KeyL"); // P2 right
    touch.set(1, TOUCH_BUTTON_BITS.kick);
    expect(sampler.sample()).toEqual([BUTTON_LEFT | BUTTON_KICK | BUTTON_SPECIAL, BUTTON_RIGHT]);
    touch.set(1, TOUCH_BUTTON_BITS.throw);
    fire("keyup", "KeyA");
    fire("keyup", "KeyL");
    expect(sampler.sample()).toEqual([BUTTON_PUNCH | BUTTON_KICK | BUTTON_SPECIAL, 0]);
  });

  it("reports P1's keyboard and pad input to the touch source, never P2's (P2 may play on a keyboard beside a touch P1)", () => {
    const touch = new TouchState();
    const seen: number[] = [];
    const source = { bits: () => touch.bits(), endSample: () => touch.endSample(), otherInput: (bits: number) => seen.push(bits) };
    const { target, fire } = fakeKeyTarget();
    let pads: [number, number] = [0, BUTTON_KICK];
    const sampler = createInputSampler(createKeyboard(target, KEYBOARD_BINDINGS), { read: () => pads, has: () => true }, source);
    fire("keydown", "KeyJ"); // P2's keyboard
    sampler.sample();
    fire("keyup", "KeyJ");
    fire("keydown", "KeyD"); // P1's keyboard
    sampler.sample();
    fire("keyup", "KeyD");
    pads = [BUTTON_SPECIAL, 0]; // P1's pad
    sampler.sample();
    expect(seen).toEqual([0, BUTTON_RIGHT, BUTTON_SPECIAL]);
  });

  it("works without a touch source (desktop)", () => {
    const { target, fire } = fakeKeyTarget();
    const sampler = createInputSampler(createKeyboard(target, KEYBOARD_BINDINGS), noPads);
    fire("keydown", "KeyF");
    expect(sampler.sample()).toEqual([BUTTON_PUNCH, 0]);
  });
});

// --- layout ----------------------------------------------------------------

// Spec 015 R5 sizes that show touch controls (landscape phones and tablets),
// plus an iPhone in landscape with its notch and home-indicator insets.
const TOUCH_SIZES: [number, number, Insets][] = [
  [667, 375, NO_INSETS],
  [844, 390, NO_INSETS],
  [932, 430, NO_INSETS],
  [1024, 768, NO_INSETS],
  [1180, 820, NO_INSETS],
  [844, 390, { top: 0, right: 47, bottom: 21, left: 47 }],
  [932, 430, { top: 0, right: 59, bottom: 21, left: 59 }],
];

describe("touch layout (R1)", () => {
  it.each(TOUCH_SIZES)("%ix%i keeps the controls off the health bars, inside the safe area, apart", (w, h, insets) => {
    const fit = fitScreen(w, h, { fractional: true, insets });
    const layout = layoutTouch(w, h, fit, insets);
    const bars = HUD_BARS.map((r) => canvasRectToCss(r, fit));
    const rects = Object.entries(layout) as [string, Rect][];
    for (const [name, r] of rects) {
      for (const bar of bars) expect(overlaps(r, bar), `${name} over a health bar`).toBe(false);
      expect(r.x, name).toBeGreaterThanOrEqual(insets.left);
      expect(r.y, name).toBeGreaterThanOrEqual(insets.top);
      expect(r.x + r.w, name).toBeLessThanOrEqual(w - insets.right);
      expect(r.y + r.h, name).toBeLessThanOrEqual(h - insets.bottom);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i]![1], rects[j]![1]), `${rects[i]![0]} and ${rects[j]![0]}`).toBe(false);
      }
    }
    // Thumb-sized: the d-pad at least 120 px, buttons at least 52 px.
    expect(layout.dpad.w).toBeGreaterThanOrEqual(120);
    for (const name of TOUCH_BUTTONS) if (name !== "pause") expect(layout[name].w).toBeGreaterThanOrEqual(52);
  });

  it("puts the d-pad bottom-left and the buttons bottom-right", () => {
    const fit = fitScreen(844, 390, { fractional: true });
    const l = layoutTouch(844, 390, fit, NO_INSETS);
    expect(l.dpad.x + l.dpad.w).toBeLessThan(844 / 2);
    expect(l.dpad.y + l.dpad.h).toBeGreaterThan(390 * 0.9);
    for (const name of ["punch", "kick", "special", "throw"] as const) expect(l[name].x).toBeGreaterThan(844 / 2);
  });
});

describe("Pause in a letterbox (R1, QA 2026-11-12 F2)", () => {
  /** Where Pause sits: "side" (right letterbox), "top" (top letterbox) or "stage" (over the canvas). */
  function where(w: number, h: number, insets: Insets = NO_INSETS) {
    const fit = fitScreen(w, h, { fractional: true, insets });
    const pause = layoutTouch(w, h, fit, insets).pause;
    const right = fit.left + fit.cssWidth;
    const spot = pause.x >= right ? "side" : pause.y + pause.h <= fit.top ? "top" : "stage";
    return { spot, pause, fit };
  }

  it("1024x768 tablet: the 96 px top letterbox holds a full-size Pause (it missed by 2 px before)", () => {
    const { spot, pause, fit } = where(1024, 768);
    expect(fit.top).toBe(96);
    expect(spot).toBe("top");
    expect(pause.w).toBe(52);
    expect(pause.y).toBeGreaterThanOrEqual(PAUSE_GAP);
    expect(fit.top - (pause.y + pause.h)).toBeGreaterThanOrEqual(PAUSE_GAP);
    expect(pause.x + pause.w / 2).toBeCloseTo(fit.left + fit.cssWidth / 2, 0); // centered over the timer
  });

  it("1180x820 tablet: the 78 px top letterbox holds it too", () => {
    const { spot, pause, fit } = where(1180, 820);
    expect(spot).toBe("top");
    expect(pause.w).toBeGreaterThanOrEqual(PAUSE_MIN);
    expect(pause.y + pause.h).toBeLessThanOrEqual(fit.top - PAUSE_GAP);
  });

  it("phones keep Pause in the side letterbox at its usual size", () => {
    for (const [w, h] of [[844, 390], [932, 430]] as const) {
      const { spot, pause } = where(w, h);
      expect(spot, `${w}x${h}`).toBe("side");
      expect(pause.w).toBe(Math.round(Math.min(52, Math.max(36, Math.min(w, h) * 0.1))));
    }
    // With a notch the 47 px left beside the canvas is too thin for its 39 px Pause plus gaps, and
    // the inset itself is off limits: Pause stays under the timer, as before (and off the bars).
    expect(where(844, 390, { top: 0, right: 47, bottom: 21, left: 47 }).spot).toBe("stage");
  });

  it("shrinks Pause to fit a tight letterbox, down to the minimum touch size, then falls back to the stage", () => {
    // pauseSizeIn: usual size with the usual margin; else the room minus a gap each side; never under PAUSE_MIN
    expect(pauseSizeIn(98, 52, 23)).toBe(52);
    expect(pauseSizeIn(96, 52, 23)).toBe(52);
    expect(pauseSizeIn(60, 52, 23)).toBe(60 - 2 * PAUSE_GAP);
    expect(pauseSizeIn(PAUSE_MIN + 2 * PAUSE_GAP, 52, 23)).toBe(PAUSE_MIN);
    expect(pauseSizeIn(PAUSE_MIN + 2 * PAUSE_GAP - 1, 52, 23)).toBeNull();
    expect(pauseSizeIn(0, 52, 23)).toBeNull();
    // a small usual Pause (phone) is never grown, and fits as long as its own size does
    expect(pauseSizeIn(40 + 2 * PAUSE_GAP, 37, 11)).toBe(37);
    // 667x375 has no letterbox at all: Pause goes under the timer, below the health bars
    const { spot, pause, fit } = where(667, 375);
    expect(spot).toBe("stage");
    for (const bar of HUD_BARS.map((r) => canvasRectToCss(r, fit))) expect(overlaps(pause, bar)).toBe(false);
  });

  it("a top letterbox just too thin for the minimum size falls back to the stage", () => {
    // 16:9 canvas of width 1000 is 562.5 tall; a height of 562.5 + 2 * (PAUSE_MIN + 2 * PAUSE_GAP - 1) leaves 55 px rows
    const h = Math.round(562.5 + 2 * (PAUSE_MIN + 2 * PAUSE_GAP - 1));
    const { spot, fit } = where(1000, h);
    expect(fit.top).toBeLessThan(PAUSE_MIN + 2 * PAUSE_GAP);
    expect(spot).toBe("stage");
  });
});
