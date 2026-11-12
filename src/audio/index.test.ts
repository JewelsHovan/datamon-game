import { describe, expect, it } from "vitest";
import type { SimEvent } from "../sim/types";
import { BASE_LEVELS } from "./engine";
import { bindAudioControls, createAudio, DEFAULT_SETTINGS, STORAGE_KEY, type AudioOptions, type GameAudio } from "./index";
import { routeEvent } from "./sfx";
import {
  FakeAudioContext,
  FakeGain,
  FakeOscillator,
  FakeSource,
  FakeTimers,
  MemoryStorage,
} from "./testing/fakeAudioContext";

/** One sample of every SimEvent type. */
const ALL_EVENTS: readonly SimEvent[] = [
  { type: "jump", player: 0, dir: 1 },
  { type: "land", player: 0 },
  { type: "attack", player: 0, move: "light_punch" },
  { type: "hit", player: 0, target: 1, move: "light_punch", strength: "light", x: 0, y: 0, damage: 40, combo: 1 },
  { type: "block", player: 0, target: 1, move: "heavy_punch", strength: "heavy", x: 0, y: 0 },
  { type: "trade", x: 0, y: 0 },
  { type: "throw", player: 0, target: 1 },
  { type: "tech", x: 0, y: 0 },
  { type: "knockdown", player: 1, x: 0, y: 0 },
  { type: "projectile", player: 0, x: 0, y: 0 },
  { type: "clash", x: 0, y: 0 },
  { type: "ko", player: 1, x: 0, y: 0 },
  { type: "round_start", round: 1 },
  { type: "fight" },
  { type: "round_end", winner: 0, reason: "ko" },
  { type: "match_end", winner: 0 },
];

function setup(options: Partial<AudioOptions> = {}) {
  const ctx = new FakeAudioContext();
  const timers = new FakeTimers();
  const storage = new MemoryStorage();
  const audio = createAudio({ createContext: () => ctx, timers, storage, ...options });
  audio.resume();
  const { engine } = audio.internals();
  if (!engine) throw new Error("engine not created");
  return { ctx, timers, storage, audio, engine };
}

const startedSince = (ctx: FakeAudioContext, from: number): FakeSource[] => ctx.started.slice(from);

describe("audio facade: events to voices (A1)", () => {
  it("every SimEvent type schedules at least one voice on the effects bus", () => {
    const { ctx, audio, engine } = setup();
    const sfxBus = engine.sfxBus as unknown as FakeGain;
    const musicBus = engine.musicBus as unknown as FakeGain;
    for (const ev of ALL_EVENTS) {
      const before = ctx.started.length;
      audio.onEvents([ev]);
      const voices = startedSince(ctx, before);
      expect(voices.length, `${ev.type} started no voice`).toBeGreaterThan(0);
      for (const v of voices) {
        expect(v.reaches(sfxBus), `${ev.type} voice not on the sfx bus`).toBe(true);
        expect(v.reaches(musicBus), `${ev.type} voice leaked onto the music bus`).toBe(false);
        expect(v.startTime!).toBeGreaterThanOrEqual(ctx.currentTime);
        expect(v.stopTime!).toBeGreaterThan(v.startTime!);
      }
      ctx.advance(3);
    }
  });

  it("light and heavy hits differ in pitch and length", () => {
    const { ctx, audio } = setup();
    const play = (strength: "light" | "heavy") => {
      const before = ctx.started.length;
      audio.onEvents([{ type: "hit", player: 0, target: 1, move: strength === "light" ? "light_punch" : "heavy_punch", strength, x: 0, y: 0, damage: 1, combo: 1 }]);
      const voices = startedSince(ctx, before);
      const oscs = voices.filter((v): v is FakeOscillator => v instanceof FakeOscillator);
      const lowest = Math.min(...oscs.map((o) => o.startFrequency));
      const length = Math.max(...voices.map((v) => v.stopTime! - v.startTime!));
      ctx.advance(2);
      return { lowest, length };
    };
    const light = play("light");
    const heavy = play("heavy");
    expect(heavy.lowest).toBeLessThan(light.lowest * 0.8);
    expect(heavy.length).toBeGreaterThan(light.length * 1.5);
  });

  it("special hits add a zap layer the heavy hit does not have", () => {
    const { ctx, audio } = setup();
    const waves = (strength: "heavy" | "special") => {
      const before = ctx.started.length;
      audio.onEvents([{ type: "hit", player: 0, target: 1, move: strength === "special" ? "special" : "heavy_kick", strength, x: 0, y: 0, damage: 1, combo: 1 }]);
      ctx.advance(2);
      return startedSince(ctx, before).filter((v): v is FakeOscillator => v instanceof FakeOscillator).map((o) => o.type);
    };
    expect(waves("heavy")).not.toContain("sawtooth");
    expect(waves("special")).toContain("sawtooth");
  });

  it("stinger-only events route as specified and schedule their stingers ahead", () => {
    expect(routeEvent({ type: "round_end", winner: 1, reason: "ko" })).toMatchObject({ sfx: null, stingers: [{ name: "round_win", delay: 1.6 }] });
    expect(routeEvent({ type: "round_end", winner: 0, reason: "time" })).toMatchObject({
      sfx: null,
      stingers: [{ name: "time_up", delay: 0 }, { name: "round_win" }],
    });
    expect(routeEvent({ type: "round_end", winner: 2, reason: "time" }).stingers.map((s) => s.name)).toEqual(["time_up", "draw"]);
    expect(routeEvent({ type: "round_end", winner: -1, reason: "ko" })).toMatchObject({ sfx: null, stingers: [] });
    expect(routeEvent({ type: "round_start", round: 2 })).toMatchObject({ sfx: null, stingers: [{ name: "round", arg: 2 }] });
    expect(routeEvent({ type: "fight" })).toMatchObject({ sfx: null, stingers: [{ name: "fight" }] });
    expect(routeEvent({ type: "match_end", winner: 1 })).toMatchObject({ sfx: null, stingers: [{ name: "match_win" }] });
    expect(routeEvent({ type: "ko", player: 0, x: 0, y: 0 })).toMatchObject({ sfx: "ko", stingers: [{ name: "ko" }] });

    const { ctx, audio } = setup();
    ctx.advance(1);
    const before = ctx.started.length;
    audio.onEvents([{ type: "round_end", winner: 1, reason: "ko" }]);
    const voices = startedSince(ctx, before);
    expect(voices.length).toBeGreaterThan(0);
    expect(Math.min(...voices.map((v) => v.startTime!))).toBeCloseTo(ctx.currentTime + 1.6, 6);
  });

  it("round_start plays one blip per round number", () => {
    const { ctx, audio } = setup();
    const count = (round: number) => {
      const before = ctx.started.length;
      audio.onEvents([{ type: "round_start", round }]);
      ctx.advance(2);
      return ctx.started.length - before;
    };
    const r1 = count(1);
    expect(count(3)).toBe(r1 + 2);
  });

  it("onEvents on a muted engine schedules nothing", () => {
    const { ctx, audio } = setup();
    audio.setMuted(true);
    const before = ctx.started.length;
    audio.onEvents(ALL_EVENTS);
    audio.ui("confirm");
    for (let t = 600; t > 0; t -= 60) audio.onEvents([], { phase: "fight", timer: t, training: false });
    expect(ctx.started.length).toBe(before);
  });

  it("nothing is scheduled before the context runs", () => {
    const ctx = new FakeAudioContext();
    const audio = createAudio({ createContext: () => ctx, timers: new FakeTimers(), storage: null });
    audio.onEvents(ALL_EVENTS);
    expect(audio.status).toBe("idle");
    expect(ctx.started.length).toBe(0);
  });

  it("the finishing hit stays quiet under the K.O. and the music ducks", () => {
    const { ctx, audio, engine } = setup();
    const hit: SimEvent = { type: "hit", player: 0, target: 1, move: "heavy_kick", strength: "heavy", x: 0, y: 0, damage: 1, combo: 1 };
    const ko: SimEvent = { type: "ko", player: 1, x: 0, y: 0 };
    let before = ctx.started.length;
    audio.onEvents([ko]);
    const koOnly = ctx.started.length - before;
    ctx.advance(4);
    before = ctx.started.length;
    audio.onEvents([hit, ko]);
    expect(ctx.started.length - before).toBe(koOnly);
    const duck = (engine.duckGain as unknown as FakeGain).gain;
    expect(Math.min(...duck.targets())).toBeLessThanOrEqual(0.2);
    expect(duck.final()).toBe(1);
  });

  it("ticks the timer once per second in the last 10 seconds, sharper in the last 3", () => {
    const { ctx, audio } = setup();
    const ticks: { second: number; voices: FakeSource[] }[] = [];
    for (let timer = 12 * 60; timer >= 1; timer--) {
      const before = ctx.started.length;
      audio.onEvents([], { phase: "fight", timer, training: false });
      if (ctx.started.length > before) ticks.push({ second: Math.ceil(timer / 60), voices: startedSince(ctx, before) });
      ctx.advance(1 / 60);
    }
    expect(ticks.map((t) => t.second)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const freq = (t: (typeof ticks)[number]) =>
      Math.max(...t.voices.filter((v): v is FakeOscillator => v instanceof FakeOscillator).map((o) => o.startFrequency));
    expect(freq(ticks[9]!)).toBeGreaterThan(freq(ticks[0]!));

    const before = ctx.started.length;
    for (let timer = 600; timer >= 1; timer -= 30) audio.onEvents([], { phase: "fight", timer, training: true });
    for (let timer = 600; timer >= 1; timer -= 30) audio.onEvents([], { phase: "intro", timer, training: false });
    expect(ctx.started.length).toBe(before);
  });

  it("menu sounds play on the effects bus", () => {
    const { ctx, audio, engine } = setup();
    for (const kind of ["move", "confirm", "back"] as const) {
      const before = ctx.started.length;
      audio.ui(kind);
      const voices = startedSince(ctx, before);
      expect(voices.length).toBeGreaterThan(0);
      for (const v of voices) expect(v.reaches(engine.sfxBus as unknown as FakeGain)).toBe(true);
    }
  });
});

describe("audio facade: music", () => {
  it("music() before the context exists starts the loop on resume, on the music bus", () => {
    const ctx = new FakeAudioContext();
    const timers = new FakeTimers();
    const audio = createAudio({ createContext: () => ctx, timers, storage: null });
    audio.music("fight");
    expect(ctx.started.length).toBe(0);
    audio.resume();
    const { engine } = audio.internals();
    for (let i = 0; i < 40; i++) {
      ctx.advance(0.025);
      timers.fire();
    }
    expect(audio.stats().track).toBe("fight");
    const voices = ctx.started;
    expect(voices.length).toBeGreaterThan(0);
    for (const v of voices) {
      expect(v.reaches(engine!.musicBus as unknown as FakeGain)).toBe(true);
      expect(v.reaches(engine!.sfxBus as unknown as FakeGain)).toBe(false);
    }
    expect(audio.stats().late).toBe(0);
  });

  it("switching tracks fades the old one and null stops the scheduler", () => {
    const { ctx, timers, audio } = setup();
    audio.music("select");
    timers.fire();
    audio.music("fight");
    expect(audio.stats().track).toBe("fight");
    audio.music(null);
    expect(audio.stats().track).toBe(null);
    expect(timers.intervals.size).toBe(0);
    const before = ctx.started.length;
    ctx.advance(1);
    timers.fire();
    expect(ctx.started.length).toBe(before);
  });

  it("mute keeps the loop position but starts no music voices", () => {
    const { ctx, timers, audio } = setup();
    audio.music("fight");
    audio.setMuted(true);
    const before = ctx.started.length;
    const steps = audio.stats().musicSteps;
    for (let i = 0; i < 40; i++) {
      ctx.advance(0.025);
      timers.fire();
    }
    expect(ctx.started.length).toBe(before);
    expect(audio.stats().musicSteps).toBeGreaterThan(steps);
  });
});

describe("audio facade: controls and failure (A3)", () => {
  it("mute toggles both buses and unmute restores the volumes", () => {
    const { audio, engine } = setup();
    const music = (engine.musicBus as unknown as FakeGain).gain;
    const sfx = (engine.sfxBus as unknown as FakeGain).gain;
    expect(music.final()).toBeCloseTo(DEFAULT_SETTINGS.music * BASE_LEVELS.music);
    expect(sfx.final()).toBeCloseTo(DEFAULT_SETTINGS.sfx * BASE_LEVELS.sfx);
    expect(audio.toggleMute()).toBe(true);
    expect(music.final()).toBe(0);
    expect(sfx.final()).toBe(0);
    expect(audio.toggleMute()).toBe(false);
    expect(music.final()).toBeCloseTo(DEFAULT_SETTINGS.music * BASE_LEVELS.music);
    expect(sfx.final()).toBeCloseTo(DEFAULT_SETTINGS.sfx * BASE_LEVELS.sfx);
  });

  it("volumes and mute persist through storage", () => {
    const storage = new MemoryStorage();
    const first = setup({ storage });
    first.audio.setVolume("master", 0.5);
    first.audio.setVolume("music", 0.3);
    first.audio.setVolume("sfx", 2); // clamped
    first.audio.setMuted(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual({ master: 0.5, music: 0.3, sfx: 1, muted: true });

    const second = setup({ storage });
    expect(second.audio.getVolume("master")).toBe(0.5);
    expect(second.audio.getVolume("music")).toBe(0.3);
    expect(second.audio.getVolume("sfx")).toBe(1);
    expect(second.audio.muted).toBe(true);
    expect((second.engine.master as unknown as FakeGain).gain.final()).toBeCloseTo(0.5 * BASE_LEVELS.master);
    second.audio.setMuted(false);
    expect((second.engine.musicBus as unknown as FakeGain).gain.final()).toBeCloseTo(0.3 * BASE_LEVELS.music);
  });

  it("bad or blocked storage falls back to defaults without throwing", () => {
    const garbage = new MemoryStorage();
    garbage.setItem(STORAGE_KEY, "{not json");
    expect(setup({ storage: garbage }).audio.getVolume("music")).toBe(DEFAULT_SETTINGS.music);
    const wrongTypes = new MemoryStorage();
    wrongTypes.setItem(STORAGE_KEY, JSON.stringify({ master: "loud", music: -3, muted: "yes" }));
    const a = setup({ storage: wrongTypes }).audio;
    expect(a.getVolume("master")).toBe(DEFAULT_SETTINGS.master);
    expect(a.getVolume("music")).toBe(0);
    expect(a.muted).toBe(false);
    const blocked = {
      getItem(): string | null {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };
    const b = setup({ storage: blocked }).audio;
    expect(() => b.setVolume("sfx", 0.2)).not.toThrow();
    expect(b.getVolume("sfx")).toBe(0.2);
  });

  it("a throwing AudioContext constructor leaves a silent engine that never throws", () => {
    let calls = 0;
    const audio = createAudio({
      createContext: () => {
        calls++;
        throw new Error("NotAllowedError");
      },
      timers: new FakeTimers(),
      storage: new MemoryStorage(),
    });
    const everything = (a: GameAudio) => {
      a.resume();
      a.music("fight");
      a.onEvents(ALL_EVENTS, { phase: "fight", timer: 300, training: false });
      a.ui("move");
      a.setMuted(true);
      a.toggleMute();
      a.setVolume("music", 0.4);
      a.setHidden(true);
      a.setHidden(false);
      a.stats();
      a.music(null);
      a.resume();
    };
    expect(() => everything(audio)).not.toThrow();
    expect(audio.status).toBe("failed");
    expect(calls).toBe(1);
    expect(audio.stats()).toMatchObject({ status: "failed", started: 0, track: null });
    expect(() => audio.dispose()).not.toThrow();
    expect(() => everything(audio)).not.toThrow();
  });

  it("a context whose nodes throw mid-game never throws into the game", () => {
    const ctx = new FakeAudioContext();
    const audio = createAudio({ createContext: () => ctx, timers: new FakeTimers(), storage: null });
    audio.resume();
    ctx.createOscillator = () => {
      throw new Error("InvalidStateError");
    };
    expect(() => audio.onEvents(ALL_EVENTS)).not.toThrow();
    expect(() => audio.ui("back")).not.toThrow();
  });

  it("with no WebAudio at all (node), createAudio and every call are safe", () => {
    const audio = createAudio({ storage: null, timers: new FakeTimers() });
    expect(audio.status).toBe("idle");
    audio.resume();
    expect(audio.status).toBe("failed");
    expect(() => audio.onEvents(ALL_EVENTS)).not.toThrow();
  });

  it("setHidden suspends a running context and resumes it when shown", () => {
    const { ctx, audio } = setup();
    expect(audio.status).toBe("running");
    audio.setHidden(true);
    expect(ctx.state).toBe("suspended");
    audio.setHidden(false);
    expect(ctx.state).toBe("running");
  });

  it("dispose stops the music and closes the context", () => {
    const { ctx, timers, audio } = setup();
    audio.music("fight");
    audio.dispose();
    expect(timers.intervals.size).toBe(0);
    expect(ctx.state).toBe("closed");
    expect(audio.status).toBe("disposed");
    const before = ctx.started.length;
    audio.onEvents(ALL_EVENTS);
    expect(ctx.started.length).toBe(before);
  });
});

describe("bindAudioControls", () => {
  class FakeTarget {
    listeners = new Map<string, ((e: Event) => void)[]>();
    addEventListener(type: string, fn: (e: Event) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    removeEventListener(type: string, fn: (e: Event) => void) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
    }
    emit(type: string, event: Partial<KeyboardEvent> = {}) {
      for (const fn of this.listeners.get(type) ?? []) fn(event as Event);
    }
  }

  it("the first input resumes, M toggles mute, modifiers and repeats are ignored", () => {
    const ctx = new FakeAudioContext();
    const audio = createAudio({ createContext: () => ctx, timers: new FakeTimers(), storage: null });
    const target = new FakeTarget();
    const unbind = bindAudioControls(target, audio, { visibility: null });
    expect(audio.status).toBe("idle");
    target.emit("pointerdown");
    expect(audio.status).toBe("running");
    target.emit("keydown", { code: "KeyM" });
    expect(audio.muted).toBe(true);
    target.emit("keydown", { code: "KeyM", repeat: true });
    target.emit("keydown", { code: "KeyM", metaKey: true });
    target.emit("keydown", { code: "KeyF" });
    expect(audio.muted).toBe(true);
    target.emit("keydown", { code: "KeyM" });
    expect(audio.muted).toBe(false);
    unbind();
    target.emit("keydown", { code: "KeyM" });
    expect(audio.muted).toBe(false);
  });

  it("ignoreKey lets a rebinding screen keep M, and visibility suspends", () => {
    const ctx = new FakeAudioContext();
    const audio = createAudio({ createContext: () => ctx, timers: new FakeTimers(), storage: null });
    const target = new FakeTarget();
    const doc = Object.assign(new FakeTarget(), { hidden: false });
    let capturing = true;
    bindAudioControls(target, audio, { ignoreKey: () => capturing, visibility: doc });
    target.emit("keydown", { code: "KeyM" });
    expect(audio.status).toBe("running");
    expect(audio.muted).toBe(false);
    capturing = false;
    target.emit("keydown", { code: "KeyM" });
    expect(audio.muted).toBe(true);
    doc.hidden = true;
    doc.emit("visibilitychange");
    expect(ctx.state).toBe("suspended");
    doc.hidden = false;
    doc.emit("visibilitychange");
    expect(ctx.state).toBe("running");
  });
});
