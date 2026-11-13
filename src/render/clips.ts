// Animation clips (docs/game-design.md, "Animation clip format").
// A fighter's clips come from public/fighters/<slug>/manifest.json and the atlas
// it names (lossless WebP, spec 013) when they exist; otherwise placeholder clips
// are built from the walk sheet.
import { STANDING_WALK_FRAME, WALK_ROWS, type Person } from "../data/catalog";

/** Atlas file when a manifest does not name one (the art pipeline always does). */
export const ATLAS_FILE = "atlas.webp";

/**
 * URL of a file the art pipeline shipped next to a manifest. The manifest's version is the
 * cache key: art is cached for up to an hour (public/_headers), and a new manifest must never
 * be paired with an old cached atlas.
 */
export function artUrl(dir: string, file: string, version: number): string {
  return `${dir}/${file}?v=${version}`;
}

export interface ClipFrame {
  /** Rectangle in the atlas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Anchor inside the rectangle: the point that sits on the fighter's position. */
  ax: number;
  ay: number;
  /** Default ticks (60 Hz) this frame shows. */
  hold: number;
}

export interface Clip {
  loop: boolean;
  frames: ClipFrame[];
}

export interface FighterManifest {
  fighter: string;
  /** Atlas file name next to the manifest. */
  atlas: string;
  /**
   * The same atlas with P2's alternate colors for mirror matches (QA 2026-11-12 F1): recolored
   * offline by art/pipeline/palette_alt.py, which keeps every head untouched. Same size and frames.
   */
  atlasAlt?: string;
  version: number;
  scale: number;
  facing: "right" | "left";
  clips: Record<string, Clip>;
}

/** Anything drawImage accepts that also knows its size. */
export type AtlasImage = CanvasImageSource & { readonly width: number; readonly height: number };

export interface ClipSet {
  slug: string;
  source: "manifest" | "placeholder";
  atlas: AtlasImage;
  /** Direction the art faces: 1 right, -1 left. Frames are mirrored when the fighter faces the other way. */
  artFacing: 1 | -1;
  clips: Record<string, Clip>;
  /** URL of the alternate-color atlas the manifest names, if any (mirror matches). */
  altAtlasUrl?: string;
}

export class ManifestError extends Error {
  override name = "ManifestError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(obj: Record<string, unknown>, key: string, where: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ManifestError(`${where}.${key} must be a number`);
  }
  return value;
}

function parseFrame(raw: unknown, where: string): ClipFrame {
  if (!isRecord(raw)) throw new ManifestError(`${where} must be an object`);
  const frame: ClipFrame = {
    x: num(raw, "x", where),
    y: num(raw, "y", where),
    w: num(raw, "w", where),
    h: num(raw, "h", where),
    ax: num(raw, "ax", where),
    ay: num(raw, "ay", where),
    hold: num(raw, "hold", where),
  };
  if (frame.w <= 0 || frame.h <= 0) throw new ManifestError(`${where} has an empty rectangle`);
  if (!Number.isInteger(frame.hold) || frame.hold < 1) {
    throw new ManifestError(`${where}.hold must be a positive integer`);
  }
  return frame;
}

/**
 * Validates a manifest in the design-doc format. Unknown extra fields are
 * ignored, so newer manifests keep loading.
 */
export function parseManifest(data: unknown): FighterManifest {
  if (!isRecord(data)) throw new ManifestError("manifest must be an object");
  if (typeof data.fighter !== "string" || data.fighter === "") {
    throw new ManifestError("manifest.fighter must be a non-empty string");
  }
  const version = num(data, "version", "manifest");
  const atlas = data.atlas === undefined ? ATLAS_FILE : data.atlas;
  if (typeof atlas !== "string" || !/^[\w.-]+$/.test(atlas)) {
    throw new ManifestError("manifest.atlas must be a file name next to the manifest");
  }
  const atlasAlt = data.atlasAlt;
  if (atlasAlt !== undefined && (typeof atlasAlt !== "string" || !/^[\w.-]+$/.test(atlasAlt))) {
    throw new ManifestError("manifest.atlasAlt must be a file name next to the manifest");
  }
  const scale = data.scale === undefined ? 1 : num(data, "scale", "manifest");
  const facing = data.facing === undefined ? "right" : data.facing;
  if (facing !== "right" && facing !== "left") {
    throw new ManifestError('manifest.facing must be "right" or "left"');
  }
  if (!isRecord(data.clips)) throw new ManifestError("manifest.clips must be an object");
  const clips: Record<string, Clip> = {};
  for (const [name, rawClip] of Object.entries(data.clips)) {
    const where = `clips.${name}`;
    if (!isRecord(rawClip)) throw new ManifestError(`${where} must be an object`);
    if (typeof rawClip.loop !== "boolean") throw new ManifestError(`${where}.loop must be a boolean`);
    if (!Array.isArray(rawClip.frames) || rawClip.frames.length === 0) {
      throw new ManifestError(`${where}.frames must be a non-empty array`);
    }
    clips[name] = {
      loop: rawClip.loop,
      frames: rawClip.frames.map((f, i) => parseFrame(f, `${where}.frames[${i}]`)),
    };
  }
  if (Object.keys(clips).length === 0) throw new ManifestError("manifest.clips is empty");
  const manifest: FighterManifest = { fighter: data.fighter, atlas, version, scale, facing, clips };
  if (atlasAlt !== undefined) manifest.atlasAlt = atlasAlt;
  return manifest;
}

/** Frames whose rectangle falls outside the atlas, as "clip[index]" labels. */
export function framesOutsideAtlas(
  clips: Record<string, Clip>,
  atlasWidth: number,
  atlasHeight: number,
): string[] {
  const bad: string[] = [];
  for (const [name, clip] of Object.entries(clips)) {
    clip.frames.forEach((f, i) => {
      if (f.x < 0 || f.y < 0 || f.x + f.w > atlasWidth || f.y + f.h > atlasHeight) {
        bad.push(`${name}[${i}]`);
      }
    });
  }
  return bad;
}

export function clipDuration(clip: Clip): number {
  let total = 0;
  for (const f of clip.frames) total += f.hold;
  return total;
}

/**
 * Which frame shows `tick` ticks into the clip, using each frame's hold.
 * Looping clips wrap; others stay on their last frame.
 */
export function clipFrameIndex(clip: Clip, tick: number): number {
  const total = clipDuration(clip);
  let t = tick < 0 ? 0 : tick;
  if (clip.loop) t %= total;
  else if (t >= total) return clip.frames.length - 1;
  for (let i = 0; i < clip.frames.length; i++) {
    const hold = clip.frames[i]!.hold;
    if (t < hold) return i;
    t -= hold;
  }
  return clip.frames.length - 1;
}

// ---------------------------------------------------------------------------
// Placeholder clips from a walk sheet.

/** Source footY 228 maps to 150 px, one global factor so relative heights are kept. */
export const PLACEHOLDER_SOURCE_FOOT_Y = 228;
export const PLACEHOLDER_STANDING_HEIGHT = 150;
export const PLACEHOLDER_SCALE = PLACEHOLDER_STANDING_HEIGHT / PLACEHOLDER_SOURCE_FOOT_Y;
/** Each walk frame shows for 8 sim frames. */
export const PLACEHOLDER_WALK_HOLD = 8;
/** Alpha at or above this becomes opaque, below it transparent. */
export const ALPHA_THRESHOLD = 128;
const SLOT_GAP = 2;

export interface PlaceholderCell {
  /** Source rectangle in the walk sheet. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination slot in the atlas (integer) and the scaled draw size. */
  dx: number;
  dy: number;
  drawW: number;
  drawH: number;
  frame: ClipFrame;
}

export interface PlaceholderLayout {
  atlasWidth: number;
  atlasHeight: number;
  /** The four side-view (facing right) walk frames, in sheet order. */
  cells: PlaceholderCell[];
  clips: Record<string, Clip>;
}

/**
 * Pure geometry of a placeholder atlas: the 4 right-facing walk frames,
 * downscaled by PLACEHOLDER_SCALE, side by side. idle shows the standing
 * frame, walk cycles all four, crouch and jump reuse the standing frame.
 */
export function placeholderLayout(person: Person, scale = PLACEHOLDER_SCALE): PlaceholderLayout {
  const row = WALK_ROWS.right;
  const drawW = person.cellW * scale;
  const drawH = person.cellH * scale;
  const slotW = Math.ceil(drawW);
  const slotH = Math.ceil(drawH);
  const cells: PlaceholderCell[] = person.frames.right.map((metrics, col) => {
    const dx = col * (slotW + SLOT_GAP);
    return {
      sx: col * person.cellW,
      sy: row * person.cellH,
      sw: person.cellW,
      sh: person.cellH,
      dx,
      dy: 0,
      drawW,
      drawH,
      frame: {
        x: dx,
        y: 0,
        w: slotW,
        h: slotH,
        ax: Math.round(metrics.bodyX * scale),
        ay: Math.round(metrics.footY * scale),
        hold: PLACEHOLDER_WALK_HOLD,
      },
    };
  });
  const standing = cells[STANDING_WALK_FRAME.right]!.frame;
  const still = (): Clip => ({ loop: true, frames: [{ ...standing }] });
  return {
    atlasWidth: cells.length * (slotW + SLOT_GAP) - SLOT_GAP,
    atlasHeight: slotH,
    cells,
    clips: {
      idle: still(),
      walk: { loop: true, frames: cells.map((c) => ({ ...c.frame })) },
      crouch: still(),
      jump: still(),
    },
  };
}

/** Hard alpha edges: every pixel becomes fully opaque or fully transparent. */
export function hardenAlpha(rgba: Uint8ClampedArray, threshold = ALPHA_THRESHOLD): void {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i]! >= threshold) {
      rgba[i] = 255;
    } else {
      rgba[i] = 0;
      rgba[i - 1] = 0;
      rgba[i - 2] = 0;
      rgba[i - 3] = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Loading.

export interface Canvas2DLike {
  width: number;
  height: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | null;
}

export interface ClipLoaderDeps {
  /** Parsed JSON at `url`, or null when it is missing or not JSON. */
  fetchJson(url: string): Promise<unknown>;
  loadImage(url: string): Promise<AtlasImage>;
  createCanvas(width: number, height: number): Canvas2DLike & AtlasImage;
  warn(message: string): void;
  /**
   * Optional narrowing: false when the person cannot have generated art, so the loader
   * skips the manifest request instead of letting it 404 (spec 014, A8). In the browser
   * the fighter index (public/fighters/index.json, spec 013) already does this.
   */
  mayHaveArt?(slug: string): boolean;
}

export function manifestUrl(slug: string): string {
  return `./fighters/${slug}/manifest.json`;
}

/** The atlas the manifest names, next to it. */
export function atlasUrl(slug: string, manifest: Pick<FighterManifest, "atlas" | "version">): string {
  return artUrl(`./fighters/${slug}`, manifest.atlas, manifest.version);
}

/** Draws the placeholder atlas once: smooth downscale, then hard alpha. */
export async function buildPlaceholderClipSet(person: Person, deps: ClipLoaderDeps): Promise<ClipSet> {
  const layout = placeholderLayout(person);
  const sheet = await deps.loadImage(person.sheetUrl);
  const canvas = deps.createCanvas(layout.atlasWidth, layout.atlasHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  for (const c of layout.cells) {
    ctx.drawImage(sheet, c.sx, c.sy, c.sw, c.sh, c.dx, c.dy, c.drawW, c.drawH);
  }
  const pixels = ctx.getImageData(0, 0, layout.atlasWidth, layout.atlasHeight);
  hardenAlpha(pixels.data);
  ctx.putImageData(pixels, 0, 0);
  return { slug: person.slug, source: "placeholder", atlas: canvas, artFacing: 1, clips: layout.clips };
}

/** The art pipeline's list of fighters with packed art (art/pipeline/common.py write_fighter_index). */
export const FIGHTER_INDEX_URL = "./fighters/index.json";

/** Slugs listed in a fighter index, or null when the data is not one. */
export function parseFighterIndex(data: unknown): ReadonlySet<string> | null {
  if (!isRecord(data) || !isRecord(data.fighters)) return null;
  return new Set(Object.keys(data.fighters));
}

const indexCache = new WeakMap<object, Promise<ReadonlySet<string> | null>>();

/**
 * Which fighters have a manifest, fetched once per loader. Lets the game skip manifest requests for
 * everyone else (each would be a 404). Null when there is no index: callers then probe manifests.
 */
export function loadFighterIndex(deps: Pick<ClipLoaderDeps, "fetchJson">): Promise<ReadonlySet<string> | null> {
  let pending = indexCache.get(deps);
  if (!pending) {
    pending = deps.fetchJson(FIGHTER_INDEX_URL).then(parseFighterIndex, () => null);
    indexCache.set(deps, pending);
  }
  return pending;
}

/** Loads a fighter's manifest clips, falling back to walk-sheet placeholders. */
export async function loadClipSetUncached(person: Person, deps: ClipLoaderDeps): Promise<ClipSet> {
  let json: unknown = null;
  const index = await loadFighterIndex(deps);
  try {
    // The fighter index (spec 013) is the source of truth; mayHaveArt (spec 014) can narrow it further.
    if ((index === null || index.has(person.slug)) && deps.mayHaveArt?.(person.slug) !== false) json = await deps.fetchJson(manifestUrl(person.slug));
  } catch {
    json = null;
  }
  if (json !== null && json !== undefined) {
    try {
      const manifest = parseManifest(json);
      if (manifest.fighter !== person.slug) {
        deps.warn(`manifest for ${person.slug} names fighter "${manifest.fighter}"`);
      }
      const atlas = await deps.loadImage(atlasUrl(person.slug, manifest));
      const outside = framesOutsideAtlas(manifest.clips, atlas.width, atlas.height);
      if (outside.length > 0) {
        deps.warn(`${person.slug}: frames outside the atlas: ${outside.join(", ")}`);
      }
      const set: ClipSet = {
        slug: person.slug,
        source: "manifest",
        atlas,
        artFacing: manifest.facing === "left" ? -1 : 1,
        clips: manifest.clips,
      };
      if (manifest.atlasAlt !== undefined) {
        set.altAtlasUrl = artUrl(`./fighters/${person.slug}`, manifest.atlasAlt, manifest.version);
      }
      return set;
    } catch (err) {
      // A manifest naming art that does not load is a failed load (spec 014 shows the failure
      // screen), not a fighter without art: only an unusable manifest falls back to placeholders.
      if (!(err instanceof ManifestError)) throw err;
      deps.warn(`${person.slug}: unusable manifest, using placeholder clips (${String(err)})`);
    }
  }
  return buildPlaceholderClipSet(person, deps);
}

const cache = new Map<string, Promise<ClipSet>>();

/** Cached per slug: each fighter's clips are loaded or built once. */
export function loadClipSet(person: Person, deps: ClipLoaderDeps = browserClipDeps()): Promise<ClipSet> {
  let pending = cache.get(person.slug);
  if (!pending) {
    pending = loadClipSetUncached(person, deps);
    cache.set(person.slug, pending);
    pending.catch(() => cache.delete(person.slug));
  }
  return pending;
}

export function clearClipCache(): void {
  cache.clear();
  altCache.clear();
}

let browserDeps: ClipLoaderDeps | null = null;

/** The browser's loader (one shared object, so the fighter index is fetched once per page). */
export function browserClipDeps(): ClipLoaderDeps {
  browserDeps ??= {
    async fetchJson(url) {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      // Dev servers with an SPA fallback answer missing files with index.html.
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("json")) return null;
      try {
        return (await res.json()) as unknown;
      } catch {
        return null;
      }
    },
    async loadImage(url) {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    },
    createCanvas(width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    warn(message) {
      console.warn(message);
    },
  };
  return browserDeps;
}

const altCache = new Map<string, Promise<ClipSet>>();

/**
 * The fighter's clips drawn from their alternate-color atlas (P2 in a mirror match). The recolor
 * happens offline in the art pipeline, per pixel, so the game only loads a second atlas: no
 * readback, and what the pipeline's tests check is exactly what is drawn. Fighters whose manifest
 * names no alternate atlas (or placeholders) get their normal clips. Like the main atlas, a named
 * alternate atlas that does not load is a failed load (spec 014).
 */
export function loadAltClipSet(person: Person, deps: ClipLoaderDeps = browserClipDeps()): Promise<ClipSet> {
  let pending = altCache.get(person.slug);
  if (!pending) {
    pending = (async () => {
      const base = await loadClipSet(person, deps);
      if (base.source !== "manifest" || base.altAtlasUrl === undefined) return base;
      const atlas = await deps.loadImage(base.altAtlasUrl);
      if (atlas.width !== base.atlas.width || atlas.height !== base.atlas.height) {
        deps.warn(`${person.slug}: alternate atlas is ${atlas.width}x${atlas.height}, not ${base.atlas.width}x${base.atlas.height}; using the normal colors`);
        return base;
      }
      return { ...base, atlas };
    })();
    altCache.set(person.slug, pending);
    pending.catch(() => altCache.delete(person.slug));
  }
  return pending;
}
