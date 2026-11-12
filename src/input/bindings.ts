// Rebindable keyboard controls (spec 005, R3). Each player's action holds one
// key; binding a key that is already in use swaps the two actions' keys, so no
// key ever drives two actions. Bindings persist in localStorage under
// CONTROLS_STORAGE_KEY; every read and write is guarded, so the game works
// without storage (private windows, blocked site data).
import { BUTTON_NAMES, type ButtonName } from "./bits";
import { KEYBOARD_BINDINGS, type KeyBindings } from "./keymap";

export const CONTROLS_STORAGE_KEY = "datamon.controls.v1";

/** Actions shown on the controls screen, in order. */
export const BINDABLE_ACTIONS: readonly ButtonName[] = BUTTON_NAMES;

export const ACTION_LABELS: Readonly<Record<ButtonName, string>> = Object.freeze({
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
  punch: "PUNCH",
  kick: "KICK",
  special: "SPECIAL",
  start: "START",
});

/** The parts of the Web Storage interface the bindings use. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** window.localStorage, or null when it is missing or access throws. */
export function safeLocalStorage(win: { readonly localStorage?: Storage } | undefined = globalThis as { localStorage?: Storage }): StorageLike | null {
  try {
    return win?.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Keys a player may bind. Escape (pause, cancel), Tab, function keys and the
 * Control, Alt and Meta modifiers are left out: combined with game keys they
 * reach browser shortcuts (Ctrl+W, Alt+Left).
 */
export function isBindableKey(code: string): boolean {
  return /^(Key[A-Z]|Digit\d|Numpad\w+|Arrow(Up|Down|Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|IntlBackslash|BracketLeft|BracketRight|Minus|Equal|Backquote|Space|Enter|Backspace|ShiftLeft|ShiftRight)$/.test(code);
}

export interface BindingSlot {
  player: 0 | 1;
  action: ButtonName;
}

export type RebindResult =
  | { ok: true; swapped: BindingSlot | null }
  | { ok: false; reason: "reserved" };

type MutableBindings = Record<ButtonName, string[]>;

function copy(b: KeyBindings): MutableBindings {
  const out = {} as MutableBindings;
  for (const a of BUTTON_NAMES) out[a] = [...b[a]];
  return out;
}

function defaults(): [MutableBindings, MutableBindings] {
  return [copy(KEYBOARD_BINDINGS[0]), copy(KEYBOARD_BINDINGS[1])];
}

/** Parses stored bindings; null unless every action of both players has valid, unique keys. */
export function parseStoredBindings(raw: string | null): [MutableBindings, MutableBindings] | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const players = (data as { players?: unknown }).players;
  if (!Array.isArray(players) || players.length !== 2) return null;
  const seen = new Set<string>();
  const out: MutableBindings[] = [];
  for (const p of players) {
    if (typeof p !== "object" || p === null) return null;
    const b = {} as MutableBindings;
    for (const a of BUTTON_NAMES) {
      const keys = (p as Record<string, unknown>)[a];
      if (!Array.isArray(keys) || keys.length === 0) return null;
      for (const k of keys) {
        if (typeof k !== "string" || !isBindableKey(k) || seen.has(k)) return null;
        seen.add(k);
      }
      b[a] = [...(keys as string[])];
    }
    out.push(b);
  }
  return [out[0]!, out[1]!];
}

export class ControlBindings {
  private players: [MutableBindings, MutableBindings];
  /** Bumped on every change, so readers can cache derived data. */
  version = 0;

  constructor(private readonly storage: StorageLike | null = safeLocalStorage()) {
    let raw: string | null = null;
    try {
      raw = storage?.getItem(CONTROLS_STORAGE_KEY) ?? null;
    } catch {
      raw = null;
    }
    this.players = parseStoredBindings(raw) ?? defaults();
  }

  /** Both players' bindings, in the shape the keyboard source reads. */
  get current(): readonly [KeyBindings, KeyBindings] {
    return this.players;
  }

  /** The key bound to an action (its first key), or undefined. */
  keyFor(player: 0 | 1, action: ButtonName): string | undefined {
    return this.players[player][action][0];
  }

  /** Which player's action a key drives, or null. */
  owner(code: string): BindingSlot | null {
    for (const player of [0, 1] as const) {
      for (const action of BUTTON_NAMES) if (this.players[player][action].includes(code)) return { player, action };
    }
    return null;
  }

  /**
   * Binds `code` to one player's action. If another action (of either player)
   * already uses the key, that action takes this action's old key instead.
   */
  rebind(player: 0 | 1, action: ButtonName, code: string): RebindResult {
    if (!isBindableKey(code)) return { ok: false, reason: "reserved" };
    const old = this.players[player][action];
    const holder = this.owner(code);
    if (holder && holder.player === player && holder.action === action) return { ok: true, swapped: null };
    if (holder) {
      const list = this.players[holder.player][holder.action];
      const replaced = list.flatMap((k) => (k === code ? (old[0] !== undefined ? [old[0]] : []) : [k]));
      this.players[holder.player][holder.action] = replaced;
    }
    this.players[player][action] = [code];
    this.changed();
    return { ok: true, swapped: holder };
  }

  restoreDefaults(): void {
    this.players = defaults();
    this.changed();
  }

  private changed(): void {
    this.version += 1;
    try {
      this.storage?.setItem(CONTROLS_STORAGE_KEY, JSON.stringify({ version: 1, players: this.players }));
    } catch {
      // Storage full or blocked: the bindings still apply for this session.
    }
  }
}
