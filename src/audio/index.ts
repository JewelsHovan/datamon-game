// Game audio facade (spec 010, R5 and R6). The scenes talk only to this file.
//
// - createAudio() is cheap and touches no browser API: the AudioContext is
//   built on the first resume() (call it from a user gesture; bindAudioControls
//   does that for you), so browsers never block or warn.
// - Every public method is guarded: no AudioContext, a constructor that throws,
//   a suspended or closed context, or blocked storage leave a silent engine
//   that never throws into the game.
// - Presentation only (docs/game-design.md, loop rule 7): it reads events and
//   the round clock and never writes back.
import type { RoundState, SimEvent, SimState } from "../sim/types";
import { AudioEngine, clamp01, makeRandom, type AudioContextLike } from "./engine";
import { DEFAULT_TIMERS, MusicPlayer, type Timers } from "./music";
import type { MusicTrack } from "./patterns";
import { routeEvent, SFX, stingerRecipe, UI_SOUNDS, type UiSound } from "./sfx";

export type { MusicTrack } from "./patterns";
export type { UiSound } from "./sfx";

export type VolumeChannel = "master" | "music" | "sfx";
export type AudioStatus = "idle" | "running" | "suspended" | "failed" | "disposed";

/** The part of the round state the timer tick reads. */
export type RoundClock = Pick<RoundState, "phase" | "timer" | "training">;

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Readonly<AudioSettings> = Object.freeze({ master: 0.8, music: 0.7, sfx: 0.9, muted: false });
export const STORAGE_KEY = "datamon.audio";

/** Seconds left at which the timer starts ticking, and at which ticks turn sharper. */
export const TICK_FROM = 10;
export const TICK_FINAL_FROM = 3;

export interface AudioStats {
  status: AudioStatus;
  muted: boolean;
  /** Audio clock in seconds (0 before the context exists). */
  time: number;
  voices: { sfx: number; music: number };
  /** Voices started since the context was created. */
  started: number;
  /** Music voices scheduled behind the clock (should stay 0). */
  late: number;
  dropped: number;
  track: MusicTrack | null;
  /** Music steps scheduled since the track started, and the grid resyncs after late ticks. */
  musicSteps: number;
  resyncs: number;
}

export interface GameAudio {
  /** Call after every sim step with that step's events (and the round or sim state, for the timer tick and fighter pitch). */
  onEvents(events: readonly SimEvent[], round?: RoundClock | SimState, state?: SimState): void;
  ui(kind: UiSound): void;
  /** Switches the music loop (null stops it). Remembered until the context exists. */
  music(track: MusicTrack | null): void;
  /** Creates (first call) and resumes the AudioContext. Call from a user gesture. */
  resume(): void;
  setMuted(muted: boolean): void;
  /** Flips mute and returns the new state. */
  toggleMute(): boolean;
  readonly muted: boolean;
  getVolume(channel: VolumeChannel): number;
  setVolume(channel: VolumeChannel, value: number): void;
  /** Suspends the context while the page is hidden; resumes it when shown again. */
  setHidden(hidden: boolean): void;
  readonly status: AudioStatus;
  stats(): AudioStats;
  /** Dev and test access to the engine and music player (null until resume()). */
  internals(): { engine: AudioEngine | null; player: MusicPlayer | null };
  dispose(): void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AudioOptions {
  /** Builds the context; defaults to the browser's AudioContext. May throw. */
  createContext?: () => AudioContextLike;
  /** Settings storage; defaults to localStorage when reachable. null disables persistence. */
  storage?: StorageLike | null;
  timers?: Timers;
  random?: () => number;
}

type AudioContextCtor = new () => AudioContextLike;

function browserContext(): AudioContextLike {
  const g = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) throw new Error("WebAudio is not available");
  return new Ctor();
}

function defaultStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(storage: StorageLike | null): AudioSettings {
  const out: AudioSettings = { ...DEFAULT_SETTINGS };
  if (!storage) return out;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return out;
    const data = JSON.parse(raw) as Partial<Record<keyof AudioSettings, unknown>>;
    for (const k of ["master", "music", "sfx"] as const) {
      const v = data[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = clamp01(v);
    }
    if (typeof data.muted === "boolean") out.muted = data.muted;
  } catch {
    // unreadable or blocked storage: defaults
  }
  return out;
}

export function saveSettings(storage: StorageLike | null, settings: AudioSettings): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // quota or privacy mode: settings just do not persist
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // Audio must never break the game.
  }
}

function isSimState(value: RoundClock | SimState): value is SimState {
  return "fighters" in value;
}

export function createAudio(options: AudioOptions = {}): GameAudio {
  const createContext = options.createContext ?? browserContext;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const timers = options.timers ?? DEFAULT_TIMERS;
  const random = options.random ?? makeRandom();
  const settings = loadSettings(storage);

  let engine: AudioEngine | null = null;
  let player: MusicPlayer | null = null;
  let failed = false;
  let disposed = false;
  let hiddenSuspend = false;
  let wantedTrack: MusicTrack | null = null;
  let lastSecond = -1;

  const levels = () => ({ master: settings.master, music: settings.music, sfx: settings.sfx });

  function ensure(): AudioEngine | null {
    if (engine || failed || disposed) return engine;
    try {
      const ctx = createContext();
      engine = new AudioEngine(ctx, levels(), settings.muted, random);
      player = new MusicPlayer(engine, timers);
      player.silent = settings.muted;
      if (wantedTrack) player.play(wantedTrack);
    } catch {
      failed = true;
      engine = null;
      player = null;
    }
    return engine;
  }

  /** The engine, when sound can be scheduled right now. */
  function live(): AudioEngine | null {
    if (!engine || disposed || settings.muted) return null;
    return engine.ctx.state === "running" ? engine : null;
  }

  function status(): AudioStatus {
    if (disposed) return "disposed";
    if (failed) return "failed";
    if (!engine) return "idle";
    return engine.ctx.state === "running" ? "running" : "suspended";
  }

  function applyMute(): void {
    if (engine) engine.applyLevels(levels(), settings.muted);
    if (player) player.silent = settings.muted;
  }

  function timerTick(e: AudioEngine | null, round: RoundClock): void {
    if (round.training || round.phase !== "fight") {
      lastSecond = -1;
      return;
    }
    const second = Math.ceil(round.timer / 60);
    if (second === lastSecond) return;
    lastSecond = second;
    if (!e || second < 1 || second > TICK_FROM) return;
    e.play(stingerRecipe(second <= TICK_FINAL_FROM ? "tick_final" : "tick"), e.now());
  }

  const audio: GameAudio = {
    onEvents(events, round, state) {
      safe(() => {
        const e = live();
        const simState = state ?? (round && isSimState(round) ? round : undefined);
        const clock = round ? (isSimState(round) ? round.round : round) : simState?.round;
        if (clock) timerTick(e, clock);
        if (!e || events.length === 0) return;
        const now = e.now();
        // The K.O. recipe carries its own impact, so the finishing hit stays quiet.
        const ko = events.some((ev) => ev.type === "ko");
        for (const ev of events) {
          if (ko && ev.type === "hit") continue;
          const r = routeEvent(ev, simState);
          if (r.sfx) e.play(SFX[r.sfx], now, { pitch: r.pitch * (0.97 + random() * 0.06) });
          for (const cue of r.stingers) e.play(stingerRecipe(cue.name, cue.arg), now + cue.delay);
          if (r.duck) e.duck(now + r.duck.delay, r.duck.depth, r.duck.hold, r.duck.release);
        }
      });
    },

    ui(kind) {
      safe(() => {
        const e = live();
        if (e) e.play(UI_SOUNDS[kind], e.now());
      });
    },

    music(track) {
      wantedTrack = track;
      safe(() => player?.play(track));
    },

    resume() {
      if (disposed) return;
      safe(() => {
        const e = ensure();
        if (!e || e.ctx.state === "running" || e.ctx.state === "closed") return;
        hiddenSuspend = false;
        e.ctx.resume().catch(() => undefined);
      });
    },

    setMuted(muted) {
      if (settings.muted === muted) return;
      settings.muted = muted;
      saveSettings(storage, settings);
      safe(applyMute);
    },

    toggleMute() {
      audio.setMuted(!settings.muted);
      return settings.muted;
    },

    get muted() {
      return settings.muted;
    },

    getVolume(channel) {
      return settings[channel];
    },

    setVolume(channel, value) {
      settings[channel] = clamp01(value);
      saveSettings(storage, settings);
      safe(applyMute);
    },

    setHidden(hidden) {
      safe(() => {
        const ctx = engine?.ctx;
        if (!ctx || disposed) return;
        if (hidden && ctx.state === "running") {
          hiddenSuspend = true;
          ctx.suspend().catch(() => undefined);
        } else if (!hidden && hiddenSuspend) {
          hiddenSuspend = false;
          ctx.resume().catch(() => undefined);
        }
      });
    },

    get status() {
      return status();
    },

    stats() {
      const seq = player?.sequencer;
      let voices = { sfx: 0, music: 0 };
      let time = 0;
      safe(() => {
        if (engine) {
          voices = { sfx: engine.activeVoices("sfx"), music: engine.activeVoices("music") };
          time = engine.now();
        }
      });
      return {
        status: status(),
        muted: settings.muted,
        time,
        voices,
        started: engine?.stats.started ?? 0,
        late: engine?.stats.late ?? 0,
        dropped: engine?.stats.dropped ?? 0,
        track: player?.playing ?? null,
        musicSteps: seq?.scheduled ?? 0,
        resyncs: seq?.resyncs ?? 0,
      };
    },

    internals() {
      return { engine, player };
    },

    dispose() {
      if (disposed) return;
      safe(() => player?.dispose());
      const ctx = engine?.ctx;
      disposed = true;
      if (ctx) safe(() => void ctx.close().catch(() => undefined));
    },
  };
  return audio;
}

// --- Browser wiring ------------------------------------------------------------------

export interface ControlTarget {
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions): void;
}

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface AudioControlOptions {
  /** KeyboardEvent.code that toggles mute (default "KeyM"); null disables it. */
  muteKey?: string | null;
  /** Return true to leave a key alone (for example while the controls screen captures a binding). */
  ignoreKey?: (event: KeyboardEvent) => boolean;
  /** Page visibility; defaults to `target.document` when the target is a window. */
  visibility?: VisibilitySource | null;
}

/**
 * Wires the browser side: the first pointer or key input resumes audio (capture
 * phase, so it runs before scene handlers), M toggles mute, and a hidden tab
 * suspends the context. Returns an unbind function.
 */
export function bindAudioControls(target: ControlTarget, audio: GameAudio, options: AudioControlOptions = {}): () => void {
  const muteKey = options.muteKey === undefined ? "KeyM" : options.muteKey;
  const visibility =
    options.visibility === undefined ? ((target as { document?: VisibilitySource }).document ?? null) : options.visibility;

  const onPointer = () => audio.resume();
  const onKey = (event: Event) => {
    audio.resume();
    const e = event as KeyboardEvent;
    if (muteKey === null || e.code !== muteKey || e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (options.ignoreKey?.(e)) return;
    audio.toggleMute();
  };
  const onVisibility = () => {
    if (visibility) audio.setHidden(visibility.hidden);
  };

  target.addEventListener("pointerdown", onPointer, { capture: true });
  target.addEventListener("touchstart", onPointer, { capture: true, passive: true });
  target.addEventListener("keydown", onKey, { capture: true });
  visibility?.addEventListener("visibilitychange", onVisibility);
  return () => {
    target.removeEventListener("pointerdown", onPointer, { capture: true });
    target.removeEventListener("touchstart", onPointer, { capture: true });
    target.removeEventListener("keydown", onKey, { capture: true });
    visibility?.removeEventListener("visibilitychange", onVisibility);
  };
}
