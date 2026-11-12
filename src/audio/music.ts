// Chiptune sequencer and music player (spec 010, R4).
//
// The Sequencer is a lookahead scheduler against the audio clock: every tick it
// schedules the steps that start within `lookahead` seconds. Step times come
// from `origin + n * stepDuration`, never from summed deltas, so the grid does
// not drift. A late tick (the page stalled and the clock passed the next step)
// re-anchors the grid just ahead of the clock and carries on from the same
// pattern position: nothing is scheduled in the past and no bar is skipped.
import { midiToFreq, type AudioEngine, type GainNodeLike, type ToneLayer } from "./engine";
import { compileSong, INSTRUMENTS, SONGS, type MusicTrack, type NoteEvent, type Pattern, type ToneVoice } from "./patterns";

export const LOOKAHEAD = 0.1;
export const TICK_MS = 25;
/** How far ahead of the clock a resynced grid starts. */
const RESYNC_DELAY = 0.01;
/** A step closer to the clock than this counts as late (scheduling takes a moment). */
const MIN_LEAD = 0.004;
/** Gap between a track request and its first note. */
const START_DELAY = 0.06;
const FADE_OUT = 0.25;

export type NoteHandler = (note: NoteEvent, time: number, stepDuration: number) => void;
export type StepHandler = (step: number, time: number) => void;

export interface SequencerOptions {
  /** Seconds on the audio clock. */
  now: () => number;
  onNote: NoteHandler;
  onStep?: StepHandler;
  lookahead?: number;
}

export class Sequencer {
  private pattern: Pattern | null = null;
  /** Clock time of grid step `count = 0`. */
  private origin = 0;
  /** Steps scheduled since `origin`. */
  private count = 0;
  /** Pattern step at `origin`. */
  private startStep = 0;
  /** Steps scheduled since start(), across resyncs and loops. */
  private total = 0;
  /** Times the grid was re-anchored after a late tick. */
  resyncs = 0;
  private readonly now: () => number;
  private readonly onNote: NoteHandler;
  private readonly onStep: StepHandler | undefined;
  readonly lookahead: number;

  constructor(options: SequencerOptions) {
    this.now = options.now;
    this.onNote = options.onNote;
    this.onStep = options.onStep;
    this.lookahead = options.lookahead ?? LOOKAHEAD;
  }

  get playing(): boolean {
    return this.pattern !== null;
  }

  get current(): Pattern | null {
    return this.pattern;
  }

  /** Seconds per step at the pattern's tempo. */
  get stepDuration(): number {
    const p = this.pattern;
    return p ? 60 / p.bpm / p.stepsPerBeat : 0;
  }

  /** Steps scheduled since start(); bar = floor(scheduled / stepsPerBar). */
  get scheduled(): number {
    return this.total;
  }

  /** The next step to schedule: its pattern index and clock time. */
  get next(): { step: number; time: number } {
    const p = this.pattern;
    if (!p) return { step: 0, time: 0 };
    return { step: (this.startStep + this.count) % p.length, time: this.origin + this.count * this.stepDuration };
  }

  start(pattern: Pattern, at: number): void {
    this.pattern = pattern;
    this.origin = at;
    this.count = 0;
    this.startStep = 0;
    this.total = 0;
    this.resyncs = 0;
  }

  stop(): void {
    this.pattern = null;
  }

  /** Schedules every step that starts before now + lookahead. Returns the steps scheduled. */
  tick(): number {
    const p = this.pattern;
    if (!p || p.length === 0) return 0;
    const now = this.now();
    const dur = this.stepDuration;
    let time = this.origin + this.count * dur;
    if (time < now + MIN_LEAD) {
      this.startStep = (this.startStep + this.count) % p.length;
      this.origin = now + RESYNC_DELAY;
      this.count = 0;
      this.resyncs++;
      time = this.origin;
    }
    const horizon = now + this.lookahead;
    const cap = Math.ceil(this.lookahead / dur) + 2;
    let n = 0;
    while (time < horizon && n < cap) {
      const step = (this.startStep + this.count) % p.length;
      for (const note of p.steps[step] ?? []) this.onNote(note, time, dur);
      this.onStep?.(step, time);
      this.count++;
      this.total++;
      n++;
      time = this.origin + this.count * dur;
    }
    return n;
  }
}

/** Turns a note into engine layers for its instrument. */
export function noteLayers(note: NoteEvent, stepDuration: number): readonly ToneLayer[] | null {
  const inst = INSTRUMENTS[note.inst];
  if (inst.kind === "drum") return null;
  const seconds = note.len * stepDuration;
  const voices: readonly ToneVoice[] = inst.voices;
  return voices.map((v) => {
    const hold = Math.max(0, seconds - v.env.a - v.env.d - 0.01);
    const layer: ToneLayer = {
      kind: "tone",
      wave: v.wave,
      freq: midiToFreq(note.midi + 12 * (v.octave ?? 0)),
      gain: v.gain * note.vel,
      env: { ...v.env, hold },
    };
    if (v.detune !== undefined) layer.detune = v.detune;
    if (v.filter !== undefined) layer.filter = v.filter;
    if (v.drive !== undefined) layer.drive = v.drive;
    return layer;
  });
}

export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
}

export const DEFAULT_TIMERS: Timers = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
};

const COMPILED = new Map<MusicTrack, Pattern>();
export function trackPattern(track: MusicTrack): Pattern {
  let p = COMPILED.get(track);
  if (!p) {
    p = compileSong(SONGS[track]);
    COMPILED.set(track, p);
  }
  return p;
}

/** Plays one music track at a time on the engine's music bus, with a short fade between tracks. */
export class MusicPlayer {
  readonly sequencer: Sequencer;
  /** When true the sequencer keeps its place but no voices start (mute). */
  silent = false;
  private track: MusicTrack | null = null;
  private out: GainNodeLike | null = null;
  private interval: unknown = null;
  private readonly engine: AudioEngine;
  private readonly timers: Timers;

  constructor(engine: AudioEngine, timers: Timers = DEFAULT_TIMERS) {
    this.engine = engine;
    this.timers = timers;
    this.sequencer = new Sequencer({
      now: () => engine.now(),
      onNote: (note, time, dur) => this.playNote(note, time, dur),
    });
  }

  get playing(): MusicTrack | null {
    return this.track;
  }

  play(track: MusicTrack | null): void {
    if (track === this.track) return;
    this.fadeOut();
    this.track = track;
    if (track === null) {
      this.sequencer.stop();
      this.stopTimer();
      return;
    }
    const out = this.engine.ctx.createGain();
    out.gain.value = 1;
    out.connect(this.engine.musicBus);
    this.out = out;
    this.sequencer.start(trackPattern(track), this.engine.now() + START_DELAY);
    this.sequencer.tick();
    if (this.interval === null) this.interval = this.timers.setInterval(() => this.tick(), TICK_MS);
  }

  tick(): void {
    this.sequencer.tick();
  }

  dispose(): void {
    this.play(null);
  }

  private playNote(note: NoteEvent, time: number, dur: number): void {
    if (this.silent || !this.out) return;
    const inst = INSTRUMENTS[note.inst];
    const options = { bus: "music" as const, out: this.out, gain: note.vel };
    if (inst.kind === "drum") {
      this.engine.play(inst.recipe, time, options);
      return;
    }
    const layers = noteLayers(note, dur);
    if (layers) this.engine.play(layers, time, { bus: "music", out: this.out });
  }

  private fadeOut(): void {
    const old = this.out;
    if (!old) return;
    this.out = null;
    const t = this.engine.now();
    old.gain.cancelScheduledValues(t);
    old.gain.setValueAtTime(old.gain.value, t);
    old.gain.linearRampToValueAtTime(0, t + FADE_OUT);
    this.timers.setTimeout(() => {
      try {
        old.disconnect();
      } catch {
        // already gone
      }
    }, (FADE_OUT + LOOKAHEAD + 0.5) * 1000);
  }

  private stopTimer(): void {
    if (this.interval !== null) this.timers.clearInterval(this.interval);
    this.interval = null;
  }
}
