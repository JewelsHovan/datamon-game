// Integrity checks for the complete 37-fighter playable roster (spec 006, spec 016, spec 017):
// catalog linkage, all 35 Battlemon slugs represented, even gravity offsets, 74 distinct
// specials, archetype balance, shipped manifests + hit/hurt box JSONs, and frame-bounds safety
// against every MoveDef in MOVES.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BOXES } from "./boxes/index";
import { getCreatures, getPeople } from "./catalog";
import { FIGHTERS } from "./fighters";
import { MOVES } from "./moves";

const ROOT = resolve(import.meta.dirname, "../..");
const PUBLIC_FIGHTERS = resolve(ROOT, "public/fighters");
const BOXES_DIR = resolve(ROOT, "src/data/boxes");

interface ManifestJson {
  fighter: string;
  clips: Record<string, { frames: unknown[] }>;
}

describe("playable fighter roster (37 fighters, 74 specials)", () => {
  const entries = Object.values(FIGHTERS);
  const slugs = Object.keys(FIGHTERS);

  it("has all 37 catalog people as playable fighters with matching slugs", () => {
    expect(entries).toHaveLength(37);
    const peopleSlugs = new Set(getPeople().map((p) => p.slug));
    expect(peopleSlugs.size).toBe(37);
    for (const [key, fighter] of Object.entries(FIGHTERS)) {
      expect(fighter.slug).toBe(key);
      expect(peopleSlugs.has(key)).toBe(true);
    }
  });

  it("assigns valid Battlemon slugs and covers all 35 creatures in getCreatures()", () => {
    const creatureSlugs = new Set(getCreatures().map((c) => c.slug));
    const used = new Set<string>();
    for (const fighter of entries) {
      expect(creatureSlugs.has(fighter.battlemonSlug)).toBe(true);
      used.add(fighter.battlemonSlug);
    }
    expect(used.size).toBe(35);
  });

  it("balances all five archetypes across the 37 fighters (8/8/7/7/7)", () => {
    const counts: Record<string, number> = {};
    for (const f of entries) counts[f.archetype] = (counts[f.archetype] ?? 0) + 1;
    expect(counts).toEqual({
      "all-rounder": 8,
      rusher: 8,
      bruiser: 7,
      zoner: 7,
      trickster: 7,
    });
  });

  it("gives every fighter an even gravityOffset so half-gravity shifts are exact", () => {
    for (const fighter of entries) {
      expect(fighter.gravityOffset % 2 === 0).toBe(true);
    }
  });

  it("defines 74 distinct special moves and names across the 37 fighters", () => {
    const moveIds = entries.flatMap((f) => [f.specialMove, f.altSpecialMove]);
    const moveNames = entries.flatMap((f) => [f.specialName, f.altSpecialName]);
    expect(moveIds).toHaveLength(74);
    expect(new Set(moveIds).size).toBe(74);
    expect(new Set(moveNames).size).toBe(74);
    for (const id of moveIds) {
      expect(MOVES[id]).toBeDefined();
    }
  });

  it("has a packed manifest.json, boxes/<slug>.json, and valid clip frames for every usable MoveDef", () => {
    const allSpecials = new Set(entries.flatMap((f) => [f.specialMove, f.altSpecialMove]));
    const universalMoves = Object.values(MOVES).filter((m) => !allSpecials.has(m.id));
    for (const slug of slugs) {
      const fighter = FIGHTERS[slug]!;
      const manifestPath = resolve(PUBLIC_FIGHTERS, slug, "manifest.json");
      const boxesPath = resolve(BOXES_DIR, `${slug}.json`);
      expect(existsSync(manifestPath), `missing ${manifestPath}`).toBe(true);
      expect(existsSync(boxesPath), `missing ${boxesPath}`).toBe(true);
      expect(BOXES[slug]).toBeDefined();

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestJson;
      expect(manifest.fighter).toBe(slug);

      const fighterMoves = [...universalMoves, MOVES[fighter.specialMove], MOVES[fighter.altSpecialMove]];
      for (const move of fighterMoves) {
        const clip = manifest.clips[move.clip];
        expect(clip, `${slug}: missing clip "${move.clip}" for move "${move.id}"`).toBeDefined();
        for (const seg of move.segments) {
          expect(
            seg.frame,
            `${slug} move "${move.id}" clip "${move.clip}" segment frame ${seg.frame} >= ${clip!.frames.length}`,
          ).toBeLessThan(clip!.frames.length);
        }
      }
    }
  });
});
