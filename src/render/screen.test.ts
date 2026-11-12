import { describe, expect, it } from "vitest";
import { createSandboxState } from "../sim/state";
import { cameraFor } from "./camera";
import { fitScreen } from "./screen";

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
    s.fighters[1].x = 124000;
    expect(cameraFor(s).x).toBe(640);
  });
});
