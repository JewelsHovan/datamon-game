// Dev page for spec 010 (audio-test.html, Vite dev only): one button per
// effect, stinger, menu sound and music loop, all through the public facade.
// window.__audioTest exposes the actions and stats for the headless check.
import type { HitStrength, MoveId } from "../data/moves";
import type { SimEvent } from "../sim/types";
import { bindAudioControls, createAudio, type GameAudio, type VolumeChannel } from "./index";

interface Action {
  id: string;
  label: string;
  run: () => void;
  primary?: boolean;
}

declare global {
  interface Window {
    __audioTest?: { audio: GameAudio; actions: string[]; run(id: string): void };
  }
}

const audio = createAudio();
bindAudioControls(window, audio);

const fire = (...events: SimEvent[]) => () => audio.onEvents(events);
const hit = (move: MoveId, strength: HitStrength, combo = 1): SimEvent => ({ type: "hit", player: 0, target: 1, move, strength, x: 64000, y: 30000, damage: 50, combo });
const block = (move: MoveId, strength: HitStrength): SimEvent => ({ type: "block", player: 0, target: 1, move, strength, x: 64000, y: 30000 });
const attack = (move: MoveId): SimEvent => ({ type: "attack", player: 0, move });
const at = (ms: number, fn: () => void) => window.setTimeout(fn, ms);

let countdown: number | null = null;
function timerCountdown(): void {
  if (countdown !== null) window.clearInterval(countdown);
  let timer = 11 * 60;
  countdown = window.setInterval(() => {
    timer -= 1;
    if (timer <= 0) {
      audio.onEvents([{ type: "round_end", winner: 0, reason: "time" }], { phase: "ko", timer: 0, training: false });
      if (countdown !== null) window.clearInterval(countdown);
      countdown = null;
      return;
    }
    audio.onEvents([], { phase: "fight", timer, training: false });
  }, 1000 / 60);
}

function fullRound(): void {
  audio.music("fight");
  audio.onEvents([{ type: "round_start", round: 3 }]);
  at(1000, fire({ type: "fight" }));
  at(1700, fire(attack("light_punch")));
  at(1800, fire(hit("light_punch", "light", 1)));
  at(1950, fire(attack("heavy_punch")));
  at(2080, fire(hit("heavy_punch", "heavy", 2)));
  at(2300, fire(attack("special")));
  at(2560, fire({ type: "projectile", player: 0, x: 0, y: 0 }));
  at(3000, fire(block("special", "special")));
  at(3500, fire({ type: "jump", player: 1, dir: 1 }));
  at(4100, fire({ type: "land", player: 1 }));
  at(4400, fire(attack("heavy_kick")));
  at(4560, fire(hit("heavy_kick", "heavy", 1), { type: "ko", player: 1, x: 0, y: 0 }, { type: "round_end", winner: 0, reason: "ko" }));
  at(5200, fire({ type: "knockdown", player: 1, x: 0, y: 0 }));
  at(7600, fire({ type: "match_end", winner: 0 }));
}

const groups: [string, Action[]][] = [
  [
    "Engine",
    [
      { id: "start", label: "Start audio", run: () => audio.resume(), primary: true },
      { id: "mute", label: "Mute / unmute (M)", run: () => audio.toggleMute() },
    ],
  ],
  [
    "Music",
    [
      { id: "music-select", label: "Select loop", run: () => audio.music("select") },
      { id: "music-fight", label: "Fight loop", run: () => audio.music("fight") },
      { id: "music-stop", label: "Stop", run: () => audio.music(null) },
    ],
  ],
  [
    "Swings (attack)",
    [
      { id: "swing-light", label: "Light", run: fire(attack("light_punch")) },
      { id: "swing-heavy", label: "Heavy", run: fire(attack("heavy_kick")) },
      { id: "swing-special", label: "Special", run: fire(attack("special")) },
      { id: "swing-throw", label: "Throw whiff", run: fire(attack("throw")) },
    ],
  ],
  [
    "Hits",
    [
      { id: "hit-light", label: "Light", run: fire(hit("light_punch", "light")) },
      { id: "hit-heavy", label: "Heavy", run: fire(hit("heavy_kick", "heavy")) },
      { id: "hit-special", label: "Special / burst", run: fire(hit("special", "special")) },
      {
        id: "hit-combo",
        label: "Combo x4",
        run: () => [1, 2, 3, 4].forEach((n, i) => at(i * 140, fire(hit(n < 4 ? "light_punch" : "heavy_punch", n < 4 ? "light" : "heavy", n)))),
      },
    ],
  ],
  [
    "Blocks",
    [
      { id: "block-light", label: "Light", run: fire(block("light_punch", "light")) },
      { id: "block-heavy", label: "Heavy", run: fire(block("heavy_kick", "heavy")) },
      { id: "block-special", label: "Special (chip)", run: fire(block("special", "special")) },
    ],
  ],
  [
    "Throws and moves",
    [
      { id: "grab", label: "Throw grab", run: fire({ type: "throw", player: 0, target: 1 }) },
      { id: "toss", label: "Throw toss", run: fire(hit("throw", "heavy")) },
      { id: "knockdown", label: "Knockdown", run: fire({ type: "knockdown", player: 1, x: 0, y: 0 }) },
      { id: "tech", label: "Tech", run: fire({ type: "tech", x: 0, y: 0 }) },
      { id: "jump", label: "Jump", run: fire({ type: "jump", player: 0, dir: 0 }) },
      { id: "land", label: "Land", run: fire({ type: "land", player: 0 }) },
    ],
  ],
  [
    "Projectiles",
    [
      { id: "projectile", label: "Launch", run: fire({ type: "projectile", player: 0, x: 0, y: 0 }) },
      { id: "clash", label: "Clash", run: fire({ type: "clash", x: 0, y: 0 }) },
      { id: "trade", label: "Trade", run: fire({ type: "trade", x: 0, y: 0 }) },
    ],
  ],
  [
    "K.O. and stingers",
    [
      { id: "ko", label: "K.O.", run: fire({ type: "ko", player: 1, x: 0, y: 0 }) },
      { id: "round-1", label: "Round 1", run: fire({ type: "round_start", round: 1 }) },
      { id: "round-3", label: "Round 3", run: fire({ type: "round_start", round: 3 }) },
      { id: "fight", label: "FIGHT!", run: fire({ type: "fight" }) },
      { id: "round-win", label: "Round win", run: fire({ type: "round_end", winner: 0, reason: "ko" }) },
      { id: "time-win", label: "Time up + win", run: fire({ type: "round_end", winner: 1, reason: "time" }) },
      { id: "draw", label: "Draw", run: fire({ type: "round_end", winner: 2, reason: "time" }) },
      { id: "match-win", label: "Match win", run: fire({ type: "match_end", winner: 0 }) },
      { id: "countdown", label: "Timer 10..0", run: timerCountdown },
    ],
  ],
  [
    "Menu",
    [
      { id: "ui-move", label: "Move", run: () => audio.ui("move") },
      { id: "ui-confirm", label: "Confirm", run: () => audio.ui("confirm") },
      { id: "ui-back", label: "Back", run: () => audio.ui("back") },
    ],
  ],
  [
    "Stress",
    [
      { id: "stack", label: "12 heavy hits at once", run: fire(...Array.from({ length: 12 }, () => hit("heavy_kick", "heavy"))) },
      { id: "full-round", label: "Full round", run: fullRound },
    ],
  ],
];

const actions = new Map<string, Action>();
const root = document.getElementById("groups")!;
for (const [title, list] of groups) {
  const section = document.createElement("section");
  const h = document.createElement("h2");
  h.textContent = title;
  const row = document.createElement("div");
  row.className = "buttons";
  for (const a of list) {
    actions.set(a.id, a);
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = a.label;
    b.dataset.action = a.id;
    if (a.primary) b.className = "primary";
    b.addEventListener("click", () => a.run());
    row.append(b);
  }
  section.append(h, row);
  if (title === "Engine") {
    for (const ch of ["master", "music", "sfx"] as VolumeChannel[]) {
      const label = document.createElement("label");
      const name = document.createElement("span");
      name.textContent = ch;
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.value = String(Math.round(audio.getVolume(ch) * 100));
      input.dataset.volume = ch;
      const value = document.createElement("span");
      value.textContent = input.value;
      input.addEventListener("input", () => {
        audio.setVolume(ch, Number(input.value) / 100);
        value.textContent = input.value;
      });
      label.append(name, input, value);
      section.append(label);
    }
  }
  root.append(section);
}

const status = document.getElementById("status")!;
function render(): void {
  const s = audio.stats();
  const bar = Math.floor(s.musicSteps / 16) + 1;
  status.className = s.muted ? "muted" : s.status === "running" ? "running" : "";
  status.textContent =
    `audio: ${s.status}${s.muted ? " (muted)" : ""}   clock ${s.time.toFixed(2)} s   voices sfx ${s.voices.sfx} / music ${s.voices.music}\n` +
    `music: ${s.track ?? "off"}${s.track ? `   bar ${bar}   steps ${s.musicSteps}   resyncs ${s.resyncs}` : ""}   ` +
    `started ${s.started}   late ${s.late}   dropped ${s.dropped}`;
}
window.setInterval(render, 100);
render();

window.__audioTest = {
  audio,
  actions: [...actions.keys()],
  run(id: string) {
    const a = actions.get(id);
    if (!a) throw new Error(`no action ${id}`);
    a.run();
  },
};
