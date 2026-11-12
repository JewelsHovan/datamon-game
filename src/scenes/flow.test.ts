// Spec 005 R8: the scene flow driven by fake inputs, headless (no canvas, no
// assets): title -> select -> versus -> fight -> results -> rematch and back
// to select, pause, the controls screen, and VS CPU with each level.
import { describe, expect, it } from "vitest";
import type { CpuController, CpuLevel } from "../ai/cpu";
import { getPeople } from "../data/catalog";
import { ControlBindings } from "../input/bindings";
import { BUTTON_DOWN, BUTTON_KICK, BUTTON_LEFT, BUTTON_PUNCH, BUTTON_RIGHT, BUTTON_SPECIAL, BUTTON_START, BUTTON_UP } from "../input/bits";
import type { AtlasImage, ClipSet } from "../render/clips";
import type { InputPair, PlayerIndex, SimState } from "../sim/types";
import type { ControlsScene } from "./controls";
import { RESULTS_DELAY, type FightScene } from "./fight";
import { SceneManager, type GameServices } from "./manager";
import { detectPlayable, fighterInfo, infoFromModule } from "./roster";
import { READY_FRAMES, type SelectScene } from "./select";
import { VERSUS_FRAMES } from "./versus";

const P = BUTTON_PUNCH;
const K = BUTTON_KICK;

function fakeSet(slug: string): ClipSet {
  return { slug, source: "manifest", atlas: { width: 1, height: 1 } as unknown as AtlasImage, artFacing: 1, clips: {} };
}

interface Fakes {
  services: GameServices;
  heldKeys: Set<string>;
  ui: string[];
  scenes: string[];
  cpus: { level: CpuLevel; player: PlayerIndex; seed: number; calls: number[] }[];
}

function fakes(cpuBits = 0): Fakes {
  const heldKeys = new Set<string>();
  const ui: string[] = [];
  const scenes: string[] = [];
  const cpus: Fakes["cpus"] = [];
  const services: GameServices = {
    people: getPeople(),
    bindings: new ControlBindings(null),
    playable: () => new Set(["julien-hovan"]),
    loadFight: async (p1, p2) => ({ clipSets: [fakeSet(p1.slug), fakeSet(p2.slug)], effects: null, portraits: [null, null] }),
    hasPad: () => false,
    heldKeys: () => heldKeys,
    random: () => 0.5,
    newSeed: () => 7,
    createCpu(level, player, seed): CpuController {
      const rec = { level, player, seed, calls: [] as number[] };
      cpus.push(rec);
      return {
        level,
        decide(state: SimState) {
          rec.calls.push(state.frame);
          return cpuBits;
        },
      };
    },
    info: fighterInfo,
    art: null,
    hooks: { ui: (k) => ui.push(k), scene: (n) => scenes.push(n) },
  };
  return { services, heldKeys, ui, scenes, cpus };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

class Driver {
  readonly m: SceneManager;
  constructor(readonly f: Fakes) {
    this.m = new SceneManager(f.services);
    this.m.toTitle();
  }
  get scene(): string {
    return this.m.scene.name;
  }
  idle(n = 1, pair: InputPair = [0, 0]): void {
    for (let i = 0; i < n; i++) this.m.step(pair);
  }
  /** One player presses `bits` for a step, then releases. */
  press(player: 0 | 1, bits: number): void {
    this.m.step(player === 0 ? [bits, 0] : [0, bits]);
    this.m.step([0, 0]);
  }
  escape(): void {
    this.m.key("Escape");
    this.m.step([0, 0]);
  }
  get select(): SelectScene {
    expect(this.scene).toBe("select");
    return this.m.scene as SelectScene;
  }
  get fight(): FightScene {
    expect(this.scene).toBe("fight");
    return this.m.scene as FightScene;
  }
  /** From the title: the menu item `index` (VS CPU, VS PLAYER, TRAINING, CONTROLS). */
  titlePick(index: number): void {
    expect(this.scene).toBe("title");
    for (let i = 0; i < index; i++) this.press(0, BUTTON_DOWN);
    this.press(0, P);
  }
  /** Both locked: wait out the ready beat and the versus splash, let the assets resolve. */
  async throughVersus(): Promise<void> {
    this.idle(READY_FRAMES);
    expect(this.scene).toBe("versus");
    this.idle(VERSUS_FRAMES);
    await flush();
    this.idle(1);
    expect(this.scene).toBe("fight");
  }
  /** P1 walks in and heavy-kicks until the match is over and the results show. */
  fightToResults(): number {
    for (let t = 1; t < 40000; t++) {
      if (this.scene === "results") return t;
      const s = (this.m.scene as FightScene).state;
      const [a, b] = s.fighters;
      const forward = a.facing === 1 ? BUTTON_RIGHT : BUTTON_LEFT;
      let p1 = 0;
      if (a.state === "idle" || a.state === "walk_forward") p1 = Math.abs(b.x - a.x) > 7000 ? forward : t % 2 === 0 ? forward | K : 0;
      this.m.step([p1, 0]);
    }
    throw new Error("the match never ended");
  }
}

describe("scene flow (A5, R5)", () => {
  it("title -> select -> versus -> fight -> results -> rematch -> pause -> quit to select", async () => {
    const d = new Driver(fakes());
    expect(d.scene).toBe("title");
    d.titlePick(1); // VS PLAYER
    expect(d.select.mode).toBe("versus");

    // A dimmed "coming soon" tile cannot be picked: P2 moves onto Pentcho and presses Punch.
    expect(d.select.debug().under).toEqual(["julien-hovan", "julien-hovan"]);
    d.press(1, BUTTON_RIGHT);
    expect(d.select.debug().under).toEqual(["julien-hovan", "pentcho-tchomakov"]);
    d.press(1, P);
    expect(d.select.locked[1]).toBeNull();

    // P1 picks Julien; P2 goes to the random tile (up wraps to the last row, left wraps to its end).
    d.press(0, P);
    expect(d.select.locked[0]?.slug).toBe("julien-hovan");
    d.press(1, BUTTON_LEFT);
    d.press(1, BUTTON_UP);
    d.press(1, BUTTON_LEFT);
    expect(d.select.debug().under).toEqual(["julien-hovan", "random"]);
    d.press(1, P);
    expect(d.select.locked[1]?.slug).toBe("julien-hovan"); // random among playable fighters
    expect(d.select.stage).toBe("ready");

    await d.throughVersus();
    const first = d.fight;
    expect(first.match).toMatchObject({ mode: "versus", cpuLevel: null });
    expect(first.cpu).toEqual([null, null]);
    expect(first.state.round.phase).toBe("intro");

    d.fightToResults();
    expect(d.scene).toBe("results");
    expect(first.state.round.phase).toBe("matchover");
    expect(first.state.round.phaseFrame).toBeGreaterThanOrEqual(RESULTS_DELAY);
    expect(d.m.scene.debug?.()).toMatchObject({ winner: 0, item: "REMATCH" });

    // Rematch: a fresh match with the same fighters and the loaded assets.
    d.press(0, P);
    const rematch = d.fight;
    expect(rematch).not.toBe(first);
    expect(rematch.assets).toBe(first.assets);
    expect(rematch.state.round).toMatchObject({ phase: "intro", number: 1, wins: [0, 0] });

    // Pause, then quit to select: the cursors come back on the last picks.
    d.idle(10);
    d.escape();
    expect(d.scene).toBe("pause");
    const frozen = rematch.state.frame;
    d.idle(30);
    expect(rematch.state.frame).toBe(frozen);
    d.press(0, BUTTON_DOWN);
    d.press(0, BUTTON_DOWN);
    expect(d.m.scene.debug?.()).toMatchObject({ item: "QUIT TO SELECT" });
    d.press(0, P);
    expect(d.select.mode).toBe("versus");
    expect(d.select.locked).toEqual([null, null]);
    expect(d.select.debug().under).toEqual(["julien-hovan", "julien-hovan"]);
    expect(d.m.fight).toBeNull();
  });

  it("results -> character select", async () => {
    const d = new Driver(fakes());
    d.titlePick(1);
    d.press(0, P);
    d.press(1, P);
    await d.throughVersus();
    d.fightToResults();
    d.press(1, BUTTON_DOWN); // either player drives the results menu
    expect(d.m.scene.debug?.()).toMatchObject({ item: "CHARACTER SELECT" });
    d.press(1, BUTTON_START);
    expect(d.select.mode).toBe("versus");
  });

  it("pause: Esc or Start pauses, the menu resumes, controls returns to the pause menu", async () => {
    const d = new Driver(fakes());
    d.titlePick(1);
    d.press(0, P);
    d.press(1, P);
    await d.throughVersus();
    const fight = d.fight;
    d.press(1, BUTTON_START); // P2's Start pauses too
    expect(d.scene).toBe("pause");
    d.press(0, P); // RESUME
    expect(d.m.scene).toBe(fight);
    d.escape();
    expect(d.scene).toBe("pause");
    d.press(0, BUTTON_DOWN);
    d.press(0, P); // CONTROLS
    expect(d.scene).toBe("controls");
    d.escape();
    expect(d.scene).toBe("pause");
    d.escape(); // Esc resumes
    expect(d.m.scene).toBe(fight);
  });

  it("Esc on the select screen goes back to the title", () => {
    const d = new Driver(fakes());
    d.titlePick(2); // TRAINING
    expect(d.select.mode).toBe("training");
    d.escape();
    expect(d.scene).toBe("title");
  });

  it("training goes through select into a free training fight", async () => {
    const d = new Driver(fakes());
    d.titlePick(2);
    d.press(0, P);
    d.press(1, P);
    await d.throughVersus();
    expect(d.fight.state.round.training).toBe(true);
  });

  it("reports scene changes and menu sounds through the hooks (audio wiring)", () => {
    const f = fakes();
    const d = new Driver(f);
    d.press(0, BUTTON_DOWN);
    d.press(0, P);
    expect(f.scenes).toEqual(["title", "select"]);
    expect(f.ui).toEqual(["move", "confirm"]);
  });
});

describe("VS CPU (lead's scope addition)", () => {
  async function toCpuFight(level: CpuLevel, cpuBits = 0): Promise<{ d: Driver; f: Fakes }> {
    const f = fakes(cpuBits);
    const d = new Driver(f);
    d.titlePick(0); // VS CPU
    expect(d.select.mode).toBe("cpu");
    expect(d.select.stage).toBe("pick");
    d.press(1, P); // P2's keys do nothing in VS CPU
    expect(d.select.locked).toEqual([null, null]);
    d.press(0, P); // P1's fighter
    expect(d.select.stage).toBe("cpu");
    expect(d.select.debug().under).toEqual(["julien-hovan", "random"]); // random opponent by default
    d.press(0, P); // the CPU's fighter, with P1's controls
    expect(d.select.stage).toBe("level");
    expect(d.select.level).toBe("normal");
    if (level === "easy") d.press(0, BUTTON_LEFT);
    if (level === "hard") d.press(0, BUTTON_RIGHT);
    expect(d.select.level).toBe(level);
    d.press(0, P);
    expect(d.select.stage).toBe("ready");
    await d.throughVersus();
    return { d, f };
  }

  for (const level of ["easy", "normal", "hard"] as const) {
    it(`reaches a VS CPU fight at ${level}, with a CPU seeded from the match`, async () => {
      const { d, f } = await toCpuFight(level);
      const fight = d.fight;
      expect(fight.match).toMatchObject({ mode: "cpu", cpuLevel: level, seed: 7 });
      expect(fight.cpu[0]).toBeNull();
      expect(fight.cpu[1]?.level).toBe(level);
      expect(f.cpus.map(({ level: l, player, seed }) => ({ level: l, player, seed }))).toEqual([{ level, player: 1, seed: 7 }]);
    });
  }

  it("the CPU slot's input comes from decide(), not from P2's keys", async () => {
    const { d, f } = await toCpuFight("normal", BUTTON_DOWN);
    const fight = d.fight;
    // P2's keyboard holds up the whole time; the CPU says down.
    for (let t = 0; t < 140; t++) d.m.step([0, BUTTON_UP]);
    expect(fight.state.round.phase).toBe("fight");
    expect(fight.state.fighters[1].state).toBe("crouch");
    // decide() saw every pre-step state, one call per sim step.
    const calls = f.cpus[0]!.calls;
    expect(calls.length).toBe(140);
    expect(calls).toEqual(Array.from({ length: 140 }, (_, i) => i));
    // P1 is still the keyboard player.
    d.m.step([BUTTON_SPECIAL, BUTTON_UP]);
    expect(fight.state.fighters[0].move?.id).toBe("special");
  });

  it("P2's Start does not pause a VS CPU fight; P1's does", async () => {
    const { d } = await toCpuFight("easy");
    d.press(1, BUTTON_START);
    expect(d.scene).toBe("fight");
    d.press(0, BUTTON_START);
    expect(d.scene).toBe("pause");
  });

  it("Kick steps back: level -> CPU's fighter -> P1's fighter", () => {
    const d = new Driver(fakes());
    d.titlePick(0);
    d.press(0, P);
    d.press(0, P);
    expect(d.select.stage).toBe("level");
    d.press(0, K);
    expect(d.select.stage).toBe("cpu");
    expect(d.select.locked[1]).toBeNull();
    d.press(0, K);
    expect(d.select.stage).toBe("pick");
    expect(d.select.locked[0]).toBeNull();
  });
});

describe("controls screen (A3, R3)", () => {
  function toControls(f = fakes()): { d: Driver; c: () => ControlsScene } {
    const d = new Driver(f);
    d.titlePick(3);
    expect(d.scene).toBe("controls");
    return { d, c: () => d.m.scene as ControlsScene };
  }

  it("rebinding P1 Punch to P2's key swaps them; Esc goes back to the title", () => {
    const f = fakes();
    const { d, c } = toControls(f);
    for (let i = 0; i < 4; i++) d.press(0, BUTTON_DOWN); // UP, DOWN, LEFT, RIGHT, -> PUNCH
    expect(c().debug()).toMatchObject({ row: 4, col: 0 });
    d.press(0, P); // Punch does not start a rebind (it is part of the key test)
    expect(c().capturing).toBeNull();
    d.press(0, BUTTON_START); // Enter
    expect(c().capturing).toEqual({ player: 0, action: "punch" });
    f.heldKeys.add("KeyL");
    expect(d.m.key("KeyL")).toBe(true);
    expect(f.services.bindings.keyFor(0, "punch")).toBe("KeyL");
    expect(f.services.bindings.keyFor(1, "punch")).toBe("KeyF");
    expect(c().status).toBe("P1 PUNCH = L  (SWAPPED WITH P2 PUNCH)");
    // While the captured key is held, nothing else happens.
    d.press(0, BUTTON_START);
    expect(c().capturing).toBeNull();
    f.heldKeys.delete("KeyL");
    d.escape();
    expect(d.scene).toBe("title");
  });

  it("Esc while waiting for a key cancels the rebind only", () => {
    const f = fakes();
    const { d, c } = toControls(f);
    d.press(0, BUTTON_START);
    expect(c().capturing).toEqual({ player: 0, action: "up" });
    expect(d.m.key("Escape")).toBe(true);
    d.idle(2);
    expect(c().capturing).toBeNull();
    expect(d.scene).toBe("controls");
    expect(f.services.bindings.keyFor(0, "up")).toBe("KeyW");
  });

  it("restore defaults, and the key test lights every held action per player", () => {
    const f = fakes();
    f.services.bindings.rebind(0, "punch", "KeyL");
    const { d, c } = toControls(f);
    d.press(0, BUTTON_UP); // wraps to BACK
    d.press(0, BUTTON_UP); // RESTORE DEFAULTS
    d.press(0, BUTTON_START);
    expect(f.services.bindings.keyFor(0, "punch")).toBe("KeyF");
    const attacks = P | K | BUTTON_SPECIAL;
    d.idle(1, [attacks, attacks]);
    expect(c().litActions()).toEqual([
      ["punch", "kick", "special"],
      ["punch", "kick", "special"],
    ]);
    expect(c().capturing).toBeNull();
  });
});

describe("roster", () => {
  it("detects playable fighters from their manifests", async () => {
    const people = getPeople();
    const manifest = { fighter: "julien-hovan", version: 2, clips: { idle: { loop: true, frames: [{ x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 0, hold: 1 }] } } };
    const found = await detectPlayable(people, {
      fetchJson: async (url) => (url.includes("julien-hovan") ? manifest : url.includes("felicia") ? { broken: true } : null),
    });
    expect([...found]).toEqual(["julien-hovan"]);
  });

  it("reads archetype and special from a fighter table when one exists, else the fallback", () => {
    expect(fighterInfo("julien-hovan", [])).toEqual({ archetype: "All-rounder", special: "Data Orb" });
    expect(fighterInfo("felicia-gorgacheva", [])).toEqual({ archetype: null, special: null });
    const table = { FIGHTERS: { "felicia-gorgacheva": { archetype: "trickster", special: "context_switch", specialName: "Context Switch" } } };
    expect(fighterInfo("felicia-gorgacheva", [table])).toEqual({ archetype: "Trickster", special: "Context Switch" });
    const list = { FIGHTER_LIST: [{ slug: "alex-andrianavalontsalama", archetype: "all_rounder", special: { name: "Rapid Deploy" } }] };
    expect(infoFromModule(list, "alex-andrianavalontsalama")).toEqual({ archetype: "All-rounder", special: "Rapid Deploy" });
  });
});
