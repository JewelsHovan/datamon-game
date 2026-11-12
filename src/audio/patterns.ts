// Music as data (spec 010, R4): instruments, the two loops, and a pure compiler
// that turns chord charts, rhythm strings and note strings into a step grid the
// sequencer plays. Every bar has 16 steps (sixteenth notes).
//
// Notation, one character or token per step:
// - bass rhythm (chars): R root, r root an octave up, f fifth, F fifth an octave up,
//   "-" holds the previous note, "." rest.
// - arpeggio (chars): 0..5 chord tones from the root up (they wrap into the next
//   octave), "-" hold, "." rest.
// - drums (chars): x hit, X accent, "." rest.
// - melody (space-separated tokens): note names like a4, c#5, bb3; "-" hold; "." rest.
import type { Envelope, FilterSpec, Recipe, Wave } from "./engine";

export type MusicTrack = "select" | "fight";

export const STEPS_PER_BAR = 16;
export const STEPS_PER_BEAT = 4;

// --- Notes and chords --------------------------------------------------------

const PITCH_CLASS: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "a4" → 69, "c#5" → 73, "bb3" → 58. Throws on a malformed name (patterns are checked by tests). */
export function noteToMidi(name: string): number {
  const m = /^([a-g])(#|b)?(-?\d)$/i.exec(name.trim());
  if (!m) throw new Error(`bad note name "${name}"`);
  const pc = PITCH_CLASS[m[1]!.toLowerCase()]!;
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + pc + accidental;
}

const CHORD_INTERVALS: Readonly<Record<string, readonly number[]>> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
};

export interface Chord {
  /** Pitch class of the root, 0 = C. */
  root: number;
  intervals: readonly number[];
}

/** "Am" → A minor, "Fmaj7", "E", "Dm7", "Gsus4". */
export function parseChord(symbol: string): Chord {
  const m = /^([A-G])(#|b)?(maj7|m7|sus4|sus2|m|7)?$/.exec(symbol.trim());
  if (!m) throw new Error(`bad chord "${symbol}"`);
  const root = (PITCH_CLASS[m[1]!.toLowerCase()]! + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
  return { root, intervals: CHORD_INTERVALS[m[3] ?? ""]! };
}

/** The k-th chord tone above the root, wrapping into higher octaves. */
export function chordTone(chord: Chord, k: number): number {
  const n = chord.intervals.length;
  return chord.intervals[k % n]! + 12 * Math.floor(k / n);
}

// --- Instruments ---------------------------------------------------------------

export interface ToneVoice {
  wave: Wave;
  gain: number;
  env: Envelope;
  /** Octaves above the played note. */
  octave?: number;
  detune?: number;
  filter?: FilterSpec;
  drive?: number;
}

export type Instrument = { kind: "tone"; voices: readonly ToneVoice[] } | { kind: "drum"; recipe: Recipe };

const e = (a: number, d: number, s = 0, r = 0.02): Envelope => ({ a, d, s, r });

export const INSTRUMENTS = {
  /** Fight bass: NES triangle with a quiet filtered pulse on top so it reads on small speakers. */
  bass: {
    kind: "tone",
    voices: [
      { wave: "triangle", gain: 0.55, env: e(0.004, 0.09, 0.75, 0.05) },
      { wave: "pulse25", gain: 0.07, env: e(0.003, 0.12, 0.45, 0.04), filter: { type: "lowpass", freq: 950 } },
    ],
  },
  /** Select bass: round triangle with a slower release. */
  softBass: {
    kind: "tone",
    voices: [{ wave: "triangle", gain: 0.5, env: e(0.01, 0.2, 0.6, 0.14) }],
  },
  /** Fight arpeggio: thin 12.5% pulse, short and plucky. */
  arp: {
    kind: "tone",
    voices: [{ wave: "pulse12", gain: 0.06, env: e(0.002, 0.07, 0.25, 0.04), filter: { type: "lowpass", freq: 3300 } }],
  },
  /** Fight lead: 25% pulse plus a slightly detuned copy for width. */
  lead: {
    kind: "tone",
    voices: [
      { wave: "pulse25", gain: 0.085, env: e(0.004, 0.12, 0.55, 0.08), filter: { type: "lowpass", freq: 3800 } },
      { wave: "pulse25", gain: 0.03, env: e(0.006, 0.12, 0.5, 0.08), detune: 9, filter: { type: "lowpass", freq: 3000 } },
    ],
  },
  /** Select keys: soft pulse arpeggio with a triangle underneath. */
  keys: {
    kind: "tone",
    voices: [
      { wave: "pulse12", gain: 0.045, env: e(0.004, 0.22, 0.3, 0.16), filter: { type: "lowpass", freq: 2100 } },
      { wave: "triangle", gain: 0.07, env: e(0.006, 0.25, 0.3, 0.16) },
    ],
  },
  /** Select melody: mellow triangle lead. */
  softLead: {
    kind: "tone",
    voices: [
      { wave: "triangle", gain: 0.17, env: e(0.012, 0.15, 0.6, 0.16) },
      { wave: "pulse25", gain: 0.02, env: e(0.02, 0.2, 0.5, 0.16), filter: { type: "lowpass", freq: 1800 } },
    ],
  },
  kick: {
    kind: "drum",
    recipe: [
      { kind: "tone", wave: "sine", freq: 150, sweep: { to: 42, time: 0.1 }, env: e(0.001, 0.16), gain: 0.75 },
      { kind: "noise", env: e(0.001, 0.012, 0, 0.005), gain: 0.12, filter: { type: "highpass", freq: 2500 } },
    ],
  },
  snare: {
    kind: "drum",
    recipe: [
      { kind: "noise", env: e(0.001, 0.13), gain: 0.34, filter: { type: "bandpass", freq: 1900, q: 0.9 } },
      { kind: "tone", wave: "triangle", freq: 230, sweep: { to: 170, time: 0.05 }, env: e(0.001, 0.07, 0, 0.01), gain: 0.25 },
    ],
  },
  hat: {
    kind: "drum",
    recipe: [{ kind: "noise", env: e(0.001, 0.028, 0, 0.005), gain: 0.09, filter: { type: "highpass", freq: 7500 } }],
  },
  openHat: {
    kind: "drum",
    recipe: [{ kind: "noise", env: e(0.001, 0.16), gain: 0.07, filter: { type: "highpass", freq: 6500 } }],
  },
  crash: {
    kind: "drum",
    recipe: [
      { kind: "noise", env: e(0.002, 1.0, 0, 0.05), gain: 0.1, filter: { type: "highpass", freq: 3500 } },
      { kind: "noise", env: e(0.002, 0.5), gain: 0.05, filter: { type: "bandpass", freq: 6000, q: 0.8 } },
    ],
  },
  rim: {
    kind: "drum",
    recipe: [
      { kind: "tone", wave: "square", freq: 1700, env: e(0.001, 0.025, 0, 0.005), gain: 0.04, filter: { type: "lowpass", freq: 3000 } },
      { kind: "noise", env: e(0.001, 0.02, 0, 0.005), gain: 0.08, filter: { type: "bandpass", freq: 2500, q: 1.2 } },
    ],
  },
} as const satisfies Record<string, Instrument>;

export type InstrumentName = keyof typeof INSTRUMENTS;

// --- Songs ---------------------------------------------------------------------

/** Per-bar strings; a list shorter than the song repeats from the start. */
type Bars = readonly string[];

export type Part =
  | { kind: "bass"; inst: InstrumentName; octave: number; bars: Bars }
  | { kind: "arp"; inst: InstrumentName; octave: number; bars: Bars }
  | { kind: "melody"; inst: InstrumentName; bars: Bars }
  | { kind: "drum"; inst: InstrumentName; bars: Bars };

export interface Song {
  name: MusicTrack;
  bpm: number;
  bars: number;
  /** One chord per bar. */
  chords: readonly string[];
  parts: readonly Part[];
}

const rep = (bar: string, n: number): string[] => Array.from({ length: n }, () => bar);
const REST = ". . . . . . . . . . . . . . . .";

/** The fight loop: A minor, 150 BPM, 16 bars (an 8-bar drive, then 8 bars with the hook). */
export const FIGHT_SONG: Song = {
  name: "fight",
  bpm: 150,
  bars: 16,
  chords: ["Am", "F", "G", "Am", "Am", "F", "Dm", "E", "F", "G", "Em", "Am", "F", "G", "E", "E"],
  parts: [
    {
      kind: "bass",
      inst: "bass",
      octave: 2,
      bars: [
        ...rep("R.r.R.r.R.r.R.r.", 7),
        "R.r.R.r.RrRrRrRr",
        ...rep("R.rRR.rRR.rRR.rR", 7),
        "R.r.R.r.RrRrRrRr",
      ],
    },
    {
      kind: "arp",
      inst: "arp",
      octave: 4,
      bars: [...rep("0121012101210123", 8), ...rep("0.1.2.1.0.1.2.1.", 7), "0.1.2.3.2.3.4.5."],
    },
    {
      kind: "melody",
      inst: "lead",
      bars: [
        ...rep(REST, 8),
        "c5 - - - a4 - c5 - f5 - - - e5 - c5 -",
        "d5 - - - b4 - d5 - g5 - - - f5 - d5 -",
        "e5 - - - g5 - - - b5 - - - a5 - g5 -",
        "a5 - - - - - - - e5 - - - c5 - - -",
        "c5 - - - a4 - c5 - f5 - - - e5 - c5 -",
        "d5 - - - b4 - d5 - g5 - - - a5 - b5 -",
        "b5 - - - g#5 - - - e5 - - - g#5 - b5 -",
        "e6 - - - - - - - d6 - - - b5 - g#5 -",
      ],
    },
    { kind: "drum", inst: "kick", bars: [...rep("X.....x.x.....x.", 7), "X.....x.x.x.x.x.", ...rep("X.....x.x.....x.", 7), "X.....x.x.x.x.x."] },
    { kind: "drum", inst: "snare", bars: [...rep("....X.......X...", 7), "....X.....x.xxXX", ...rep("....X.......X...", 7), "....X.....x.xxXX"] },
    { kind: "drum", inst: "hat", bars: rep("x.x.x.x.x.x.x.x.", 16) },
    { kind: "drum", inst: "openHat", bars: ["................", "................", "................", "..............x."] },
    { kind: "drum", inst: "crash", bars: ["X...............", ...rep("................", 7), "X...............", ...rep("................", 7)] },
  ],
};

/** The select loop: F major 7 colours, 112 BPM, 8 bars; keys and bass, the melody enters on bar 5. */
export const SELECT_SONG: Song = {
  name: "select",
  bpm: 112,
  bars: 8,
  chords: ["Fmaj7", "Em7", "Dm7", "Cmaj7", "Fmaj7", "Em7", "Dm7", "G"],
  parts: [
    { kind: "bass", inst: "softBass", octave: 2, bars: ["R-----R-r---R---"] },
    { kind: "arp", inst: "keys", octave: 4, bars: ["0.1.2.3.2.1.2.1."] },
    {
      kind: "melody",
      inst: "softLead",
      bars: [
        ...rep(REST, 4),
        "e5 - - - c5 - - - a4 - - - c5 - e5 -",
        "d5 - - - - - b4 - g4 - - - b4 - d5 -",
        "c5 - - - a4 - - - f4 - - - a4 - c5 -",
        "b4 - - - - - - - d5 - - - - - - -",
      ],
    },
    { kind: "drum", inst: "kick", bars: ["x.......x.....x."] },
    { kind: "drum", inst: "rim", bars: ["............x..."] },
    { kind: "drum", inst: "hat", bars: ["..x...x...x...x."] },
  ],
};

export const SONGS: Readonly<Record<MusicTrack, Song>> = { fight: FIGHT_SONG, select: SELECT_SONG };

// --- Compiler ------------------------------------------------------------------

export interface NoteEvent {
  inst: InstrumentName;
  /** MIDI note (ignored by drums). */
  midi: number;
  /** Length in steps. */
  len: number;
  /** Gain multiplier, 0..1. */
  vel: number;
}

export interface Pattern {
  name: string;
  bpm: number;
  stepsPerBeat: number;
  stepsPerBar: number;
  /** Total steps (bars × stepsPerBar). */
  length: number;
  /** Notes starting on each step. */
  steps: readonly (readonly NoteEvent[])[];
}

/** Splits a bar into exactly 16 step tokens (chars, or space-separated tokens for melodies). */
function tokens(bar: string, spaced: boolean, where: string): string[] {
  const list = spaced ? bar.trim().split(/\s+/) : [...bar];
  if (list.length !== STEPS_PER_BAR) throw new Error(`${where}: expected ${STEPS_PER_BAR} steps, got ${list.length}`);
  return list;
}

/** Expands a song into a step grid. Pure; throws on malformed data. */
export function compileSong(song: Song): Pattern {
  const length = song.bars * STEPS_PER_BAR;
  const steps: NoteEvent[][] = Array.from({ length }, () => []);
  if (song.chords.length !== song.bars) throw new Error(`${song.name}: ${song.chords.length} chords for ${song.bars} bars`);
  const chords = song.chords.map(parseChord);

  for (const part of song.parts) {
    if (part.bars.length === 0) continue;
    for (let bar = 0; bar < song.bars; bar++) {
      const where = `${song.name}/${part.inst}/bar ${bar + 1}`;
      const src = part.bars[bar % part.bars.length]!;
      const toks = tokens(src, part.kind === "melody", where);
      const chord = chords[bar]!;
      let last: NoteEvent | null = null;
      toks.forEach((tok, i) => {
        if (tok === "-") {
          if (last) last.len += 1;
          return;
        }
        last = null;
        if (tok === ".") return;
        let ev: NoteEvent;
        if (part.kind === "drum") {
          if (tok !== "x" && tok !== "X") throw new Error(`${where}: bad drum token "${tok}"`);
          ev = { inst: part.inst, midi: 0, len: 1, vel: tok === "X" ? 1 : 0.72 };
        } else if (part.kind === "melody") {
          ev = { inst: part.inst, midi: noteToMidi(tok), len: 1, vel: 1 };
        } else {
          const base = 12 * (part.octave + 1) + chord.root;
          let midi: number;
          if (part.kind === "bass") {
            const offsets: Record<string, number> = { R: 0, r: 12, f: 7, F: 19 };
            const off = offsets[tok];
            if (off === undefined) throw new Error(`${where}: bad bass token "${tok}"`);
            midi = base + off;
          } else {
            const k = Number(tok);
            if (!Number.isInteger(k) || k < 0 || k > 9) throw new Error(`${where}: bad arp token "${tok}"`);
            midi = base + chordTone(chord, k);
          }
          ev = { inst: part.inst, midi, len: 1, vel: 1 };
        }
        steps[bar * STEPS_PER_BAR + i]!.push(ev);
        last = ev;
      });
    }
  }
  return { name: song.name, bpm: song.bpm, stepsPerBeat: STEPS_PER_BEAT, stepsPerBar: STEPS_PER_BAR, length, steps };
}
