// Screen-reader layer (spec 014, R5). To assistive tech the canvas is one
// image, so this module gives it a label naming the game and the current
// screen, and feeds a polite live region with screen changes and the big
// fight moments: the round number, FIGHT, K.O., the round and match winners,
// pause and resume. Never single hits. Messages are throttled (one at a time,
// at least GAP_MS apart, a short queue where the newest screen change wins),
// so the region never floods.
//
// Presentation only (docs/game-design.md, loop rule 7): it reads scene changes
// and sim events through the GameHooks and never writes back. The wording is
// pure functions; Announcer adds the throttle (clock and timer injected); the
// DOM binding at the bottom touches the page.
import { getPerson } from "../data/catalog";
import type { GameMode, SceneName } from "../scenes/manager";
import type { PlayerIndex, SimEvent, SimState } from "../sim/types";

export const GAME_NAME = "Compass: Cardinal Clash";
/** Minimum time between two announcements. */
export const GAP_MS = 900;
/** Messages waiting beyond this are dropped, oldest first. */
export const MAX_QUEUE = 4;

const SCREENS: Readonly<Record<SceneName, string>> = {
  title: "title screen",
  select: "character select",
  versus: "versus",
  fight: "fight",
  pause: "paused",
  results: "results",
  controls: "controls",
};

const MODE_WORDS: Readonly<Record<GameMode, string>> = { cpu: "VS CPU", versus: "VS player", training: "training" };

/** The canvas's accessible name: the game and the screen, e.g. "Compass: Cardinal Clash, fight: Julien H. versus Felicia G.". */
export function canvasLabel(name: SceneName, mode: GameMode | null, detail?: string): string {
  let screen = SCREENS[name];
  if (name === "select" && mode) screen = `${MODE_WORDS[mode]} ${screen}`;
  return `${GAME_NAME}, ${screen}${detail ? `: ${detail}` : ""}`;
}

/** Ends a sentence with a period unless it already ends with punctuation ("Felicia G."). */
function sentence(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** What the live region says when the screen changes from `prev` to `name` (null: nothing). */
export function sceneMessage(name: SceneName, prev: SceneName | null, mode: GameMode | null, detail?: string): string | null {
  switch (name) {
    case "title":
      return "Title screen.";
    case "select":
      return mode ? `${MODE_WORDS[mode]}: character select.` : "Character select.";
    case "versus":
      return detail ? sentence(detail) : null;
    case "fight":
      // From the versus splash the round announcements follow on their own.
      if (prev === "pause") return "Resumed.";
      if (prev === "results") return "Rematch.";
      return null;
    case "pause":
      return prev === "controls" ? null : "Paused.";
    case "results":
      return detail ? sentence(`Results: ${detail}`) : "Results.";
    case "controls":
      return "Controls.";
  }
}

/** How a player is named: by fighter, or by side in a mirror match; the CPU says so. */
export function playerWords(player: PlayerIndex, names: readonly [string, string], cpu: boolean): string {
  if (names[0] !== names[1]) return names[player];
  if (player === 1 && cpu) return "the CPU";
  return `player ${player + 1}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The announcements for one sim step's events (most steps: none). */
export function eventMessages(events: readonly SimEvent[], state: SimState, names: readonly [string, string], cpu: boolean): string[] {
  const out: string[] = [];
  const who = (p: PlayerIndex) => playerWords(p, names, cpu);
  for (const e of events) {
    switch (e.type) {
      case "round_start":
        out.push(state.round.training ? "Training." : `Round ${e.round}.`);
        break;
      case "fight":
        out.push("Fight!");
        break;
      case "ko":
        out.push("K.O.!");
        break;
      case "round_end": {
        const round = state.round.number;
        const time = e.reason === "time" ? "Time! " : "";
        if (e.winner === 0 || e.winner === 1) out.push(`${time}${capitalize(who(e.winner))} wins round ${round}.`);
        else if (e.winner === 2) out.push(`${time}Round ${round} is a draw.`);
        break;
      }
      case "match_end": {
        const [a, b] = state.round.wins;
        out.push(`${capitalize(who(e.winner))} wins the match, ${Math.max(a, b)} to ${Math.min(a, b)}!`);
        break;
      }
      default:
        break; // hits, blocks, jumps...: not announced
    }
  }
  return out;
}

export interface AnnouncerSink {
  /** Sets the canvas's accessible name. */
  label(text: string): void;
  /** Puts a message in the live region. */
  say(text: string): void;
}

export interface AnnouncerTimers {
  now(): number;
  later(fn: () => void, ms: number): unknown;
}

interface Pending {
  text: string;
  kind: "scene" | "event";
}

export class Announcer {
  private readonly queue: Pending[] = [];
  private lastSaid = -Infinity;
  private waiting = false;
  private prev: SceneName | null = null;
  private mode: GameMode | null = null;
  /** Every message said so far (newest last, capped), for tests and browser checks. */
  readonly said: string[] = [];

  constructor(
    private readonly sink: AnnouncerSink,
    private readonly timers: AnnouncerTimers,
    private readonly gapMs = GAP_MS,
  ) {}

  /** GameHooks.scene: relabel the canvas at once and announce the new screen. */
  scene(name: SceneName, mode: GameMode | null, detail?: string): void {
    this.sink.label(canvasLabel(name, mode, detail));
    const message = sceneMessage(name, this.prev, mode, detail);
    this.prev = name;
    this.mode = mode;
    if (message) this.push(message, "scene");
  }

  /** GameHooks.simEvents: the fight's big moments. */
  simEvents(events: readonly SimEvent[], state: SimState): void {
    if (events.length === 0) return;
    const names = state.fighters.map((f) => getPerson(f.slug)?.shortName ?? f.slug) as [string, string];
    for (const text of eventMessages(events, state, names, this.mode === "cpu")) this.push(text, "event");
  }

  /** Queues a message; it is said now if the last one is old enough, else after the gap. */
  push(text: string, kind: Pending["kind"] = "event"): void {
    // Only the newest screen change matters (fast pause/resume toggles say one thing).
    if (kind === "scene") for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i]!.kind === "scene") this.queue.splice(i, 1);
    if (this.queue.at(-1)?.text === text) return;
    this.queue.push({ text, kind });
    while (this.queue.length > MAX_QUEUE) this.queue.shift();
    this.pump();
  }

  get pending(): readonly string[] {
    return this.queue.map((p) => p.text);
  }

  private pump(): void {
    if (this.waiting || this.queue.length === 0) return;
    const wait = this.lastSaid + this.gapMs - this.timers.now();
    if (wait > 0) {
      this.waiting = true;
      this.timers.later(() => {
        this.waiting = false;
        this.pump();
      }, wait);
      return;
    }
    const next = this.queue.shift()!;
    this.lastSaid = this.timers.now();
    this.sink.say(next.text);
    this.said.push(next.text);
    if (this.said.length > 50) this.said.shift();
    if (this.queue.length > 0) this.pump();
  }
}

/**
 * The page side: `role="img"` and the label on the canvas, and a visually
 * hidden polite live region (role="status") appended to the body.
 */
export function createPageAnnouncer(doc: Document, canvas: HTMLElement): Announcer {
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", GAME_NAME);
  let region = doc.getElementById("announcer");
  if (!region) {
    region = doc.createElement("div");
    region.id = "announcer";
    region.className = "sr-only";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    doc.body.appendChild(region);
  }
  const live = region;
  const view = doc.defaultView;
  return new Announcer(
    {
      label: (text) => canvas.setAttribute("aria-label", text),
      // The same words twice in a row (Round 1 after a rematch) still change the text, so they are read again.
      say: (text) => {
        live.textContent = live.textContent === text ? `${text} ` : text;
      },
    },
    { now: () => view?.performance.now() ?? Date.now(), later: (fn, ms) => (view ?? globalThis).setTimeout(fn, ms) },
  );
}
