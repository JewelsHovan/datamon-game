// Touch controls for P1 (spec 015): a d-pad on the left, Punch, Kick, Special
// and Throw on the right, and Pause. They are HTML elements over the canvas
// (pointer events give reliable multi-touch hit testing, and the canvas stays a
// function of game state). Each finger is one pointer; P1's touch bits are the
// OR of every finger, plus a latch so a tap shorter than one sim step still
// shows up in the next sample (as keyboard taps do). The sampler merges them
// into P1's bitmask with the keyboard and gamepad.
//
// The pure parts (d-pad geometry, button bits, the latch, the layout) are
// separate from the DOM layer so vitest covers them in a node environment.
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
import type { Insets, ScreenFit } from "../render/screen";

export const TOUCH_BUTTONS = ["punch", "kick", "special", "throw", "pause"] as const;
export type TouchButton = (typeof TOUCH_BUTTONS)[number];

/** Throw is Punch+Kick pressed together; Pause is Start (it also confirms in menus). */
export const TOUCH_BUTTON_BITS: Readonly<Record<TouchButton, number>> = Object.freeze({
  punch: BUTTON_PUNCH,
  kick: BUTTON_KICK,
  special: BUTTON_SPECIAL,
  throw: BUTTON_PUNCH | BUTTON_KICK,
  pause: BUTTON_START,
});

/** Fraction of the d-pad radius around its center that reads as neutral. */
export const DPAD_DEAD_ZONE = 0.25;
/** tan(22.5 degrees): the 8 directions each own a 45 degree sector. */
const TAN_22_5 = Math.SQRT2 - 1;

/**
 * Direction bits for a finger at (dx, dy) from the d-pad center (screen
 * coordinates, y down). Inside the dead zone it is neutral; beyond it, the
 * nearest of 8 directions. A finger that slides past the pad's edge keeps its
 * direction, so sliding never drops out.
 */
export function dpadBits(dx: number, dy: number, radius: number, deadZone = DPAD_DEAD_ZONE): number {
  const dead = radius * deadZone;
  if (dx * dx + dy * dy <= dead * dead) return 0;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  let bits = 0;
  if (ax > ay * TAN_22_5) bits |= dx < 0 ? BUTTON_LEFT : BUTTON_RIGHT;
  if (ay > ax * TAN_22_5) bits |= dy < 0 ? BUTTON_UP : BUTTON_DOWN;
  return bits;
}

/** What the input sampler reads from touch: P1's bits once per step. */
export interface TouchSource {
  /** P1's bits: every finger held now, plus anything pressed since the last sample. */
  bits(): number;
  /** Clears the tap latch; call once per sample. */
  endSample(): void;
  /**
   * P1's keyboard and gamepad bits this sample, before touch is merged. Anything
   * there means P1 plays without touch. P2's devices never reach this, so P2 on a
   * keyboard or pad beside a touch P1 (a tablet) leaves the controls alone.
   */
  otherInput?(bits: number): void;
}

/** Held bits per finger (pointer id), with a latch for taps shorter than a step. */
export class TouchState implements TouchSource {
  private readonly fingers = new Map<number, number>();
  private latched = 0;

  /** A finger is down (or moved) on a control producing `bits` (0 for a neutral d-pad). */
  set(id: number, bits: number): void {
    this.fingers.set(id, bits);
    this.latched |= bits;
  }

  /** A finger lifted (or was cancelled). */
  release(id: number): void {
    this.fingers.delete(id);
  }

  /** Bits one finger holds, or 0. */
  of(id: number): number {
    return this.fingers.get(id) ?? 0;
  }

  /** Every finger's bits, without the latch. */
  held(): number {
    let bits = 0;
    for (const b of this.fingers.values()) bits |= b;
    return bits;
  }

  bits(): number {
    return this.held() | this.latched;
  }

  endSample(): void {
    this.latched = 0;
  }

  /** Lifts every finger and clears the latch (controls hidden). */
  reset(): void {
    this.fingers.clear();
    this.latched = 0;
  }
}

// --------------------------------------------------------------- layout ----

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TouchLayout = Record<"dpad" | TouchButton, Rect>;

/**
 * The fight HUD's health bars, portraits and round pips, in canvas pixels
 * (src/render/hud.ts: bars at y 18..30 with a 2 px frame, portraits at y 14..46,
 * pips down to y 45). Touch controls never cover these.
 */
export const HUD_BARS: readonly Rect[] = [
  { x: 14, y: 14, w: 290, h: 34 },
  { x: 336, y: 14, w: 290, h: 34 },
];
/** Canvas y under the health bars where Pause may sit (between the bars there is no room). */
const BELOW_BARS_Y = 50;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Lays out the controls for a view of `width` x `height` CSS pixels: the d-pad in
 * the bottom-left corner, the buttons in the bottom-right corner (both over the
 * letterbox and the canvas corners), Pause in a letterbox if there is room,
 * else under the timer. Everything stays inside the safe area.
 */
export function layoutTouch(width: number, height: number, canvas: ScreenFit, insets: Insets): TouchLayout {
  const short = Math.min(width, height);
  const margin = Math.round(clamp(short * 0.03, 8, 24));
  const d = Math.round(clamp(short * 0.38, 120, 200));
  const b = Math.round(clamp(short * 0.155, 52, 84));
  const gap = Math.round(b * 0.2);
  const p = Math.round(clamp(short * 0.1, 36, 52));

  const left = insets.left + margin;
  const right = width - insets.right - margin;
  const bottom = height - insets.bottom - margin;

  // Buttons: a 2x2 cluster, the right column raised a little (arcade layout).
  //   SPECIAL  THROW
  //   PUNCH    KICK
  const lift = Math.round(b * 0.3);
  const colR = right - b;
  const colL = colR - gap - b;
  const rowLow = bottom - b;
  const rowHigh = rowLow - gap - b;

  let pause: Rect;
  const sideRoom = width - insets.right - (canvas.left + canvas.cssWidth);
  const topRoom = canvas.top - insets.top;
  if (sideRoom >= p + 2 * margin) {
    pause = { x: width - insets.right - margin - p, y: insets.top + margin, w: p, h: p };
  } else if (topRoom >= p + 2 * margin) {
    pause = { x: Math.round(canvas.left + canvas.cssWidth / 2 - p / 2), y: Math.round(insets.top + (topRoom - p) / 2), w: p, h: p };
  } else {
    pause = {
      x: Math.round(canvas.left + canvas.cssWidth / 2 - p / 2),
      y: Math.round(canvas.top + BELOW_BARS_Y * canvas.scale),
      w: p,
      h: p,
    };
  }

  return {
    dpad: { x: left, y: bottom - d, w: d, h: d },
    punch: { x: colL, y: rowLow, w: b, h: b },
    kick: { x: colR, y: rowLow - lift, w: b, h: b },
    special: { x: colL, y: rowHigh, w: b, h: b },
    throw: { x: colR, y: rowHigh - lift, w: b, h: b },
    pause,
  };
}

/** A canvas-pixel rect in CSS pixels. */
export function canvasRectToCss(r: Rect, canvas: ScreenFit): Rect {
  return { x: canvas.left + r.x * canvas.scale, y: canvas.top + r.y * canvas.scale, w: r.w * canvas.scale, h: r.h * canvas.scale };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// ------------------------------------------------------------------ DOM ----

export interface TouchControls extends TouchSource {
  /** The controls are on screen. */
  readonly visible: boolean;
  /** A coarse pointer, or touch has been used on this page (fractional scaling, rotate screen). */
  readonly touchDevice: boolean;
  /** Called once when touchDevice turns true after start-up (the first touch). */
  onTouchDevice: (() => void) | null;
  show(): void;
  /** P1 plays with the keyboard or a gamepad: hide the controls and lift every finger. */
  hide(): void;
  /** Pause shows only in a fight and its pause menu (on menus Start just confirms, as Punch does). */
  setPauseShown(shown: boolean): void;
  /** Positions the controls for the current fit. */
  layout(width: number, height: number, canvas: ScreenFit, insets: Insets): void;
  /** Bits held by fingers right now (no latch), for checks. */
  held(): number;
  dispose(): void;
}

const LABELS: Readonly<Record<Exclude<TouchButton, "pause">, [string, string]>> = {
  punch: ["P", "PUNCH"],
  kick: ["K", "KICK"],
  special: ["S", "SPECIAL"],
  throw: ["P+K", "THROW"],
};
const DIRS = [
  ["up", BUTTON_UP],
  ["down", BUTTON_DOWN],
  ["left", BUTTON_LEFT],
  ["right", BUTTON_RIGHT],
] as const;

/**
 * Builds the controls inside `root` (an empty element over the canvas) and
 * wires pointer events. They show on a coarse pointer, or on the first touch
 * anywhere; P1's keyboard or gamepad input hides them (otherInput, from the sampler).
 */
export function createTouchControls(root: HTMLElement, win: Window = window): TouchControls {
  const doc = root.ownerDocument;
  const state = new TouchState();
  const coarse = win.matchMedia?.("(pointer: coarse)").matches ?? false;
  let touchDevice = coarse;
  let visible = false;
  let last: { width: number; height: number; canvas: ScreenFit; insets: Insets } | null = null;

  const make = (cls: string, parent: HTMLElement, tag = "div"): HTMLElement => {
    const el = doc.createElement(tag);
    el.className = cls;
    parent.appendChild(el);
    return el;
  };

  root.textContent = "";
  root.setAttribute("aria-hidden", "true");
  const dpad = make("touch-dpad", root);
  dpad.dataset.control = "dpad";
  const arms = new Map<number, HTMLElement>();
  for (const [name, bit] of DIRS) {
    const arm = make(`touch-arm touch-arm-${name}`, dpad);
    arms.set(bit, arm);
  }
  make("touch-hub", dpad);
  const knob = make("touch-knob", dpad);

  const buttons = new Map<TouchButton, HTMLElement>();
  for (const name of TOUCH_BUTTONS) {
    const btn = make(`touch-btn touch-btn-${name}`, root);
    btn.dataset.control = name;
    if (name === "pause") {
      make("touch-pause-bar", btn);
      make("touch-pause-bar", btn);
    } else {
      const [glyph, caption] = LABELS[name];
      make("touch-glyph", btn, "span").textContent = glyph;
      make("touch-caption", btn, "span").textContent = caption;
    }
    buttons.set(name, btn);
  }

  const dpadFingers = new Set<number>();
  const buttonFingers = new Map<number, TouchButton>();

  function paint(): void {
    let dir = 0;
    for (const id of dpadFingers) dir |= state.of(id);
    for (const [bit, arm] of arms) arm.classList.toggle("lit", (dir & bit) !== 0);
    dpad.classList.toggle("active", dpadFingers.size > 0);
    const down = new Set(buttonFingers.values());
    for (const [name, btn] of buttons) btn.classList.toggle("pressed", down.has(name));
  }

  function moveDpad(e: PointerEvent): void {
    const r = dpad.getBoundingClientRect();
    const radius = r.width / 2;
    const dx = e.clientX - (r.left + radius);
    const dy = e.clientY - (r.top + r.height / 2);
    state.set(e.pointerId, dpadBits(dx, dy, radius));
    // The knob follows the finger, held inside the pad.
    const len = Math.hypot(dx, dy);
    const max = radius * 0.45;
    const k = len > max ? max / len : 1;
    knob.style.transform = `translate(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px)`;
    paint();
  }

  const capture = (el: HTMLElement, id: number) => {
    try {
      el.setPointerCapture(id);
    } catch {
      // Synthetic or already-released pointers cannot be captured; touch captures implicitly.
    }
  };

  const onDpadDown = (e: PointerEvent) => {
    capture(dpad, e.pointerId);
    dpadFingers.add(e.pointerId);
    moveDpad(e);
  };
  const onDpadMove = (e: PointerEvent) => {
    if (dpadFingers.has(e.pointerId)) moveDpad(e);
  };
  const onDpadEnd = (e: PointerEvent) => {
    if (!dpadFingers.delete(e.pointerId)) return;
    state.release(e.pointerId);
    if (dpadFingers.size === 0) knob.style.transform = "";
    paint();
  };
  dpad.addEventListener("pointerdown", onDpadDown);
  dpad.addEventListener("pointermove", onDpadMove);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) dpad.addEventListener(type, onDpadEnd);

  for (const [name, btn] of buttons) {
    btn.addEventListener("pointerdown", (e) => {
      capture(btn, e.pointerId);
      buttonFingers.set(e.pointerId, name);
      state.set(e.pointerId, TOUCH_BUTTON_BITS[name]);
      paint();
    });
    const end = (e: PointerEvent) => {
      if (buttonFingers.get(e.pointerId) !== name) return;
      buttonFingers.delete(e.pointerId);
      state.release(e.pointerId);
      paint();
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) btn.addEventListener(type, end);
  }

  // No long-press menu or selection on the controls; no pinch on iOS Safari (it ignores user-scalable=no).
  const prevent = (e: Event) => e.preventDefault();
  root.addEventListener("contextmenu", prevent);
  doc.addEventListener("gesturestart", prevent);

  const controls: TouchControls = {
    get visible() {
      return visible;
    },
    get touchDevice() {
      return touchDevice;
    },
    onTouchDevice: null,
    bits: () => (visible ? state.bits() : 0),
    endSample: () => state.endSample(),
    otherInput(bits) {
      if (bits !== 0) controls.hide();
    },
    setPauseShown(shown) {
      const pause = buttons.get("pause")!;
      if (pause.hidden === !shown) return;
      pause.hidden = !shown;
      for (const [id, name] of buttonFingers) {
        if (name !== "pause" || shown) continue;
        buttonFingers.delete(id);
        state.release(id);
      }
      paint();
    },
    held: () => (visible ? state.held() : 0),
    show() {
      if (visible) return;
      visible = true;
      root.hidden = false;
      if (last) controls.layout(last.width, last.height, last.canvas, last.insets);
    },
    hide() {
      if (!visible) return;
      visible = false;
      root.hidden = true;
      state.reset();
      dpadFingers.clear();
      buttonFingers.clear();
      knob.style.transform = "";
      paint();
    },
    layout(width, height, canvas, insets) {
      last = { width, height, canvas, insets };
      if (!visible) return;
      const l = layoutTouch(width, height, canvas, insets);
      const place = (el: HTMLElement, r: Rect) => {
        el.style.left = `${r.x}px`;
        el.style.top = `${r.y}px`;
        el.style.width = `${r.w}px`;
        el.style.height = `${r.h}px`;
      };
      place(dpad, l.dpad);
      for (const [name, btn] of buttons) {
        place(btn, l[name]);
        btn.style.fontSize = `${Math.round(l[name].h)}px`;
      }
    },
    dispose() {
      win.removeEventListener("pointerdown", onAnyPointer, true);
      root.removeEventListener("contextmenu", prevent);
      doc.removeEventListener("gesturestart", prevent);
    },
  };

  // The first touch anywhere shows the controls (and makes this a touch device).
  const onAnyPointer = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    if (!touchDevice) {
      touchDevice = true;
      controls.onTouchDevice?.();
    }
    controls.show();
  };
  win.addEventListener("pointerdown", onAnyPointer, true);

  root.hidden = true;
  controls.setPauseShown(false); // until a fight starts
  if (coarse) controls.show();
  return controls;
}
