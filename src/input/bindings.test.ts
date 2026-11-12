// Spec 005 A3 (unit part): rebinding with swap, persistence through a fake
// storage, restore defaults, and storage that fails. Also R2's preventDefault.
import { describe, expect, it } from "vitest";
import { BUTTON_KICK, BUTTON_PUNCH } from "./bits";
import { CONTROLS_STORAGE_KEY, ControlBindings, isBindableKey, parseStoredBindings, type StorageLike } from "./bindings";
import { legendLines } from "../render/hud";
import { KEYBOARD_BINDINGS, keyLabel } from "./keymap";
import { createKeyboard, shouldPreventDefault, type KeyTarget } from "./keyboard";

class FakeStorage implements StorageLike {
  readonly data = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.data.set(key, value);
  }
}

const throwing: StorageLike = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

describe("control bindings (R3)", () => {
  it("start from the design-doc defaults", () => {
    const b = new ControlBindings(new FakeStorage());
    expect(b.current).toEqual(KEYBOARD_BINDINGS);
    expect(b.keyFor(0, "punch")).toBe("KeyF");
    expect(b.keyFor(1, "special")).toBe("Quote");
  });

  it("rebinding to a free key just moves the action", () => {
    const b = new ControlBindings(new FakeStorage());
    expect(b.rebind(0, "punch", "KeyJ")).toEqual({ ok: true, swapped: null });
    expect(b.keyFor(0, "punch")).toBe("KeyJ");
    expect(b.owner("KeyF")).toBeNull();
  });

  it("rebinding P1 Punch to a key P2 uses swaps the two (A3)", () => {
    const b = new ControlBindings(new FakeStorage());
    const r = b.rebind(0, "punch", "KeyL");
    expect(r).toEqual({ ok: true, swapped: { player: 1, action: "punch" } });
    expect(b.keyFor(0, "punch")).toBe("KeyL");
    expect(b.keyFor(1, "punch")).toBe("KeyF");
    expect(b.owner("KeyL")).toEqual({ player: 0, action: "punch" });
    expect(b.owner("KeyF")).toEqual({ player: 1, action: "punch" });
  });

  it("rebinding to a key the same player uses swaps within that player", () => {
    const b = new ControlBindings(new FakeStorage());
    b.rebind(0, "punch", "KeyG");
    expect(b.keyFor(0, "punch")).toBe("KeyG");
    expect(b.keyFor(0, "kick")).toBe("KeyF");
  });

  it("rebinding an action to its own key changes nothing", () => {
    const store = new FakeStorage();
    const b = new ControlBindings(store);
    expect(b.rebind(0, "punch", "KeyF")).toEqual({ ok: true, swapped: null });
    expect(store.writes).toBe(0);
  });

  it("refuses reserved keys (Escape, Tab, function keys, Ctrl, Alt, Meta)", () => {
    const b = new ControlBindings(new FakeStorage());
    for (const code of ["Escape", "Tab", "F1", "F5", "ControlLeft", "AltLeft", "MetaLeft"]) {
      expect(b.rebind(0, "punch", code)).toEqual({ ok: false, reason: "reserved" });
      expect(isBindableKey(code)).toBe(false);
    }
    expect(b.keyFor(0, "punch")).toBe("KeyF");
    for (const code of ["KeyQ", "Digit4", "Semicolon", "Quote", "Slash", "ShiftLeft", "Numpad5", "ArrowUp", "Space"]) {
      expect(isBindableKey(code)).toBe(true);
    }
  });

  it("persist through storage: a new instance (a reload) reads them back (A3)", () => {
    const store = new FakeStorage();
    const a = new ControlBindings(store);
    a.rebind(0, "punch", "KeyL");
    a.rebind(1, "special", "Slash");
    expect(store.data.has(CONTROLS_STORAGE_KEY)).toBe(true);
    const reloaded = new ControlBindings(store);
    expect(reloaded.keyFor(0, "punch")).toBe("KeyL");
    expect(reloaded.keyFor(1, "punch")).toBe("KeyF");
    expect(reloaded.keyFor(1, "special")).toBe("Slash");
    expect(reloaded.current).toEqual(a.current);
  });

  it("restore defaults resets and saves (A3)", () => {
    const store = new FakeStorage();
    const a = new ControlBindings(store);
    a.rebind(0, "punch", "KeyL");
    a.restoreDefaults();
    expect(a.current).toEqual(KEYBOARD_BINDINGS);
    expect(new ControlBindings(store).current).toEqual(KEYBOARD_BINDINGS);
  });

  it("work without storage, and with storage that throws on every call", () => {
    for (const storage of [null, throwing]) {
      const b = new ControlBindings(storage);
      expect(b.current).toEqual(KEYBOARD_BINDINGS);
      expect(b.rebind(0, "kick", "KeyK").ok).toBe(true);
      expect(b.keyFor(0, "kick")).toBe("KeyK");
    }
  });

  it("ignore corrupt or conflicting saved data", () => {
    expect(parseStoredBindings("not json")).toBeNull();
    expect(parseStoredBindings(JSON.stringify({ players: [] }))).toBeNull();
    const dup = JSON.parse(JSON.stringify({ players: KEYBOARD_BINDINGS })) as { players: Record<string, string[]>[] };
    dup.players[1]!.punch = ["KeyF"]; // same key as P1 punch
    expect(parseStoredBindings(JSON.stringify(dup))).toBeNull();
    const store = new FakeStorage();
    store.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(dup));
    expect(new ControlBindings(store).current).toEqual(KEYBOARD_BINDINGS);
  });
});

describe("key labels and legends (R7)", () => {
  it("print keys as on the keycap", () => {
    expect(["KeyF", "Semicolon", "Quote", "Slash", "Digit3", "ArrowUp", "Enter", "Numpad4"].map(keyLabel)).toEqual([
      "F", ";", "'", "/", "3", "UP", "ENTER", "NUM 4",
    ]);
  });

  it("legends follow each player's actual bindings, or the pad", () => {
    const b = new ControlBindings(null);
    expect(legendLines(b.current[0])).toEqual(["F PUNCH  G KICK  H SPECIAL", "WASD MOVE  F+G THROW"]);
    expect(legendLines(b.current[1])).toEqual(["L PUNCH  ; KICK  ' SPECIAL", "ARROWS MOVE  L+; THROW"]);
    b.rebind(0, "punch", "KeyJ");
    b.rebind(0, "up", "ArrowUp"); // swaps with P2 up
    expect(legendLines(b.current[0])).toEqual(["J PUNCH  G KICK  H SPECIAL", "UP A S D MOVE  J+G THROW"]);
    expect(legendLines(b.current[1], true)).toEqual(["A PUNCH  B KICK  X/Y SPECIAL", "D-PAD MOVE  A+B THROW"]);
  });
});

describe("keyboard source (R2)", () => {
  type Listener = (e: KeyboardEvent) => void;
  function fakeTarget() {
    const listeners = new Map<string, Listener[]>();
    const target: KeyTarget = {
      addEventListener(type, fn) {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      removeEventListener(type, fn) {
        listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== fn));
      },
    };
    const fire = (type: "keydown" | "keyup", code: string, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) => {
      let prevented = false;
      const e = { code, ctrlKey: false, metaKey: false, ...mods, repeat: false, preventDefault: () => (prevented = true) } as unknown as KeyboardEvent;
      for (const l of listeners.get(type) ?? []) l(e);
      return prevented;
    };
    return { target, fire };
  }

  it("stops the browser default for bound keys and for ' and / even when unbound", () => {
    const { target, fire } = fakeTarget();
    createKeyboard(target, KEYBOARD_BINDINGS);
    expect(fire("keydown", "KeyL")).toBe(true);
    expect(fire("keydown", "Semicolon")).toBe(true);
    expect(fire("keydown", "Quote")).toBe(true);
    expect(fire("keydown", "Slash")).toBe(true); // unbound by default, still blocked (quick find)
    expect(fire("keydown", "KeyZ")).toBe(false); // not a game key
    expect(fire("keydown", "KeyF", { metaKey: true })).toBe(false); // Cmd+F stays the browser's
    expect(fire("keydown", "KeyF", { ctrlKey: true })).toBe(false);
  });

  it("reads live bindings: a rebind applies without recreating the keyboard", () => {
    const { target, fire } = fakeTarget();
    const bindings = new ControlBindings(null);
    const kb = createKeyboard(target, bindings);
    bindings.rebind(1, "punch", "KeyM");
    expect(fire("keydown", "KeyM")).toBe(true);
    expect(kb.bits(1)).toBe(BUTTON_PUNCH);
    fire("keyup", "KeyM");
    kb.endSample();
    expect(kb.bits(1)).toBe(0);
    fire("keydown", "Semicolon");
    expect(kb.bits(1)).toBe(BUTTON_KICK);
    expect(kb.held().has("Semicolon")).toBe(true);
  });

  it("latches taps shorter than a sample", () => {
    const { target, fire } = fakeTarget();
    const kb = createKeyboard(target, KEYBOARD_BINDINGS);
    fire("keydown", "KeyF");
    fire("keyup", "KeyF");
    expect(kb.bits(0)).toBe(BUTTON_PUNCH);
    kb.endSample();
    expect(kb.bits(0)).toBe(0);
  });

  it("shouldPreventDefault leaves modifier shortcuts alone", () => {
    expect(shouldPreventDefault({ code: "Quote", ctrlKey: false, metaKey: false }, KEYBOARD_BINDINGS)).toBe(true);
    expect(shouldPreventDefault({ code: "KeyL", ctrlKey: true, metaKey: false }, KEYBOARD_BINDINGS)).toBe(false);
  });
});
