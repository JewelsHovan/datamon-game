// Spec 013 A2: a fight's art comes from the shipped manifests. Loading everything a fight draws
// (both fighters, a mirror match's recolored atlas, the effects, the stage and its walkers) requests only
// files the manifests name: lossless WebP, never .png art, never a datamon/walk/* sheet.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getPeople, getPerson, type Person } from "../data/catalog";
import { detectPlayable } from "../scenes/roster";
import { clearClipCache, loadAltClipSet, loadClipSet, type AtlasImage, type ClipLoaderDeps } from "./clips";
import { loadEffects } from "./effects";
import { loadStageArt, parseStageManifest } from "./stage";

const PUBLIC = resolve(import.meta.dirname, "../../public");

function person(slug: string): Person {
  const p = getPerson(slug);
  if (!p) throw new Error(`missing ${slug}`);
  return p;
}

/** Serves public/ from disk; images are fakes that only know their URL. Records every request. */
function publicDeps() {
  const requests: string[] = [];
  const local = (url: string) => resolve(PUBLIC, url.replace(/^\.\//, "").replace(/\?.*$/, ""));
  const deps: ClipLoaderDeps = {
    async fetchJson(url) {
      requests.push(url);
      const path = local(url);
      return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown) : null;
    },
    async loadImage(url) {
      requests.push(url);
      if (!existsSync(local(url))) throw new Error(`missing ${url}`);
      return { width: 4096, height: 4096, url } as unknown as AtlasImage;
    },
    createCanvas(width, height) {
      const ctx = {
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(16) }),
        putImageData: () => {},
      };
      return { width, height, getContext: () => ctx } as unknown as ReturnType<ClipLoaderDeps["createCanvas"]>;
    },
    warn: (m) => {
      throw new Error(`unexpected warning: ${m}`);
    },
  };
  return { deps, requests };
}

const images = (requests: string[]) => requests.filter((u) => !u.includes(".json"));

describe("a fight loads only WebP art named by the manifests (spec 013)", () => {
  beforeEach(() => clearClipCache());

  it("fighters, a mirror match, effects and the stage request no .png and no walk sheet", async () => {
    const { deps, requests } = publicDeps();
    const julien = person("julien-hovan");
    const [a, b, alt, fx, stage] = await Promise.all([
      loadClipSet(julien, deps),
      loadClipSet(person("pentcho-tchomakov"), deps),
      loadAltClipSet(julien, deps),
      loadEffects(deps),
      loadStageArt(deps),
    ]);
    expect([a.source, b.source, alt.source]).toEqual(["manifest", "manifest", "manifest"]);
    expect(fx).not.toBeNull();
    expect(stage?.walkers?.cast).toHaveLength(7);
    const art = images(requests);
    expect(art.length).toBeGreaterThanOrEqual(7);
    expect(alt.atlas).not.toBe(a.atlas);
    expect(requests.filter((u) => u.includes("palette-alt"))).toEqual([]);
    for (const url of art) expect(url).toMatch(/\.webp\?v=\d+$/);
    expect(requests.filter((u) => u.includes(".png"))).toEqual([]);
    expect(requests.filter((u) => u.includes("datamon/walk/"))).toEqual([]);
    expect(art).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\.\/fighters\/julien-hovan\/atlas\.webp\?v=\d+$/),
        expect.stringMatching(/^\.\/fighters\/pentcho-tchomakov\/atlas\.webp\?v=\d+$/),
        // a mirror match draws P2 from the recolored atlas the manifest names (QA 2026-11-12 F1)
        expect.stringMatching(/^\.\/fighters\/julien-hovan\/atlas-alt\.webp\?v=\d+$/),
        expect.stringMatching(/^\.\/effects\/atlas\.webp\?v=\d+$/),
        expect.stringMatching(/^\.\/stages\/office\/far\.webp\?v=\d+$/),
        expect.stringMatching(/^\.\/stages\/office\/mid\.webp\?v=\d+$/),
        expect.stringMatching(/^\.\/stages\/office\/walkers\.webp\?v=\d+$/),
      ]),
    );
  });

  it("the walker cast and frames come from the stage manifest, not from the catalog", async () => {
    const raw = JSON.parse(readFileSync(resolve(PUBLIC, "stages/office/manifest.json"), "utf8")) as {
      walkers: { cast: { slug: string }[] };
    };
    const { deps } = publicDeps();
    const stage = await loadStageArt(deps);
    expect(stage?.walkers?.cast.map((c) => c.slug)).toEqual(raw.walkers.cast.map((c) => c.slug));
    for (const c of stage!.walkers!.cast) {
      expect(getPerson(c.slug)).toBeDefined();
      expect(c.frames).toHaveLength(4);
    }
    expect(stage!.walkers!.stand).toBe(2);
  });

  it("the shipped fighter index lists exactly the fighters with a manifest, so nobody else is probed", async () => {
    const { deps, requests } = publicDeps();
    const playable = await detectPlayable(getPeople(), deps);
    const withManifest = getPeople().filter((p) => existsSync(resolve(PUBLIC, "fighters", p.slug, "manifest.json"))).map((p) => p.slug);
    expect([...playable].sort()).toEqual(withManifest.sort());
    expect(withManifest).toHaveLength(4);
    expect(requests).toEqual(["./fighters/index.json"]);
    // A coworker without art loads straight from the walk sheet: no manifest request.
    requests.length = 0;
    const jewoo = person("jewoo-lee");
    await loadClipSet(jewoo, deps);
    expect(requests).toEqual([jewoo.sheetUrl]);
  });

  it("a stage manifest without a usable walkers block still loads its layers", () => {
    const m = parseStageManifest({
      version: 3,
      floorColor: "#000000",
      layers: [{ id: "far", file: "far.webp", w: 864, h: 360, factor: 0.35, y: 0 }],
      walkers: { file: "../walkers.webp", cast: [] },
    });
    expect(m?.layers).toHaveLength(1);
    expect(m?.walkers).toBeNull();
    expect(parseStageManifest({ floorColor: "#000000", layers: [{ id: "x", file: "a/b.webp", w: 1, factor: 1, y: 0 }] })).toBeNull();
  });
});
