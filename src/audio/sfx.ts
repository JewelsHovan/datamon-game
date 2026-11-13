// Sound design table (spec 010, R2 and R3): every effect, stinger and menu
// sound is a recipe (a list of layers, see engine.ts), and `routeEvent` maps
// each SimEvent to the effect and stingers it plays. Pure data and pure
// functions; the facade in index.ts does the scheduling.
import type { Envelope, FilterSpec, Layer, NoiseLayer, Recipe, ToneLayer, Wave } from "./engine";
import { fighterInfo } from "../data/fighters";
import { MOVES, type HitStrength, type MoveId } from "../data/moves";
import type { PlayerIndex, SimEvent, SimState } from "../sim/types";
import { midiToFreq } from "./engine";
import { noteToMidi } from "./patterns";

// --- Builders ------------------------------------------------------------------

const env = (a: number, d: number, s = 0, r = 0.02, hold = 0): Envelope => ({ a, d, s, r, hold });
const lp = (freq: number, to?: number, time?: number): FilterSpec =>
  to === undefined ? { type: "lowpass", freq } : { type: "lowpass", freq, to, time: time ?? 0.1 };
const hp = (freq: number): FilterSpec => ({ type: "highpass", freq });
const bp = (freq: number, q = 1, to?: number, time?: number): FilterSpec =>
  to === undefined ? { type: "bandpass", freq, q } : { type: "bandpass", freq, q, to, time: time ?? 0.1 };

function tone(wave: Wave, freq: number, e: Envelope, gain: number, extra: Partial<ToneLayer> = {}): ToneLayer {
  return { kind: "tone", wave, freq, env: e, gain, ...extra };
}
function noise(e: Envelope, gain: number, filter: FilterSpec, extra: Partial<NoiseLayer> = {}): NoiseLayer {
  return { kind: "noise", env: e, gain, filter, ...extra };
}
const delayed = (recipe: Recipe, delay: number): Layer[] => recipe.map((l) => ({ ...l, delay: (l.delay ?? 0) + delay }));

/**
 * A short melody as layers: space-separated tokens, one per `step` seconds;
 * note names (a4, c#5), "-" extends the previous note, "." rests.
 */
export function melody(wave: Wave, notes: string, step: number, gain: number, e: Envelope, extra: Partial<ToneLayer> = {}): ToneLayer[] {
  const out: ToneLayer[] = [];
  let last: ToneLayer | null = null;
  let lastSteps = 0;
  const finish = () => {
    if (last) last.env = { ...last.env, hold: Math.max(0, lastSteps * step - last.env.a - last.env.d) };
  };
  notes
    .trim()
    .split(/\s+/)
    .forEach((tok, i) => {
      if (tok === "-") {
        if (last) lastSteps++;
        return;
      }
      finish();
      last = null;
      if (tok === ".") return;
      last = tone(wave, midiToFreq(noteToMidi(tok)), { ...e }, gain, { ...extra, delay: (extra.delay ?? 0) + i * step });
      lastSteps = 1;
      out.push(last);
    });
  finish();
  return out;
}

// --- Effects (R2) ----------------------------------------------------------------

export const SFX = {
  whoosh_light: [noise(env(0.015, 0.07), 0.22, bp(900, 1.4, 3200, 0.08))],
  whoosh_heavy: [noise(env(0.03, 0.15, 0, 0.03), 0.3, bp(500, 1.1, 1900, 0.16)), noise(env(0.02, 0.12), 0.1, lp(400), { rate: 0.5 })],
  whoosh_special: [
    noise(env(0.02, 0.1), 0.16, bp(1200, 2, 4000, 0.1)),
    tone("pulse25", 220, env(0.005, 0.18, 0, 0.03), 0.07, { sweep: { to: 880, time: 0.18 }, filter: lp(2600) }),
  ],
  whoosh_throw: [noise(env(0.01, 0.06), 0.18, bp(600, 1.2, 1400, 0.06))],

  /** Light hit: bright snap, a mid square body dropping fast. About 0.1 s. */
  hit_light: [
    noise(env(0.001, 0.035), 0.4, hp(1800)),
    tone("square", 440, env(0.001, 0.075), 0.22, { sweep: { to: 150, time: 0.07 }, filter: lp(2400) }),
    tone("sine", 1400, env(0.001, 0.02), 0.12, { sweep: { to: 500, time: 0.02 } }),
  ],
  /** Heavy hit: darker transient, a low driven square body and a sub drop. About 0.27 s. */
  hit_heavy: [
    noise(env(0.001, 0.09), 0.5, lp(4200, 700, 0.09)),
    tone("square", 190, env(0.001, 0.22), 0.3, { sweep: { to: 52, time: 0.18 }, drive: 5, filter: lp(1500, 500, 0.2) }),
    tone("sine", 110, env(0.001, 0.26), 0.5, { sweep: { to: 38, time: 0.22 } }),
  ],
  /** Special hit (projectile burst): a medium hit plus a resonant zap and a sparkle. */
  hit_special: [
    noise(env(0.001, 0.06), 0.4, bp(2500, 0.8)),
    tone("square", 300, env(0.001, 0.14), 0.22, { sweep: { to: 90, time: 0.12 }, drive: 3, filter: lp(1800) }),
    tone("sawtooth", 1800, env(0.001, 0.16), 0.1, { sweep: { to: 220, time: 0.16 }, filter: bp(2200, 3, 600, 0.16) }),
    tone("pulse12", 1320, env(0.002, 0.22), 0.05, { sweep: { to: 1760, time: 0.22 }, filter: lp(4000) }),
  ],

  /** Blocks: inharmonic partials (ratios 1, 1.47, 2.09, 2.64) for a metallic clank. */
  block_light: [
    noise(env(0.001, 0.02), 0.22, hp(4000)),
    tone("square", 1180, env(0.001, 0.09), 0.06, { filter: lp(5000) }),
    tone("triangle", 1735, env(0.001, 0.14), 0.12),
    tone("triangle", 2466, env(0.001, 0.1), 0.07),
    tone("sine", 3115, env(0.001, 0.06), 0.04),
  ],
  block_heavy: [
    noise(env(0.001, 0.03), 0.28, hp(3000)),
    tone("sine", 140, env(0.001, 0.08), 0.25, { sweep: { to: 80, time: 0.08 } }),
    tone("square", 820, env(0.001, 0.16), 0.07, { filter: lp(4000) }),
    tone("triangle", 1205, env(0.001, 0.22), 0.13),
    tone("triangle", 1714, env(0.001, 0.16), 0.08),
    tone("sine", 2165, env(0.001, 0.1), 0.05),
  ],
  block_special: [
    noise(env(0.001, 0.02), 0.22, hp(4000)),
    tone("square", 1180, env(0.001, 0.09), 0.06, { filter: lp(5000) }),
    tone("triangle", 1735, env(0.001, 0.14), 0.12),
    tone("sawtooth", 1600, env(0.001, 0.1), 0.05, { sweep: { to: 400, time: 0.1 }, filter: bp(1800, 3, 500, 0.1) }),
  ],

  grab: [
    noise(env(0.002, 0.05), 0.25, bp(700, 0.9)),
    tone("sine", 160, env(0.001, 0.08), 0.35, { sweep: { to: 90, time: 0.08 } }),
    tone("triangle", 200, env(0.01, 0.2), 0.08, { sweep: { to: 400, time: 0.22 }, delay: 0.04 }),
  ],
  toss: [
    noise(env(0.04, 0.22, 0, 0.04), 0.32, bp(300, 1, 1500, 0.25)),
    tone("square", 140, env(0.002, 0.12), 0.14, { sweep: { to: 80, time: 0.12 }, drive: 2, filter: lp(900) }),
  ],
  knockdown: [
    tone("sine", 95, env(0.001, 0.3), 0.6, { sweep: { to: 34, time: 0.28 } }),
    noise(env(0.002, 0.22), 0.3, lp(500, 150, 0.22)),
    tone("triangle", 70, env(0.001, 0.12), 0.25, { sweep: { to: 40, time: 0.12 }, delay: 0.14 }),
    noise(env(0.002, 0.12), 0.12, lp(400), { delay: 0.14 }),
  ],
  /** Dash: a quick low scuff. */
  dash: [noise(env(0.004, 0.08), 0.2, bp(700, 1.2, 1600, 0.08)), noise(env(0.002, 0.04), 0.08, lp(500))],
  /** Context Switch: a falling zap out, a rising zap in. */
  teleport_out: [tone("pulse12", 1400, env(0.002, 0.14), 0.08, { sweep: { to: 300, time: 0.13 }, filter: lp(4000) }), noise(env(0.002, 0.08), 0.1, hp(3000))],
  teleport_in: [tone("pulse12", 300, env(0.002, 0.14), 0.08, { sweep: { to: 1400, time: 0.12 }, filter: lp(4000) }), noise(env(0.002, 0.06), 0.1, hp(3000))],
  /** A body slamming into the wall. */
  wall_bounce: [
    tone("sine", 110, env(0.001, 0.22), 0.55, { sweep: { to: 40, time: 0.2 } }),
    noise(env(0.001, 0.12), 0.35, bp(900, 0.8)),
    noise(env(0.002, 0.25), 0.1, hp(2500), { delay: 0.02 }),
  ],
  /** Armor absorbing a hit: a dull metal clank. */
  armor: [
    tone("square", 620, env(0.001, 0.16), 0.06, { filter: lp(3000) }),
    tone("square", 930, env(0.001, 0.12), 0.04, { filter: lp(3000) }),
    noise(env(0.001, 0.05), 0.25, bp(1800, 0.9)),
  ],
  /** Counter / parry absorb: crisp metallic ring + punchy low impact sweep. */
  counter: [
    noise(env(0.001, 0.025), 0.28, hp(3600)),
    tone("triangle", 1480, env(0.001, 0.24), 0.16),
    tone("triangle", 2210, env(0.001, 0.18), 0.1, { delay: 0.01 }),
    tone("sine", 190, env(0.001, 0.16), 0.42, { sweep: { to: 48, time: 0.15 } }),
    tone("square", 260, env(0.001, 0.1), 0.12, { sweep: { to: 75, time: 0.09 }, filter: lp(1600) }),
  ],
  /** Block push: a shove and a whoosh. */
  block_push: [noise(env(0.01, 0.14), 0.26, bp(500, 1, 1400, 0.12)), tone("sine", 160, env(0.001, 0.1), 0.3, { sweep: { to: 80, time: 0.1 } })],
  /** Get-up roll: a soft tumble. */
  roll: [noise(env(0.02, 0.2), 0.12, lp(700, 300, 0.2))],
  /** Taunt: two cheeky blips. */
  taunt: [tone("pulse25", 784, env(0.002, 0.06), 0.06, { filter: lp(3500) }), tone("pulse25", 1047, env(0.002, 0.09), 0.06, { delay: 0.1, filter: lp(3500) })],
  jump: [
    tone("triangle", 280, env(0.002, 0.09), 0.14, { sweep: { to: 560, time: 0.08 } }),
    noise(env(0.005, 0.04), 0.05, bp(1200)),
  ],
  land: [noise(env(0.002, 0.05), 0.12, lp(600)), tone("sine", 130, env(0.001, 0.06), 0.18, { sweep: { to: 70, time: 0.06 } })],
  projectile: [
    tone("pulse25", 260, env(0.003, 0.2), 0.1, { sweep: { to: 1040, time: 0.12 }, filter: lp(3500) }),
    noise(env(0.01, 0.18), 0.18, bp(600, 1.5, 2600, 0.18)),
    tone("sawtooth", 130, env(0.005, 0.25), 0.08, { sweep: { to: 260, time: 0.2 }, drive: 2, filter: lp(1200) }),
  ],
  /** Mine set: short armed-beacon chirp. */
  mine_set: [
    tone("pulse25", 660, env(0.001, 0.05), 0.09, { sweep: { to: 990, time: 0.045 }, filter: lp(4000) }),
    tone("pulse12", 1320, env(0.001, 0.08), 0.08, { delay: 0.055, filter: lp(4500) }),
    noise(env(0.001, 0.02), 0.1, bp(2400, 1.5)),
  ],
  /** Shockwave: low resonant ground pulse. */
  shockwave: [
    tone("sine", 130, env(0.002, 0.24), 0.48, { sweep: { to: 36, time: 0.22 } }),
    tone("sawtooth", 110, env(0.003, 0.22), 0.14, { sweep: { to: 45, time: 0.2 }, drive: 3, filter: lp(900, 220, 0.22) }),
    noise(env(0.002, 0.18), 0.26, bp(380, 1.8, 120, 0.18)),
  ],
  clash: [
    noise(env(0.001, 0.12), 0.4, bp(2200, 0.7)),
    tone("square", 1250, env(0.001, 0.25), 0.06, { filter: lp(5000) }),
    tone("square", 1770, env(0.001, 0.25), 0.05, { filter: lp(5000) }),
    tone("sine", 120, env(0.001, 0.2), 0.4, { sweep: { to: 50, time: 0.2 } }),
    tone("triangle", 2500, env(0.001, 0.4), 0.05, { sweep: { to: 1800, time: 0.4 } }),
  ],
  /** "MERGE CONFLICT!": a minor-second buzz under a doubled impact. */
  trade: [
    tone("square", 220, env(0.002, 0.18), 0.08, { drive: 2, filter: lp(1800) }),
    tone("square", 233, env(0.002, 0.18), 0.08, { drive: 2, filter: lp(1800) }),
    noise(env(0.001, 0.05), 0.3, hp(1500), { delay: 0.03 }),
    tone("sine", 300, env(0.001, 0.1), 0.3, { sweep: { to: 90, time: 0.1 }, delay: 0.03 }),
  ],
  /** Throw tech: a bright "ting". */
  tech: [
    noise(env(0.001, 0.015), 0.2, hp(5000)),
    tone("triangle", 1568, env(0.001, 0.25), 0.15),
    tone("triangle", 2349, env(0.001, 0.18), 0.08, { delay: 0.04 }),
    tone("sine", 3136, env(0.001, 0.1), 0.04, { delay: 0.04 }),
  ],
  /** K.O.: a big low driven hit, a falling pulse tone and a ring-out on A and E. */
  ko: [
    noise(env(0.001, 0.3), 0.6, lp(5000, 250, 0.3)),
    tone("square", 160, env(0.001, 0.5), 0.32, { sweep: { to: 38, time: 0.45 }, drive: 7, filter: lp(1600, 300, 0.5) }),
    tone("sine", 90, env(0.002, 0.9), 0.65, { sweep: { to: 28, time: 0.8 } }),
    tone("pulse25", 880, env(0.01, 0.2, 0.6, 0.4, 0.5), 0.08, { sweep: { to: 110, time: 1.1 }, filter: lp(2500), delay: 0.05 }),
    tone("triangle", 220, env(0.01, 0.3, 0.5, 1.2, 0.3), 0.12, { delay: 0.1 }),
    tone("triangle", 330, env(0.01, 0.3, 0.4, 1.0, 0.3), 0.07, { delay: 0.1 }),
    noise(env(0.05, 1.0), 0.05, { type: "highpass", freq: 3000, to: 1200, time: 1.0 }, { delay: 0.05 }),
  ],
} as const satisfies Record<string, Recipe>;

export type SfxName = keyof typeof SFX;

// --- Stingers (R3) -----------------------------------------------------------------

const LEAD_ENV = env(0.003, 0.06, 0.6, 0.08);
const SNARE: Recipe = [noise(env(0.001, 0.13), 0.3, bp(1900, 0.9))];
const KICK: Recipe = [tone("sine", 150, env(0.001, 0.16), 0.6, { sweep: { to: 42, time: 0.1 } })];
const CRASH: Recipe = [noise(env(0.002, 0.9), 0.1, hp(3500))];

/** "ROUND n": a rising E minor call, then one blip per round number (capped at 5). */
export function roundCall(round: number): Recipe {
  const blips = Math.max(1, Math.min(5, Math.floor(round) || 1));
  const layers: Layer[] = [
    ...SNARE,
    ...melody("pulse25", "e5 g5 b5 e6 - - - -", 0.07, 0.1, LEAD_ENV, { filter: lp(4200) }),
    ...melody("pulse12", "b4 e5 g5 b5 - - - -", 0.07, 0.05, LEAD_ENV, { filter: lp(3500) }),
    ...melody("triangle", "e3 - - - - - - -", 0.07, 0.3, env(0.005, 0.1, 0.7, 0.1)),
  ];
  for (let k = 0; k < blips; k++) layers.push(tone("pulse25", 988, env(0.002, 0.05, 0.4, 0.03, 0.02), 0.09, { delay: 0.62 + k * 0.13, filter: lp(4200) }));
  return layers;
}

export const STINGERS = {
  round: roundCall(1),
  /** "FIGHT!": a noise burst and kick under an A power-chord stab with a rising saw. */
  fight: [
    noise(env(0.001, 0.3), 0.42, bp(1400, 0.8, 500, 0.3)),
    tone("sine", 150, env(0.001, 0.25), 0.6, { sweep: { to: 40, time: 0.22 } }),
    tone("square", 220, env(0.003, 0.15, 0.5, 0.2, 0.1), 0.09, { drive: 2, filter: lp(2800) }),
    tone("square", 330, env(0.003, 0.15, 0.5, 0.2, 0.1), 0.07, { drive: 2, filter: lp(2800) }),
    tone("square", 440, env(0.003, 0.15, 0.5, 0.2, 0.1), 0.06, { filter: lp(3200) }),
    tone("sawtooth", 300, env(0.002, 0.18), 0.05, { sweep: { to: 1500, time: 0.15 }, filter: lp(3000) }),
  ],
  /** K.O. sting: a falling A minor arpeggio over a held low A. */
  ko: [
    ...CRASH,
    ...melody("pulse25", "a5 e5 c5 a4 - - - - - -", 0.1, 0.09, LEAD_ENV, { filter: lp(3800) }),
    ...melody("pulse12", "e5 c5 a4 e4 - - - - - -", 0.1, 0.04, LEAD_ENV, { filter: lp(3000) }),
    ...melody("triangle", "a2 - - - - - - - - -", 0.1, 0.32, env(0.005, 0.2, 0.7, 0.3)),
  ],
  /** Round win: a short C major fanfare. */
  round_win: [
    ...SNARE,
    ...KICK,
    ...melody("pulse25", "g4 c5 e5 g5 - e5 g5 - - - -", 0.075, 0.1, LEAD_ENV, { filter: lp(4200) }),
    ...melody("pulse12", "e4 g4 c5 e5 - c5 e5 - - - -", 0.075, 0.05, LEAD_ENV, { filter: lp(3500) }),
    ...melody("triangle", "c3 - - g2 - c3 - - - - -", 0.075, 0.3, env(0.005, 0.1, 0.7, 0.12)),
  ],
  /** Draw: an unresolved suspended phrase. */
  draw: [
    ...melody("pulse25", "e5 d5 - - - -", 0.1, 0.09, LEAD_ENV, { filter: lp(3800) }),
    ...melody("pulse12", "a4 g4 - - - -", 0.1, 0.05, LEAD_ENV, { filter: lp(3000) }),
    ...melody("triangle", "d3 - - - - -", 0.1, 0.3, env(0.005, 0.1, 0.7, 0.2)),
  ],
  /** Time up: two falling beeps. */
  time_up: [...melody("square", "a5 - . e5 - - -", 0.07, 0.08, env(0.002, 0.05, 0.6, 0.05), { filter: lp(3000) })],
  /** Match win: a longer fanfare that resolves on a crash. */
  match_win: [
    ...KICK,
    ...melody("pulse25", "c5 e5 g5 c6 - g5 c6 - b5 g5 b5 d6 - - c6 - - - - - -", 0.09, 0.1, LEAD_ENV, { filter: lp(4200) }),
    ...melody("pulse12", "g4 c5 e5 g5 - e5 g5 - g5 d5 g5 b5 - - g5 - - - - - -", 0.09, 0.05, LEAD_ENV, { filter: lp(3500) }),
    ...melody("triangle", "c3 - - - - - - - g2 - - - - - c3 - - - - - -", 0.09, 0.32, env(0.005, 0.1, 0.7, 0.25)),
    ...delayed(SNARE, 0.99),
    ...delayed(SNARE, 1.08),
    ...delayed(SNARE, 1.17),
    ...delayed(KICK, 1.26),
    ...delayed(CRASH, 1.26),
  ],
  /** Timer tick in the last 10 seconds, and a sharper one in the last 3. */
  tick: [tone("triangle", 1568, env(0.001, 0.03), 0.12), noise(env(0.001, 0.01, 0, 0.005), 0.06, hp(5000))],
  tick_final: [tone("square", 2093, env(0.001, 0.06), 0.06, { filter: lp(4500) }), tone("triangle", 1047, env(0.001, 0.06), 0.1)],
} as const satisfies Record<string, Recipe>;

export type StingerName = keyof typeof STINGERS;

/** The recipe for a stinger; "round" takes the round number. */
export function stingerRecipe(name: StingerName, arg?: number): Recipe {
  if (name === "round" && arg !== undefined) return roundCall(arg);
  return STINGERS[name];
}

// --- Menu sounds (R3) ----------------------------------------------------------------

export type UiSound = "move" | "confirm" | "back";

export const UI_SOUNDS: Readonly<Record<UiSound, Recipe>> = {
  move: [tone("pulse25", 1047, env(0.001, 0.035), 0.07, { filter: lp(4000) })],
  confirm: [
    tone("pulse25", 1047, env(0.001, 0.05, 0.5, 0.02, 0.02), 0.08, { filter: lp(4500) }),
    tone("pulse25", 1568, env(0.001, 0.09), 0.08, { delay: 0.06, filter: lp(4500) }),
  ],
  back: [tone("triangle", 784, env(0.001, 0.05), 0.14), tone("triangle", 523, env(0.001, 0.08), 0.14, { delay: 0.06 })],
};

// --- Routing ---------------------------------------------------------------------------

export interface StingerCue {
  name: StingerName;
  /** Seconds after the event. */
  delay: number;
  arg?: number;
}

export interface Duck {
  delay: number;
  /** Music gain while ducked (1 = no duck). */
  depth: number;
  hold: number;
  release: number;
}

export interface Route {
  sfx: SfxName | null;
  /** Pitch multiplier for the effect (combo hits climb a little). */
  pitch: number;
  stingers: readonly StingerCue[];
  duck: Duck | null;
}

/**
 * Seconds from round_end to the round win jingle. A K.O. runs the sim at a
 * quarter rate for 30 render frames, so the victory pose (70 sim frames in)
 * lands about 1.55 s later; a time-out has no slow motion.
 */
export const ROUND_WIN_DELAY = { ko: 1.6, time: 1.15 } as const;
export const KO_STING_DELAY = 0.45;

const NONE: readonly StingerCue[] = [];

function whooshFor(move: MoveId): SfxName {
  if (move === "throw" || MOVES[move]?.commandGrabTick !== undefined) return "whoosh_throw";
  const strength: HitStrength = MOVES[move]?.strength ?? "light";
  if (strength === "special") return "whoosh_special";
  return strength === "heavy" ? "whoosh_heavy" : "whoosh_light";
}

function fighterPitch(state: SimState | undefined, player: PlayerIndex): number {
  const slug = state?.fighters[player]?.slug;
  return slug ? fighterInfo(slug).sfxPitch : 1;
}

const route = (sfx: SfxName | null, extra: Partial<Route> = {}): Route => ({ sfx, pitch: 1, stingers: NONE, duck: null, ...extra });

/** What a sim event sounds like. Pure. */
export function routeEvent(e: SimEvent, state?: SimState): Route {
  switch (e.type) {
    case "jump":
      return route("jump");
    case "land":
      return route("land");
    case "attack":
      return route(whooshFor(e.move), { pitch: fighterPitch(state, e.player) });
    case "hit": {
      if (e.move === "throw") return route("toss");
      const pitch = 1 + 0.025 * Math.min(4, Math.max(0, e.combo - 1));
      return route(e.strength === "heavy" ? "hit_heavy" : e.strength === "special" ? "hit_special" : "hit_light", { pitch });
    }
    case "block":
      return route(e.strength === "heavy" ? "block_heavy" : e.strength === "special" ? "block_special" : "block_light");
    case "trade":
      return route("trade");
    case "throw":
      return route("grab");
    case "tech":
      return route("tech");
    case "knockdown":
      return route("knockdown");
    case "projectile":
      return e.kind === "slow_mine"
        ? route("mine_set")
        : e.kind === "shockwave"
          ? route("shockwave")
          : e.kind === "fast_packet"
            ? route("projectile", { pitch: 1.22 })
            : e.kind === "arc_burst"
              ? route("projectile", { pitch: 1.12 })
              : route("projectile");
    case "clash":
      return route("clash");
    case "ko":
      return route("ko", {
        stingers: [{ name: "ko", delay: KO_STING_DELAY }],
        duck: { delay: 0, depth: 0.15, hold: 2.2, release: 0.8 },
      });
    case "round_start":
      return route(null, { stingers: [{ name: "round", delay: 0, arg: e.round }], duck: { delay: 0, depth: 0.5, hold: 0.7, release: 0.4 } });
    case "fight":
      return route(null, { stingers: [{ name: "fight", delay: 0 }], duck: { delay: 0, depth: 0.45, hold: 0.4, release: 0.4 } });
    case "round_end": {
      if (e.winner === -1) return route(null);
      const at = ROUND_WIN_DELAY[e.reason];
      const cues: StingerCue[] = [];
      if (e.reason === "time") cues.push({ name: "time_up", delay: 0 });
      cues.push({ name: e.winner === 2 ? "draw" : "round_win", delay: at });
      return route(null, { stingers: cues, duck: { delay: at, depth: 0.35, hold: 0.9, release: 0.5 } });
    }
    case "match_end":
      return route(null, { stingers: [{ name: "match_win", delay: 0.1 }], duck: { delay: 0.1, depth: 0.25, hold: 2.2, release: 0.8 } });
    case "dash":
      return route("dash");
    case "teleport":
      return route(e.phase === "out" ? "teleport_out" : "teleport_in");
    case "wall_bounce":
      return route("wall_bounce");
    case "armor":
      return route("armor");
    case "counter":
      return route("counter");
    case "block_push":
      return route("block_push");
    case "roll":
      return route("roll");
    case "taunt":
      return route("taunt", { pitch: fighterPitch(state, e.player) });
  }
}
