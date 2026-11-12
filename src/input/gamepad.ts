// Gamepad API to bitmask, and joining (spec 005, R4). The mapping is a pure
// function over a minimal gamepad shape, so tests can feed it fake pads.
// A pad drives no one until a button on it is pressed: then it goes to the
// first player without a pad (P1, then P2). Unplugging it frees the slot.
import { BUTTON_BITS, BUTTON_DOWN, BUTTON_LEFT, BUTTON_NAMES, BUTTON_RIGHT, BUTTON_UP } from "./bits";
import { GAMEPAD_BINDINGS, type GamepadBindings } from "./keymap";

/** The parts of the Gamepad interface the mapping reads. */
export interface GamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly buttons: readonly { readonly pressed: boolean; readonly value?: number }[];
  readonly axes: readonly number[];
}

export function gamepadToBits(
  pad: GamepadLike | null | undefined,
  bindings: GamepadBindings = GAMEPAD_BINDINGS,
): number {
  if (!pad || !pad.connected) return 0;
  let bits = 0;
  for (const name of BUTTON_NAMES) {
    for (const index of bindings.buttons[name]) {
      if (pad.buttons[index]?.pressed) {
        bits |= BUTTON_BITS[name];
        break;
      }
    }
  }
  const x = pad.axes[bindings.axisX] ?? 0;
  const y = pad.axes[bindings.axisY] ?? 0;
  if (x <= -bindings.deadzone) bits |= BUTTON_LEFT;
  if (x >= bindings.deadzone) bits |= BUTTON_RIGHT;
  // Standard mapping: negative y is up.
  if (y <= -bindings.deadzone) bits |= BUTTON_UP;
  if (y >= bindings.deadzone) bits |= BUTTON_DOWN;
  return bits;
}

/** Connected pads in index order. */
export function connectedPads(pads: readonly (GamepadLike | null | undefined)[]): GamepadLike[] {
  return pads
    .filter((p): p is GamepadLike => p !== null && p !== undefined && p.connected)
    .sort((a, b) => a.index - b.index);
}

export function anyButtonPressed(pad: GamepadLike): boolean {
  return pad.buttons.some((b) => b.pressed);
}

export interface PadEvent {
  type: "join" | "leave";
  player: 0 | 1;
  /** Gamepad index. */
  pad: number;
}

/**
 * Which pad drives which player. update() runs once per sample with the
 * browser's pad list; bits() reads the assigned pads. The press that joins a
 * pad is held back until released, so joining never also confirms or attacks.
 */
export class PadSlots {
  readonly slots: [number | null, number | null] = [null, null];
  private readonly suppress: [number, number] = [0, 0];
  private pads = new Map<number, GamepadLike>();

  update(list: readonly (GamepadLike | null | undefined)[]): PadEvent[] {
    const events: PadEvent[] = [];
    const connected = connectedPads(list);
    this.pads = new Map(connected.map((p) => [p.index, p]));
    for (const player of [0, 1] as const) {
      const index = this.slots[player];
      if (index !== null && !this.pads.has(index)) {
        this.slots[player] = null;
        this.suppress[player] = 0;
        events.push({ type: "leave", player, pad: index });
      }
    }
    for (const pad of connected) {
      if (this.slots.includes(pad.index) || !anyButtonPressed(pad)) continue;
      const player = this.slots[0] === null ? 0 : this.slots[1] === null ? 1 : -1;
      if (player === -1) break;
      this.slots[player] = pad.index;
      this.suppress[player] = gamepadToBits(pad);
      events.push({ type: "join", player, pad: pad.index });
    }
    return events;
  }

  /** Bitmasks for P1 and P2 from their assigned pads (0 without one). */
  bits(): [number, number] {
    const out: [number, number] = [0, 0];
    for (const player of [0, 1] as const) {
      const index = this.slots[player];
      if (index === null) continue;
      const bits = gamepadToBits(this.pads.get(index));
      this.suppress[player] &= bits;
      out[player] = bits & ~this.suppress[player];
    }
    return out;
  }

  /** Whether a player has a pad. */
  has(player: 0 | 1): boolean {
    return this.slots[player] !== null;
  }
}

export interface GamepadSource {
  /** Polls the pads (joins and leaves happen here) and returns P1's and P2's bitmasks. */
  read(): [number, number];
  /** Whether a player has a pad assigned. */
  has(player: 0 | 1): boolean;
}

export function createGamepads(
  nav: Navigator | undefined = globalThis.navigator,
  onEvent: (e: PadEvent) => void = () => {},
): GamepadSource {
  const slots = new PadSlots();
  return {
    read() {
      if (!nav || typeof nav.getGamepads !== "function") return [0, 0];
      let list: readonly (GamepadLike | null)[] = [];
      try {
        list = nav.getGamepads();
      } catch {
        list = [];
      }
      for (const e of slots.update(list)) onEvent(e);
      return slots.bits();
    },
    has: (player) => slots.has(player),
  };
}
