import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getPerson, type Person } from "../data/catalog";
import {
  FIGHTER_INDEX_URL,
  ManifestError,
  PLACEHOLDER_SCALE,
  PLACEHOLDER_WALK_HOLD,
  atlasUrl,
  clearClipCache,
  clipFrameIndex,
  framesOutsideAtlas,
  hardenAlpha,
  loadClipSet,
  manifestUrl,
  parseFighterIndex,
  parseManifest,
  placeholderLayout,
  type AtlasImage,
  type ClipLoaderDeps,
} from "./clips";

const FIXTURE_PATH = resolve(import.meta.dirname, "fixtures/test-fighter.manifest.json");
const fixtureJson = (): unknown => JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

function person(slug: string): Person {
  const p = getPerson(slug);
  if (!p) throw new Error(`missing ${slug}`);
  return p;
}

/** Fake loader deps: serves the fixture for `manifestFor`, fake images and a recording canvas. */
function fakeDeps(manifestFor: string | null) {
  const fetched: string[] = [];
  const images: string[] = [];
  const draws: number[][] = [];
  const warnings: string[] = [];
  let hardened = 0;
  const deps: ClipLoaderDeps = {
    async fetchJson(url) {
      fetched.push(url);
      return manifestFor !== null && url === manifestUrl(manifestFor) ? fixtureJson() : null;
    },
    async loadImage(url) {
      images.push(url);
      return { width: url.includes("/atlas.") ? 384 : 440, height: 960 } as unknown as AtlasImage;
    },
    createCanvas(width, height) {
      const data = new Uint8ClampedArray(width * height * 4).fill(100);
      const ctx = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        drawImage: (...args: unknown[]) => draws.push(args.slice(1) as number[]),
        getImageData: () => ({ data }),
        putImageData: () => {
          hardened = data.filter((_, i) => i % 4 === 3).every((a) => a === 0 || a === 255)
            ? hardened + 1
            : hardened;
        },
      };
      return { width, height, getContext: () => ctx } as unknown as ReturnType<
        ClipLoaderDeps["createCanvas"]
      >;
    },
    warn: (m) => warnings.push(m),
  };
  return {
    deps,
    fetched,
    images,
    draws,
    warnings,
    get hardened() {
      return hardened;
    },
  };
}

describe("clip manifest format", () => {
  it("accepts the fixture manifest unchanged", () => {
    const m = parseManifest(fixtureJson());
    expect(m.fighter).toBe("julien-hovan");
    expect(m.version).toBe(1);
    expect(m.scale).toBe(0.27);
    expect(m.facing).toBe("right");
    expect(Object.keys(m.clips)).toEqual(["idle", "walk", "crouch", "heavy_punch"]);
    expect(m.clips.heavy_punch!.frames[0]).toEqual({
      x: 0, y: 281, w: 96, h: 142, ax: 30, ay: 141, hold: 4,
    });
    expect(framesOutsideAtlas(m.clips, 384, 424)).toEqual([]);
    expect(framesOutsideAtlas(m.clips, 300, 424)).toEqual(["crouch[0]", "crouch[1]"]);
  });

  it("accepts the exact example from docs/game-design.md and ignores extra fields", () => {
    const example = {
      fighter: "julien-hovan",
      version: 1,
      scale: 0.27,
      facing: "right",
      clips: {
        heavy_punch: {
          loop: false,
          frames: [{ x: 0, y: 0, w: 96, h: 142, ax: 30, ay: 141, hold: 4 }],
        },
      },
      generator: "art/pipeline/pack.py",
    };
    expect(parseManifest(example).clips.heavy_punch!.frames).toHaveLength(1);
  });

  it.each([
    ["a non-object", 42, /must be an object/],
    ["a missing fighter", { version: 1, clips: {} }, /fighter/],
    ["no clips", { fighter: "a", version: 1, clips: {} }, /empty/],
    [
      "an empty frame list",
      { fighter: "a", version: 1, clips: { idle: { loop: true, frames: [] } } },
      /frames/,
    ],
    [
      "a zero hold",
      {
        fighter: "a",
        version: 1,
        clips: { idle: { loop: true, frames: [{ x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 0, hold: 0 }] } },
      },
      /hold/,
    ],
    [
      "a missing anchor",
      {
        fighter: "a",
        version: 1,
        clips: { idle: { loop: true, frames: [{ x: 0, y: 0, w: 1, h: 1, ay: 0, hold: 1 }] } },
      },
      /ax/,
    ],
    [
      "an atlas outside the fighter's folder",
      {
        fighter: "a",
        atlas: "../other/atlas.webp",
        version: 1,
        clips: { idle: { loop: true, frames: [{ x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 0, hold: 1 }] } },
      },
      /atlas/,
    ],
  ])("rejects %s", (_label, data, message) => {
    expect(() => parseManifest(data)).toThrow(ManifestError);
    expect(() => parseManifest(data)).toThrow(message);
  });
});

describe("frame timing from holds", () => {
  const m = parseManifest(fixtureJson());

  it("a looping clip wraps after the sum of its holds", () => {
    const idle = m.clips.idle!; // 4 frames x 6 ticks
    expect([0, 5, 6, 11, 12, 23, 24, 30].map((t) => clipFrameIndex(idle, t))).toEqual([
      0, 0, 1, 1, 2, 3, 0, 1,
    ]);
  });

  it("a one-shot clip stays on its last frame", () => {
    const crouch = m.clips.crouch!; // holds 3, 4
    expect([0, 2, 3, 6, 7, 100].map((t) => clipFrameIndex(crouch, t))).toEqual([0, 0, 1, 1, 1, 1]);
  });
});

describe("placeholder clips from the walk sheet", () => {
  it("lays out the 4 right-facing walk frames with the standing frame for idle, crouch and jump", () => {
    const julien = person("julien-hovan");
    const layout = placeholderLayout(julien);
    expect(layout.cells).toHaveLength(4);
    // Row 3 of the sheet (facing right), cells read from the catalog's cellW / cellH.
    expect(layout.cells.map((c) => [c.sx, c.sy, c.sw, c.sh])).toEqual([
      [0, 720, 110, 240],
      [110, 720, 110, 240],
      [220, 720, 110, 240],
      [330, 720, 110, 240],
    ]);
    // Source footY 228 lands at 150 px.
    for (const c of layout.cells) expect(c.frame.ay).toBe(150);
    expect(Math.round(228 * PLACEHOLDER_SCALE)).toBe(150);
    expect(layout.clips.walk!.frames).toHaveLength(4);
    expect(layout.clips.walk!.frames.every((f) => f.hold === PLACEHOLDER_WALK_HOLD)).toBe(true);
    const standing = layout.cells[2]!.frame;
    for (const name of ["idle", "crouch", "jump"]) {
      expect(layout.clips[name]!.frames).toEqual([standing]);
    }
    // Every frame fits in the atlas.
    expect(framesOutsideAtlas(layout.clips, layout.atlasWidth, layout.atlasHeight)).toEqual([]);
  });

  it("uses each person's own cell width", () => {
    const widths = new Set(
      ["julien-hovan", "felicia-gorgacheva", "jewoo-lee", "veronica-marallag"].map(
        (slug) => placeholderLayout(person(slug)).cells[1]!.sx,
      ),
    );
    expect(widths.size).toBeGreaterThan(1);
  });

  it("hardens alpha to fully opaque or fully transparent", () => {
    const px = new Uint8ClampedArray([10, 20, 30, 127, 10, 20, 30, 128, 1, 2, 3, 254]);
    hardenAlpha(px);
    expect([...px]).toEqual([0, 0, 0, 0, 10, 20, 30, 255, 1, 2, 3, 255]);
  });
});

describe("clip loader", () => {
  beforeEach(() => clearClipCache());

  it("loads manifest.json and the atlas it names when the fighter has them", async () => {
    const f = fakeDeps("julien-hovan");
    const set = await loadClipSet(person("julien-hovan"), f.deps);
    expect(set.source).toBe("manifest");
    // No fighter index in this fake, so the loader probes the manifest (older builds).
    expect(f.fetched).toEqual([FIGHTER_INDEX_URL, "./fighters/julien-hovan/manifest.json"]);
    expect(f.images).toEqual([atlasUrl("julien-hovan", parseManifest(fixtureJson()))]);
    expect(f.images).toEqual(["./fighters/julien-hovan/atlas.webp?v=1"]);
    expect(set.clips).toEqual(parseManifest(fixtureJson()).clips);
    expect(set.artFacing).toBe(1);
    expect(f.warnings).toEqual([]);
  });

  it("builds placeholder clips from the walk sheet when there is no manifest", async () => {
    const f = fakeDeps(null);
    const felicia = person("felicia-gorgacheva");
    const set = await loadClipSet(felicia, f.deps);
    expect(set.source).toBe("placeholder");
    expect(f.images).toEqual([felicia.sheetUrl]);
    expect(f.draws).toHaveLength(4);
    expect(f.hardened).toBe(1);
    expect(Object.keys(set.clips).sort()).toEqual(["crouch", "idle", "jump", "walk"]);
  });

  it("falls back to placeholders with a warning when the manifest is invalid", async () => {
    const f = fakeDeps(null);
    f.deps.fetchJson = async () => ({ fighter: "julien-hovan", version: 1, clips: {} });
    const set = await loadClipSet(person("julien-hovan"), f.deps);
    expect(set.source).toBe("placeholder");
    expect(f.warnings.some((w) => w.includes("unusable manifest"))).toBe(true);
  });

  it("rejects when the manifest's atlas does not load, so the page can show its failure screen (spec 014)", async () => {
    const f = fakeDeps("julien-hovan");
    f.deps.loadImage = async () => {
      throw new Error("EncodingError: the atlas request was blocked");
    };
    await expect(loadClipSet(person("julien-hovan"), f.deps)).rejects.toThrow("blocked");
    expect(f.warnings).toEqual([]);
    // Not cached: a later attempt (after a reload) loads again.
    const g = fakeDeps("julien-hovan");
    expect((await loadClipSet(person("julien-hovan"), g.deps)).source).toBe("manifest");
  });

  it("skips the manifest request for people mayHaveArt rules out (no 404, spec 014 A8)", async () => {
    const f = fakeDeps("jewoo-lee");
    f.deps.mayHaveArt = (slug) => slug === "julien-hovan";
    const set = await loadClipSet(person("jewoo-lee"), f.deps);
    expect(set.source).toBe("placeholder");
    expect(f.fetched).toEqual([FIGHTER_INDEX_URL]); // the index (spec 013) is read; no manifest request
  });

  it("caches each fighter's clips", async () => {
    const f = fakeDeps(null);
    const p = person("jewoo-lee");
    const [a, b] = await Promise.all([loadClipSet(p, f.deps), loadClipSet(p, f.deps)]);
    expect(a).toBe(b);
    expect(f.fetched).toEqual([FIGHTER_INDEX_URL, manifestUrl(p.slug)]);
  });
});

describe("fighter index (spec 013)", () => {
  beforeEach(() => clearClipCache());

  /** fakeDeps serving an index that lists `listed`, plus the fixture manifest for Julien. */
  function indexed(listed: string[]) {
    const f = fakeDeps("julien-hovan");
    const fetchJson = f.deps.fetchJson;
    f.deps.fetchJson = async (url) => {
      if (url !== FIGHTER_INDEX_URL) return fetchJson(url);
      f.fetched.push(url);
      return { fighters: Object.fromEntries(listed.map((s) => [s, { manifest: "manifest.json", atlas: "atlas.webp", version: 1 }])) };
    };
    return f;
  }

  it("skips the manifest request for anyone the index does not list (no 404s)", async () => {
    const f = indexed(["julien-hovan"]);
    const jewoo = person("jewoo-lee");
    const set = await loadClipSet(jewoo, f.deps);
    expect(set.source).toBe("placeholder");
    expect(f.fetched).toEqual([FIGHTER_INDEX_URL]);
    expect(f.images).toEqual([jewoo.sheetUrl]);
  });

  it("loads the manifest for a listed fighter, and fetches the index once per loader", async () => {
    const f = indexed(["julien-hovan"]);
    const [a] = await Promise.all([loadClipSet(person("julien-hovan"), f.deps), loadClipSet(person("jewoo-lee"), f.deps)]);
    expect(a.source).toBe("manifest");
    expect(f.fetched.filter((u) => u === FIGHTER_INDEX_URL)).toHaveLength(1);
    expect(f.fetched).toContain(manifestUrl("julien-hovan"));
    expect(f.fetched).not.toContain(manifestUrl("jewoo-lee"));
  });

  it("parses only index-shaped data", () => {
    expect([...parseFighterIndex({ fighters: { a: {}, b: {} } })!]).toEqual(["a", "b"]);
    expect(parseFighterIndex(null)).toBeNull();
    expect(parseFighterIndex({ fighters: ["a"] })).toBeNull();
  });
});
