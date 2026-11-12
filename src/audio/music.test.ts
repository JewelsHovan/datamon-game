import { describe, expect, it } from "vitest";
import { noteLayers, Sequencer, trackPattern } from "./music";
import {
  chordTone,
  compileSong,
  FIGHT_SONG,
  INSTRUMENTS,
  noteToMidi,
  parseChord,
  SELECT_SONG,
  STEPS_PER_BAR,
  type NoteEvent,
  type Pattern,
} from "./patterns";

/** A test pattern: one kick on every beat (4 per bar), BPM and bars as given. */
function beats(bpm: number, bars: number): Pattern {
  const length = bars * STEPS_PER_BAR;
  const steps: NoteEvent[][] = Array.from({ length }, (_, i) => (i % 4 === 0 ? [{ inst: "kick", midi: 0, len: 1, vel: 1 }] : []));
  return { name: "test", bpm, stepsPerBeat: 4, stepsPerBar: STEPS_PER_BAR, length, steps };
}

function harness(lookahead = 0.1) {
  const clock = { t: 0 };
  const notes: { time: number; scheduledAt: number }[] = [];
  const steps: { step: number; time: number; scheduledAt: number }[] = [];
  const seq = new Sequencer({
    now: () => clock.t,
    lookahead,
    onNote: (_note, time) => notes.push({ time, scheduledAt: clock.t }),
    onStep: (step, time) => steps.push({ step, time, scheduledAt: clock.t }),
  });
  /** Ticks every 25 ms of clock time up to `until`. */
  const run = (until: number) => {
    while (clock.t < until - 1e-9) {
      clock.t = Math.round((clock.t + 0.025) * 1e6) / 1e6;
      seq.tick();
    }
  };
  return { clock, notes, steps, seq, run };
}

describe("sequencer (A2)", () => {
  it("schedules notes at exact beat times for 8 bars at 120 BPM", () => {
    const { clock, notes, seq, run } = harness();
    const start = 0.05;
    seq.start(beats(120, 8), start);
    seq.tick();
    run(16.2); // 8 bars at 120 BPM = 16 s
    const firstLoop = notes.filter((n) => n.time < start + 16 - 1e-9);
    expect(firstLoop).toHaveLength(32);
    firstLoop.forEach((n, k) => {
      expect(n.time).toBeCloseTo(start + k * 0.5, 9);
      expect(n.time).toBeGreaterThanOrEqual(n.scheduledAt);
      expect(n.time - n.scheduledAt).toBeLessThanOrEqual(0.1 + 1e-9);
    });
    // The loop wraps seamlessly: the next downbeat lands exactly 16 s after the first.
    expect(notes[32]!.time).toBeCloseTo(start + 16, 9);
    expect(seq.resyncs).toBe(0);
    expect(clock.t).toBeGreaterThan(16);
  });

  it("is exact at 150 BPM over the full fight loop with a ragged tick rate", () => {
    const { clock, steps, seq } = harness();
    const pattern = beats(150, 8);
    seq.start(pattern, 0.06);
    // Ticks jitter between 5 and 45 ms (timer slop), never late enough to miss the lookahead.
    let k = 0;
    while (clock.t < 13) {
      clock.t += 0.005 + ((k++ * 7) % 9) * 0.005;
      seq.tick();
    }
    const dur = 60 / 150 / 4;
    expect(steps.length).toBeGreaterThanOrEqual(128);
    steps.forEach((s, i) => {
      expect(s.step).toBe(i % pattern.length);
      expect(s.time).toBeCloseTo(0.06 + i * dur, 9);
      expect(s.time).toBeGreaterThanOrEqual(s.scheduledAt);
    });
  });

  it("a late tick (300 ms gap) schedules nothing in the past and skips no step or bar", () => {
    const { clock, steps, seq, run } = harness();
    const pattern = beats(120, 8);
    const dur = 60 / 120 / 4;
    seq.start(pattern, 0.05);
    seq.tick();
    run(3);
    const beforeGap = steps.length;
    clock.t += 0.3; // the page stalled: no tick for 300 ms
    seq.tick();
    run(20);

    for (const s of steps) expect(s.time).toBeGreaterThanOrEqual(s.scheduledAt);
    // Every pattern step appears in order, across the gap and the loop point.
    steps.forEach((s, i) => expect(s.step).toBe(i % pattern.length));
    expect(seq.resyncs).toBe(1);
    // Before the gap the grid is exact; after it the grid is exact again from the resync point.
    const resyncAt = steps[beforeGap]!;
    expect(resyncAt.time).toBeGreaterThanOrEqual(3.3);
    expect(resyncAt.time).toBeLessThan(3.3 + 0.02);
    for (let i = beforeGap + 1; i < steps.length; i++) expect(steps[i]!.time - steps[i - 1]!.time).toBeCloseTo(dur, 9);
    // All 8 bars completed: the first full loop ends with bar 8's last step.
    expect(steps.filter((s) => s.step === pattern.length - 1).length).toBeGreaterThanOrEqual(1);
  });

  it("stop() halts scheduling and start() restarts from the top", () => {
    const { steps, seq, run } = harness();
    seq.start(beats(120, 1), 0.05);
    run(1);
    const n = steps.length;
    seq.stop();
    run(2);
    expect(steps.length).toBe(n);
    seq.start(beats(120, 1), 2.05);
    run(2.2);
    expect(steps[n]!.step).toBe(0);
  });
});

describe("patterns", () => {
  it("parses notes and chords", () => {
    expect(noteToMidi("a4")).toBe(69);
    expect(noteToMidi("c4")).toBe(60);
    expect(noteToMidi("c#5")).toBe(73);
    expect(noteToMidi("bb3")).toBe(58);
    expect(() => noteToMidi("h2")).toThrow();
    const am = parseChord("Am");
    expect(am).toEqual({ root: 9, intervals: [0, 3, 7] });
    expect(chordTone(am, 3)).toBe(12);
    expect(chordTone(parseChord("Fmaj7"), 3)).toBe(11);
    expect(() => parseChord("Xm")).toThrow();
  });

  it("the fight loop is a driving 16-bar loop around 150 BPM with bass, lead, arpeggio and noise drums", () => {
    const p = compileSong(FIGHT_SONG);
    expect(p.bpm).toBeGreaterThanOrEqual(140);
    expect(p.bpm).toBeLessThanOrEqual(160);
    expect(p.length).toBe(16 * STEPS_PER_BAR);
    const insts = new Set(p.steps.flat().map((n) => n.inst));
    for (const name of ["bass", "arp", "lead", "kick", "snare", "hat"] as const) expect(insts.has(name)).toBe(true);
    // Every bar has a kick on the downbeat and bass in it.
    for (let bar = 0; bar < 16; bar++) {
      expect(p.steps[bar * 16]!.some((n) => n.inst === "kick")).toBe(true);
      expect(p.steps.slice(bar * 16, bar * 16 + 16).flat().some((n) => n.inst === "bass")).toBe(true);
    }
    expect(INSTRUMENTS.bass.voices[0].wave).toBe("triangle");
  });

  it("the select loop is calmer: slower, 8 bars, no snare", () => {
    const p = compileSong(SELECT_SONG);
    expect(p.bpm).toBeLessThan(compileSong(FIGHT_SONG).bpm - 20);
    expect(p.length).toBe(8 * STEPS_PER_BAR);
    expect(p.steps.flat().some((n) => n.inst === "snare")).toBe(false);
  });

  it("holds extend notes and bass follows the chord root", () => {
    const p = compileSong(SELECT_SONG);
    const bar1 = p.steps[0]!.find((n) => n.inst === "softBass")!;
    expect(bar1.len).toBe(6); // "R-----"
    expect(bar1.midi).toBe(noteToMidi("f2"));
    const bar2 = p.steps[16]!.find((n) => n.inst === "softBass")!;
    expect(bar2.midi).toBe(noteToMidi("e2"));
  });

  it("rejects malformed bars", () => {
    expect(() => compileSong({ ...SELECT_SONG, parts: [{ kind: "drum", inst: "hat", bars: ["x.x"] }] })).toThrow(/expected 16/);
    expect(() => compileSong({ ...SELECT_SONG, parts: [{ kind: "bass", inst: "bass", octave: 2, bars: ["Q..............."] }] })).toThrow(/bad bass/);
    expect(() => compileSong({ ...SELECT_SONG, chords: ["C"] })).toThrow(/chords/);
  });

  it("note layers hold for the note length", () => {
    const pattern = trackPattern("select");
    const dur = 60 / pattern.bpm / 4;
    const long = noteLayers({ inst: "softLead", midi: 69, len: 8, vel: 1 }, dur)!;
    const short = noteLayers({ inst: "softLead", midi: 69, len: 1, vel: 1 }, dur)!;
    expect(long[0]!.freq).toBeCloseTo(440);
    expect(long[0]!.env.hold!).toBeGreaterThan(short[0]!.env.hold!);
    expect(noteLayers({ inst: "kick", midi: 0, len: 1, vel: 1 }, dur)).toBeNull();
  });
});
