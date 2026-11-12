// A recording stand-in for AudioContext (spec 010 tests). It builds a node
// graph, records every param automation and every source start/stop, and lets
// tests move the clock by hand. No sound, no browser.
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  BufferSourceNodeLike,
  CompressorNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  WaveShaperNodeLike,
} from "../engine";

export interface ParamEvent {
  kind: "set" | "linear" | "exp" | "target";
  value: number;
  time: number;
  timeConstant?: number;
}

export class FakeParam implements AudioParamLike {
  value: number;
  events: ParamEvent[] = [];
  constructor(value: number) {
    this.value = value;
  }
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: "set", value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: "linear", value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    if (value <= 0) throw new RangeError("exponential ramp to a non-positive value");
    this.events.push({ kind: "exp", value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number, timeConstant: number) {
    this.events.push({ kind: "target", value, time, timeConstant });
    return this;
  }
  /** Like the real thing: drops every event scheduled at or after `time`. */
  cancelScheduledValues(time: number) {
    this.events = this.events.filter((e) => e.time < time);
    return this;
  }
  /** The value the automation settles on (the last scheduled value, or `value`). */
  final(): number {
    return this.events.at(-1)?.value ?? this.value;
  }
  /** Values the param was sent toward with setTargetAtTime. */
  targets(): number[] {
    return this.events.filter((e) => e.kind === "target").map((e) => e.value);
  }
}

export class FakeNode implements AudioNodeLike {
  outputs: FakeNode[] = [];
  /** Every node this one was ever connected to (kept after disconnect, for routing checks). */
  routedTo: FakeNode[] = [];
  disconnected = false;
  constructor(
    readonly ctx: FakeAudioContext,
    readonly kind: string,
  ) {
    ctx.nodes.push(this);
  }
  connect(destination: AudioNodeLike): FakeNode {
    if (!(destination instanceof FakeNode)) throw new Error("fake nodes connect only to fake nodes");
    this.outputs.push(destination);
    this.routedTo.push(destination);
    return destination;
  }
  disconnect() {
    this.outputs = [];
    this.disconnected = true;
  }
  /** True when `target` is (or was) downstream of this node. */
  reaches(target: FakeNode): boolean {
    const seen = new Set<FakeNode>();
    const stack: FakeNode[] = [this];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === target) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...n.routedTo);
    }
    return false;
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
  constructor(ctx: FakeAudioContext) {
    super(ctx, "gain");
  }
}

export abstract class FakeSource extends FakeNode {
  startTime: number | null = null;
  stopTime: number | null = null;
  startOffset: number | undefined;
  start(when = 0, offset?: number) {
    if (this.startTime !== null) throw new Error("start() called twice");
    this.startTime = when;
    this.startOffset = offset;
    this.ctx.started.push(this);
  }
  stop(when = 0) {
    this.stopTime = when;
  }
}

export class FakeOscillator extends FakeSource implements OscillatorNodeLike {
  type: OscillatorType = "sine";
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  periodicWave: object | null = null;
  constructor(ctx: FakeAudioContext) {
    super(ctx, "oscillator");
  }
  setPeriodicWave(wave: object) {
    this.periodicWave = wave;
    this.type = "custom";
  }
  /** First scheduled frequency. */
  get startFrequency(): number {
    return this.frequency.events.find((e) => e.kind === "set")?.value ?? this.frequency.value;
  }
}

export class FakeBuffer implements AudioBufferLike {
  readonly data: Float32Array;
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData() {
    return this.data;
  }
}

export class FakeBufferSource extends FakeSource implements BufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  constructor(ctx: FakeAudioContext) {
    super(ctx, "noise");
  }
}

export class FakeFilter extends FakeNode implements BiquadFilterNodeLike {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  constructor(ctx: FakeAudioContext) {
    super(ctx, "filter");
  }
}

export class FakeShaper extends FakeNode implements WaveShaperNodeLike {
  curve: Float32Array | null = null;
  oversample: OverSampleType = "none";
  constructor(ctx: FakeAudioContext) {
    super(ctx, "shaper");
  }
}

export class FakeCompressor extends FakeNode implements CompressorNodeLike {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
  constructor(ctx: FakeAudioContext) {
    super(ctx, "compressor");
  }
}

export class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  readonly sampleRate = 8000;
  state: "suspended" | "running" | "closed" = "suspended";
  readonly nodes: FakeNode[] = [];
  /** Sources in the order start() was called. */
  readonly started: FakeSource[] = [];
  readonly destination: FakeNode;

  constructor(options: { running?: boolean } = {}) {
    this.destination = new FakeNode(this, "destination");
    if (options.running) this.state = "running";
  }
  advance(seconds: number) {
    this.currentTime += seconds;
  }
  createGain() {
    return new FakeGain(this);
  }
  createOscillator() {
    return new FakeOscillator(this);
  }
  createBufferSource() {
    return new FakeBufferSource(this);
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(length, sampleRate);
  }
  createBiquadFilter() {
    return new FakeFilter(this);
  }
  createWaveShaper() {
    return new FakeShaper(this);
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this);
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array) {
    return { real, imag };
  }
  resume() {
    if (this.state !== "closed") this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    if (this.state !== "closed") this.state = "suspended";
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

/** Manual timers for the music scheduler. */
export class FakeTimers {
  intervals = new Map<number, { fn: () => void; ms: number }>();
  timeouts: { fn: () => void; ms: number }[] = [];
  private next = 1;
  setInterval(fn: () => void, ms: number) {
    const id = this.next++;
    this.intervals.set(id, { fn, ms });
    return id;
  }
  clearInterval(handle: unknown) {
    this.intervals.delete(handle as number);
  }
  setTimeout(fn: () => void, ms: number) {
    this.timeouts.push({ fn, ms });
    return this.timeouts.length;
  }
  /** Runs every interval callback once. */
  fire() {
    for (const { fn } of [...this.intervals.values()]) fn();
  }
}

export class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}
