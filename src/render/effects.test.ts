// Spec 004 A4 and A5: shake decays to zero; reduced effects means no shake and no flash.
import { describe, expect, it } from "vitest";
import { firstActiveTick, MOVES, type ProjectileKind } from "../data/moves";
import { createMatchState } from "../sim/state";
import type { SimEvent, SimState } from "../sim/types";
import type { AtlasImage, Clip } from "./clips";
import { EffectsLayer, SHAKE, type EffectAtlas } from "./effects";

const state = createMatchState(1, "julien-hovan", "julien-hovan", true);
const heavyHit: SimEvent = { type: "hit", player: 0, target: 1, move: "heavy_punch", strength: "heavy", x: 64000, y: 21000, damage: 90, combo: 1 };

function makeClip(x = 0, w = 48, h = 32, hold = 4): Clip {
  return { loop: false, frames: [{ x, y: 0, w, h, ax: Math.floor(w / 2), ay: Math.floor(h / 2), hold }] };
}

function makeTestAtlas(): EffectAtlas {
  return {
    atlas: { width: 512, height: 512 } as unknown as AtlasImage,
    clips: {
      hit_light: makeClip(0, 20, 20, 4),
      hit_heavy: makeClip(20, 44, 48, 4),
      block: makeClip(64, 24, 54, 4),
      dust: makeClip(88, 40, 20, 4),
      orb: makeClip(128, 48, 32, 4),
      orb_burst: makeClip(176, 52, 54, 4),
      charge_streaks: makeClip(228, 120, 60, 4),
      rush_streaks: makeClip(348, 120, 60, 4),
      uppercut_arc: makeClip(468, 44, 64, 4),
    },
  };
}

function makeRecordingCtx(includeExtras = true) {
  const calls: { op: string; args: unknown[] }[] = [];
  const ctx: Record<string, unknown> = {
    globalCompositeOperation: "source-over",
    fillStyle: "#000",
    save: () => calls.push({ op: "save", args: [] }),
    restore: () => calls.push({ op: "restore", args: [] }),
    translate: (...args: number[]) => calls.push({ op: "translate", args }),
    scale: (...args: number[]) => calls.push({ op: "scale", args }),
    drawImage: (...args: unknown[]) => calls.push({ op: "drawImage", args: args.slice(1) }),
  };
  if (includeExtras) {
    ctx.fillRect = (...args: number[]) => calls.push({ op: "fillRect", args });
    ctx.rotate = (...args: number[]) => calls.push({ op: "rotate", args });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("effects layer feel (spec 004)", () => {
  it("a heavy hit shakes the screen, and the shake decays to zero", () => {
    const fx = new EffectsLayer(null);
    fx.onEvents([heavyHit], state);
    expect(fx.amplitude).toBe(SHAKE.heavy);
    expect(fx.flash[1]).toBe(2);
    let last = fx.amplitude;
    for (let i = 0; i < SHAKE.decayFrames; i++) {
      fx.tick();
      expect(fx.amplitude).toBeLessThanOrEqual(last);
      last = fx.amplitude;
    }
    expect(fx.amplitude).toBe(0);
    expect(fx.cameraOffset(3)).toEqual({ x: 0, y: 0 });
  });

  it("a K.O. shakes harder and flashes the screen", () => {
    const fx = new EffectsLayer(null);
    fx.onEvents([{ type: "ko", player: 1, x: 64000, y: 32000 }], state);
    expect(fx.amplitude).toBe(SHAKE.ko);
    expect(fx.screenFlash).toBeGreaterThan(0);
  });

  it("with reduced effects on, nothing shakes or flashes", () => {
    const fx = new EffectsLayer(null, true);
    fx.onEvents([heavyHit, { type: "ko", player: 1, x: 64000, y: 32000 }], state);
    expect(fx.amplitude).toBe(0);
    expect(fx.flash).toEqual([0, 0]);
    expect(fx.screenFlash).toBe(0);
    expect(fx.cameraOffset(1)).toEqual({ x: 0, y: 0 });
  });

  it("counter events spawn block + hit_heavy, flash the countering player, and trigger heavy shake", () => {
    const atlas = makeTestAtlas();
    const fx = new EffectsLayer(atlas);
    fx.onEvents([{ type: "counter", player: 1, target: 0, x: 64000, y: 22000 }], state);
    expect(fx.count).toBe(2);
    expect(fx.flash).toEqual([0, 3]);
    expect(fx.amplitude).toBe(SHAKE.heavy);

    const { ctx, calls } = makeRecordingCtx();
    fx.draw(ctx, { x: 0, y: 0 });
    const drawnSrcXs = calls.filter((c) => c.op === "drawImage").map((c) => c.args[0]);
    expect(drawnSrcXs).toEqual([atlas.clips.block!.frames[0]!.x, atlas.clips.hit_heavy!.frames[0]!.x]);

    const fxReduced = new EffectsLayer(atlas, true);
    fxReduced.onEvents([{ type: "counter", player: 1, target: 0, x: 64000, y: 22000 }], state);
    expect(fxReduced.flash).toEqual([0, 0]);
    expect(fxReduced.amplitude).toBe(0);
  });

  it("projectile hits and projectile spawns emit appropriate bursts and dust", () => {
    const atlas = makeTestAtlas();
    const fx = new EffectsLayer(atlas);
    // Non-shockwave projectile hit (packet_sniper) -> orb_burst + hit_heavy
    fx.onEvents(
      [{ type: "hit", player: 0, target: 1, move: "packet_sniper", strength: "special", x: 70000, y: 22000, damage: 76, combo: 1 }],
      state,
    );
    expect(fx.count).toBe(2);
    const { ctx, calls } = makeRecordingCtx();
    fx.draw(ctx, { x: 0, y: 0 });
    expect(calls.filter((c) => c.op === "drawImage").map((c) => c.args[0])).toEqual([
      atlas.clips.orb_burst!.frames[0]!.x,
      atlas.clips.hit_heavy!.frames[0]!.x,
    ]);

    // Shockwave hit (ground_fault) -> dust + orb_burst + hit_heavy
    const fxShock = new EffectsLayer(atlas);
    fxShock.onEvents(
      [{ type: "hit", player: 0, target: 1, move: "ground_fault", strength: "special", x: 70000, y: 29800, damage: 76, combo: 1 }],
      state,
    );
    expect(fxShock.count).toBe(3);

    // Projectile spawn muzzle burst: hit_light (0.65 scale) vs dust for shockwave
    const fxSpawn = new EffectsLayer(atlas);
    fxSpawn.onEvents(
      [
        { type: "projectile", player: 0, x: 60000, y: 22000, kind: "fast_packet" },
        { type: "projectile", player: 1, x: 70000, y: 29800, kind: "shockwave" },
      ],
      state,
    );
    expect(fxSpawn.count).toBe(2);
    const spawnRec = makeRecordingCtx();
    fxSpawn.draw(spawnRec.ctx, { x: 0, y: 0 });
    const drawCalls = spawnRec.calls.filter((c) => c.op === "drawImage");
    expect(drawCalls.map((c) => c.args[0])).toEqual([
      atlas.clips.hit_light!.frames[0]!.x,
      atlas.clips.dust!.frames[0]!.x,
    ]);
    // hit_light scaled to 0.65 -> 20 * 0.65 = 13
    expect(drawCalls[0]!.args[6]).toBe(13);
  });

  it("spawns trails for skyline_upper, breaker_lariat, golden_rush, and force_push toss", () => {
    const atlas = makeTestAtlas();
    const s: SimState = structuredClone(state);
    const drawnXs = (fx: EffectsLayer) => {
      const rec = makeRecordingCtx();
      fx.draw(rec.ctx, { x: 0, y: 0 });
      return rec.calls.filter((c) => c.op === "drawImage").map((c) => c.args[0]);
    };

    // skyline_upper active start -> uppercut_arc
    const fxUpper = new EffectsLayer(atlas);
    s.frame = 10;
    s.fighters[0].move = {
      id: "skyline_upper",
      tick: firstActiveTick(MOVES.skyline_upper),
      connected: false,
      grabbed: false,
      hitSeg: -1,
      armorUsed: false,
    };
    fxUpper.follow(s);
    expect(drawnXs(fxUpper)).toEqual([atlas.clips.uppercut_arc!.frames[0]!.x]);

    // breaker_lariat advancing armored segment -> charge_streaks
    const fxLariat = new EffectsLayer(atlas);
    s.frame = 20;
    s.fighters[0].move = { id: "breaker_lariat", tick: 3, connected: false, grabbed: false, hitSeg: -1, armorUsed: false };
    fxLariat.follow(s);
    expect(drawnXs(fxLariat)).toEqual([atlas.clips.charge_streaks!.frames[0]!.x]);

    // golden_rush fast slide -> rush_streaks + dust at feet
    const fxSlide = new EffectsLayer(atlas);
    s.frame = 30;
    s.fighters[0].move = { id: "golden_rush", tick: 3, connected: false, grabbed: false, hitSeg: -1, armorUsed: false };
    fxSlide.follow(s);
    expect(drawnXs(fxSlide)).toEqual([atlas.clips.rush_streaks!.frames[0]!.x, atlas.clips.dust!.frames[0]!.x]);

    // force_push successful toss -> dust
    const fxToss = new EffectsLayer(atlas);
    s.frame = 40;
    s.fighters[0].move = {
      id: "force_push",
      tick: MOVES.force_push.tossTick!,
      connected: true,
      grabbed: true,
      hitSeg: -1,
      armorUsed: false,
    };
    fxToss.follow(s);
    expect(drawnXs(fxToss)).toEqual([atlas.clips.dust!.frames[0]!.x]);
  });

  it("spawns trails, arcs, and dust for spec 017 new specials (granite_tackle, comet_upper, jet_sweep, titan_press toss, blink_edge, frost_fault, shadow_pivot)", () => {
    const atlas = makeTestAtlas();
    const s: SimState = structuredClone(state);
    const drawnXs = (fx: EffectsLayer) => {
      const rec = makeRecordingCtx();
      fx.draw(rec.ctx, { x: 0, y: 0 });
      return rec.calls.filter((c) => c.op === "drawImage").map((c) => c.args[0]);
    };

    // granite_tackle advancing armored segment -> charge_streaks
    const fxTackle = new EffectsLayer(atlas);
    s.frame = 10;
    s.fighters[0].move = {
      id: "granite_tackle",
      tick: firstActiveTick(MOVES.granite_tackle),
      connected: false,
      grabbed: false,
      hitSeg: -1,
      armorUsed: false,
    };
    fxTackle.follow(s);
    expect(drawnXs(fxTackle)).toEqual([atlas.clips.charge_streaks!.frames[0]!.x]);

    // comet_upper active start -> uppercut_arc
    const fxComet = new EffectsLayer(atlas);
    s.frame = 20;
    s.fighters[0].move = {
      id: "comet_upper",
      tick: firstActiveTick(MOVES.comet_upper),
      connected: false,
      grabbed: false,
      hitSeg: -1,
      armorUsed: false,
    };
    fxComet.follow(s);
    expect(drawnXs(fxComet)).toEqual([atlas.clips.uppercut_arc!.frames[0]!.x]);

    // jet_sweep low slide -> dust
    const fxJet = new EffectsLayer(atlas);
    s.frame = 30;
    s.fighters[0].move = { id: "jet_sweep", tick: 3, connected: false, grabbed: false, hitSeg: -1, armorUsed: false };
    fxJet.follow(s);
    expect(drawnXs(fxJet)).toEqual([atlas.clips.dust!.frames[0]!.x]);

    // titan_press successful toss -> dust
    const fxTitan = new EffectsLayer(atlas);
    s.frame = 40;
    s.fighters[0].move = {
      id: "titan_press",
      tick: MOVES.titan_press.tossTick!,
      connected: true,
      grabbed: true,
      hitSeg: -1,
      armorUsed: false,
    };
    fxTitan.follow(s);
    expect(drawnXs(fxTitan)).toEqual([atlas.clips.dust!.frames[0]!.x]);

    // blink_edge post-reappear lunge -> rush_streaks
    const fxBlink = new EffectsLayer(atlas);
    s.frame = 50;
    s.fighters[0].move = {
      id: "blink_edge",
      tick: MOVES.blink_edge.reappearTick!,
      connected: false,
      grabbed: false,
      hitSeg: -1,
      armorUsed: false,
    };
    fxBlink.follow(s);
    expect(drawnXs(fxBlink)).toEqual([atlas.clips.rush_streaks!.frames[0]!.x]);

    // frost_fault projectile release -> dust
    const fxFrost = new EffectsLayer(atlas);
    s.frame = 60;
    s.fighters[0].move = {
      id: "frost_fault",
      tick: MOVES.frost_fault.projectileTick!,
      connected: false,
      grabbed: false,
      hitSeg: -1,
      armorUsed: false,
    };
    fxFrost.follow(s);
    expect(drawnXs(fxFrost)).toEqual([atlas.clips.dust!.frames[0]!.x]);

    // shadow_pivot post-reappear slash -> rush_streaks
    const fxPivot = new EffectsLayer(atlas);
    s.frame = 70;
    s.fighters[0].move = { id: "shadow_pivot", tick: 18, connected: false, grabbed: false, hitSeg: -1, armorUsed: false };
    fxPivot.follow(s);
    expect(drawnXs(fxPivot)).toEqual([atlas.clips.rush_streaks!.frames[0]!.x]);

    // Null atlas safety during follow()
    const fxNull = new EffectsLayer(null);
    expect(() => fxNull.follow(s)).not.toThrow();
    expect(fxNull.count).toBe(0);
  });

  it("renders all 5 ProjectileKind variants distinctly and safely on minimal fake canvases", () => {
    const atlas = makeTestAtlas();
    const fx = new EffectsLayer(atlas);
    const kinds: (ProjectileKind | undefined)[] = [undefined, "orb", "fast_packet", "slow_mine", "shockwave", "arc_burst"];

    for (const kind of kinds) {
      const s: SimState = structuredClone(state);
      s.frame = 4;
      s.projectiles = [{ owner: 0, x: 50000, y: 22000, vx: 600, ...(kind ? { kind } : {}) }];

      const full = makeRecordingCtx(true);
      fx.drawProjectiles(full.ctx, s, { x: 0, y: 0 });
      const drawImages = full.calls.filter((c) => c.op === "drawImage");
      expect(drawImages).toHaveLength(1);

      if (kind === undefined || kind === "orb") {
        expect(full.calls.some((c) => c.op === "scale")).toBe(false);
        expect(full.calls.some((c) => c.op === "fillRect")).toBe(false);
        expect(drawImages[0]!.args[0]).toBe(atlas.clips.orb!.frames[0]!.x);
      } else if (kind === "fast_packet") {
        expect(full.calls.some((c) => c.op === "scale" && c.args[0] === 1.45 && c.args[1] === 0.7)).toBe(true);
        expect(full.calls.some((c) => c.op === "fillRect")).toBe(true);
      } else if (kind === "slow_mine") {
        const scaleCall = full.calls.find((c) => c.op === "scale");
        expect(scaleCall).toBeDefined();
        expect(scaleCall!.args[0]).toBe(scaleCall!.args[1]);
        expect(full.calls.filter((c) => c.op === "fillRect")).toHaveLength(4);
      } else if (kind === "shockwave") {
        expect(drawImages[0]!.args[0]).toBe(atlas.clips.dust!.frames[0]!.x);
        expect(full.calls.some((c) => c.op === "fillRect")).toBe(true);
      } else if (kind === "arc_burst") {
        expect(drawImages[0]!.args[0]).toBe(atlas.clips.uppercut_arc!.frames[0]!.x);
        expect(full.calls.some((c) => c.op === "rotate")).toBe(true);
      }

      // Minimal fake canvas without fillRect or rotate must never throw
      const minimal = makeRecordingCtx(false);
      expect(() => fx.drawProjectiles(minimal.ctx, s, { x: 0, y: 0 })).not.toThrow();
    }

    // Fallback (no atlas) must also render all 5 kinds without throwing
    const fxNull = new EffectsLayer(null);
    const sAll: SimState = structuredClone(state);
    sAll.projectiles = (["orb", "fast_packet", "slow_mine", "shockwave", "arc_burst"] as ProjectileKind[]).map((kind, idx) => ({
      owner: 0,
      x: 30000 + idx * 5000,
      y: 22000,
      vx: 500,
      kind,
    }));
    const fullNull = makeRecordingCtx(true);
    fxNull.drawProjectiles(fullNull.ctx, sAll, { x: 0, y: 0 });
    expect(fullNull.calls.filter((c) => c.op === "fillRect").length).toBeGreaterThanOrEqual(5);
    const minimalNull = makeRecordingCtx(false);
    expect(() => fxNull.drawProjectiles(minimalNull.ctx, sAll, { x: 0, y: 0 })).not.toThrow();
  });
});
