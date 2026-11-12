// WebAudio voice engine (spec 010, R1): buses, a master compressor, and
// fire-and-forget voices built from oscillators or noise, an ADSR envelope,
// pitch and filter sweeps, and optional waveshaper drive.
//
// Everything talks to the small structural interfaces below instead of the DOM
// types, so a fake context (src/audio/testing) can stand in under Vitest.
//
// Graph:  voices → sfxBus ─────────────┐
//         voices → trackOut → musicBus → duck ─┴→ compressor → master → destination

// --- Structural WebAudio subset ----------------------------------------------

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(target: number, time: number, timeConstant: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface ScheduledSourceLike extends AudioNodeLike {
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

export interface OscillatorNodeLike extends ScheduledSourceLike {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
  readonly detune: AudioParamLike;
  setPeriodicWave(wave: object): void;
}

export interface AudioBufferLike {
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceNodeLike extends ScheduledSourceLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  readonly playbackRate: AudioParamLike;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

export interface WaveShaperNodeLike extends AudioNodeLike {
  curve: Float32Array | null;
  oversample: OverSampleType;
}

export interface CompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBufferSource(): BufferSourceNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createWaveShaper(): WaveShaperNodeLike;
  createDynamicsCompressor(): CompressorNodeLike;
  createPeriodicWave(real: Float32Array, imag: Float32Array): object;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

// --- Sound recipes -------------------------------------------------------------

/** "pulse25" and "pulse12" are the NES-style narrow pulse waves (25% and 12.5% duty). */
export type Wave = "sine" | "square" | "sawtooth" | "triangle" | "pulse25" | "pulse12";

/**
 * ADSR in seconds: linear attack to the peak, exponential decay to `s` (a
 * fraction of the peak), `hold` seconds at the sustain level, exponential release.
 */
export interface Envelope {
  a: number;
  d: number;
  s: number;
  r: number;
  hold?: number;
}

/** Exponential sweep from the start value to `to` over `time` seconds. */
export interface Sweep {
  to: number;
  time: number;
}

export interface FilterSpec {
  type: "lowpass" | "highpass" | "bandpass";
  freq: number;
  /** Optional exponential cutoff sweep. */
  to?: number;
  time?: number;
  q?: number;
}

interface LayerBase {
  env: Envelope;
  /** Peak gain of this layer (before bus levels). */
  gain: number;
  /** Seconds after the recipe's start time. */
  delay?: number;
  filter?: FilterSpec;
  /** Waveshaper drive (0 = clean, 2..8 = gritty). */
  drive?: number;
}

export interface ToneLayer extends LayerBase {
  kind: "tone";
  wave: Wave;
  freq: number;
  sweep?: Sweep;
  /** Cents. */
  detune?: number;
}

export interface NoiseLayer extends LayerBase {
  kind: "noise";
  /** Playback rate of the noise buffer (lower = darker). */
  rate?: number;
}

export type Layer = ToneLayer | NoiseLayer;
export type Recipe = readonly Layer[];

export type BusName = "sfx" | "music";

export interface PlayOptions {
  /** Pitch multiplier for tone frequencies, sweeps and noise rate. */
  pitch?: number;
  /** Gain multiplier. */
  gain?: number;
  /** Which voice budget the voices count against (default "sfx"). */
  bus?: BusName;
  /** Output node (default: the bus). Music tracks pass their own fade node. */
  out?: AudioNodeLike;
}

export function layerEnd(layer: Layer): number {
  const e = layer.env;
  return (layer.delay ?? 0) + e.a + e.d + (e.hold ?? 0) + e.r;
}

/** Seconds from the recipe start until its last voice is silent. */
export function recipeDuration(recipe: Recipe): number {
  let end = 0;
  for (const l of recipe) end = Math.max(end, layerEnd(l));
  return end;
}

// --- Levels --------------------------------------------------------------------

export interface Levels {
  master: number;
  music: number;
  sfx: number;
}

/** Bus gain at volume 1. The user's 0..1 volumes scale these. */
export const BASE_LEVELS: Readonly<Levels> = Object.freeze({ master: 0.9, music: 0.5, sfx: 0.85 });

/**
 * Voices per bus, counted from scheduling until they end (stingers schedule
 * ahead, so a K.O. alone books about 30). A recipe that does not fit is dropped
 * whole, never cut to a few layers, and counted in stats.
 */
export const VOICE_LIMITS: Readonly<Record<BusName, number>> = Object.freeze({ sfx: 128, music: 64 });

const FLOOR = 0.0001;
const NOISE_SECONDS = 2;
const LEVEL_RAMP = 0.015;

interface ActiveVoice {
  end: number;
  bus: BusName;
  nodes: AudioNodeLike[];
}

export interface EngineStats {
  /** Voices started since creation. */
  started: number;
  /** Music voices that were scheduled before the context clock (should stay 0). */
  late: number;
  /** Voices dropped by the voice limit. */
  dropped: number;
}

/** Small deterministic PRNG for noise and variation (audio is not the sim; this only keeps tests stable). */
export function makeRandom(seed = 0x2f6b9a1d): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** Fourier coefficients of a pulse wave with the given duty cycle. */
export function pulseCoefficients(duty: number, harmonics = 48): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    real[n] = Math.sin(2 * Math.PI * n * duty) / (Math.PI * n);
    imag[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (Math.PI * n);
  }
  return { real, imag };
}

/** Soft-clip curve: y = (1 + k) x / (1 + k |x|), so y(±1) = ±1. */
export function driveCurve(k: number, size = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i * 2) / (size - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export class AudioEngine {
  readonly ctx: AudioContextLike;
  readonly master: GainNodeLike;
  readonly compressor: CompressorNodeLike;
  readonly musicBus: GainNodeLike;
  /** Sits after the music bus; ducking automates it so volume changes stay independent. */
  readonly duckGain: GainNodeLike;
  readonly sfxBus: GainNodeLike;
  readonly stats: EngineStats = { started: 0, late: 0, dropped: 0 };

  private readonly random: () => number;
  private noise: AudioBufferLike | null = null;
  private readonly waves = new Map<Wave, object>();
  private readonly curves = new Map<number, Float32Array<ArrayBuffer>>();
  private active: ActiveVoice[] = [];
  private duckEnd = 0;
  private duckDepth = 1;

  constructor(ctx: AudioContextLike, levels: Levels, muted: boolean, random: () => number = makeRandom()) {
    this.ctx = ctx;
    this.random = random;
    this.master = ctx.createGain();
    this.compressor = ctx.createDynamicsCompressor();
    this.musicBus = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.sfxBus = ctx.createGain();

    const c = this.compressor;
    c.threshold.value = -16;
    c.knee.value = 10;
    c.ratio.value = 6;
    c.attack.value = 0.003;
    c.release.value = 0.2;

    this.musicBus.connect(this.duckGain);
    this.duckGain.connect(c);
    this.sfxBus.connect(c);
    c.connect(this.master);
    this.master.connect(ctx.destination);

    this.duckGain.gain.value = 1;
    this.applyLevels(levels, muted, true);
  }

  now(): number {
    return this.ctx.currentTime;
  }

  /** Sets bus gains from the user's volumes. Mute zeroes both buses; the master keeps its level. */
  applyLevels(levels: Levels, muted: boolean, immediate = false): void {
    const set = (param: AudioParamLike, value: number) => {
      if (immediate) {
        param.value = value;
        return;
      }
      const t = this.ctx.currentTime;
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      param.setTargetAtTime(value, t, LEVEL_RAMP);
    };
    set(this.master.gain, clamp01(levels.master) * BASE_LEVELS.master);
    set(this.musicBus.gain, muted ? 0 : clamp01(levels.music) * BASE_LEVELS.music);
    set(this.sfxBus.gain, muted ? 0 : clamp01(levels.sfx) * BASE_LEVELS.sfx);
  }

  /**
   * Pulls the music down to `depth` at `at`, holds it, then lets it recover.
   * A duck that starts while another is held merges with it (deeper depth,
   * later end), so a K.O. followed by the round-win jingle never lets the music
   * jump back up in between. setTargetAtTime glides from whatever the gain is
   * at `at`, so there is no anchor value to get wrong.
   */
  duck(at: number, depth: number, hold: number, release: number): void {
    const g = this.duckGain.gain;
    let end = at + hold;
    if (at < this.duckEnd) {
      depth = Math.min(depth, this.duckDepth);
      end = Math.max(end, this.duckEnd);
    }
    this.duckDepth = depth;
    this.duckEnd = end;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(depth, at, 0.03);
    g.setTargetAtTime(1, end, Math.max(0.01, release / 3));
  }

  /** Voices currently sounding (after pruning finished ones). */
  activeVoices(bus?: BusName): number {
    this.prune();
    if (!bus) return this.active.length;
    let n = 0;
    for (const v of this.active) if (v.bus === bus) n++;
    return n;
  }

  /**
   * Plays every layer of a recipe starting at `at`, or none of them when the
   * bus has no room for all. Returns how many voices started.
   */
  play(recipe: Recipe, at: number, options: PlayOptions = {}): number {
    const bus = options.bus ?? "sfx";
    if (this.activeVoices(bus) + recipe.length > VOICE_LIMITS[bus]) {
      this.stats.dropped += recipe.length;
      return 0;
    }
    let started = 0;
    for (const layer of recipe) if (this.voice(layer, at, options)) started++;
    return started;
  }

  /** Starts one voice. Returns false when the voice limit dropped it. */
  voice(layer: Layer, at: number, options: PlayOptions = {}): boolean {
    const bus = options.bus ?? "sfx";
    if (this.activeVoices(bus) >= VOICE_LIMITS[bus]) {
      this.stats.dropped++;
      return false;
    }
    const ctx = this.ctx;
    const pitch = options.pitch ?? 1;
    const t0 = at + (layer.delay ?? 0);
    if (bus === "music" && t0 < ctx.currentTime) this.stats.late++;
    const nodes: AudioNodeLike[] = [];

    let source: ScheduledSourceLike;
    let offset: number | undefined;
    if (layer.kind === "tone") {
      const osc = ctx.createOscillator();
      this.setWave(osc, layer.wave);
      const f0 = Math.max(1, layer.freq * pitch);
      osc.frequency.setValueAtTime(f0, t0);
      if (layer.sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(1, layer.sweep.to * pitch), t0 + layer.sweep.time);
      if (layer.detune) osc.detune.value = layer.detune;
      source = osc;
    } else {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      src.loop = true;
      src.playbackRate.value = (layer.rate ?? 1) * pitch;
      offset = this.random() * (NOISE_SECONDS - 0.5);
      source = src;
    }
    nodes.push(source);

    let tail: AudioNodeLike = source;
    if (layer.drive && layer.drive > 0) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.curve(layer.drive);
      shaper.oversample = "2x";
      tail.connect(shaper);
      tail = shaper;
      nodes.push(shaper);
    }
    if (layer.filter) {
      const f = layer.filter;
      const biquad = ctx.createBiquadFilter();
      biquad.type = f.type;
      biquad.frequency.setValueAtTime(f.freq, t0);
      if (f.to !== undefined) biquad.frequency.exponentialRampToValueAtTime(Math.max(10, f.to), t0 + (f.time ?? 0.1));
      biquad.Q.value = f.q ?? 0.7;
      tail.connect(biquad);
      tail = biquad;
      nodes.push(biquad);
    }
    const amp = ctx.createGain();
    const end = envelope(amp.gain, t0, layer.gain * (options.gain ?? 1), layer.env);
    tail.connect(amp);
    amp.connect(options.out ?? (bus === "music" ? this.musicBus : this.sfxBus));
    nodes.push(amp);

    if (offset === undefined) source.start(t0);
    else source.start(t0, offset);
    source.stop(end + 0.02);
    this.active.push({ end: end + 0.02, bus, nodes });
    this.stats.started++;
    return true;
  }

  /** Disconnects voices that finished a little while ago. */
  private prune(): void {
    const cutoff = this.ctx.currentTime - 0.1;
    if (!this.active.some((v) => v.end < cutoff)) return;
    const keep: ActiveVoice[] = [];
    for (const v of this.active) {
      if (v.end < cutoff) {
        for (const n of v.nodes) {
          try {
            n.disconnect();
          } catch {
            // already disconnected
          }
        }
      } else keep.push(v);
    }
    this.active = keep;
  }

  private setWave(osc: OscillatorNodeLike, wave: Wave): void {
    if (wave !== "pulse25" && wave !== "pulse12") {
      osc.type = wave;
      return;
    }
    let pw = this.waves.get(wave);
    if (!pw) {
      const { real, imag } = pulseCoefficients(wave === "pulse25" ? 0.25 : 0.125);
      pw = this.ctx.createPeriodicWave(real, imag);
      this.waves.set(wave, pw);
    }
    osc.setPeriodicWave(pw);
  }

  private noiseBuffer(): AudioBufferLike {
    if (!this.noise) {
      const rate = this.ctx.sampleRate;
      const buffer = this.ctx.createBuffer(1, Math.floor(rate * NOISE_SECONDS), rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = this.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }

  private curve(drive: number): Float32Array<ArrayBuffer> {
    const key = Math.round(drive * 10);
    let c = this.curves.get(key);
    if (!c) {
      c = driveCurve(key / 10);
      this.curves.set(key, c);
    }
    return c;
  }
}

/** Schedules an ADSR on a gain param; returns the time the voice is silent. */
export function envelope(param: AudioParamLike, at: number, peak: number, env: Envelope): number {
  const a = Math.max(0.001, env.a);
  const d = Math.max(0.001, env.d);
  const hold = Math.max(0, env.hold ?? 0);
  const r = Math.max(0.001, env.r);
  const top = Math.max(FLOOR, peak);
  const sustain = Math.max(FLOOR, top * env.s);
  param.setValueAtTime(FLOOR, at);
  param.linearRampToValueAtTime(top, at + a);
  param.exponentialRampToValueAtTime(sustain, at + a + d);
  const releaseAt = at + a + d + hold;
  if (hold > 0) param.setValueAtTime(sustain, releaseAt);
  param.exponentialRampToValueAtTime(FLOOR, releaseAt + r);
  param.setValueAtTime(0, releaseAt + r);
  return releaseAt + r;
}

export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
