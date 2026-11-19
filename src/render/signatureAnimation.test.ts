// Spec 020 verification: signature move beats (Hotfix Charge, Context Switch, Rapid Deploy),
// defensive outcome differentiation (Perfect Shield, Guard Break, Throw Escape),
// pixel-snapped rendering, and reduced-effects-safe variants.
import { describe, expect, it } from "vitest";
import { getPerson, type Person } from "../data/catalog";
import { COMBAT } from "../data/combat";
import { MOVEMENT } from "../data/movement";
import { firstActiveTick, MOVES, moveDuration } from "../data/moves";
import { BUTTON_KICK as K, BUTTON_PUNCH as P, BUTTON_RIGHT as R, BUTTON_SPECIAL as S, BUTTON_UP as U } from "../sim/inputBits";
import { createFighter, createSandboxState } from "../sim/state";
import { step } from "../sim/step";
import type { FighterState, InputPair, SimEvent, SimState } from "../sim/types";
import type { AtlasImage, Clip, ClipSet } from "./clips";
import { type EffectAtlas, EffectsLayer, SHAKE } from "./effects";
import { clipForFighter, drawFighter, frameForFighter, isHidden } from "./fighterRenderer";
import { Hud } from "./hud";
import { guardBreakPose, poseForFighter, signatureBeatForMove } from "./signatureMotion";

function requirePerson(slug: string): Person {
  const person = getPerson(slug);
  if (!person) throw new Error(`missing ${slug}`);
  return person;
}

function requireEvent<T extends SimEvent["type"]>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }> {
  const found = events.find((e): e is Extract<SimEvent, { type: T }> => e.type === type);
  if (!found) throw new Error(`expected ${type} event`);
  return found;
}

function makeClip(x = 0, w = 80, h = 140, hold = 4, count = 8): Clip {
  return {
    loop: false,
    frames: Array.from({ length: count }, (_, idx) => ({
      x: x + idx * w,
      y: 0,
      w,
      h,
      ax: Math.floor(w / 2),
      ay: h - 1,
      hold,
    })),
  };
}

function makeFighterClips(slug: string): ClipSet {
  return {
    slug,
    source: "manifest",
    atlas: { width: 1024, height: 1024 } as unknown as AtlasImage,
    artFacing: 1,
    clips: {
      idle: makeClip(0, 74, 140, 8, 4),
      special: makeClip(0, 96, 136, 4, 9),
      block: makeClip(0, 74, 140, 4, 2),
      hurt: makeClip(0, 88, 136, 4, 4),
    },
  };
}

function makeEffectAtlas(): EffectAtlas {
  const fxClip = (x: number, w: number, h: number): Clip => ({
    loop: false,
    frames: [{ x, y: 0, w, h, ax: Math.floor(w / 2), ay: Math.floor(h / 2), hold: 6 }],
  });
  return {
    atlas: { width: 512, height: 512 } as unknown as AtlasImage,
    clips: {
      hit_light: fxClip(0, 20, 20),
      hit_heavy: fxClip(20, 44, 48),
      block: fxClip(64, 24, 54),
      dust: fxClip(88, 40, 20),
      orb: fxClip(128, 48, 32),
      orb_burst: fxClip(176, 52, 54),
      teleport_out: fxClip(228, 69, 144),
      teleport_in: fxClip(297, 82, 150),
      charge_streaks: fxClip(0, 120, 60),
      rush_streaks: fxClip(120, 120, 60),
      uppercut_arc: fxClip(240, 60, 80),
    },
  };
}

function makeRecordingCtx() {
  const drawImages: number[][] = [];
  const fillRects: number[][] = [];
  const fillTexts: { text: string; fillStyle: string }[] = [];
  const compositeOps: string[] = [];
  let currentComposite = "source-over";
  let currentFill = "#000";
  const stack: { composite: string; fill: string }[] = [];

  const ctx: Record<string, unknown> = {
    get globalCompositeOperation() {
      return currentComposite;
    },
    set globalCompositeOperation(v: string) {
      currentComposite = v;
      compositeOps.push(v);
    },
    get fillStyle() {
      return currentFill;
    },
    set fillStyle(v: string) {
      currentFill = v;
    },
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    textBaseline: "top",
    save: () => stack.push({ composite: currentComposite, fill: currentFill }),
    restore: () => {
      const top = stack.pop();
      if (top) {
        currentComposite = top.composite;
        currentFill = top.fill;
      }
    },
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    drawImage: (...args: unknown[]) => {
      drawImages.push(args.slice(1).map((v) => Number(v)));
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRects.push([x, y, w, h]);
    },
    fillText: (text: string) => {
      fillTexts.push({ text, fillStyle: currentFill });
    },
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    drawImages,
    fillRects,
    fillTexts,
    compositeOps,
  };
}

function fighter(slug: string, patch: Partial<FighterState>): FighterState {
  return { ...createFighter(slug, 50000, 1), ...patch };
}

function duel(p1: string, p2: string, gapPx = 64): SimState {
  const s = createSandboxState(17, p1, p2);
  const mid = MOVEMENT.stageWidth / 2;
  const half = Math.floor((gapPx * 100) / 2);
  s.fighters[0].x = mid - half;
  s.fighters[1].x = mid + half;
  return s;
}

function runSim(start: SimState, inputs: readonly InputPair[]): { state: SimState; states: SimState[]; events: SimEvent[] } {
  let state = start;
  const states: SimState[] = [];
  const events: SimEvent[] = [];
  for (const pair of inputs) {
    state = step(state, pair);
    states.push(state);
    events.push(...state.events);
  }
  return { state, states, events };
}

describe("Spec 020: Signature special beats (Pentcho, Felicia, Alex)", () => {
  it("Pentcho's Hotfix Charge maps anticipation, travel, impact, and follow-through beats to MOVES.charge", () => {
    expect(moveDuration(MOVES.charge)).toBe(46);
    expect(firstActiveTick(MOVES.charge)).toBe(10);

    expect(signatureBeatForMove("charge", 0)).toBe("anticipation");
    expect(signatureBeatForMove("charge", 4)).toBe("anticipation"); // armor brace
    expect(signatureBeatForMove("charge", 10)).toBe("travel"); // burst active
    expect(signatureBeatForMove("charge", 16, 4)).toBe("impact"); // hitstop crush on contact
    expect(signatureBeatForMove("charge", 24)).toBe("impact"); // heavy follow-through brake
    expect(signatureBeatForMove("charge", 32)).toBe("follow_through");

    const pentcho = requirePerson("pentcho-tchomakov");
    const set = makeFighterClips(pentcho.slug);
    const fx = new EffectsLayer(makeEffectAtlas());
    const s = duel(pentcho.slug, "julien-hovan", 130);
    const sim = runSim(s, [[S, 0], ...Array.from({ length: 45 }, (): InputPair => [0, 0])]);

    const seenOverlays = new Set<string>();
    for (const st of sim.states) {
      fx.follow(st);
      fx.onEvents(st.events, st);
      for (const k of fx.activeOverlayKinds()) seenOverlays.add(k);
      const rec = makeRecordingCtx();
      drawFighter(rec.ctx, set, st.fighters[0], { x: 0, y: 0 });
      for (const args of rec.drawImages) {
        for (const n of args.slice(4)) expect(Number.isInteger(n)).toBe(true);
      }
      fx.tick();
    }

    expect(seenOverlays.has("armor_brace")).toBe(true);
    expect(seenOverlays.has("charge_smear")).toBe(true);

    // Pose shifts backward on armor coil (tick 4) and forward during charge lunge (tick 14)
    const coilPose = poseForFighter(fighter(pentcho.slug, { state: "attack", move: { id: "charge", tick: 5, connected: false, grabbed: false, hitSeg: -1, armorUsed: false } }));
    const lungePose = poseForFighter(fighter(pentcho.slug, { state: "attack", move: { id: "charge", tick: 15, connected: false, grabbed: false, hitSeg: -1, armorUsed: false } }));
    expect(coilPose.offsetX).toBeLessThan(0);
    expect(coilPose.scaleY).toBeLessThan(1);
    expect(lungePose.offsetX).toBeGreaterThan(0);
    expect(lungePose.scaleX).toBeGreaterThan(1);
  });

  it("Felicia's Context Switch ties phase-collapse, vanish travel, reappear coil, and overhead arc to MOVES.teleport", () => {
    expect(MOVES.teleport.vanishTick).toBe(8);
    expect(MOVES.teleport.reappearTick).toBe(16);
    expect(firstActiveTick(MOVES.teleport)).toBe(23);

    expect(signatureBeatForMove("teleport", 4)).toBe("anticipation");
    expect(signatureBeatForMove("teleport", 10)).toBe("travel");
    expect(signatureBeatForMove("teleport", 16)).toBe("travel");
    expect(signatureBeatForMove("teleport", 21)).toBe("travel"); // rising spring before active window
    expect(signatureBeatForMove("teleport", 23)).toBe("impact"); // active overhead window (23..30)
    expect(signatureBeatForMove("teleport", 34)).toBe("follow_through");

    const felicia = requirePerson("felicia-gorgacheva");
    const set = makeFighterClips(felicia.slug);
    const fx = new EffectsLayer(makeEffectAtlas());
    const sim = runSim(duel(felicia.slug, "julien-hovan", 100), [[S, 0], ...Array.from({ length: 40 }, (): InputPair => [0, 0])]);

    const seenOverlays = new Set<string>();
    let hiddenTicks = 0;
    for (const st of sim.states) {
      if (isHidden(st.fighters[0])) hiddenTicks += 1;
      fx.follow(st);
      fx.onEvents(st.events, st);
      for (const k of fx.activeOverlayKinds()) seenOverlays.add(k);
      const rec = makeRecordingCtx();
      drawFighter(rec.ctx, set, st.fighters[0], { x: 0, y: 0 });
      if (isHidden(st.fighters[0])) expect(rec.drawImages).toHaveLength(0);
      fx.tick();
    }

    expect(hiddenTicks).toBe(8);
    expect(seenOverlays.has("phase_collapse")).toBe(true);
    expect(seenOverlays.has("phase_streak")).toBe(true);
    expect(seenOverlays.has("overhead_arc")).toBe(true);
    expect(seenOverlays.has("impact_ring")).toBe(true);

    // Pre-vanish compression narrows width and lifts vertically; rising overhead strike stretches up.
    const preVanish = poseForFighter(fighter(felicia.slug, { state: "attack", move: { id: "teleport", tick: 6, connected: false, grabbed: false, hitSeg: -1, armorUsed: false } }));
    const overheadSpring = poseForFighter(fighter(felicia.slug, { state: "attack", move: { id: "teleport", tick: 21, connected: false, grabbed: false, hitSeg: -1, armorUsed: false } }));
    expect(preVanish.scaleX).toBeLessThan(0.8);
    expect(preVanish.scaleY).toBeGreaterThan(1.1);
    expect(overheadSpring.offsetY).toBeLessThan(0);
  });

  it("Alex's Rapid Deploy ties coil, blitz, 3-punch flurry smears, and launcher uppercut to MOVES.rush", () => {
    expect(moveDuration(MOVES.rush)).toBe(36);
    expect(firstActiveTick(MOVES.rush)).toBe(8);

    expect(signatureBeatForMove("rush", 1)).toBe("anticipation");
    expect(signatureBeatForMove("rush", 5)).toBe("travel");
    expect(signatureBeatForMove("rush", 12)).toBe("travel");
    expect(signatureBeatForMove("rush", 18)).toBe("anticipation"); // uppercut coil
    expect(signatureBeatForMove("rush", 21)).toBe("impact"); // launcher uppercut
    expect(signatureBeatForMove("rush", 28)).toBe("follow_through");

    const alex = requirePerson("alex-andrianavalontsalama");
    const fx = new EffectsLayer(makeEffectAtlas());
    const sim = runSim(duel(alex.slug, "julien-hovan", 240), [[S, 0], ...Array.from({ length: 35 }, (): InputPair => [0, 0])]);

    const seenOverlays = new Set<string>();
    for (const st of sim.states) {
      fx.follow(st);
      fx.onEvents(st.events, st);
      for (const k of fx.activeOverlayKinds()) seenOverlays.add(k);
      fx.tick();
    }

    expect(seenOverlays.has("rush_smear")).toBe(true);
    expect(seenOverlays.has("uppercut_wind")).toBe(true);

    // Connecting Rapid Deploy spawns uppercut_wind + uppercut_arc immediately on tick 21 even when hitstop starts on that step, and impact_ring on hit.
    const hitSim = runSim(duel(alex.slug, "julien-hovan", 110), [[S, 0], ...Array.from({ length: 65 }, (): InputPair => [0, 0])]);
    const fxHit = new EffectsLayer(makeEffectAtlas());
    const hitOverlays = new Set<string>();
    let launcherArcOnHitFrame = false;
    for (const st of hitSim.states) {
      fxHit.follow(st);
      fxHit.onEvents(st.events, st);
      if (st.fighters[0].move?.id === "rush" && st.fighters[0].move.tick === 21 && st.fighters[0].hitstop > 0) {
        if (fxHit.activeOverlayKinds().includes("uppercut_wind")) launcherArcOnHitFrame = true;
      }
      for (const k of fxHit.activeOverlayKinds()) hitOverlays.add(k);
      fxHit.tick();
    }
    expect(launcherArcOnHitFrame).toBe(true);
    expect(hitOverlays.has("impact_ring")).toBe(true);

    const upperCoil = poseForFighter(fighter(alex.slug, { state: "attack", move: { id: "rush", tick: 18, connected: false, grabbed: false, hitSeg: -1, armorUsed: false } }));
    const launcher = poseForFighter(fighter(alex.slug, { state: "attack", move: { id: "rush", tick: 22, connected: false, grabbed: false, hitSeg: -1, armorUsed: false } }));
    expect(upperCoil.offsetY).toBeGreaterThan(0);
    expect(upperCoil.scaleY).toBeLessThan(0.92);
    expect(launcher.offsetY).toBeLessThan(-4);
    expect(launcher.scaleY).toBeGreaterThan(1.1);
  });
});

describe("Spec 020: Defensive outcomes & reduced-effects safety", () => {
  it("differentiates Perfect Shield, Guard Break, and Throw Escape in pose, effects, HUD, and reduced mode", () => {
    const atlas = makeEffectAtlas();
    const set = makeFighterClips("julien-hovan");

    // 1) Real sim Perfect Shield (grounded + airborne) vs normal block
    const perfSim = runSim(duel("julien-hovan", "julien-hovan", 52), [[P, 0], [0, 0], [0, R], [0, R]]);
    const perfEvent = requireEvent(perfSim.events, "perfect_block");
    expect(perfSim.state.fighters[1].state).toBe("blockstun");

    const fxPerf = new EffectsLayer(atlas);
    fxPerf.onEvents(perfSim.state.events, perfSim.state);
    const perfOpts = fxPerf.poseOptions(1, perfSim.state.fighters[1]);
    expect(perfOpts.reaction).toBe("perfect_shield");
    expect(poseForFighter(perfSim.state.fighters[1], perfOpts).offsetX).toBeGreaterThan(0);

    // Normal block (even if guardCooldown were 0) NEVER triggers perfect_shield without a perfect_block event
    const normalBlockSim = runSim(duel("julien-hovan", "julien-hovan", 52), [[P, R], ...Array.from({ length: 4 }, (): InputPair => [0, R])]);
    const fxNorm = new EffectsLayer(atlas);
    fxNorm.onEvents(normalBlockSim.state.events, normalBlockSim.state);
    const normOpts = fxNorm.poseOptions(1, normalBlockSim.state.fighters[1]);
    expect(normOpts.reaction).toBeNull();
    expect(poseForFighter(normalBlockSim.state.fighters[1], normOpts).offsetX).toBe(0);

    // Air Perfect Shield against projectile also binds to perfect_shield reaction
    const airSetup = runSim(duel("julien-hovan", "julien-hovan", 140), [
      [S, 0],
      ...Array.from({ length: 14 }, (): InputPair => [0, 0]),
      [0, U],
    ]);
    // Step forward until the orb hits airborne P2, then rewind 2 frames to press Back inside the 3-frame Perfect Shield window.
    let probe = airSetup.state;
    const beforeHitStates: SimState[] = [probe];
    for (let k = 0; k < 24; k++) {
      probe = step(probe, [0, 0]);
      if (probe.events.some((e) => e.type === "hit")) break;
      beforeHitStates.push(probe);
    }
    const preHit = beforeHitStates[Math.max(0, beforeHitStates.length - 2)];
    if (!preHit) throw new Error("missing preHit state");
    const airPerf = runSim(preHit, [[0, R], [0, R], [0, R]]);
    const airPerfEvent = requireEvent(airPerf.events, "perfect_block");
    expect(airPerf.state.fighters[1].state).toBe("airborne");
    const fxAirPerf = new EffectsLayer(atlas);
    fxAirPerf.onEvents([airPerfEvent], airPerf.state);
    expect(fxAirPerf.poseOptions(1, airPerf.state.fighters[1]).reaction).toBe("perfect_shield");
    expect(poseForFighter(airPerf.state.fighters[1], fxAirPerf.poseOptions(1, airPerf.state.fighters[1])).offsetX).toBeGreaterThan(0);

    // 2) Real sim Guard Break
    const gbStart = duel("julien-hovan", "julien-hovan", 48);
    gbStart.fighters[1].guard = 50;
    gbStart.fighters[1].guardCooldown = 20;
    const gbSim = runSim(gbStart, [[P, R], ...Array.from({ length: 10 }, (): InputPair => [0, R])]);
    const gbEvent = requireEvent(gbSim.events, "guard_break");
    expect(gbSim.state.fighters[1].state).toBe("guard_break");

    // Guard Break stagger progresses through jolt (frame 0) -> dizzy sway (1/2) -> recovery (3).
    expect(guardBreakPose(2).frameOverride).toBe(0);
    expect(guardBreakPose(2).offsetX).toBe(-5);
    expect(guardBreakPose(14).offsetY).toBe(2);
    expect([1, 2]).toContain(guardBreakPose(14).frameOverride);
    expect(guardBreakPose(38).frameOverride).toBe(3);
    expect(clipForFighter(gbSim.state.fighters[1]).frame).toBe(0);
    expect(frameForFighter(set, fighter("julien-hovan", { state: "guard_break", stateFrame: 38 })).x).toBe(
      set.clips.hurt?.frames[3]?.x,
    );

    // 3) Real sim Throw Escape (tech) vs non-tech idle pushback
    const techStart = duel("julien-hovan", "julien-hovan", 48);
    const grabSim = runSim(techStart, [[P | K, 0], ...Array.from({ length: 4 }, (): InputPair => [0, 0])]);
    expect(grabSim.state.fighters[1].state).toBe("held");
    const techSim = runSim(grabSim.state, [[0, P | K]]);
    const techEvent = requireEvent(techSim.events, "tech");
    expect(techSim.state.fighters[0].pushFrames).toBe(COMBAT.pushFrames - 1);
    const fxTechPose = new EffectsLayer(atlas);
    fxTechPose.onEvents(techSim.state.events, techSim.state);
    expect(fxTechPose.poseOptions(0, techSim.state.fighters[0]).reaction).toBe("throw_tech");
    expect(poseForFighter(techSim.state.fighters[0], fxTechPose.poseOptions(0, techSim.state.fighters[0])).offsetX).toBeLessThan(0);

    // Generic idle pushback without a tech event does NOT trigger throw_tech pose
    const nonTechIdle = fighter("julien-hovan", { state: "idle", pushFrames: 6, pushLeft: -2400 });
    expect(new EffectsLayer(atlas).poseOptions(0, nonTechIdle).reaction).toBeNull();
    expect(poseForFighter(nonTechIdle).offsetX).toBe(0);

    // Compare full vs reduced EffectsLayer for each defensive outcome
    const runOutcome = (event: SimEvent, reduced: boolean, simState: SimState) => {
      const fx = new EffectsLayer(atlas, reduced);
      fx.follow(simState);
      fx.onEvents([event], simState);
      const rec = makeRecordingCtx();
      fx.draw(rec.ctx, { x: 0, y: 0 });
      return { fx, rec };
    };

    const pFull = runOutcome(perfEvent, false, perfSim.state);
    const pRed = runOutcome(perfEvent, true, perfSim.state);
    expect(pFull.fx.activeOverlayKinds()).toEqual(["perfect_shield_full"]);
    expect(pRed.fx.activeOverlayKinds()).toEqual(["perfect_shield_reduced"]);
    expect(pFull.fx.amplitude).toBe(SHAKE.light);
    expect(pFull.fx.flash[1]).toBe(3);
    expect(pRed.fx.amplitude).toBe(0);
    expect(pRed.fx.flash).toEqual([0, 0]);
    expect(pRed.rec.compositeOps).not.toContain("lighter");

    const gFull = runOutcome(gbEvent, false, gbSim.state);
    const gRed = runOutcome(gbEvent, true, gbSim.state);
    expect(gFull.fx.activeOverlayKinds()).toEqual(["guard_break_full"]);
    expect(gRed.fx.activeOverlayKinds()).toEqual(["guard_break_reduced"]);
    expect(gFull.fx.amplitude).toBe(SHAKE.heavy);
    expect(gFull.fx.flash[1]).toBe(4);
    expect(gRed.fx.amplitude).toBe(0);
    expect(gRed.fx.flash).toEqual([0, 0]);
    expect(gRed.rec.compositeOps).not.toContain("lighter");
    // Both full and reduced draw the ongoing guard_break head marker when state === "guard_break"
    expect(gRed.rec.fillRects.length).toBeGreaterThan(0);

    const tFull = runOutcome(techEvent, false, techSim.state);
    const tRed = runOutcome(techEvent, true, techSim.state);
    expect(tFull.fx.activeOverlayKinds()).toEqual(["tech_full"]);
    expect(tRed.fx.activeOverlayKinds()).toEqual(["tech_reduced"]);
    expect(tFull.fx.amplitude).toBe(SHAKE.light);
    expect(tRed.fx.amplitude).toBe(0);
    expect(tRed.fx.flash).toEqual([0, 0]);
    expect(tRed.rec.compositeOps).not.toContain("lighter");

    // Ensure all overlay fillRects are pixel-snapped integers
    for (const rect of [...pFull.rec.fillRects, ...pRed.rec.fillRects, ...gFull.rec.fillRects, ...gRed.rec.fillRects, ...tFull.rec.fillRects, ...tRed.rec.fillRects]) {
      for (const n of rect) expect(Number.isInteger(n)).toBe(true);
    }

    // HUD renders distinct defensive callouts
    const julien = requirePerson("julien-hovan");
    const hud = new Hud([julien, julien], [null, null]);
    hud.onEvents([perfEvent, gbEvent, techEvent]);
    const hudRec = makeRecordingCtx();
    hud.draw(hudRec.ctx, gbSim.state, false);
    const labels = hudRec.fillTexts.map((t) => t.text);
    expect(labels).toContain("PERFECT SHIELD");
    expect(labels).toContain("SHIELD BREAK!");
    expect(labels).toContain("THROW TECH");
  });
});
