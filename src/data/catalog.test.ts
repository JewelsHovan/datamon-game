import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STANDING_WALK_FRAME, getCreatures, getPeople, getPerson } from "./catalog";

const PUBLIC_DIR = resolve(import.meta.dirname, "../../public");

describe("catalog wrapper (A2)", () => {
  const people = getPeople();

  it("returns exactly 37 people, all datamon_person, no voxel skins", () => {
    expect(people).toHaveLength(37);
    for (const p of people) expect(p.kind).toBe("datamon_person");
    expect(people.some((p) => p.id <= 5)).toBe(false);
    expect(new Set(people.map((p) => p.slug)).size).toBe(37);
  });

  it("every person has a portrait URL, a sheet URL and 4 frames for left and right", () => {
    for (const p of people) {
      expect(p.portraitUrl, p.slug).toMatch(/^\.\/datamon\/portraits\/.+\.webp$/);
      expect(p.sheetUrl, p.slug).toMatch(/^\.\/datamon\/walk\/.+\.webp$/);
      expect(p.frames.left, p.slug).toHaveLength(4);
      expect(p.frames.right, p.slug).toHaveLength(4);
      for (const f of [...p.frames.left, ...p.frames.right]) {
        expect(f.frameWidth).toBeGreaterThan(0);
        expect(f.bodyX).toBeGreaterThan(0);
        expect(f.footY).toBeGreaterThan(0);
        expect(f.footY).toBeLessThanOrEqual(p.cellH);
      }
    }
  });

  it("the portrait and sheet files exist in public/", () => {
    for (const p of people) {
      expect(existsSync(resolve(PUBLIC_DIR, p.portraitUrl)), p.portraitUrl).toBe(true);
      expect(existsSync(resolve(PUBLIC_DIR, p.sheetUrl)), p.sheetUrl).toBe(true);
    }
  });

  it("cell sizes come from the catalog (cellW 99..130, cellH 240)", () => {
    for (const p of people) {
      expect(p.cellW).toBeGreaterThanOrEqual(99);
      expect(p.cellW).toBeLessThanOrEqual(130);
      expect(p.cellH).toBe(240);
    }
  });

  it("looks people up by slug", () => {
    expect(getPerson("julien-hovan")?.shortName).toBe("Julien H.");
    expect(getPerson("felicia-gorgacheva")?.kind).toBe("datamon_person");
    expect(getPerson("nobody")).toBeUndefined();
    expect(getPerson("classic-cyan")).toBeUndefined();
  });

  it("exposes the standing walk frame and the 35 creatures", () => {
    expect(STANDING_WALK_FRAME.right).toBe(2);
    expect(STANDING_WALK_FRAME.left).toBe(2);
    expect(getCreatures()).toHaveLength(35);
  });
});
