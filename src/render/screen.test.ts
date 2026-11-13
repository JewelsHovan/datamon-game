import { describe, expect, it } from "vitest";
import { createSandboxState } from "../sim/state";
import { cameraFor } from "./camera";
import { fitScreen, needsRotate } from "./screen";

describe("screen fit (R6)", () => {
  it.each([
    [1440, 900, 2, 1280, 720],
    [800, 600, 1, 640, 360],
    [1920, 1080, 3, 1920, 1080],
    [2560, 1440, 4, 2560, 1440],
    [1300, 2000, 2, 1280, 720],
  ])("%ix%i scales by %i", (w, h, scale, cssW, cssH) => {
    const fit = fitScreen(w, h);
    expect(fit).toMatchObject({ scale, cssWidth: cssW, cssHeight: cssH });
    expect(fit.left).toBe(Math.floor((w - cssW) / 2));
    expect(fit.top).toBe(Math.floor((h - cssH) / 2));
  });

  it("scales fractionally only below 640x360", () => {
    expect(fitScreen(320, 180).scale).toBe(0.5);
    expect(fitScreen(639, 1000).scale).toBeLessThan(1);
  });
});

describe("screen fit on touch devices (spec 015, R3, R5)", () => {
  it.each([
    // landscape phones fill the height, tablets the width
    [667, 375],
    [844, 390],
    [932, 430],
    [1024, 768],
    [1180, 820],
  ])("%ix%i fills one side fractionally, letterboxed, nothing cut off", (w, h) => {
    const fit = fitScreen(w, h, { fractional: true });
    expect(fit.scale).toBeCloseTo(Math.min(w / 640, h / 360), 9);
    const fillsHeight = Math.abs(fit.cssHeight - h) < 1e-6;
    const fillsWidth = Math.abs(fit.cssWidth - w) < 1e-6;
    expect(fillsHeight || fillsWidth).toBe(true);
    expect(fit.cssWidth / fit.cssHeight).toBeCloseTo(16 / 9, 9);
    expect(fit.left).toBeGreaterThanOrEqual(0);
    expect(fit.top).toBeGreaterThanOrEqual(0);
    expect(fit.left + fit.cssWidth).toBeLessThanOrEqual(w + 1e-6);
    expect(fit.top + fit.cssHeight).toBeLessThanOrEqual(h + 1e-6);
  });

  it("uses the whole height of a landscape phone", () => {
    expect(fitScreen(844, 390, { fractional: true }).cssHeight).toBeCloseTo(390, 6);
    expect(fitScreen(844, 390).scale).toBe(1); // without touch: integer scaling
  });

  it("keeps desktop integer scaling unchanged", () => {
    expect(fitScreen(1366, 768)).toMatchObject({ scale: 2, cssWidth: 1280, cssHeight: 720 });
    expect(fitScreen(1920, 1080, { fractional: false }).scale).toBe(3);
  });

  it("stays inside the safe-area insets", () => {
    const insets = { top: 0, right: 47, bottom: 21, left: 47 };
    const fit = fitScreen(844, 390, { fractional: true, insets });
    expect(fit.cssHeight).toBeCloseTo(369, 6);
    expect(fit.left).toBeGreaterThanOrEqual(47);
    expect(fit.left + fit.cssWidth).toBeLessThanOrEqual(844 - 47);
    expect(fit.top + fit.cssHeight).toBeLessThanOrEqual(390 - 21 + 1e-6);
  });

  it("shows the rotate screen only for touch devices in portrait", () => {
    expect(needsRotate(390, 844, true)).toBe(true);
    expect(needsRotate(844, 390, true)).toBe(false);
    expect(needsRotate(390, 844, false)).toBe(false);
  });
});

describe("camera (R6)", () => {
  it("follows the midpoint between the fighters", () => {
    const s = createSandboxState(1, "julien-hovan", "felicia-gorgacheva");
    expect(cameraFor(s).x).toBe(320); // midpoint 640 px on a 1280 px stage
    s.fighters[0].x = 70000;
    s.fighters[1].x = 90000;
    expect(cameraFor(s).x).toBe(480);
  });

  it("is clamped to the stage", () => {
    const s = createSandboxState(1, "julien-hovan", "felicia-gorgacheva");
    s.fighters[0].x = 4000;
    s.fighters[1].x = 20000;
    expect(cameraFor(s).x).toBe(0);
    s.fighters[0].x = 110000;
    s.fighters[1].x = 120000;
    expect(cameraFor(s).x).toBe(640);
  });
});
