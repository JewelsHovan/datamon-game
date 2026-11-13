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
    d.m.toTitle(); // a fresh title menu (the one we came back to still points at CONTROLS)
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
    d.press(0, BUTTON_START);
    expect(c().capturing).toEqual({ player: 0, action: "punch" });
    f.heldKeys.add("KeyH");
    expect(d.m.key("KeyH")).toBe(true);
    expect(f.services.bindings.keyFor(0, "punch")).toBe("KeyH");
    expect(f.services.bindings.keyFor(1, "punch")).toBe("KeyF");
    expect(c().status).toBe("P1 PUNCH = H  (SWAPPED WITH P2 PUNCH)");
    // While the captured key is held, nothing else happens.
    d.press(0, BUTTON_START);
    expect(c().capturing).toBeNull();
    f.heldKeys.delete("KeyH");
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

  it("reads the fighter index once instead of probing a manifest per person (spec 013)", async () => {
    const fetched: string[] = [];
    const listed = { manifest: "manifest.json", atlas: "atlas.webp", version: 1 };
    const found = await detectPlayable(getPeople(), {
      fetchJson: async (url) => {
        fetched.push(url);
        return url === "./fighters/index.json" ? { fighters: { "julien-hovan": listed, "pentcho-tchomakov": listed } } : null;
      },
    });
    expect([...found].sort()).toEqual(["julien-hovan", "pentcho-tchomakov"]);
    expect(fetched).toEqual(["./fighters/index.json"]);
  });

  it("asks only for the manifests mayHaveArt allows, so people without art cost no 404 (spec 014 A8)", async () => {
    const asked: string[] = [];
    const found = await detectPlayable(getPeople(), {
      fetchJson: async (url) => {
        asked.push(url);
        return null;
      },
      mayHaveArt: (slug) => slug === "julien-hovan" || slug === "felicia-gorgacheva",
    });
    expect(found.size).toBe(0);
    // Without a fighter index (an older build) the probe runs, narrowed by mayHaveArt.
    expect(asked.filter((u) => u !== "./fighters/index.json").sort()).toEqual(["./fighters/felicia-gorgacheva/manifest.json", "./fighters/julien-hovan/manifest.json"]);
  });

  it("reads archetype and special from a fighter table when one exists, else the fallback", () => {
    expect(fighterInfo("julien-hovan", [])).toEqual({ archetype: "All-rounder", special: "Data Orb" });
    expect(fighterInfo("felicia-gorgacheva", [])).toEqual({ archetype: null, special: null });
    const table = { FIGHTERS: { "felicia-gorgacheva": { archetype: "trickster", special: "context_switch", specialName: "Context Switch" } } };
    expect(fighterInfo("felicia-gorgacheva", [table])).toEqual({ archetype: "Trickster", special: "Context Switch" });
    const list = { FIGHTER_LIST: [{ slug: "alex-andrianavalontsalama", archetype: "all_rounder", special: { name: "Rapid Deploy" } }] };
    expect(infoFromModule(list, "alex-andrianavalontsalama")).toEqual({ archetype: "All-rounder", special: "Rapid Deploy" });
  });

  it("extracts altSpecial, trait, and winQuote from the live fighter table and renders them in select, versus, and results", async () => {
    const info = fighterInfo("ethan-pirso");
    expect(info).toEqual({
      archetype: "Zoner",
      special: "Packet Sniper",
      altSpecial: "Rate-Limit Mine",
      trait: "Firewall Spacing",
      winQuote: "RATE LIMITED AT FULL SCREEN.",
    });

    const drawn: { text: string; x: number; y: number }[] = [];
    const ctx = {
      font: "",
      textAlign: "left",
      textBaseline: "top",
      fillStyle: "",
      globalAlpha: 1,
      filter: "",
      imageSmoothingEnabled: false,
      save() {},
      restore() {},
      translate() {},
      scale() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      fill() {},
      fillRect() {},
      drawImage() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      fillText(s: string, x: number, y: number) {
        drawn.push({ text: s, x, y });
      },
    } as unknown as CanvasRenderingContext2D;

    const f = fakes();
    const withVictory = (slug: string): ClipSet => ({
      ...fakeSet(slug),
      clips: { victory: { loop: false, frames: [{ x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 0, hold: 1 }] } },
    });
    const d = new Driver({
      ...f,
      services: {
        ...f.services,
        loadFight: async (p1, p2) => ({ clipSets: [withVictory(p1.slug), withVictory(p2.slug)], effects: null, portraits: [null, null] }),
      },
    });
    d.titlePick(1);
    d.m.scene.render(ctx, 0);
    const selectTexts = drawn.map((t) => t.text);
    expect(selectTexts).toContain("ALL-ROUNDER");
    expect(selectTexts).toContain("SP: DATA ORB");
    expect(selectTexts).toContain("F+RISING COMMIT");
    for (const t of drawn) expect(t.y).toBeLessThan(360);

    drawn.length = 0;
    d.press(0, P);
    d.press(1, P);
    d.idle(READY_FRAMES);
    expect(d.scene).toBe("versus");
    d.m.scene.render(ctx, 20);
    const versusTexts = drawn.map((t) => t.text);
    expect(versusTexts).toContain("BALANCED CORE");
    expect(versusTexts).toContain("DATA ORB / RISING COMMIT");
    for (const t of drawn) expect(t.y).toBeLessThan(360);

    await d.throughVersus();
    d.fightToResults();
    drawn.length = 0;
    d.m.scene.render(ctx, 0);
    expect(drawn.map((t) => t.text)).toContain("CLEAN GREEN CHECKS ACROSS THE BOARD.");
  });
});

describe("app shell (spec 014)", () => {
  /** Fakes with a fullscreen toggle that records its calls. */
  function withFullscreen(enabled: boolean) {
    const f = fakes();
    const toggles: number[] = [];
    const services: GameServices = { ...f.services, fullscreen: { enabled, toggle: () => toggles.push(1) } };
    return { f: { ...f, services }, toggles };
  }

  it("FULLSCREEN is the last title item and toggles fullscreen; it is left out where the API is missing (R4)", () => {
    const off = new Driver(fakes());
    expect(off.m.scene.debug?.()).toMatchObject({ items: ["VS CPU", "VS PLAYER", "TRAINING", "CONTROLS"] });
    const disabled = new Driver(withFullscreen(false).f);
    expect((disabled.m.scene.debug?.() as { items: string[] }).items).not.toContain("FULLSCREEN");

    const { f, toggles } = withFullscreen(true);
    const d = new Driver(f);
    expect(d.m.scene.debug?.()).toMatchObject({ items: ["VS CPU", "VS PLAYER", "TRAINING", "CONTROLS", "FULLSCREEN"] });
    d.titlePick(4);
    expect(toggles).toHaveLength(1);
    expect(d.scene).toBe("title"); // stays on the title
  });

  it("the pause menu has FULLSCREEN before QUIT TO SELECT, and shows the mute key (R4, R7)", async () => {
    const { f, toggles } = withFullscreen(true);
    let muted = false;
    const d = new Driver({ ...f, services: { ...f.services, soundMuted: () => muted } });
    d.titlePick(1);
    d.press(0, P);
    d.press(1, P);
    await d.throughVersus();
    d.escape();
    expect(d.m.scene.debug?.()).toMatchObject({ items: ["RESUME", "CONTROLS", "FULLSCREEN", "QUIT TO SELECT"], hint: "ESC: RESUME   M: MUTE" });
    d.press(0, BUTTON_DOWN);
    d.press(0, BUTTON_DOWN);
    d.press(0, P); // FULLSCREEN
    expect(toggles).toHaveLength(1);
    expect(d.scene).toBe("pause");
    muted = true;
    expect(d.m.scene.debug?.()).toMatchObject({ hint: "ESC: RESUME   M: UNMUTE" });
    d.press(0, BUTTON_DOWN);
    d.press(0, P); // QUIT TO SELECT
    expect(d.select.mode).toBe("versus");
  });

  it("the pause menu's SOUND item mutes and unmutes for everyone, and reads what the sound is (QA F3)", async () => {
    const { f } = withFullscreen(true);
    let muted = false;
    const d = new Driver({ ...f, services: { ...f.services, soundMuted: () => muted, toggleSound: () => (muted = !muted) } });
    d.titlePick(1);
    d.press(0, P);
    d.press(1, P);
    await d.throughVersus();
    d.escape();
    expect(d.m.scene.debug?.()).toMatchObject({ items: ["RESUME", "CONTROLS", "SOUND ON", "FULLSCREEN", "QUIT TO SELECT"] });
    d.press(0, BUTTON_DOWN);
    d.press(0, BUTTON_DOWN);
    expect(d.m.scene.debug?.()).toMatchObject({ item: "SOUND ON" });
    d.press(0, P);
    expect(muted).toBe(true);
    expect(d.scene).toBe("pause"); // stays on the menu
    expect(d.m.scene.debug?.()).toMatchObject({ item: "SOUND OFF", items: ["RESUME", "CONTROLS", "SOUND OFF", "FULLSCREEN", "QUIT TO SELECT"], hint: "ESC: RESUME   M: UNMUTE" });
    d.press(1, P); // either human player can drive the menu
    expect(muted).toBe(false);
    expect(d.m.scene.debug?.()).toMatchObject({ item: "SOUND ON" });
    // M from the keyboard and the item share one state: the label follows it
    muted = true;
    expect(d.m.scene.debug?.()).toMatchObject({ item: "SOUND OFF" });
  });

  it("on touch every screen names the touch buttons; a keyboard brings the keys back (QA F3)", async () => {
    let touch = true;
    const f = fakes();
    const d = new Driver({ ...f, services: { ...f.services, touchControls: () => touch, soundMuted: () => false, toggleSound: () => false } });
    expect(d.m.scene.debug?.()).toMatchObject({ hints: ["MOVE: D-PAD   CONFIRM: PUNCH   BACK: KICK"] });
    touch = false;
    expect((d.m.scene.debug?.() as { hints: string[] }).hints[0]).toMatch(/^MOVE: WASD OR IJKL {3}CONFIRM: R, F OR H/);
    touch = true;

    // Controls: no keyboard to test or bind on touch, Kick leaves
    d.titlePick(3);
    expect(d.scene).toBe("controls");
    expect(d.m.scene.debug?.()).toMatchObject({ footer: "REBINDING NEEDS A KEYBOARD   KICK: BACK" });
    touch = false;
    expect((d.m.scene.debug?.() as { footer: string }).footer).toMatch(/ESC: BACK$/);
    d.press(0, K); // with a keyboard Kick only lights up its row (key test)
    expect(d.scene).toBe("controls");
    touch = true;
    d.press(0, K);
    expect(d.scene).toBe("title");

    d.m.toTitle(); // a fresh title menu (the one we came back to still points at CONTROLS)
    d.titlePick(1); // VS PLAYER
    expect(d.select.hint()).toBe("PICK: PUNCH   CANCEL: KICK");
    touch = false;
    expect(d.select.hint()).toBe("PICK: PUNCH OR START   CANCEL: KICK   ESC: TITLE");
    touch = true;
    d.press(0, P);
    d.press(1, P);
    await d.throughVersus();
    // P1 by touch gets no key legend (the buttons are labelled); P2 on the keyboard keeps theirs
    const [l1, l2] = d.fight.legends();
    expect(l1).toBeNull();
    expect(l2?.[0]).toMatch(/^H PUNCH/);
    d.escape();
    expect(d.m.scene.debug?.()).toMatchObject({ hint: "PUNCH: SELECT   KICK: RESUME" });
    touch = false;
    expect(d.m.scene.debug?.()).toMatchObject({ hint: "ESC: RESUME   M: MUTE" });
    d.escape();
    expect(d.fight.legends()[0]?.[0]).toMatch(/^F PUNCH/);
  });

  it("losing window focus pauses a fight, and only a fight (R7)", async () => {
    const d = new Driver(fakes());
    d.m.blur();
    expect(d.scene).toBe("title");
    d.titlePick(1);
    d.press(0, P);
    d.press(1, P);
    await d.throughVersus();
    const fight = d.fight;
    d.m.blur();
    expect(d.scene).toBe("pause");
    d.m.blur(); // already paused: stays on the pause menu
    expect(d.scene).toBe("pause");
    d.escape();
    expect(d.m.scene).toBe(fight);
  });

  it("scene changes carry the scene's words for screen readers (R5)", async () => {
    const seen: [string, string | null, string | undefined][] = [];
    const f = fakes();
    const services: GameServices = { ...f.services, hooks: { scene: (name, mode, detail) => seen.push([name, mode, detail]) } };
    const d = new Driver({ ...f, services });
    d.titlePick(1);
    d.press(0, P);
    d.press(1, P);
    await d.throughVersus();
    d.escape();
    expect(seen).toEqual([
      ["title", null, undefined],
      ["select", "versus", undefined],
      ["versus", "versus", "Julien H. versus Julien H."],
      ["fight", "versus", "Julien H. versus Julien H."],
      ["pause", "versus", "Julien H. versus Julien H."],
    ]);
  });

  it("a fight that fails to load hands the error to fatal() instead of going back to select (R6)", async () => {
    const f = fakes();
    const errors: unknown[] = [];
    const boom = new Error("atlas blocked");
    const services: GameServices = { ...f.services, loadFight: () => Promise.reject(boom), fatal: (err) => errors.push(err) };
    const d = new Driver({ ...f, services });
    d.titlePick(1);
    d.press(0, P);
    d.press(1, P);
    d.idle(READY_FRAMES);
    await flush();
    expect(errors).toEqual([boom]);
    d.idle(300);
    expect(d.scene).toBe("versus"); // the page's failure screen takes over; no silent return to select
  });
});
