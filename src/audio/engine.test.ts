import { describe, expect, it } from "vitest";
import {
  AudioEngine,
  driveCurve,
  envelope,
  layerEnd,
  pulseCoefficients,
  recipeDuration,
  VOICE_LIMITS,
  type AudioContextLike,
  type Recipe,
} from "./engine";
import { INSTRUMENTS } from "./patterns";
import { melody, routeEvent, SFX, STINGERS, UI_SOUNDS, type SfxName } from "./sfx";
import {
  FakeAudioContext,
  FakeBufferSource,
  FakeCompressor,
  FakeFilter,
  FakeGain,
  FakeOscillator,
  FakeParam,
  FakeShaper,
} from "./testing/fakeAudioContext";

// Compile-time: the browser AudioContext satisfies the structural subset the engine uses.
type RealContextFits = AudioContext extends AudioContextLike ? true : false;
const realContextFits: RealContextFits = true;

const LEVELS = { master: 1, music: 1, sfx: 1 };

describe("engine graph (R1)", () => {
  it("routes both buses through one compressor into the master gain", () => {
    expect(realContextFits).toBe(true);
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine(ctx, LEVELS, false);
    const comp = engine.compressor as unknown as FakeCompressor;
    expect(comp.kind).toBe("compressor");
    expect((engine.sfxBus as unknown as FakeGain).outputs).toEqual([comp]);
    expect((engine.musicBus as unknown as FakeGain).outputs).toEqual([engine.duckGain]);
    expect((engine.duckGain as unknown as FakeGain).outputs).toEqual([comp]);
    expect(comp.outputs).toEqual([engine.master]);
    expect((engine.master as unknown as FakeGain).outputs).toEqual([ctx.destination]);
    expect(comp.threshold.value).toBeLessThan(0);
    expect(comp.ratio.value).toBeGreaterThan(1);
  });

  it("builds a tone voice: wave, sweep, drive, filter, envelope, start and stop", () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine(ctx, LEVELS, false);
    ctx.advance(1);
    engine.voice(
      { kind: "tone", wave: "square", freq: 200, sweep: { to: 50, time: 0.2 }, drive: 4, filter: { type: "lowpass", freq: 1500, to: 400, time: 0.2 }, env: { a: 0.001, d: 0.2, s: 0, r: 0.02 }, gain: 0.3, delay: 0.1 },
      ctx.currentTime,
      { pitch: 2 },
    );
    const osc = ctx.started[0] as FakeOscillator;
    expect(osc.type).toBe("square");
    expect(osc.startTime).toBeCloseTo(1.1);
    expect(osc.frequency.events[0]).toMatchObject({ kind: "set", value: 400 });
    expect(osc.frequency.events[1]).toMatchObject({ kind: "exp", value: 100 });
    const shaper = osc.outputs[0] as FakeShaper;
    expect(shaper.kind).toBe("shaper");
    expect(shaper.curve).not.toBeNull();
    const filter = shaper.outputs[0] as FakeFilter;
    expect(filter.type).toBe("lowpass");
    const amp = filter.outputs[0] as FakeGain;
    expect(amp.outputs).toEqual([engine.sfxBus]);
    expect(Math.max(...amp.gain.events.map((e) => e.value))).toBeCloseTo(0.3);
    expect(osc.stopTime).toBeCloseTo(1.1 + 0.001 + 0.2 + 0.02 + 0.02);
  });

  it("pulse waves use a periodic wave; noise uses a shared looping buffer", () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine(ctx, LEVELS, false);
    engine.play(
      [
        { kind: "tone", wave: "pulse25", freq: 440, env: { a: 0.001, d: 0.05, s: 0, r: 0.01 }, gain: 0.1 },
        { kind: "tone", wave: "pulse25", freq: 660, env: { a: 0.001, d: 0.05, s: 0, r: 0.01 }, gain: 0.1 },
        { kind: "noise", env: { a: 0.001, d: 0.05, s: 0, r: 0.01 }, gain: 0.1 },
        { kind: "noise", env: { a: 0.001, d: 0.05, s: 0, r: 0.01 }, gain: 0.1 },
      ],
      0,
    );
    const [p1, p2, n1, n2] = ctx.started as [FakeOscillator, FakeOscillator, FakeBufferSource, FakeBufferSource];
    expect(p1.type).toBe("custom");
    expect(p1.periodicWave).toBe(p2.periodicWave);
    expect(n1.buffer).toBe(n2.buffer);
    expect(n1.loop).toBe(true);
    expect(n1.startOffset).toBeGreaterThanOrEqual(0);
  });

  it("caps concurrent voices per bus and frees them once they end", () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine(ctx, LEVELS, false);
    const layer = { kind: "tone" as const, wave: "sine" as const, freq: 300, env: { a: 0.001, d: 0.1, s: 0, r: 0.01 }, gain: 0.1 };
    for (let i = 0; i < VOICE_LIMITS.sfx + 10; i++) engine.voice(layer, 0);
    expect(engine.activeVoices("sfx")).toBe(VOICE_LIMITS.sfx);
    expect(engine.stats.dropped).toBe(10);
    expect(engine.voice(layer, 0, { bus: "music" })).toBe(true);
    ctx.advance(1);
    expect(engine.activeVoices("sfx")).toBe(0);
    expect(ctx.nodes.filter((n) => n.kind === "oscillator").every((n) => n.disconnected)).toBe(true);
  });

  it("drops a recipe whole when the bus has no room for all its layers", () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine(ctx, LEVELS, false);
    const layer = { kind: "tone" as const, wave: "sine" as const, freq: 300, env: { a: 0.001, d: 0.1, s: 0, r: 0.01 }, gain: 0.1 };
    for (let i = 0; i < VOICE_LIMITS.sfx - 2; i++) engine.voice(layer, 0);
    expect(engine.play(SFX.hit_heavy, 0)).toBe(0); // 3 layers, 2 free slots
    expect(engine.stats.dropped).toBe(3);
    expect(engine.play(UI_SOUNDS.move, 0)).toBe(1);
  });

  it("overlapping ducks merge: deepest depth, latest end, no jump back up in between", () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine(ctx, LEVELS, false);
    const g = (engine.duckGain as unknown as FakeGain).gain;
    engine.duck(0, 0.15, 2.2, 0.8); // K.O.
    engine.duck(1.6, 0.35, 0.9, 0.5); // round win jingle, same batch
    const targets = g.events.filter((e) => e.kind === "target");
    expect(g.events.some((e) => e.kind === "set" && e.value > 0.5)).toBe(false);
    expect(targets.map((e) => [e.value, Number(e.time.toFixed(2))])).toEqual([
      [0.15, 0],
      [0.15, 1.6],
      [1, 2.5],
    ]);
    engine.duck(5, 0.5, 0.4, 0.4); // a later duck starts fresh
    expect(g.final()).toBe(1);
    expect(g.targets().at(-2)).toBe(0.5);
  });

  it("counts music voices scheduled behind the clock", () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine(ctx, LEVELS, false);
    ctx.advance(1);
    const layer = { kind: "tone" as const, wave: "sine" as const, freq: 300, env: { a: 0.001, d: 0.1, s: 0, r: 0.01 }, gain: 0.1 };
    engine.voice(layer, 0.9, { bus: "music" });
    engine.voice(layer, 1.05, { bus: "music" });
    expect(engine.stats.late).toBe(1);
  });

  it("envelope: attack to peak, decay to sustain, hold, release to silence", () => {
    const p = new FakeParam(0);
    const end = envelope(p, 2, 0.5, { a: 0.01, d: 0.1, s: 0.4, hold: 0.3, r: 0.2 });
    expect(end).toBeCloseTo(2.61);
    const kinds = p.events.map((e) => [e.kind, Number(e.value.toFixed(4)), Number(e.time.toFixed(3))]);
    expect(kinds).toEqual([
      ["set", 0.0001, 2],
      ["linear", 0.5, 2.01],
      ["exp", 0.2, 2.11],
      ["set", 0.2, 2.41],
      ["exp", 0.0001, 2.61],
      ["set", 0, 2.61],
    ]);
  });

  it("pulse coefficients and the drive curve are well formed", () => {
    const { real, imag } = pulseCoefficients(0.25, 8);
    expect(real[0]).toBe(0);
    expect(imag[4]).toBeCloseTo(0); // a 25% pulse has no 4th harmonic
    expect(Math.abs(imag[1]!)).toBeGreaterThan(0.1);
    const curve = driveCurve(4, 101);
    expect(curve[0]).toBeCloseTo(-1);
    expect(curve[50]).toBeCloseTo(0);
    expect(curve[100]).toBeCloseTo(1);
    expect(curve[75]!).toBeGreaterThan(0.5); // soft clip pushes mid values up
  });
});

describe("sound design table (R2, R3)", () => {
  const all: [string, Recipe][] = [
    ...Object.entries(SFX),
    ...Object.entries(STINGERS),
    ...Object.entries(UI_SOUNDS),
    ...Object.entries(INSTRUMENTS).flatMap(([name, inst]) => (inst.kind === "drum" ? [[name, inst.recipe] as [string, Recipe]] : [])),
  ];

  it("every recipe is playable and none is harsh: bounded peaks and lengths", () => {
    for (const [name, recipe] of all) {
      expect(recipe.length, name).toBeGreaterThan(0);
      for (const l of recipe) {
        expect(l.env.a, name).toBeGreaterThan(0);
        expect(l.env.d, name).toBeGreaterThan(0);
        expect(l.gain, name).toBeGreaterThan(0);
        expect(l.gain, name).toBeLessThanOrEqual(0.75);
        if (l.kind === "tone") expect(l.freq, name).toBeGreaterThan(20);
      }
      // Summed peak gain of the layers sounding at once (checked at every layer start).
      let peak = 0;
      for (const at of recipe.map((l) => l.delay ?? 0)) {
        let sum = 0;
        for (const l of recipe) if ((l.delay ?? 0) <= at && at < layerEnd(l)) sum += l.gain;
        peak = Math.max(peak, sum);
      }
      expect(peak, `${name} summed peak`).toBeLessThanOrEqual(2);
      expect(recipeDuration(recipe), name).toBeLessThan(3);
    }
  });

  it("attacks whoosh by strength", () => {
    const w = (move: Parameters<typeof routeEvent>[0] & { type: "attack" }) => routeEvent(move).sfx;
    expect(w({ type: "attack", player: 0, move: "light_punch" })).toBe("whoosh_light");
    expect(w({ type: "attack", player: 0, move: "light_kick" })).toBe("whoosh_light");
    expect(w({ type: "attack", player: 0, move: "air_attack" })).toBe("whoosh_light");
    expect(w({ type: "attack", player: 0, move: "heavy_punch" })).toBe("whoosh_heavy");
    expect(w({ type: "attack", player: 0, move: "crouch_attack" })).toBe("whoosh_heavy");
    expect(w({ type: "attack", player: 0, move: "special" })).toBe("whoosh_special");
    expect(w({ type: "attack", player: 0, move: "throw" })).toBe("whoosh_throw");
  });

  it("hits, blocks and throws pick their recipes; combos climb in pitch", () => {
    const hit = (strength: "light" | "heavy" | "special", move: "light_punch" | "heavy_kick" | "special" | "throw", combo = 1) =>
      routeEvent({ type: "hit", player: 0, target: 1, move, strength, x: 0, y: 0, damage: 1, combo });
    expect(hit("light", "light_punch").sfx).toBe("hit_light");
    expect(hit("heavy", "heavy_kick").sfx).toBe("hit_heavy");
    expect(hit("special", "special").sfx).toBe("hit_special");
    expect(hit("heavy", "throw").sfx).toBe("toss");
    expect(hit("light", "light_punch", 3).pitch).toBeGreaterThan(hit("light", "light_punch", 1).pitch);
    expect(hit("light", "light_punch", 30).pitch).toBeLessThanOrEqual(1.1);
    const block = (strength: "light" | "heavy" | "special") =>
      routeEvent({ type: "block", player: 0, target: 1, move: "light_punch", strength, x: 0, y: 0 }).sfx;
    expect([block("light"), block("heavy"), block("special")]).toEqual(["block_light", "block_heavy", "block_special"]);
    expect(routeEvent({ type: "throw", player: 0, target: 1 }).sfx).toBe("grab");
  });

  it("each effect event has its own recipe", () => {
    const simple: [Parameters<typeof routeEvent>[0], SfxName][] = [
      [{ type: "jump", player: 0, dir: 0 }, "jump"],
      [{ type: "land", player: 0 }, "land"],
      [{ type: "trade", x: 0, y: 0 }, "trade"],
      [{ type: "tech", x: 0, y: 0 }, "tech"],
      [{ type: "knockdown", player: 0, x: 0, y: 0 }, "knockdown"],
      [{ type: "projectile", player: 0, x: 0, y: 0 }, "projectile"],
      [{ type: "clash", x: 0, y: 0 }, "clash"],
    ];
    for (const [ev, name] of simple) expect(routeEvent(ev).sfx).toBe(name);
  });

  it("the K.O. is a long low hit with a falling tone", () => {
    const lows = SFX.ko.filter((l) => l.kind === "tone").map((l) => l.freq);
    expect(Math.min(...lows)).toBeLessThan(100);
    expect(SFX.ko.some((l) => l.kind === "tone" && l.sweep && l.sweep.to < l.freq / 4 && l.sweep.time >= 1)).toBe(true);
    expect(recipeDuration(SFX.ko)).toBeGreaterThan(recipeDuration(SFX.hit_heavy) * 3);
  });

  it("melody() spaces notes by step and turns holds into sustain", () => {
    const layers = melody("pulse25", "a4 - . e5", 0.1, 0.1, { a: 0.01, d: 0.02, s: 0.5, r: 0.05 });
    expect(layers).toHaveLength(2);
    expect(layers[0]!.freq).toBeCloseTo(440);
    expect(layers[0]!.env.hold).toBeCloseTo(0.2 - 0.03);
    expect(layers[1]!.delay).toBeCloseTo(0.3);
  });
});
