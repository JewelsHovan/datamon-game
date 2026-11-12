import { describe, expect, it } from "vitest";
import { MOVEMENT } from "../data/movement";
import {
  BUTTON_DOWN as D,
  BUTTON_LEFT as L,
  BUTTON_RIGHT as R,
  BUTTON_UP as U,
} from "./inputBits";
import { MAX_SEPARATION, WALL_LEFT, WALL_RIGHT, pushboxesOverlap } from "./physics";
import { fighterInfo } from "../data/fighters";
import { createSandboxState } from "./state";
import { step } from "./step";
import {
  SANDBOX_P1,
  SANDBOX_P2,
  SANDBOX_SCRIPT,
  SANDBOX_SCRIPT_SEED,
} from "./testing/sandboxScript";
import type { InputPair, SimState } from "./types";

function fresh(): SimState {
  return createSandboxState(7, SANDBOX_P1, SANDBOX_P2);
}

function repeat(state: SimState, frames: number, inputs: InputPair): SimState {
  let s = state;
  for (let i = 0; i < frames; i++) s = step(s, inputs);
  return s;
}

function withPositions(state: SimState, p1x: number, p2x: number): SimState {
  const s = structuredClone(state);
  s.fighters[0].x = p1x;
  s.fighters[1].x = p2x;
  s.fighters[0].facing = p1x < p2x ? 1 : -1;
  s.fighters[1].facing = p1x < p2x ? -1 : 1;
  return s;
}

describe("movement (A8)", () => {
  it("movement numbers match the spec 001 decisions (subpixels)", () => {
    expect(MOVEMENT).toMatchObject({
      floorY: 32000,
      stageWidth: 128000,
      screenMargin: 4000,
      walkForwardSpeed: 180, // spec 012: matched to the walk art stride (was 270)
      walkBackSpeed: 150, // spec 012 (was 200)
      jumpsquatFrames: 4,
      jumpLaunchSpeed: 1160,
      gravity: 58,
      jumpHorizontalSpeed: 330,
      landingFrames: 3,
      pushboxWidth: 4600,
    });
  });

  it("a neutral jump leaves the ground after the jumpsquat and lands on a fixed frame", () => {
    // Jump timing derived from the data: 4 jumpsquat frames, then exactly 40 airborne frames.
    expect(MOVEMENT.jumpsquatFrames).toBe(4);
    expect(MOVEMENT.gravity % 2).toBe(0);

    let s = fresh();
    const trace: { frame: number; state: string; y: number }[] = [];
    const pressFrame = s.frame + 1; // up is held on this step only
    s = step(s, [U, 0]);
    trace.push({ frame: s.frame, state: s.fighters[0].state, y: s.fighters[0].y });
    for (let i = 0; i < 60; i++) {
      s = step(s, [0, 0]);
      trace.push({ frame: s.frame, state: s.fighters[0].state, y: s.fighters[0].y });
    }
    const at = (frame: number) => trace.find((t) => t.frame === frame)!;

    // Frames pressFrame .. pressFrame+3: jumpsquat, still on the floor.
    for (let f = pressFrame; f <= pressFrame + 3; f++) {
      expect(at(f)).toMatchObject({ state: "jumpsquat", y: MOVEMENT.floorY });
    }
    // pressFrame+4: first airborne frame, off the floor.
    expect(at(pressFrame + 4).state).toBe("airborne");
    expect(at(pressFrame + 4).y).toBeLessThan(MOVEMENT.floorY);
    // Airborne through pressFrame+42, touching down on pressFrame+43 (40 airborne steps).
    for (let f = pressFrame + 4; f <= pressFrame + 42; f++) {
      expect(at(f).state).toBe("airborne");
      expect(at(f).y).toBeLessThan(MOVEMENT.floorY);
    }
    expect(at(pressFrame + 43)).toMatchObject({ state: "landing", y: MOVEMENT.floorY });
    // Concretely: pressing up on frame 1 lands on frame 44.
    expect(pressFrame).toBe(1);
    expect(at(44)).toMatchObject({ state: "landing", y: MOVEMENT.floorY });
    // Three landing frames, then idle.
    expect(at(pressFrame + 45).state).toBe("landing");
    expect(at(pressFrame + 46).state).toBe("idle");
    // Apex about 116 px above the floor.
    const apex = Math.min(...trace.map((t) => t.y));
    expect(MOVEMENT.floorY - apex).toBe(11600);
  });

  it("forward walk is faster than back walk", () => {
    const start = fresh();
    const p1x = start.fighters[0].x;
    const forward = repeat(start, 30, [R, 0]).fighters[0].x - p1x;
    const back = p1x - repeat(start, 30, [L, 0]).fighters[0].x;
    expect(forward).toBe(30 * MOVEMENT.walkForwardSpeed);
    expect(back).toBe(30 * MOVEMENT.walkBackSpeed);
    expect(forward).toBeGreaterThan(back);
  });

  it("walking back is relative to facing", () => {
    // P2 faces left, so holding right walks P2 back.
    const start = fresh();
    const s = repeat(start, 10, [0, R]);
    expect(s.fighters[1].state).toBe("walk_back");
    // Each fighter walks at its own percentage of the shared speed (spec 006).
    const speed = Math.floor((MOVEMENT.walkBackSpeed * fighterInfo(SANDBOX_P2).walkPct) / 100);
    expect(s.fighters[1].x - start.fighters[1].x).toBe(10 * speed);
  });

  it("a fighter held against a wall stays at the wall", () => {
    let s = withPositions(fresh(), 10000, 30000);
    for (let i = 0; i < 300; i++) {
      s = step(s, [L, 0]);
      expect(s.fighters[0].x).toBeGreaterThanOrEqual(WALL_LEFT);
    }
    expect(s.fighters[0].x).toBe(WALL_LEFT);
    expect(s.fighters[0].state).toBe("walk_back");

    let r = withPositions(fresh(), 98000, 118000);
    for (let i = 0; i < 300; i++) {
      r = step(r, [0, R]);
      expect(r.fighters[1].x).toBeLessThanOrEqual(WALL_RIGHT);
    }
    expect(r.fighters[1].x).toBe(WALL_RIGHT);
  });

  it("walking into the opponent pushes them; at the wall the walker is stopped", () => {
    let s = withPositions(fresh(), 60000, 65000);
    const p2Start = s.fighters[1].x;
    s = repeat(s, 60, [R, 0]);
    expect(s.fighters[1].x).toBeGreaterThan(p2Start);
    expect(s.fighters[1].x - s.fighters[0].x).toBe(MOVEMENT.pushboxWidth);

    let w = withPositions(fresh(), WALL_RIGHT - 8000, WALL_RIGHT);
    w = repeat(w, 120, [R, 0]);
    expect(w.fighters[1].x).toBe(WALL_RIGHT);
    expect(w.fighters[1].x - w.fighters[0].x).toBe(MOVEMENT.pushboxWidth);
  });

  it("separation never exceeds the screen limit", () => {
    expect(MAX_SEPARATION).toBe(56000);
    const sequences: InputPair[] = [
      [L, R], // both walk back
      [L, 0], // only P1 walks back
      [0, R], // only P2 walks back
      [U | L, U | R], // both jump back
      [U | L, 0],
    ];
    for (const inputs of sequences) {
      let s = fresh();
      for (let i = 0; i < 400; i++) {
        s = step(s, inputs);
        expect(Math.abs(s.fighters[1].x - s.fighters[0].x)).toBeLessThanOrEqual(MAX_SEPARATION);
      }
    }
    // Both walking back ends exactly at the limit.
    const s = repeat(fresh(), 400, [L, R]);
    expect(s.fighters[1].x - s.fighters[0].x).toBe(MAX_SEPARATION);
  });

  it("after every step of the A5 sequence the pushboxes do not overlap", () => {
    let s = createSandboxState(SANDBOX_SCRIPT_SEED, SANDBOX_P1, SANDBOX_P2);
    let checked = 0;
    for (const inputs of SANDBOX_SCRIPT) {
      s = step(s, inputs);
      expect(pushboxesOverlap(s.fighters[0], s.fighters[1]), `frame ${s.frame}`).toBe(false);
      for (const f of s.fighters) {
        expect(f.x).toBeGreaterThanOrEqual(WALL_LEFT);
        expect(f.x).toBeLessThanOrEqual(WALL_RIGHT);
        expect(f.y).toBeLessThanOrEqual(MOVEMENT.floorY);
      }
      checked++;
    }
    expect(checked).toBe(600);
  });

  it("after jumping over the opponent, both fighters' facing flips on landing, not in the air", () => {
    // P1 forward-jumps from 76 px away, the A5 sequence's jump-over spacing.
    let s = withPositions(fresh(), 63450, 71050);
    s = step(s, [U | R, 0]);
    let crossedInAir = false;
    let landed = false;
    for (let i = 0; i < 60 && !landed; i++) {
      s = step(s, [0, 0]);
      const [p1, p2] = s.fighters;
      if (p1.state === "landing") {
        // The touchdown step: both have turned around.
        landed = true;
        expect(p1.facing).toBe(-1);
        expect(p2.facing).toBe(1);
        expect(p1.x).toBeGreaterThan(p2.x);
      } else {
        // Jumpsquat and every airborne step: facings unchanged, even after crossing.
        expect(p1.facing).toBe(1);
        expect(p2.facing).toBe(-1);
        if (p1.state === "airborne" && p1.x > p2.x) crossedInAir = true;
      }
    }
    expect(crossedInAir).toBe(true);
    expect(landed).toBe(true);
  });

  it("crouch holds the fighter in place and down beats forward", () => {
    const start = fresh();
    const s = repeat(start, 20, [D | R, 0]);
    expect(s.fighters[0].state).toBe("crouch");
    expect(s.fighters[0].x).toBe(start.fighters[0].x);
  });

  it("forward and back jumps travel 40 frames at the jump speed", () => {
    const start = fresh();
    const fwd = repeat(step(start, [U | R, 0]), 46, [0, 0]);
    expect(fwd.fighters[0].x - start.fighters[0].x).toBe(40 * MOVEMENT.jumpHorizontalSpeed);
    const back = repeat(step(start, [U | L, 0]), 46, [0, 0]);
    expect(start.fighters[0].x - back.fighters[0].x).toBe(40 * MOVEMENT.jumpHorizontalSpeed);
  });
});
